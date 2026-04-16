import { v4 as uuidv4 } from 'uuid';
import type WebSocket from 'ws';
import type {
  ClientMessage,
  ConnectedClient,
  EquipmentSlots,
  ServerMessage,
  TurnAction,
  Zone,
} from '../types';
import {
  createCharacter,
  getCharacterByWallet,
  restoreCharacterFromDb,
  equipItem,
  unequipItem,
  addToInventory,
  getFightHistory,
} from '../data/characters';
import { getShopCatalog, getShopItemById, getShopItemPrice, purchaseShopItem } from '../data/items';
import { getLeaderboard } from '../data/leaderboard';
import { getMatchmaking } from '../game/matchmaking';
import {
  submitTurnAction,
  addSpectator,
  getActiveFights,
  getFight,
  setClientsRef,
  handlePlayerDisconnect,
} from './fight-room';
import {
  registerChatClient,
  unregisterChatClient,
  handleChatMessage,
  broadcastSystemMessage,
  getChatClients,
} from './chat';
import { CONFIG, GAME_CONSTANTS } from '../config';
import { verifyEquipmentOwnership } from '../utils/sui-verify';
import { getWagerStatus } from '../utils/sui-settle';
import {
  createFight,
} from './fight-room';

// === Connected Clients Registry ===

const connectedClients = new Map<string, ConnectedClient>();

// Share with fight-room module
setClientsRef(connectedClients);

function send(client: ConnectedClient, msg: ServerMessage): void {
  if (client.socket.readyState === client.socket.OPEN) {
    client.socket.send(JSON.stringify(msg));
  }
}

function sendError(client: ConnectedClient, message: string): void {
  send(client, { type: 'error', message });
}

// === Connection Handling ===

export function handleConnection(socket: WebSocket): void {
  const clientId = uuidv4();
  const client: ConnectedClient = {
    id: clientId,
    socket,
    lastChatTime: 0,
    authenticated: false,
  };

  connectedClients.set(clientId, client);
  console.log(`[WS] Client connected: ${clientId} (total: ${connectedClients.size})`);

  socket.on('message', (raw: Buffer | string) => {
    try {
      const data = JSON.parse(typeof raw === 'string' ? raw : raw.toString()) as ClientMessage;
      handleMessage(client, data);
    } catch (err) {
      sendError(client, 'Invalid message format');
    }
  });

  socket.on('close', () => {
    handleDisconnect(client);
  });

  socket.on('error', (err) => {
    console.error(`[WS] Client error ${clientId}:`, err.message);
  });
}

function handleDisconnect(client: ConnectedClient): void {
  // If this client was already removed (replaced by a newer session), skip teardown
  if (!connectedClients.has(client.id)) return;

  console.log(`[WS] Client disconnected: ${client.id} (wallet: ${client.walletAddress || 'none'})`);

  if (client.walletAddress) {
    // Remove from matchmaking queue
    try {
      getMatchmaking().removeFromQueue(client.walletAddress);
    } catch { /* matchmaking may not be initialized */ }

    // Handle active fight disconnect (forfeit)
    handlePlayerDisconnect(client.walletAddress);

    // Remove from chat
    unregisterChatClient(client.walletAddress);

    // Notify others
    broadcastSystemMessage(`${client.walletAddress.slice(0, 8)}... has left.`);
  }

  connectedClients.delete(client.id);
}

// === Message Router ===

