import { v4 as uuidv4 } from 'uuid';
import { CONFIG, GAME_CONSTANTS } from '../config';
import { settleWagerOnChain } from '../utils/sui-settle';
import { updateCharacterOnChain, findCharacterObjectId, setFightLockOnChain } from '../utils/sui-settle';
import { fetchEquippedFromDOFs, applyDOFEquipment } from '../utils/sui-read';
import {
  applyXp,
  checkFightEnd,
  createFighterState,
  generateRandomAction,
  getOffhandType,
  resolveTurn,
  validateTurnAction,
} from '../game/combat';
import { rollLoot } from '../game/loot';
import { calculateEloChange, calculateXpReward } from '../utils/elo';
import {
  addFightHistory,
  getCharacterById,
  updateCharacter,
  persistItems,
} from '../data/characters';
import { dbSaveFight, dbDeleteWagerInFlight } from '../data/db';
import {
  markDisconnect as graceMarkDisconnect,
  markReconnect as graceMarkReconnect,
} from './reconnect-grace';
import type {
  Character,
  ConnectedClient,
  FightHistoryEntry,
  FightState,
  FightType,
  Item,
  OffhandType,
  ServerMessage,
  TurnAction,
} from '../types';

// === Active Fights Store ===

const activeFights = new Map<string, FightState>();
const finishedFights = new Map<string, FightState>();

// Client registry (set from handler.ts)
let clientsRef: Map<string, ConnectedClient> = new Map();

export function setClientsRef(clients: Map<string, ConnectedClient>): void {
  clientsRef = clients;
}

function getClientByWallet(walletAddress: string): ConnectedClient | undefined {
  for (const [, client] of clientsRef) {
    if (client.walletAddress === walletAddress) return client;
  }
  return undefined;
}

function sendToClient(client: ConnectedClient, msg: ServerMessage): void {
  if (client.socket.readyState === client.socket.OPEN) {
    client.socket.send(JSON.stringify(msg));
  }
}

function sendToWallet(wallet: string, msg: ServerMessage): void {
  const client = getClientByWallet(wallet);
  if (client) sendToClient(client, msg);
}

function broadcastToFightPlayers(fight: FightState, msgForA: ServerMessage, msgForB: ServerMessage): void {
  sendToWallet(fight.playerA.walletAddress, msgForA);
  sendToWallet(fight.playerB.walletAddress, msgForB);
}

function broadcastToFight(fight: FightState, msg: ServerMessage): void {
  sendToWallet(fight.playerA.walletAddress, msg);
  sendToWallet(fight.playerB.walletAddress, msg);
  // Spectators
  for (const spectatorWallet of fight.spectators) {
    sendToWallet(spectatorWallet, msg);
  }
}

function broadcastToSpectators(fight: FightState, msg: ServerMessage): void {
  for (const spectatorWallet of fight.spectators) {
    sendToWallet(spectatorWallet, msg);
  }
}

function buildFightStatePayload(fight: FightState): Record<string, any> {
  return {
    id: fight.id,
    type: fight.type,
    status: fight.status,
    playerA: {
      characterId: fight.playerA.characterId,
      walletAddress: fight.playerA.walletAddress,
      name: fight.playerA.character.name,
      currentHp: fight.playerA.currentHp,
      maxHp: fight.playerA.maxHp,
      level: fight.playerA.character.level,
      equipment: fight.playerA.character.equipment,
      stats: fight.playerA.character.stats,
    },
    playerB: {
      characterId: fight.playerB.characterId,
      walletAddress: fight.playerB.walletAddress,
      name: fight.playerB.character.name,
      currentHp: fight.playerB.currentHp,
      maxHp: fight.playerB.maxHp,
      level: fight.playerB.character.level,
      equipment: fight.playerB.character.equipment,
      stats: fight.playerB.character.stats,
    },
    turn: fight.turn,
    log: fight.turnResults,
    wagerAmount: fight.wagerAmount,
  };
}

