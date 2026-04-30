import type WebSocket from 'ws';

// === Core Enums / Literal Types ===

export type Zone = 'head' | 'chest' | 'stomach' | 'belt' | 'legs';

export type FightType = 'friendly' | 'ranked' | 'wager' | 'item_stake';

export type Rarity = 1 | 2 | 3 | 4 | 5;

export const RARITY_NAMES: Record<Rarity, string> = {
  1: 'Common',
  2: 'Uncommon',
  3: 'Rare',
  4: 'Epic',
  5: 'Legendary',
};

// 1=weapon, 2=offhand, 3=helmet, 4=chest, 5=gloves, 6=boots, 7=belt, 8=ring, 9=necklace
export type ItemType = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export const ITEM_TYPE_NAMES: Record<ItemType, string> = {
  1: 'Weapon',
  2: 'Offhand',
  3: 'Helmet',
  4: 'Chest Armor',
  5: 'Gloves',
  6: 'Boots',
  7: 'Belt',
  8: 'Ring',
  9: 'Necklace',
};

export type OffhandType = 'shield' | 'dual_wield' | 'none';

// === Stats ===

export interface CharacterStats {
  strength: number;
  dexterity: number;
  intuition: number;
  endurance: number;
}

export interface StatBonuses {
  strength?: number;
  dexterity?: number;
  intuition?: number;
  endurance?: number;
  hp?: number;
  armor?: number;
  defense?: number;
  critBonus?: number;
  damage?: number;
}

export interface DerivedStats {
  maxHp: number;
  attackPower: number;
  critChance: number;
  critMultiplier: number;
  evasionChance: number;
  armor: number;
  defense: number;
}

// === Items & Equipment ===

export interface Item {
  id: string;
  name: string;
  itemType: ItemType;
  rarity: Rarity;
  levelReq: number;
  statBonuses: StatBonuses;
  minDamage?: number;
  maxDamage?: number;
  offhandType?: OffhandType;
  price?: number;
  shopAvailable?: boolean;
  description?: string;
}

export interface EquipmentSlots {
  weapon: Item | null;
  offhand: Item | null;
  helmet: Item | null;
  chest: Item | null;
  gloves: Item | null;
  boots: Item | null;
  belt: Item | null;
  ring1: Item | null;
  ring2: Item | null;
  necklace: Item | null;
}

// === Character ===

export interface Character {
  id: string;
  name: string;
  level: number;
  /** CUMULATIVE total XP earned (matches chain `Character.xp`). Never resets on level-up. */
  xp: number;
  walletAddress: string;
  /**
   * The on-chain Character NFT object ID for this server-side record.
   * Resolved once via `CharacterCreated` event scan at restore/create time
   * and persisted in Supabase. Every later admin call (`update_after_fight`,
   * `set_fight_lock`, DOF reads) targets THIS object id directly — never
   * re-scans events. Wallets with multiple Characters (legacy / migration)
   * always pin to the one we hydrated, not "whichever was newest at scan
   * time" (which is what `findCharacterObjectId(wallet)` returns and is
   * therefore unsafe on hot paths).
   *
   * `undefined` only for characters created before this field was added
   * (server reconciles by re-scanning on next login).
   */
  onChainObjectId?: string;
  stats: CharacterStats;
  equipment: EquipmentSlots;
  inventory: Item[];
  gold: number;
  wins: number;
  losses: number;
  rating: number;
  unallocatedPoints: number;
  fightHistory: string[];
  createdAt: number;
}

// === Fight / Combat ===

export interface TurnAction {
  attackZones: Zone[];
  blockZones: Zone[];
}

export interface HitResult {
  zone: Zone;
  blocked: boolean;
  dodged: boolean;
  crit: boolean;
  damage: number;
}

export interface TurnResult {
  turn: number;
  playerA: {
    playerId: string;
    actions: TurnAction;
    hits: HitResult[];
    hpAfter: number;
  };
  playerB: {
    playerId: string;
    actions: TurnAction;
    hits: HitResult[];
    hpAfter: number;
  };
}

export interface FighterState {
  characterId: string;
  walletAddress: string;
  currentHp: number;
  maxHp: number;
  derivedStats: DerivedStats;
  character: Character;
}

export type FightStatus = 'waiting' | 'active' | 'finished';

export interface FightState {
  id: string;
  type: FightType;
  playerA: FighterState;
  playerB: FighterState;
  turn: number;
  turnResults: TurnResult[];
  status: FightStatus;
  winner?: string;
  wagerAmount?: number;
  wagerMatchId?: string;
  stakedItemIds?: string[];
  spectators: Set<string>;
  turnActions: Map<string, TurnAction>;
  turnTimer?: ReturnType<typeof setTimeout>;
  startedAt: number;
  finishedAt?: number;
}

// === Matchmaking ===

export interface QueueEntry {
  walletAddress: string;
  characterId: string;
  fightType: FightType;
  rating: number;
  joinedAt: number;
  wagerAmount?: number;
  wagerMatchId?: string;
}

// === Wager Lobby ===

export interface WagerLobbyEntry {
  wagerMatchId: string;
  creatorWallet: string;
  creatorCharacterId: string;
  creatorName: string;
  creatorLevel: number;
  creatorRating: number;
  creatorStats: CharacterStats;
  wagerAmount: number;
  createdAt: number;
}

// === WebSocket Messages ===

export type ClientMessage = { type: string } & Record<string, any>;

export type ServerMessage = { type: string } & Record<string, any>;

// === Connected Client ===

export interface ConnectedClient {
  id: string;
  socket: WebSocket;
  walletAddress?: string;
  characterId?: string;
  currentFightId?: string;
  spectatingFightId?: string;
  lastChatTime: number;
  authenticated: boolean;
}

// === Leaderboard ===

export interface LeaderboardEntry {
  rank: number;
  walletAddress: string;
  characterName: string;
  rating: number;
  wins: number;
  losses: number;
  level: number;
}

// === Fight History ===

export interface FightHistoryEntry {
  fightId: string;
  type: FightType;
  opponentName: string;
  opponentWallet: string;
  result: 'win' | 'loss';
  ratingChange: number;
  xpGained: number;
  lootGained: Item | null;
  turns: number;
  timestamp: number;
}