function handleMessage(client: ConnectedClient, msg: ClientMessage): void {
  // Auth must be first
  if (msg.type !== 'auth' && !client.authenticated) {
    sendError(client, 'Not authenticated. Send auth message first.');
    return;
  }

  switch (msg.type) {
    case 'auth':
      handleAuth(client, msg);
      break;
    case 'create_character':
      handleCreateCharacter(client, msg);
      break;
    case 'get_character':
      handleGetCharacter(client, msg);
      break;
    case 'queue_fight':
      handleQueueFight(client, msg);
      break;
    case 'cancel_queue':
      handleCancelQueue(client);
      break;
    case 'fight_action':
      handleFightAction(client, msg);
      break;
    case 'chat_message':
      handleChat(client, msg);
      break;
    case 'get_online_players':
      handleGetOnlinePlayers(client);
      break;
    case 'equip_item':
      handleEquipItem(client, msg);
      break;
    case 'unequip_item':
      handleUnequipItem(client, msg);
      break;
    case 'buy_shop_item':
      handleBuyShopItem(client, msg);
      break;
    case 'get_shop':
      handleGetShop(client);
      break;
    case 'get_inventory':
      handleGetInventory(client);
      break;
    case 'get_leaderboard':
      handleGetLeaderboard(client);
      break;
    case 'get_fight_history':
      handleGetFightHistory(client);
      break;
    case 'spectate_fight':
      handleSpectateFight(client, msg);
      break;
    case 'wager_accepted':
      handleWagerAccepted(client, msg);
      break;
    // Marketplace, challenges, etc. — not yet implemented; silently ignore
    case 'get_marketplace':
    case 'list_item':
    case 'delist_item':
    case 'buy_listing':
    case 'allocate_points':
    case 'stop_spectating':
    case 'challenge_player':
    case 'accept_challenge':
    case 'decline_challenge':
      break;
    default:
      sendError(client, `Unknown message type: ${msg.type}`);
  }
}

// === Auth ===

async function handleAuth(client: ConnectedClient, msg: ClientMessage): Promise<void> {
  const walletAddress = msg.walletAddress as string | undefined;

  if (!walletAddress || typeof walletAddress !== 'string' || walletAddress.length < 3) {
    send(client, { type: 'error', message: 'Invalid wallet address' });
    return;
  }

  // Check if wallet is already connected
  let isReconnect = false;
  for (const [, existing] of connectedClients) {
    if (existing.walletAddress === walletAddress && existing.id !== client.id) {
      // Disconnect old session (handleDisconnect will skip teardown since we delete first)
      isReconnect = true;
      connectedClients.delete(existing.id);
      existing.socket.close();
      break;
    }
  }

  client.walletAddress = walletAddress;
  client.authenticated = true;

  // Check for existing character: in-memory first, then Supabase
  let character = getCharacterByWallet(walletAddress);
  if (!character) {
    character = await restoreCharacterFromDb(walletAddress) ?? undefined;
  }
  if (character) {
    client.characterId = character.id;

    // Verify on-chain equipped items are still owned by the wallet
    const removedSlots = await verifyEquipmentOwnership(walletAddress, character.equipment);
    if (removedSlots.length > 0) {
      console.log(`[Auth] Removed ghost items from ${walletAddress}: ${removedSlots.join(', ')}`);
    }
  }

  // Register for chat
  registerChatClient(client);

  send(client, {
    type: 'auth_ok',
    walletAddress,
    hasCharacter: !!character,
    character: character ? sanitizeCharacter(character) : null,
  });

  if (!isReconnect) {
    broadcastSystemMessage(`${walletAddress.slice(0, 8)}... has joined.`);
  }
}

// === Create Character ===

function handleCreateCharacter(client: ConnectedClient, msg: ClientMessage): void {
  const name = msg.name as string;
  const strength = Number(msg.strength) || 0;
  const dexterity = Number(msg.dexterity) || 0;
  const intuition = Number(msg.intuition) || 0;
  const endurance = Number(msg.endurance) || 0;

  if (!name) {
    sendError(client, 'Missing name or stats');
    return;
  }

  const result = createCharacter(client.walletAddress!, name, {
    strength,
    dexterity,
    intuition,
    endurance,
  });

  if (!result.character) {
    sendError(client, result.error || 'Failed to create character');
    return;
  }

  client.characterId = result.character.id;

  send(client, {
    type: 'character_created',
    character: sanitizeCharacter(result.character),
  });
}

// === Get Character ===

function handleGetCharacter(client: ConnectedClient, msg: ClientMessage): void {
  const walletAddress = (msg.walletAddress as string) || client.walletAddress;
  if (!walletAddress) {
    sendError(client, 'No wallet address');
    return;
  }

  const character = getCharacterByWallet(walletAddress);
  if (!character) {
    sendError(client, 'Character not found');
    return;
  }

  send(client, {
    type: 'character_data',
    character: sanitizeCharacter(character),
  });
}

// === Queue Fight ===

