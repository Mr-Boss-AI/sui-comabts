import dotenv from 'dotenv';
dotenv.config();

function required(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === '') {
    throw new Error(`Required env var ${name} is not set. Check server/.env`);
  }
  return v.trim();
}

function optional(name: string, fallback: string = ''): string {
  return (process.env[name] || fallback).trim();
}

// All v5-required envs throw if missing. There are no hardcoded fallbacks
// for package IDs, addresses, or keys — those must come from the env.
export const CONFIG = {
  PORT: parseInt(optional('PORT', '3001'), 10),
  SUPABASE_URL: optional('SUPABASE_URL'),
  SUPABASE_KEY: optional('SUPABASE_KEY'),
  SUI_NETWORK: optional('SUI_NETWORK', 'testnet'),

  // v5 has ONE package ID — no upgrade dichotomy. Required.
  SUI_PACKAGE_ID: required('SUI_PACKAGE_ID'),
  // AdminCap object id (held by treasury wallet). Required.
  ADMIN_CAP_ID: required('ADMIN_CAP_ID'),
  // TransferPolicy<Item> object id (created by setup_transfer_policy). Required for marketplace flows.
  TRANSFER_POLICY_ID: optional('TRANSFER_POLICY_ID'),
  // TransferPolicyCap<Item> object id. Optional — only the publisher needs it.
  TRANSFER_POLICY_CAP_ID: optional('TRANSFER_POLICY_CAP_ID'),
  // Publisher wallet address (matches the hardcoded TREASURY in arena.move).
  // Used for sanity check + log lines. Required.
  PLATFORM_TREASURY: required('PLATFORM_TREASURY'),
  // Treasury wallet's Ed25519 private key, suiprivkey1... format. Required for signing admin txs.
  SUI_TREASURY_PRIVATE_KEY: required('SUI_TREASURY_PRIVATE_KEY'),

  WAGER_ACCEPT_TIMEOUT_MS: 30_000,
  // Fight-lock duration set on fight start. Must be < chain's MAX_LOCK_MS (1 hour).
  FIGHT_LOCK_DURATION_MS: 10 * 60 * 1000,

  // JWT signing secret for the wallet auth handshake. On testnet auto-generates
  // if missing (per restart) for dev convenience; on mainnet it MUST be set
  // explicitly so tokens survive restarts.
  JWT_SECRET: (() => {
    const v = process.env.JWT_SECRET?.trim();
    if (v) return v;
    if (process.env.SUI_NETWORK === 'mainnet') {
      throw new Error('JWT_SECRET is required on mainnet');
    }
    const fallback = `dev-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
    console.warn(`[CONFIG] JWT_SECRET not set — generated ephemeral testnet secret. Tokens will invalidate on restart.`);
    return fallback;
  })(),
  // 24-hour JWT session lifetime, in seconds.
  JWT_TTL_SECONDS: 24 * 60 * 60,
  // 5-minute window for completing a sign-in challenge.
  AUTH_CHALLENGE_TTL_MS: 5 * 60 * 1000,
} as const;

export const GAME_CONSTANTS = {
  TURN_TIMER_MS: 20_000,
  // Server level cap matches chain MAX_LEVEL.
  MAX_LEVEL: 20,
  STAT_POINTS_PER_LEVEL: 3,
  STARTING_STAT_POINTS: 20,
  MIN_STAT: 3,
  // HP / weapon-damage curves are purely server-side (combat math). The level
  // index goes 0..20; index 0 is unused, 1..20 is the playable range.
  // Values interpolated to follow the chunky-progression feel of the GDD.
  LEVEL_HP: [
    0,    // L0 (unused)
    40,   // L1
    50,   // L2
    65,   // L3
    85,   // L4
    110,  // L5
    140,  // L6
    175,  // L7
    215,  // L8
    260,  // L9
    310,  // L10
    365,  // L11
    425,  // L12
    490,  // L13
    560,  // L14
    635,  // L15
    715,  // L16
    800,  // L17
    890,  // L18
    985,  // L19
    1085, // L20
  ] as readonly number[],
  LEVEL_WEAPON_DAMAGE: [
    0,   // L0 (unused)
    6,   // L1
    8,   // L2
    11,  // L3
    14,  // L4
    18,  // L5
    22,  // L6
    27,  // L7
    32,  // L8
    38,  // L9
    44,  // L10
    50,  // L11
    57,  // L12
    64,  // L13
    72,  // L14
    80,  // L15
    88,  // L16
    97,  // L17
    106, // L18
    116, // L19
    126, // L20
  ] as readonly number[],
  DAMAGE_RANGE_LOW: 0.8,
  DAMAGE_RANGE_HIGH: 1.2,
  STR_DAMAGE_BONUS: 0.5,
  DEX_DAMAGE_BONUS: 0.15,
  EVASION_PER_DEXTERITY: 0.5,
  EVASION_CAP: 30,
  CRIT_CHANCE_PER_INTUITION: 0.5,
  CRIT_CHANCE_CAP: 25,
  CRIT_MULTIPLIER_BASE: 1.5,
  CRIT_MULTIPLIER_PER_INTUITION: 0.01,
  DEFENSE_PER_ENDURANCE: 0.3,
  ANTI_CRIT_PER_ENDURANCE: 0.3,
  ANTI_EVASION_PER_STRENGTH: 0.3,
  CRIT_ARMOR_PEN: 0.5,
  DEFAULT_ATTACK_ZONES: 1,
  DEFAULT_BLOCK_ZONES: 2,
  SHIELD_BLOCK_ZONES: 3,
  DUAL_WIELD_ATTACK_ZONES: 2,
  DUAL_WIELD_BLOCK_ZONES: 1,
  SHIELD_BLOCK_LINES: [
    ['head', 'chest', 'stomach'],
    ['chest', 'stomach', 'belt'],
    ['stomach', 'belt', 'legs'],
    ['belt', 'legs', 'head'],
    ['legs', 'head', 'chest'],
  ] as readonly (readonly string[])[],
  BLOCK_LINES: [
    ['head', 'chest'],
    ['chest', 'stomach'],
    ['stomach', 'belt'],
    ['belt', 'legs'],
    ['legs', 'head'],
  ] as readonly (readonly string[])[],
  // XP-to-next-level table mirrors chain `xp_for_level` deltas. Server uses
  // partial XP, chain stores cumulative — but levels happen at the same
  // accumulated XP totals.
  // Index = current_level. Value = XP needed to reach (level+1).
  // chain L2=100 (delta 100), L3=300 (delta 200), L4=700 (delta 400), L5=1500 (delta 800), …
  LEVEL_XP: [
    0,
    100,    // L1 → L2
    200,    // L2 → L3
    400,    // L3 → L4
    800,    // L4 → L5
    1500,   // L5 → L6
    3000,   // L6 → L7
    6000,   // L7 → L8
    13000,  // L8 → L9
    25000,  // L9 → L10
    30000,  // L10 → L11
    40000,  // L11 → L12
    50000,  // L12 → L13
    80000,  // L13 → L14
    100000, // L14 → L15
    80000,  // L15 → L16
    120000, // L16 → L17
    150000, // L17 → L18
    150000, // L18 → L19
    150000, // L19 → L20
    0,      // L20 (max)
  ] as readonly number[],
  XP_WIN_MIN: 25,
  XP_WIN_MAX: 200,
  XP_LOSS_MIN: 5,
  XP_LOSS_MAX: 30,
  MATCHMAKING_INITIAL_RANGE: 200,
  MATCHMAKING_EXPAND_AMOUNT: 50,
  MATCHMAKING_EXPAND_INTERVAL_MS: 10_000,
  ELO_K_FACTOR: 32,
  ELO_MIN_RATING: 100,
  DEFAULT_RATING: 1000,
  CHAT_RATE_LIMIT_MS: 1000,
  STARTING_GOLD: 0,
  // NFT-only flow: no NPC item drops, no gold economy. Loot tables use rarity
  // probabilities only — picks from minted on-chain catalog.
  LOOT_NOTHING_CHANCE: 60,
  LOOT_COMMON_CHANCE: 25,
  LOOT_UNCOMMON_CHANCE: 10,
  LOOT_RARE_CHANCE: 4,
  LOOT_EPIC_CHANCE: 0.9,
  LOOT_LEGENDARY_CHANCE: 0.1,
  ZONES: ['head', 'chest', 'stomach', 'belt', 'legs'] as const,
} as const;