// === Create a Fight ===

export async function createFight(
  characterA: Character,
  characterB: Character,
  fightType: FightType,
  wagerAmount?: number
): Promise<FightState> {
  // D3 (strict): re-read chain DOFs right before the combat snapshot. This is
  // the anti-cheat seam — even if the client lied about equipment at
  // queue/accept time, chain-truth is what enters the fight. Also catches
  // any save the player did between auth and this moment. Done in parallel
  // with the character lookup so fight-start latency stays in the same
  // budget as the RPC we already pay for fight-lock acquisition.
  // Prefer the pinned `onChainObjectId` on the server-side Character record
  // — set once at auth/restore time. Multi-character wallets (legacy / migration)
  // would otherwise hit the wrong NFT via `findCharacterObjectId`'s newest-first
  // event scan. Fall back to the scan only if pinning hasn't happened yet
  // (legacy rows pre-onChainObjectId).
  const [aObjId, bObjId] = await Promise.all([
    characterA.onChainObjectId ?? findCharacterObjectId(characterA.walletAddress),
    characterB.onChainObjectId ?? findCharacterObjectId(characterB.walletAddress),
  ]);
  const [dofA, dofB] = await Promise.all([
    aObjId ? fetchEquippedFromDOFs(aObjId) : Promise.resolve(null),
    bObjId ? fetchEquippedFromDOFs(bObjId) : Promise.resolve(null),
  ]);
  if (dofA) {
    const changed = applyDOFEquipment(characterA.equipment, dofA);
    if (changed.length > 0) {
      console.log(`[Fight] ${characterA.name} DOF-synced slots: ${changed.join(', ')}`);
    }
  }
  if (dofB) {
    const changed = applyDOFEquipment(characterB.equipment, dofB);
    if (changed.length > 0) {
      console.log(`[Fight] ${characterB.name} DOF-synced slots: ${changed.join(', ')}`);
    }
  }

  const fighterA = createFighterState(characterA, characterB);
  const fighterB = createFighterState(characterB, characterA);

  const fight: FightState = {
    id: uuidv4(),
    type: fightType,
    playerA: fighterA,
    playerB: fighterB,
    turn: 0,
    turnResults: [],
    status: 'active',
    wagerAmount,
    spectators: new Set(),
    turnActions: new Map(),
    startedAt: Date.now(),
  };

  activeFights.set(fight.id, fight);

  // Notify both players
  const clientA = getClientByWallet(characterA.walletAddress);
  const clientB = getClientByWallet(characterB.walletAddress);

  if (clientA) clientA.currentFightId = fight.id;
  if (clientB) clientB.currentFightId = fight.id;

  const fightPayload = buildFightStatePayload(fight);

  const startMsg: ServerMessage = {
    type: 'fight_start',
    fight: fightPayload,
  };

  broadcastToFight(fight, startMsg);

  // On-chain fight-lock (fire-and-forget — auto-expiry is the safety net if
  // this fails, and server-side fight state is authoritative for combat
  // resolution regardless). Reuses the object IDs fetched above.
  (async () => {
    try {
      const expiry = Date.now() + CONFIG.FIGHT_LOCK_DURATION_MS;
      const locks: Promise<unknown>[] = [];
      if (aObjId) locks.push(setFightLockOnChain(aObjId, expiry));
      if (bObjId) locks.push(setFightLockOnChain(bObjId, expiry));
      await Promise.allSettled(locks);
    } catch (err: any) {
      console.error('[FightLock] Acquire failed at fight start:', err?.message || err);
    }
  })();

  // Start first turn
  startNextTurn(fight);

  return fight;
}

// === Turn Management ===