function handleQueueFight(client: ConnectedClient, msg: ClientMessage): void {
  if (!client.characterId) {
    sendError(client, 'Create a character first');
    return;
  }

  if (client.currentFightId) {
    sendError(client, 'Already in a fight');
    return;
  }

  const character = getCharacterByWallet(client.walletAddress!);
  if (!character) {
    sendError(client, 'Character not found');
    return;
  }

  // Merge on-chain equipped items into character equipment for combat
  const onChainEquipment = msg.onChainEquipment as Record<string, Record<string, unknown>> | undefined;
  if (onChainEquipment) {
    for (const [slot, raw] of Object.entries(onChainEquipment)) {
      if (!raw || !(slot in character.equipment)) continue;
      const sb = (raw.statBonuses || {}) as Record<string, number>;
      (character.equipment as unknown as Record<string, unknown>)[slot] = {
        id: raw.id,
        name: raw.name,
        itemType: raw.itemType,
        rarity: raw.rarity,
        levelReq: raw.levelReq || 1,
        statBonuses: {
          strength: sb.strengthBonus || 0,
          dexterity: sb.dexterityBonus || 0,
          intuition: sb.intuitionBonus || 0,
          endurance: sb.enduranceBonus || 0,
          hp: sb.hpBonus || 0,
          armor: sb.armorBonus || 0,
          defense: sb.defenseBonus || 0,
          critBonus: sb.critChanceBonus || 0,
          damage: sb.attackBonus || 0,
        },
        minDamage: raw.minDamage || 0,
        maxDamage: raw.maxDamage || 0,
      };
    }
  }

  const fightType = (msg.fightType as string) || 'ranked';
  if (!['friendly', 'ranked', 'wager', 'item_stake'].includes(fightType)) {
    sendError(client, 'Invalid fight type');
    return;
  }

  const wagerAmount = fightType === 'wager' ? (Number(msg.wagerAmount) || 0) : undefined;
  const wagerMatchId = fightType === 'wager' ? (msg.wagerMatchId as string) : undefined;

  if (fightType === 'wager') {
    if (!wagerAmount || wagerAmount < 0.1) {
      sendError(client, 'Minimum wager is 0.1 SUI');
      return;
    }
    if (!wagerMatchId) {
      sendError(client, 'On-chain wager escrow required. Sign the create_wager transaction first.');
      return;
    }
  }

  const mm = getMatchmaking();
  const added = mm.addToQueue({
    walletAddress: client.walletAddress!,
    characterId: client.characterId,
    fightType: fightType as any,
    rating: character.rating,
    joinedAt: Date.now(),
    wagerAmount,
    wagerMatchId,
  });

  if (!added) {
    sendError(client, 'Already in queue');
    return;
  }

  send(client, {
    type: 'queue_joined',
    fightType,
  });
}

// === Cancel Queue ===

function handleCancelQueue(client: ConnectedClient): void {
  if (!client.walletAddress) {
    sendError(client, 'Not authenticated');
    return;
  }

  const mm = getMatchmaking();
  mm.removeFromQueue(client.walletAddress);

  send(client, {
    type: 'queue_left',
  });
}

// === Fight Action ===

function handleFightAction(client: ConnectedClient, msg: ClientMessage): void {
  if (!client.currentFightId || !client.characterId) {
    sendError(client, 'Not in a fight');
    return;
  }

  const attackZones = msg.attackZones as Zone[] | undefined;
  const blockZones = msg.blockZones as Zone[] | undefined;

  if (!attackZones || !blockZones) {
    sendError(client, 'Missing attackZones or blockZones');
    return;
  }

  const action: TurnAction = { attackZones, blockZones };
  const result = submitTurnAction(client.currentFightId, client.characterId, action);

  if (!result.success) {
    sendError(client, result.error || 'Failed to submit action');
  }
}

// === Chat ===

function handleChat(client: ConnectedClient, msg: ClientMessage): void {
  const content = msg.content as string;
  const target = msg.target as string | undefined;

  const result = handleChatMessage(client, content, target);
  if (!result.success) {
    sendError(client, result.error || 'Failed to send message');
  }
}

// === Online Players ===

