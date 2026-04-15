// ===== ZONES =====
export const ZONES = ["head", "chest", "stomach", "belt", "legs"] as const;
export type Zone = (typeof ZONES)[number];

export const ZONE_LABELS: Record<Zone, string> = {
  head: "Head",
  chest: "Chest",
  stomach: "Stomach",
  belt: "Belt",
  legs: "Legs",
};

// ===== ITEMS =====
export const ITEM_TYPES = {
  WEAPON: 1,
  SHIELD: 2,
  HELMET: 3,
  CHEST: 4,
  GLOVES: 5,
  BOOTS: 6,
  BELT: 7,
  RING: 8,
  NECKLACE: 9,
} as const;
export type ItemType = (typeof ITEM_TYPES)[keyof typeof ITEM_TYPES];

export const ITEM_TYPE_LABELS: Record<ItemType, string> = {
  1: "Weapon",
  2: "Shield",
  3: "Helmet",
  4: "Chest",
  5: "Gloves",
  6: "Boots",
  7: "Belt",
  8: "Ring",
  9: "Necklace",
};

export const RARITIES = {
  COMMON: 1,
  UNCOMMON: 2,
  RARE: 3,
  EPIC: 4,
  LEGENDARY: 5,
} as const;
export type Rarity = (typeof RARITIES)[keyof typeof RARITIES];

export const RARITY_LABELS: Record<Rarity, string> = {
  1: "Common",
  2: "Uncommon",
  3: "Rare",
  4: "Epic",
  5: "Legendary",
};

export const RARITY_COLORS: Record<Rarity, string> = {
  1: "text-zinc-300",
  2: "text-green-400",
  3: "text-blue-400",
  4: "text-purple-400",
  5: "text-orange-400",
};

export const RARITY_BG_COLORS: Record<Rarity, string> = {
  1: "border-zinc-600",
  2: "border-green-600",
  3: "border-blue-600",
  4: "border-purple-600",
  5: "border-orange-600",
};

export const RARITY_GLOW: Record<Rarity, string> = {
  1: "",
  2: "shadow-green-900/30",
  3: "shadow-blue-900/40",
  4: "shadow-purple-900/50",
  5: "shadow-orange-900/60 shadow-lg",
};

// ===== STATS =====
export interface CharacterStats {
  strength: number;
  dexterity: number;
  intuition: number;
  endurance: number;
}

export interface StatBonuses {
  strengthBonus: number;
  dexterityBonus: number;
  intuitionBonus: number;
  enduranceBonus: number;
  hpBonus: number;
  armorBonus: number;
  defenseBonus: number;
  attackBonus: number;
  critChanceBonus: number;
  critMultiplierBonus: number;
  evasionBonus: number;
  antiCritBonus: number;
  antiEvasionBonus: number;
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

// ===== CHARACTER =====
export interface Character {
  id: string;
  name: string;
  level: number;
  xp: number;
  stats: CharacterStats;
  unallocatedPoints: number;
  equipment: EquipmentSlots;
  wins: number;
  losses: number;
  rating: number;
  walletAddress: string;
}

// ===== EQUIPMENT =====
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

export const EQUIPMENT_SLOT_LABELS: Record<keyof EquipmentSlots, string> = {
  weapon: "Weapon",
  offhand: "Off-hand",
  helmet: "Helmet",
  chest: "Chest",
  gloves: "Gloves",
  boots: "Boots",
  belt: "Belt",
  ring1: "Ring 1",
  ring2: "Ring 2",
  necklace: "Necklace",
};

export const SLOT_TO_ITEM_TYPE: Record<keyof EquipmentSlots, ItemType[]> = {
  weapon: [ITEM_TYPES.WEAPON],
  offhand: [ITEM_TYPES.SHIELD, ITEM_TYPES.WEAPON],
  helmet: [ITEM_TYPES.HELMET],
  chest: [ITEM_TYPES.CHEST],
  gloves: [ITEM_TYPES.GLOVES],
  boots: [ITEM_TYPES.BOOTS],
  belt: [ITEM_TYPES.BELT],
  ring1: [ITEM_TYPES.RING],
  ring2: [ITEM_TYPES.RING],
  necklace: [ITEM_TYPES.NECKLACE],
};

// ===== ITEMS =====
export interface Item {
  id: string;
  name: string;
  imageUrl?: string;
  itemType: ItemType;
  classReq: number;
  levelReq: number;
  rarity: Rarity;
  statBonuses: StatBonuses;
  minDamage: number;
  maxDamage: number;
  price?: number;
}

// ===== FIGHT =====
export type FightType = "friendly" | "ranked" | "wager" | "item_stake";

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
  playerA: { actions: TurnAction; hits: HitResult[]; hpAfter?: number };
  playerB: { actions: TurnAction; hits: HitResult[]; hpAfter?: number };
}

export interface FighterState {
  characterId: string;
  walletAddress: string;
  name: string;
  currentHp: number;
  maxHp: number;
  level: number;
  equipment?: EquipmentSlots;
}

export interface FightState {
  id: string;
  type: FightType;
  playerA: FighterState;
  playerB: FighterState;
  turn: number;
  log: TurnResult[];
  status: "waiting" | "active" | "finished";
  winner?: string;
  wagerAmount?: number;
  turnDeadline?: number;
}

// ===== CHAT =====
export interface ChatMessage {
  id: string;
  sender: string;
  senderName: string;
  content: string;
  type: "global" | "whisper" | "system";
  target?: string;
  timestamp: number;
}

// ===== PRESENCE =====
export type PlayerStatus = "online" | "in_fight" | "in_marketplace" | "idle";

export interface OnlinePlayer {
  walletAddress: string;
  name: string;
  level: number;
  rating: number;
  status: PlayerStatus;
  fightId?: string;
}

// ===== LEADERBOARD =====
export interface LeaderboardEntry {
  rank: number;
  walletAddress: string;
  name: string;
  level: number;
  rating: number;
  wins: number;
  losses: number;
}

// ===== MARKETPLACE =====
export interface MarketplaceListing {
  id: string;
  item: Item;
  seller: string;
  sellerName: string;
  price: number;
  listedAt: number;
}

// ===== LOOT =====
export interface LootBoxResult {
  xpGained: number;
  ratingChange: number;
  item?: Item;
}

// ===== XP TABLE (Fibonacci-brutal) =====
// XP needed to reach the next level (cumulative thresholds)
const LEVEL_XP = [0, 8, 21, 55, 144, 377, 987, 2584];
export const XP_TABLE: Record<number, number> = {
  1: 0,
  2: 8,
  3: 29,
  4: 84,
  5: 228,
  6: 605,
  7: 1592,
  8: 4176,
};

export function getXpForNextLevel(level: number): number | null {
  if (level >= 8) return null;
  return LEVEL_XP[level] || null;
}

export function getXpProgress(level: number, xp: number): number {
  const needed = LEVEL_XP[level];
  if (!needed) return 1;
  return Math.min(1, xp / needed);
}

// ===== LEVEL UNLOCKS =====
export const LEVEL_UNLOCKS: Record<number, string[]> = {
  1: ["Training Ground", "Common items"],
  3: ["Friendly fights"],
  4: ["Trading"],
  5: ["Ranked fights", "Uncommon items"],
  7: ["Wager fights", "Rare items"],
  8: ["Dual wield / Shield choice"],
  10: ["Epic items"],
  15: ["Legendary items"],
  20: ["Hall of Fame eligible"],
};