function startNextTurn(fight: FightState): void {
  fight.turn++;
  fight.turnActions.clear();

  const deadline = Date.now() + GAME_CONSTANTS.TURN_TIMER_MS;

  const turnStartMsg: ServerMessage = {
    type: 'turn_start',
    turn: fight.turn,
    deadline,
  };

  broadcastToFight(fight, turnStartMsg);

  // Set turn timer
  fight.turnTimer = setTimeout(() => {
    handleTurnTimeout(fight);
  }, GAME_CONSTANTS.TURN_TIMER_MS);
}

function handleTurnTimeout(fight: FightState): void {
  if (fight.status !== 'active') return;

  const offhandA = getOffhandType(fight.playerA.character.equipment);
  const offhandB = getOffhandType(fight.playerB.character.equipment);

  // Auto-generate actions for players who didn't submit
  if (!fight.turnActions.has(fight.playerA.characterId)) {
    fight.turnActions.set(fight.playerA.characterId, generateRandomAction(offhandA));
  }
  if (!fight.turnActions.has(fight.playerB.characterId)) {
    fight.turnActions.set(fight.playerB.characterId, generateRandomAction(offhandB));
  }

  resolveFightTurn(fight);
}

// === Submit Turn Action ===

export function submitTurnAction(
  fightId: string,
  characterId: string,
  action: TurnAction
): { success: boolean; error?: string } {
  const fight = activeFights.get(fightId);
  if (!fight) return { success: false, error: 'Fight not found' };
  if (fight.status !== 'active') return { success: false, error: 'Fight is not active' };

  // Verify this player is in the fight
  const isPlayerA = fight.playerA.characterId === characterId;
  const isPlayerB = fight.playerB.characterId === characterId;
  if (!isPlayerA && !isPlayerB) {
    return { success: false, error: 'You are not in this fight' };
  }

  // Already submitted this turn?
  if (fight.turnActions.has(characterId)) {
    return { success: false, error: 'Already submitted action for this turn' };
  }

  // Validate action
  const character = isPlayerA ? fight.playerA.character : fight.playerB.character;
  const offhand = getOffhandType(character.equipment);
  const validation = validateTurnAction(action, offhand);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  fight.turnActions.set(characterId, action);

  // Acknowledge
  const wallet = isPlayerA ? fight.playerA.walletAddress : fight.playerB.walletAddress;
  sendToWallet(wallet, {
    type: 'fight_action_ack',
    fightId,
    turn: fight.turn,
  });

  // If both players have submitted, resolve immediately
  if (
    fight.turnActions.has(fight.playerA.characterId) &&
    fight.turnActions.has(fight.playerB.characterId)
  ) {
    // Clear the timer
    if (fight.turnTimer) {
      clearTimeout(fight.turnTimer);
      fight.turnTimer = undefined;
    }
    resolveFightTurn(fight);
  }

  return { success: true };
}

// === Resolve Turn ===

function resolveFightTurn(fight: FightState): void {
  const actionA = fight.turnActions.get(fight.playerA.characterId)!;
  const actionB = fight.turnActions.get(fight.playerB.characterId)!;

  const turnResult = resolveTurn(
    fight.turn,
    fight.playerA,
    fight.playerB,
    actionA,
    actionB
  );

  fight.turnResults.push(turnResult);

  // Build turn result message. hpAfter is included so the frontend damage log
  // can render post-turn HP (without this the log shows "Your HP: ?").
  const turnResultMsg: ServerMessage = {
    type: 'turn_result',
    result: {
      turn: turnResult.turn,
      playerA: {
        actions: turnResult.playerA.actions,
        hits: turnResult.playerA.hits,
        hpAfter: turnResult.playerA.hpAfter,
      },
      playerB: {
        actions: turnResult.playerB.actions,
        hits: turnResult.playerB.hits,
        hpAfter: turnResult.playerB.hpAfter,
      },
    },
    fight: buildFightStatePayload(fight),
  };

  broadcastToFight(fight, turnResultMsg);

  // Check if fight is over
  const endCheck = checkFightEnd(fight.playerA, fight.playerB);

  if (endCheck.finished) {
    finishFight(fight, endCheck.winner, endCheck.draw, endCheck.draw ? 'draw' : 'hp_zero');
  } else {
    // Start next turn after a short delay
    setTimeout(() => {
      if (fight.status === 'active') {
        startNextTurn(fight);
      }
    }, 1500);
  }
}