function handleGetOnlinePlayers(client: ConnectedClient): void {
  const players: Array<{ walletAddress: string; name: string; level: number; rating: number; status: string; fightId?: string }> = [];

  for (const [, c] of connectedClients) {
    if (c.authenticated && c.walletAddress) {
      const character = getCharacterByWallet(c.walletAddress);
      let status = 'online';
      let fightId: string | undefined;
      if (c.currentFightId) {
        status = 'fighting';
        fightId = c.currentFightId;
      }
      players.push({
        walletAddress: c.walletAddress,
        name: character?.name || 'Unknown',
        level: character?.level || 1,
        rating: character?.rating || 1000,
        status,
        fightId,
      });
    }
  }

  send(client, {
    type: 'online_players',
    players,
  });
}

// === Equip Item ===

function handleEquipItem(client: ConnectedClient, msg: ClientMessage): void {
  if (!client.characterId) {
    sendError(client, 'No character');
    return;
  }
  if (client.currentFightId) {
    sendError(client, 'Cannot change equipment during a fight');
    return;
  }

  const itemId = msg.itemId as string;
  if (!itemId) {
    sendError(client, 'Missing itemId');
    return;
  }

  const result = equipItem(client.characterId, itemId);
  if (!result.success) {
    sendError(client, result.error || 'Failed to equip item');
    return;
  }

  const character = getCharacterByWallet(client.walletAddress!);
  send(client, {
    type: 'item_equipped',
    character: character ? sanitizeCharacter(character) : null,
  });
}

// === Unequip Item ===

function handleUnequipItem(client: ConnectedClient, msg: ClientMessage): void {
  if (!client.characterId) {
    sendError(client, 'No character');
    return;
  }
  if (client.currentFightId) {
    sendError(client, 'Cannot change equipment during a fight');
    return;
  }

  const slot = msg.slot as keyof EquipmentSlots;
  if (!slot) {
    sendError(client, 'Missing slot');
    return;
  }

  const validSlots: (keyof EquipmentSlots)[] = [
    'weapon', 'offhand', 'helmet', 'chest', 'gloves', 'boots', 'belt', 'ring1', 'ring2', 'necklace',
  ];
  if (!validSlots.includes(slot)) {
    sendError(client, 'Invalid slot');
    return;
  }

  // Get the item before unequipping so we can return it
  const charBefore = getCharacterByWallet(client.walletAddress!);
  const unequippedItem = charBefore?.equipment[slot] || null;

  const result = unequipItem(client.characterId, slot);
  if (!result.success) {
    sendError(client, result.error || 'Failed to unequip item');
    return;
  }

  const character = getCharacterByWallet(client.walletAddress!);
  send(client, {
    type: 'item_unequipped',
    character: character ? sanitizeCharacter(character) : null,
    item: unequippedItem,
  });
}

// === Buy Shop Item ===

function handleBuyShopItem(client: ConnectedClient, msg: ClientMessage): void {
  if (!client.characterId) {
    sendError(client, 'No character');
    return;
  }

  const itemId = msg.itemId as string;
  if (!itemId) {
    sendError(client, 'Missing itemId');
    return;
  }

  const character = getCharacterByWallet(client.walletAddress!);
  if (!character) {
    sendError(client, 'Character not found');
    return;
  }

  const price = getShopItemPrice(itemId);
  if (price <= 0) {
    sendError(client, 'Item not available for purchase');
    return;
  }

  if (character.gold < price) {
    sendError(client, `Not enough gold. Need ${price}, have ${character.gold}`);
    return;
  }

  const shopItem = getShopItemById(itemId);
  if (!shopItem) {
    sendError(client, 'Item not found');
    return;
  }

  if (shopItem.levelReq > character.level) {
    sendError(client, `Requires level ${shopItem.levelReq}`);
    return;
  }

  const result = purchaseShopItem(itemId);
  if (!result.item) {
    sendError(client, result.error || 'Purchase failed');
    return;
  }

  character.gold -= price;
  character.inventory.push(result.item);

  send(client, {
    type: 'item_purchased',
    item: result.item,
    character: sanitizeCharacter(character),
  });
}

// === Get Shop ===

