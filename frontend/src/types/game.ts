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
  /** True iff the NFT is currently a dynamic-object-field of a Kiosk
   *  (either listed for sale OR placed-but-unlisted). Set by
   *  `fetchKioskItems` in `lib/sui-contracts.ts`. */
  inKiosk?: boolean;
  /** True iff the NFT is currently listed for sale on the marketplace.
   *  Computed at render time by cross-referencing
   *  `state.marketplaceListings`. Implies `inKiosk: true`. When
   *  `inKiosk && !kioskListed` the item is "stuck" — placed in a kiosk
   *  but not for sale — and the user can pull it back to their wallet
   *  via the Retrieve action. */
  kioskListed?: boolean;
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
  /** Sui Kiosk shared-object ID — required for buy / delist tx PTBs. */
  kioskId: string;
  seller: string;
  sellerName: string;
  /** Price in SUI (display-friendly). For exact arithmetic, use priceMist. */
  price: number;
  /** Raw price in MIST as a decimal string (BigInt-safe). */
  priceMist: string;
  listedAt: number;
}

// ===== WAGER LOBBY =====
export interface WagerLobbyEntry {
  wagerMatchId: string;
  creatorWallet: string;
  creatorName: string;
  creatorLevel: number;
  creatorRating: number;
  creatorStats: CharacterStats;
  wagerAmount: number;
  createdAt: number;
}

// ===== LOOT =====
export interface LootBoxResult {
  xpGained: number;
  ratingChange: number;
  item?: Item;
}

// ===== XP TABLE =====
// CUMULATIVE XP required to BE at each level. Mirrors `character.move::xp_for_level`
// exactly — chain is the source of truth (GDD §9.1). Index = level - 1.
//   L1=0, L2=100, L3=300, L4=700, L5=1500, L6=3000, L7=6000, L8=12000,
//   L9=25000, L10=50000, L11=80000, L12=120000, L13=170000, L14=250000,
//   L15=350000, L16=430000, L17=550000, L18=700000, L19=850000, L20=1000000.
export const MAX_LEVEL = 20;

const LEVEL_XP_CUMULATIVE: readonly number[] = [
  0,           // L1
  100,         // L2
  300,         // L3
  700,         // L4
  1_500,       // L5
  3_000,       // L6
  6_000,       // L7
  12_000,      // L8
  25_000,      // L9
  50_000,      // L10
  80_000,      // L11
  120_000,     // L12
  170_000,     // L13
  250_000,     // L14
  350_000,     // L15
  430_000,     // L16
  550_000,     // L17
  700_000,     // L18
  850_000,     // L19
  1_000_000,   // L20
];

/** Cumulative XP threshold for `level`. Returns 0 below 1, the table value
 * elsewhere, and Infinity past MAX_LEVEL so the bar never goes "above" max. */
export function xpThresholdForLevel(level: number): number {
  if (level <= 1) return 0;
  if (level > MAX_LEVEL) return Number.POSITIVE_INFINITY;
  return LEVEL_XP_CUMULATIVE[level - 1] ?? Number.POSITIVE_INFINITY;
}

/** Cumulative XP required to reach the level after `level`. `null` at MAX. */
export function getXpForNextLevel(level: number): number | null {
  if (level >= MAX_LEVEL) return null;
  return xpThresholdForLevel(level + 1);
}

/** Progress 0..1 within the current level's XP band. Always returns 1 at MAX. */
export function getXpProgress(level: number, xp: number): number {
  if (level >= MAX_LEVEL) return 1;
  const floor = xpThresholdForLevel(level);
  const ceiling = xpThresholdForLevel(level + 1);
  const span = ceiling - floor;
  if (span <= 0 || !Number.isFinite(span)) return 1;
  return Math.max(0, Math.min(1, (xp - floor) / span));
}

/** XP earned within the current level (0 at level start, span at threshold). */
export function getXpInCurrentLevel(level: number, xp: number): number {
  if (level >= MAX_LEVEL) return 0;
  return Math.max(0, xp - xpThresholdForLevel(level));
}

/** XP needed to advance from `level` to `level + 1`. Returns 0 at MAX. */
export function getXpSpanForLevel(level: number): number {
  if (level >= MAX_LEVEL) return 0;
  return xpThresholdForLevel(level + 1) - xpThresholdForLevel(level);
}

/** Convenience: cumulative table snapshot for tests / introspection. */
export const XP_TABLE: Record<number, number> = Object.fromEntries(
  LEVEL_XP_CUMULATIVE.map((v, i) => [i + 1, v]),
);

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