// === Finish Fight ===

type FinishReason = 'hp_zero' | 'draw' | 'disconnect';

function finishFight(
  fight: FightState,
  winnerId?: string,
  draw?: boolean,
  reason: FinishReason = 'hp_zero',
): void {
  fight.status = 'finished';
  fight.finishedAt = Date.now();

  // Bug C diagnostic — distinguishes HP-zero / draw / disconnect-forfeit end
  // paths. If a reported "fight ended without HP zero" happens, the log line
  // tells us whether the cause was a disconnect (reason=disconnect, both HPs
  // above 0) or something else entirely.
  console.log(
    `[Fight] End id=${fight.id.slice(0, 8)} reason=${reason}` +
    ` winner=${winnerId ? winnerId.slice(0, 10) : 'none'} draw=${!!draw}` +
    ` turn=${fight.turn}` +
    ` hpA=${fight.playerA.currentHp}/${fight.playerA.maxHp}` +
    ` hpB=${fight.playerB.currentHp}/${fight.playerB.maxHp}`,
  );

  if (fight.turnTimer) {
    clearTimeout(fight.turnTimer);
    fight.turnTimer = undefined;
  }

  let winnerWallet: string | undefined;
  let loserWallet: string | undefined;
  let winnerChar: Character | undefined;
  let loserChar: Character | undefined;

  if (!draw && winnerId) {
    fight.winner = winnerId;
    const isAWinner = fight.playerA.characterId === winnerId;
    winnerWallet = isAWinner ? fight.playerA.walletAddress : fight.playerB.walletAddress;
    loserWallet = isAWinner ? fight.playerB.walletAddress : fight.playerA.walletAddress;
    winnerChar = getCharacterById(isAWinner ? fight.playerA.characterId : fight.playerB.characterId);
    loserChar = getCharacterById(isAWinner ? fight.playerB.characterId : fight.playerA.characterId);
  }

  // Process rewards
  let winnerRatingChange = 0;
  let loserRatingChange = 0;
  let winnerXp = 0;
  let loserXp = 0;
  let lootDrop: Item | null = null;

  if (winnerChar && loserChar && !draw) {
    // ELO update for ranked/wager
    if (fight.type === 'ranked' || fight.type === 'wager') {
      const elo = calculateEloChange(winnerChar.rating, loserChar.rating);
      winnerRatingChange = elo.winnerDelta;
      loserRatingChange = elo.loserDelta;
      winnerChar.rating = elo.winnerNew;
      loserChar.rating = elo.loserNew;
    }

    // XP
    winnerXp = calculateXpReward(fight.type, true, winnerChar.rating, loserChar.rating);
    loserXp = calculateXpReward(fight.type, false, winnerChar.rating, loserChar.rating);

    applyXp(winnerChar, winnerXp);
    applyXp(loserChar, loserXp);

    // Win/loss tracking
    winnerChar.wins++;
    loserChar.losses++;

    // Wager handling — settle on-chain if wagerMatchId exists, else fall back to gold
    if (fight.type === 'wager' && fight.wagerMatchId && winnerWallet) {
      const wagerMatchId = fight.wagerMatchId;
      settleWagerOnChain(wagerMatchId, winnerWallet)
        .then(({ digest }) => {
          console.log(`[Wager] Settled on-chain: ${digest}`);
          // Settlement landed — drop the in-flight recovery row so the boot
          // sweeper doesn't accidentally re-cancel a settled wager on next
          // restart. (Idempotent: admin_cancel_wager would abort with
          // EMatchAlreadySettled anyway, but cleaning up keeps the table
          // honest.)
          dbDeleteWagerInFlight(wagerMatchId).catch(() => {});
          sendToWallet(fight.playerA.walletAddress, { type: 'wager_settled', txDigest: digest, wagerMatchId });
          sendToWallet(fight.playerB.walletAddress, { type: 'wager_settled', txDigest: digest, wagerMatchId });
        })
        .catch((err) => {
          console.error('[Wager] On-chain settlement failed:', err);
          // Leave the in-flight row in place — boot sweeper handles it.
          sendToWallet(fight.playerA.walletAddress, { type: 'error', message: 'Wager settlement failed on-chain. Refund expected within 10 minutes.', sticky: true });
          sendToWallet(fight.playerB.walletAddress, { type: 'error', message: 'Wager settlement failed on-chain. Refund expected within 10 minutes.', sticky: true });
        });
    } else if (fight.type === 'wager' && fight.wagerAmount) {
      // Fallback: gold-based wager (no on-chain escrow)
      winnerChar.gold += fight.wagerAmount;
      loserChar.gold = Math.max(0, loserChar.gold - fight.wagerAmount);
    }

    // Loot
    lootDrop = rollLoot(winnerChar.level);
    if (lootDrop) {
      winnerChar.inventory.push(lootDrop);
    }

    // Persist
    updateCharacter(winnerChar);
    updateCharacter(loserChar);

    // Fight history for winner
    addFightHistory(winnerChar.id, {
      fightId: fight.id,
      type: fight.type,
      opponentName: loserChar.name,
      opponentWallet: loserChar.walletAddress,
      result: 'win',
      ratingChange: winnerRatingChange,
      xpGained: winnerXp,
      lootGained: lootDrop,
      turns: fight.turn,
      timestamp: Date.now(),
    });

    // Fight history for loser
    addFightHistory(loserChar.id, {
      fightId: fight.id,
      type: fight.type,
      opponentName: winnerChar.name,
      opponentWallet: winnerChar.walletAddress,
      result: 'loss',
      ratingChange: loserRatingChange,
      xpGained: loserXp,
      lootGained: null,
      turns: fight.turn,
      timestamp: Date.now(),
    });

    // Persist fight + items to Supabase (fire-and-forget)
    dbSaveFight(
      fight.id, winnerChar.walletAddress, loserChar.walletAddress,
      fight.turn, fight.type, winnerXp, loserXp,
      winnerRatingChange, loserRatingChange,
    ).catch(() => {});
    persistItems(winnerChar);
    persistItems(loserChar);

    // Update on-chain Character NFTs + release fight-lock.
    // Each updateCharacterOnChain has built-in 3-attempt exponential-backoff
    // retry. On success, the returned FightResultEffects (parsed from on-chain
    // events) is the SOURCE OF TRUTH for the post-fight character state — we
    // overwrite the server's optimistic in-memory cache with chain values so
    // server and chain never diverge on `unallocated_points`. On exhausted
    // retry, we send a sticky error to the affected player so they know the
    // chain state is stale.
    const winnerCharRef = winnerChar;
    const loserCharRef = loserChar;
    void (async () => {
      // Pinned id wins; falls back to event scan only for legacy records.
      const [winnerObjId, loserObjId] = await Promise.all([
        winnerCharRef.onChainObjectId
          ? Promise.resolve(winnerCharRef.onChainObjectId)
          : findCharacterObjectId(winnerCharRef.walletAddress).catch(() => null),
        loserCharRef.onChainObjectId
          ? Promise.resolve(loserCharRef.onChainObjectId)
          : findCharacterObjectId(loserCharRef.walletAddress).catch(() => null),
      ]);

      if (winnerObjId) {
        try {
          const effects = await updateCharacterOnChain(
            winnerObjId, true, winnerXp, winnerCharRef.rating,
          );
          // Mirror chain truth into server cache
          winnerCharRef.xp = effects.newXp;
          winnerCharRef.rating = effects.newRating;
          winnerCharRef.wins = effects.newWins;
          winnerCharRef.losses = effects.newLosses;
          if (effects.leveledUp) {
            winnerCharRef.level = effects.newLevel;
            winnerCharRef.unallocatedPoints = effects.newUnallocatedPoints;
          }
          updateCharacter(winnerCharRef);
          sendToWallet(winnerCharRef.walletAddress, { type: 'character_updated_onchain' });
        } catch (err: any) {
          console.error('[Character] Winner on-chain update failed after retries:', err?.message || err);
          sendToWallet(winnerCharRef.walletAddress, {
            type: 'error',
            message: 'On-chain character update failed after retries. Stats may be temporarily out of sync — please refresh.',
          });
        }
      }

      if (loserObjId) {
        try {
          const effects = await updateCharacterOnChain(
            loserObjId, false, loserXp, loserCharRef.rating,
          );
          loserCharRef.xp = effects.newXp;
          loserCharRef.rating = effects.newRating;
          loserCharRef.wins = effects.newWins;
          loserCharRef.losses = effects.newLosses;
          if (effects.leveledUp) {
            loserCharRef.level = effects.newLevel;
            loserCharRef.unallocatedPoints = effects.newUnallocatedPoints;
          }
          updateCharacter(loserCharRef);
          sendToWallet(loserCharRef.walletAddress, { type: 'character_updated_onchain' });
        } catch (err: any) {
          console.error('[Character] Loser on-chain update failed after retries:', err?.message || err);
          sendToWallet(loserCharRef.walletAddress, {
            type: 'error',
            message: 'On-chain character update failed after retries. Stats may be temporarily out of sync — please refresh.',
          });
        }
      }

      // Release fight-locks. Routes through the treasury queue (sequential)
      // so the release tx never races a concurrent settlement for the same
      // gas coin. On exhausted retry we surface a sticky toast so the
      // player knows their lock is auto-expiring; the chain's MAX_LOCK_MS
      // = 1 hour ceiling is the ultimate safety net, and the testnet-only
      // `/api/admin/force-unlock` endpoint can clear it sooner.
      if (winnerObjId) {
        setFightLockOnChain(winnerObjId, 0).catch((err) => {
          const detail = err?.message || String(err);
          console.error('[FightLock] Release (winner) failed:', detail);
          sendToWallet(winnerCharRef.walletAddress, {
            type: 'error',
            message: 'Fight-lock release failed on chain. Lock auto-expires within 1 hour. Refresh once it clears, or contact support.',
            sticky: true,
          });
        });
      }
      if (loserObjId) {
        setFightLockOnChain(loserObjId, 0).catch((err) => {
          const detail = err?.message || String(err);
          console.error('[FightLock] Release (loser) failed:', detail);
          sendToWallet(loserCharRef.walletAddress, {
            type: 'error',
            message: 'Fight-lock release failed on chain. Lock auto-expires within 1 hour. Refresh once it clears, or contact support.',
            sticky: true,
          });
        });
      }
    })();
  } else if (draw) {
    // Draw: both get small XP, no rating change
    const charA = getCharacterById(fight.playerA.characterId);
    const charB = getCharacterById(fight.playerB.characterId);
    if (charA) {
      const xp = calculateXpReward(fight.type, false, charA.rating, charA.rating);
      applyXp(charA, xp);
      updateCharacter(charA);
      addFightHistory(charA.id, {
        fightId: fight.id,
        type: fight.type,
        opponentName: charB?.name || 'Unknown',
        opponentWallet: fight.playerB.walletAddress,
        result: 'loss',
        ratingChange: 0,
        xpGained: xp,
        lootGained: null,
        turns: fight.turn,
        timestamp: Date.now(),
      });
    }
    if (charB) {
      const xp = calculateXpReward(fight.type, false, charB.rating, charB.rating);
      applyXp(charB, xp);
      updateCharacter(charB);
      addFightHistory(charB.id, {
        fightId: fight.id,
        type: fight.type,
        opponentName: charA?.name || 'Unknown',
        opponentWallet: fight.playerA.walletAddress,
        result: 'loss',
        ratingChange: 0,
        xpGained: xp,
        lootGained: null,
        turns: fight.turn,
        timestamp: Date.now(),
      });
    }
  }

  // Build the final fight state
  const fightPayload = buildFightStatePayload(fight);
  fightPayload.status = 'finished';
  fightPayload.winner = winnerWallet || null;

  // Send DIFFERENT loot to winner and loser
  if (winnerWallet && loserWallet) {
    const winnerMsg: ServerMessage = {
      type: 'fight_end',
      fight: fightPayload,
      loot: {
        xpGained: winnerXp,
        ratingChange: winnerRatingChange,
        item: lootDrop ? { id: lootDrop.id, name: lootDrop.name, rarity: lootDrop.rarity, itemType: lootDrop.itemType } : undefined,
      },
    };

    const loserMsg: ServerMessage = {
      type: 'fight_end',
      fight: fightPayload,
      loot: {
        xpGained: loserXp,
        ratingChange: loserRatingChange,
      },
    };

    sendToWallet(winnerWallet, winnerMsg);
    sendToWallet(loserWallet, loserMsg);

    // Spectators get the winner's view
    broadcastToSpectators(fight, winnerMsg);
  } else {
    // Draw case
    const drawMsg: ServerMessage = {
      type: 'fight_end',
      fight: fightPayload,
      loot: {
        xpGained: 0,
        ratingChange: 0,
      },
    };
    broadcastToFight(fight, drawMsg);
  }

  // Clean up client fight references
  const clientA = getClientByWallet(fight.playerA.walletAddress);
  const clientB = getClientByWallet(fight.playerB.walletAddress);
  if (clientA) clientA.currentFightId = undefined;
  if (clientB) clientB.currentFightId = undefined;

  // Move to finished fights
  activeFights.delete(fight.id);
  finishedFights.set(fight.id, fight);

  // Clean up spectators
  for (const spectatorWallet of fight.spectators) {
    const spectator = getClientByWallet(spectatorWallet);
    if (spectator) spectator.spectatingFightId = undefined;
  }
  fight.spectators.clear();
}