function handleGetShop(client: ConnectedClient): void {
  const catalog = getShopCatalog();
  // Ensure each item has a price field directly
  const items = catalog.map((item) => ({
    ...item,
    price: item.price || 0,
  }));
  send(client, {
    type: 'shop_data',
    items,
  });
}

// === Get Inventory ===

function handleGetInventory(client: ConnectedClient): void {
  const character = getCharacterByWallet(client.walletAddress!);
  if (!character) {
    sendError(client, 'Character not found');
    return;
  }

  send(client, {
    type: 'inventory',
    items: character.inventory,
  });
}

// === Get Leaderboard ===

function handleGetLeaderboard(client: ConnectedClient): void {
  const entries = getLeaderboard(100);
  // Map to frontend expected format
  const mapped = entries.map((e) => ({
    rank: e.rank,
    walletAddress: e.walletAddress,
    name: e.characterName,
    level: e.level,
    rating: e.rating,
    wins: e.wins,
    losses: e.losses,
  }));
  send(client, {
    type: 'leaderboard',
    entries: mapped,
  });
}

// === Get Fight History ===

function handleGetFightHistory(client: ConnectedClient): void {
  if (!client.characterId) {
    sendError(client, 'No character');
    return;
  }

  const history = getFightHistory(client.characterId);
  // Map to frontend expected format
  const fights = history.map((h) => ({
    id: h.fightId,
    type: h.type,
    playerA: { name: h.opponentName, walletAddress: h.opponentWallet },
    playerB: { name: getCharacterByWallet(client.walletAddress!)?.name || 'Unknown', walletAddress: client.walletAddress! },
    winner: h.result === 'win' ? client.walletAddress! : h.opponentWallet,
    turns: h.turns,
    timestamp: h.timestamp,
    wagerAmount: undefined as number | undefined,
  }));
  send(client, {
    type: 'fight_history',
    fights,
  });
}

// === Spectate Fight ===

function handleSpectateFight(client: ConnectedClient, msg: ClientMessage): void {
  const fightId = msg.fightId as string;

  if (!fightId) {
    // List active fights
    const fights = getActiveFights().map((f) => ({
      fightId: f.id,
      type: f.type,
      playerA: { name: f.playerA.character.name, level: f.playerA.character.level },
      playerB: { name: f.playerB.character.name, level: f.playerB.character.level },
      turn: f.turn,
    }));

    send(client, {
      type: 'spectate_update',
      activeFights: fights,
    });
    return;
  }

  const result = addSpectator(fightId, client.walletAddress!);
  if (!result.success) {
    sendError(client, result.error || 'Cannot spectate this fight');
    return;
  }

  const fight = result.fight!;
  send(client, {
    type: 'spectate_update',
    fight: {
      id: fight.id,
      type: fight.type,
      status: fight.status,
      turn: fight.turn,
      playerA: {
        characterId: fight.playerA.characterId,
        walletAddress: fight.playerA.walletAddress,
        name: fight.playerA.character.name,
        currentHp: fight.playerA.currentHp,
        maxHp: fight.playerA.maxHp,
        level: fight.playerA.character.level,
      },
      playerB: {
        characterId: fight.playerB.characterId,
        walletAddress: fight.playerB.walletAddress,
        name: fight.playerB.character.name,
        currentHp: fight.playerB.currentHp,
        maxHp: fight.playerB.maxHp,
        level: fight.playerB.character.level,
      },
    },
  });
}

// === Pending Wager Acceptances ===

interface PendingWagerAccept {
  wagerMatchId: string;
  wagerAmount: number;
  playerAWallet: string;
  playerACharacterId: string;
  playerBWallet: string;
  playerBCharacterId: string;
  fightType: 'wager';
  timer: ReturnType<typeof setTimeout>;
}

const pendingWagerAccepts = new Map<string, PendingWagerAccept>();

/**
 * Called by matchmaking when two wager players are matched.
 * Sends Player B a request to sign accept_wager on-chain.
 */
