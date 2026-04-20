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
import { dbSaveFight } from '../data/db';
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
  const [aObjId, bObjId] = await Promise.all([
    findCharacterObjectId(characterA.walletAddress),
    findCharacterObjectId(characterB.walletAddress),
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
      settleWagerOnChain(fight.wagerMatchId, winnerWallet)
        .then(({ digest }) => {
          console.log(`[Wager] Settled on-chain: ${digest}`);
          sendToWallet(fight.playerA.walletAddress, { type: 'wager_settled', txDigest: digest, wagerMatchId: fight.wagerMatchId });
          sendToWallet(fight.playerB.walletAddress, { type: 'wager_settled', txDigest: digest, wagerMatchId: fight.wagerMatchId });
        })
        .catch((err) => {
          console.error('[Wager] On-chain settlement failed:', err);
          sendToWallet(fight.playerA.walletAddress, { type: 'error', message: 'Wager settlement failed on-chain. Contact support.' });
          sendToWallet(fight.playerB.walletAddress, { type: 'error', message: 'Wager settlement failed on-chain. Contact support.' });
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

    // Update on-chain Character NFTs + release fight-lock (fire-and-forget)
    (async () => {
      try {
        const [winnerObjId, loserObjId] = await Promise.all([
          findCharacterObjectId(winnerChar.walletAddress),
          findCharacterObjectId(loserChar.walletAddress),
        ]);
        if (winnerObjId) {
          await updateCharacterOnChain(winnerObjId, true, winnerXp, winnerChar.rating);
        }
        if (loserObjId) {
          await updateCharacterOnChain(loserObjId, false, loserXp, loserChar.rating);
        }
        // Release on-chain fight-lock so players can equip/unequip again immediately.
        // If these fail, the 10-minute auto-expiry from createFight is the safety net.
        if (winnerObjId) {
          setFightLockOnChain(winnerObjId, 0).catch((err) =>
            console.error('[FightLock] Release (winner) failed:', err?.message || err));
        }
        if (loserObjId) {
          setFightLockOnChain(loserObjId, 0).catch((err) =>
            console.error('[FightLock] Release (loser) failed:', err?.message || err));
        }
        // Notify clients that on-chain character data has been updated
        sendToWallet(winnerChar.walletAddress, { type: 'character_updated_onchain' });
        sendToWallet(loserChar.walletAddress, { type: 'character_updated_onchain' });
      } catch (err: any) {
        console.error('[Character] On-chain update after fight failed:', err.message);
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
 * Clean up a fight if a player disconnects.
 */
export function handlePlayerDisconnect(walletAddress: string): void {
  const fight = getPlayerActiveFight(walletAddress);
  if (!fight) return;

  // The disconnecting player forfeits
  const isPlayerA = fight.playerA.walletAddress === walletAddress;
  const winnerId = isPlayerA ? fight.playerB.characterId : fight.playerA.characterId;

  finishFight(fight, winnerId, false, 'disconnect');
}