// === Spectator Support ===

export function addSpectator(fightId: string, walletAddress: string): { success: boolean; error?: string; fight?: FightState } {
  const fight = activeFights.get(fightId);
  if (!fight) return { success: false, error: 'Fight not found or already finished' };
  if (fight.playerA.walletAddress === walletAddress || fight.playerB.walletAddress === walletAddress) {
    return { success: false, error: 'You are a participant in this fight' };
  }

  fight.spectators.add(walletAddress);

  const client = getClientByWallet(walletAddress);
  if (client) client.spectatingFightId = fightId;

  return { success: true, fight };
}

export function removeSpectator(fightId: string, walletAddress: string): void {
  const fight = activeFights.get(fightId) || finishedFights.get(fightId);
  if (fight) {
    fight.spectators.delete(walletAddress);
  }
}

// === Queries ===

export function getActiveFight(fightId: string): FightState | undefined {
  return activeFights.get(fightId);
}

export function getFinishedFight(fightId: string): FightState | undefined {
  return finishedFights.get(fightId);
}

export function getFight(fightId: string): FightState | undefined {
  return activeFights.get(fightId) || finishedFights.get(fightId);
}

export function getActiveFights(): FightState[] {
  return Array.from(activeFights.values());
}

export function getPlayerActiveFight(walletAddress: string): FightState | undefined {
  for (const [, fight] of activeFights) {
    if (
      fight.playerA.walletAddress === walletAddress ||
      fight.playerB.walletAddress === walletAddress
    ) {
      return fight;
    }
  }
  return undefined;
}