export function initiateWagerAcceptance(
  entryA: { walletAddress: string; characterId: string; wagerMatchId: string; wagerAmount: number },
  entryB: { walletAddress: string; characterId: string },
): void {
  const charA = getCharacterByWallet(entryA.walletAddress);
  const clientB = getClientByWalletAddress(entryB.walletAddress);

  if (!clientB) {
    console.error('[Wager] Player B not connected');
    return;
  }

  // Send Player B the accept request
  send(clientB, {
    type: 'wager_accept_required',
    wagerMatchId: entryA.wagerMatchId,
    stakeAmount: entryA.wagerAmount,
    playerAName: charA?.name || 'Unknown',
    playerAWallet: entryA.walletAddress,
  });

  // Set timeout for acceptance
  const timer = setTimeout(() => {
    const pending = pendingWagerAccepts.get(entryA.wagerMatchId);
    if (!pending) return;
    pendingWagerAccepts.delete(entryA.wagerMatchId);

    // Notify both players
    const clientA = getClientByWalletAddress(pending.playerAWallet);
    const cB = getClientByWalletAddress(pending.playerBWallet);
    if (clientA) send(clientA, { type: 'wager_accept_timeout', wagerMatchId: entryA.wagerMatchId });
    if (cB) send(cB, { type: 'wager_accept_timeout', wagerMatchId: entryA.wagerMatchId });
    console.log(`[Wager] Accept timeout for ${entryA.wagerMatchId}`);
  }, CONFIG.WAGER_ACCEPT_TIMEOUT_MS);

  pendingWagerAccepts.set(entryA.wagerMatchId, {
    wagerMatchId: entryA.wagerMatchId,
    wagerAmount: entryA.wagerAmount,
    playerAWallet: entryA.walletAddress,
    playerACharacterId: entryA.characterId,
    playerBWallet: entryB.walletAddress,
    playerBCharacterId: entryB.characterId,
    fightType: 'wager',
    timer,
  });
}

function getClientByWalletAddress(wallet: string): ConnectedClient | undefined {
  for (const [, c] of connectedClients) {
    if (c.walletAddress === wallet) return c;
  }
  return undefined;
}

async function handleWagerAccepted(client: ConnectedClient, msg: ClientMessage): Promise<void> {
  const wagerMatchId = msg.wagerMatchId as string;
  if (!wagerMatchId) {
    sendError(client, 'Missing wagerMatchId');
    return;
  }

  const pending = pendingWagerAccepts.get(wagerMatchId);
  if (!pending) {
    sendError(client, 'No pending wager acceptance found');
    return;
  }

  if (client.walletAddress !== pending.playerBWallet) {
    sendError(client, 'You are not the expected acceptor');
    return;
  }

  // Verify on-chain that the wager is now ACTIVE (status=1)
  const status = await getWagerStatus(wagerMatchId);
  if (status !== 1) {
    sendError(client, `Wager not active on-chain (status: ${status}). Did the accept_wager transaction succeed?`);
    return;
  }

  // Clean up pending
  clearTimeout(pending.timer);
  pendingWagerAccepts.delete(wagerMatchId);

  // Get characters and start the fight
  const charA = getCharacterByWallet(pending.playerAWallet);
  const charB = getCharacterByWallet(pending.playerBWallet);

  if (!charA || !charB) {
    sendError(client, 'Character not found');
    return;
  }

  console.log(`[Wager] Accepted! Starting fight: ${charA.name} vs ${charB.name} (${pending.wagerAmount} SUI)`);

  const fight = createFight(charA, charB, 'wager', pending.wagerAmount);
  fight.wagerMatchId = wagerMatchId;
}

// === Utilities ===

function sanitizeCharacter(character: any): Record<string, any> {
  return {
    id: character.id,
    name: character.name,
    level: character.level,
    xp: character.xp,
    walletAddress: character.walletAddress,
    stats: {
      strength: character.stats.strength,
      dexterity: character.stats.dexterity,
      intuition: character.stats.intuition,
      endurance: character.stats.endurance,
    },
    unallocatedPoints: 0,
    equipment: character.equipment,
    wins: character.wins,
    losses: character.losses,
    rating: character.rating,
  };
}

// === Exports ===

export function getConnectedClients(): Map<string, ConnectedClient> {
  return connectedClients;
}

export function getOnlineCount(): number {
  let count = 0;
  for (const [, c] of connectedClients) {
    if (c.authenticated) count++;
  }
  return count;
}