/**
 * Schedule a forfeit for `walletAddress` after the reconnect grace window
 * expires. Closes Block C1 of the 2026-04-30 Gemini re-audit: the pre-fix
 * implementation forfeited INSTANTLY on socket close, costing players real
 * SUI to a 2-second wifi blip.
 *
 * Idempotent: duplicate close events on one socket don't reset the grace
 * clock. The opponent is notified once via `opponent_disconnected`. If the
 * same wallet re-authenticates in time, `handlePlayerReconnect` cancels
 * the timer and emits `opponent_reconnected` + a fresh `fight_resumed`
 * payload.
 */
export function handlePlayerDisconnect(walletAddress: string): void {
  const fight = getPlayerActiveFight(walletAddress);
  if (!fight) return;

  const opponentWallet =
    fight.playerA.walletAddress === walletAddress
      ? fight.playerB.walletAddress
      : fight.playerA.walletAddress;
  const fightId = fight.id;

  const info = graceMarkDisconnect(walletAddress, fightId, () => {
    // Re-resolve the fight at timeout time — it may have ended via
    // another path (chain settle, draw, etc.) during the grace window.
    const stillActive = activeFights.get(fightId);
    if (!stillActive) {
      console.log(
        `[Fight] ${walletAddress.slice(0, 10)} forfeit timeout fired but fight ${fightId} ` +
        `is no longer active — skipping (already finished by another path).`,
      );
      return;
    }

    const isPlayerA = stillActive.playerA.walletAddress === walletAddress;
    const winnerId = isPlayerA
      ? stillActive.playerB.characterId
      : stillActive.playerA.characterId;
    console.log(
      `[Fight] ${walletAddress.slice(0, 10)} did not reconnect within grace — forfeit fight ${fightId}`,
    );
    finishFight(stillActive, winnerId, false, 'disconnect');
  });

  if (!info) return; // duplicate close on one socket — opponent already notified

  console.log(
    `[Fight] ${walletAddress.slice(0, 10)} disconnected from fight ${fightId} — granting ` +
    `${Math.round(info.graceMs / 1000)}s reconnect grace (expires ${new Date(info.expiresAt).toISOString()})`,
  );

  // Tell the opponent so they don't think the game has frozen.
  sendToWallet(opponentWallet, {
    type: 'opponent_disconnected',
    fightId,
    expiresAt: info.expiresAt,
    graceMs: info.graceMs,
  } as ServerMessage);
}

/**
 * Cancel a pending forfeit for `walletAddress` if one exists. Called from
 * `acceptAuthenticatedSession` (handler.ts) every time a wallet
 * re-authenticates.
 */
export function handlePlayerReconnect(walletAddress: string): void {
  const fightId = graceMarkReconnect(walletAddress);
  if (!fightId) return;

  const fight = activeFights.get(fightId);
  if (!fight) {
    // Fight ended on another path during the grace window. Nothing more
    // to do — the rejoining client will receive its own auth_ok with no
    // fight in flight.
    console.log(
      `[Fight] ${walletAddress.slice(0, 10)} reconnected but fight ${fightId} is no longer active — ` +
      `nothing to resume.`,
    );
    return;
  }

  console.log(
    `[Fight] ${walletAddress.slice(0, 10)} reconnected to fight ${fightId} within grace — forfeit cancelled.`,
  );

  const opponentWallet =
    fight.playerA.walletAddress === walletAddress
      ? fight.playerB.walletAddress
      : fight.playerA.walletAddress;
  sendToWallet(opponentWallet, {
    type: 'opponent_reconnected',
    fightId,
  } as ServerMessage);

  // Push the current fight state to the rejoining client so its UI
  // re-hydrates immediately (turn count, HP, log).
  sendToWallet(walletAddress, {
    type: 'fight_resumed',
    fight: buildFightStatePayload(fight),
  } as ServerMessage);
}
