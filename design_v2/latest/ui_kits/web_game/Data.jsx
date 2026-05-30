/* Data.jsx — Fake game state used by every screen.
   Drawn from the real types in sui-comabts/frontend/src/types/game.ts so
   field names match the actual codebase exactly. */

const PLAYER = {
  name: "Ponke_the_Brawler",
  level: 14,
  archetype: "Bruiser",
  glyph: "🐸",
  rating: 2134,
  wins: 47, losses: 21, draws: 3,
  xp: { current: 4820, span: 7200 },
  unallocated: 2,
  stats: { strength: 14, dexterity: 8, intuition: 10, endurance: 12 },
  derived: { maxHp: 240, attackPower: 38, critChance: 18, critMultiplier: 1.75, evasionChance: 9, armor: 22, defense: 31 },
  balance: 4.82,
};

const ITEMS = [
  { id: "1", name: "Skullcrusher Maul",     rarity: "Legendary", slot: "weapon",   stats: "STR +6 / END +2", tag: "2H", price: 0.750, img: "../../assets/items/Skullcrusher_Maul.png" },
  { id: "2", name: "Bloodletter Gauntlets", rarity: "Epic",      slot: "gloves",   stats: "STR +3 / INT +1",            price: 0.210, img: "../../assets/items/Bloodletter_Gauntlets.png" },
  { id: "3", name: "Phantom Loop",          rarity: "Rare",      slot: "ring",     stats: "DEX +2",                     price: 0.045, img: "../../assets/items/Phantom_Loop.png" },
  { id: "4", name: "Whisperwind Amulet",    rarity: "Epic",      slot: "necklace", stats: "INT +3",                     price: 0.190, img: "../../assets/items/Whisperwind_Amulet.png" },
  { id: "5", name: "Shadowstep Wraps",      rarity: "Epic",      slot: "boots",    stats: "DEX +3",                     price: 0.180, img: "../../assets/items/Shadowstep_Wraps.png" },
  { id: "6", name: "Hunter's Hood",         rarity: "Rare",      slot: "helmet",   stats: "DEX +2 / INT +1",            price: 0.085, img: "../../assets/items/Hunters_Hood.png" },
  { id: "7", name: "Dancer's Aegis",        rarity: "Epic",      slot: "offhand",  stats: "DEX +2 / END +2",            price: 0.220, img: "../../assets/items/Dancers_Aegis.png" },
  { id: "8", name: "Pendant of Wrath",      rarity: "Legendary", slot: "necklace", stats: "STR +4 / INT +2",            price: 0.690, img: "../../assets/items/Pendant_of_Wrath.png" },
  { id: "9", name: "Skullsplitter Helm",    rarity: "Epic",      slot: "helmet",   stats: "STR +2 / END +2",            price: 0.205, img: "../../assets/items/Skullsplitter_Helm.png" },
  { id: "10", name: "Twin Stilettos",       rarity: "Rare",      slot: "weapon",   stats: "DEX +3 / STR +1", tag: "DW", price: 0.120, img: "../../assets/items/Twin_Stilettos.png" },
  { id: "11", name: "Mithril Breastplate",  rarity: "Epic",      slot: "chest",    stats: "END +4",                     price: 0.235, img: "../../assets/items/mithril_breastplate.png" },
  { id: "12", name: "Studded Leather",      rarity: "Uncommon",  slot: "chest",    stats: "DEX +1 / END +2",            price: 0.040, img: "../../assets/items/Studded_Leather_Armor.png" },
];

// Equipped loadout — keyed by slot.
const EQUIPPED = {
  weapon:   ITEMS[0],
  offhand:  null,                       // 2H weapon, offhand locked
  helmet:   ITEMS[8],
  chest:    ITEMS[10],
  gloves:   ITEMS[1],
  boots:    ITEMS[4],
  belt:     null,
  ring1:    ITEMS[2],
  ring2:    null,
  necklace: ITEMS[7],
};

const OPPONENT = {
  name: "DogeKnight",
  level: 13,
  archetype: "Tank",
  glyph: "🐕",
  rating: 2092,
  hp: { current: 178, max: 220 },
};

const PLAYERS_ONLINE = [
  { name: "DogeKnight",    lv: 13, rating: 2092, status: "online",  glyph: "🐕" },
  { name: "FrogLord420",   lv: 17, rating: 2310, status: "fighting",glyph: "🐸" },
  { name: "BonkSmash",     lv: 11, rating: 1820, status: "online",  glyph: "🔨" },
  { name: "PepeWizard",    lv: 16, rating: 2244, status: "afk",     glyph: "🧙" },
  { name: "ApeKnocker",    lv: 9,  rating: 1610, status: "online",  glyph: "🦍" },
  { name: "MoonCatHiss",   lv: 18, rating: 2401, status: "fighting",glyph: "😼" },
  { name: "CopiumFighter", lv: 7,  rating: 1500, status: "online",  glyph: "🦴" },
];

const TAVERN_LOG = [
  { who: "FrogLord420",  text: "Anyone got a Skullcrusher? Paying 0.7",  ts: "14:32", color: "var(--rarity-epic)" },
  { who: "DogeKnight",   text: "ggwp ape that crit was cooked",          ts: "14:33", color: "var(--rarity-rare)" },
  { who: "BonkSmash",    text: "queue ranked rn for free elo lol",       ts: "14:34", color: "var(--sc-red)" },
  { who: "you",          text: "lfg",                                     ts: "14:35", color: "var(--sc-yellow)", self: true },
  { who: "PepeWizard",   text: "wager 1.0 — head to head",                ts: "14:36", color: "var(--rarity-epic)" },
  { who: "Big Bad Claude", text: "Reminder: testnet drops reset Mondays.",ts: "14:37", color: "var(--sc-parchment)", bot: true },
];

const FIGHT_LOG = [
  { who: "you",    text: "Hit chest for −18",           dmg: -18, miss: false },
  { who: "foe",    text: "Blocked head — 0 dmg",        dmg: 0,   block: true },
  { who: "you",    text: "CRIT stomach −47",            dmg: -47, crit: true },
  { who: "foe",    text: "Hit legs for −12",            dmg: -12, miss: false },
  { who: "you",    text: "Whiffed head — dodged",       dmg: 0,   miss: true },
];

const LEADERS = [
  { rank: 1, name: "MoonCatHiss",  lv: 18, rating: 2401, wins: 134, losses: 41, glyph: "😼" },
  { rank: 2, name: "FrogLord420",  lv: 17, rating: 2310, wins: 119, losses: 38, glyph: "🐸" },
  { rank: 3, name: "PepeWizard",   lv: 16, rating: 2244, wins: 107, losses: 44, glyph: "🧙" },
  { rank: 4, name: "Ponke_the_Brawler", lv: 14, rating: 2134, wins: 47, losses: 21, glyph: "🐸", you: true },
  { rank: 5, name: "DogeKnight",   lv: 13, rating: 2092, wins: 81, losses: 39, glyph: "🐕" },
  { rank: 6, name: "BonkSmash",    lv: 11, rating: 1820, wins: 62, losses: 51, glyph: "🔨" },
  { rank: 7, name: "ApeKnocker",   lv: 9,  rating: 1610, wins: 33, losses: 28, glyph: "🦍" },
];

const FIGHT_HISTORY = [
  { result: "win",  opp: "BonkSmash",   elo: "+18", reason: "KO round 4" },
  { result: "win",  opp: "ApeKnocker",  elo: "+12", reason: "KO round 3" },
  { result: "loss", opp: "FrogLord420", elo: "-22", reason: "Cooked" },
  { result: "win",  opp: "DogeKnight",  elo: "+9",  reason: "Wager 0.5 SUI" },
  { result: "loss", opp: "MoonCatHiss", elo: "-15", reason: "Dodged every hit" },
];

const RARITY_COLOR = {
  Common: "var(--rarity-common)",
  Uncommon: "var(--rarity-uncommon)",
  Rare: "var(--rarity-rare)",
  Epic: "var(--rarity-epic)",
  Legendary: "var(--rarity-legendary)",
  Mythic: "var(--rarity-mythic)",
};

Object.assign(window, {
  PLAYER, ITEMS, EQUIPPED, OPPONENT, PLAYERS_ONLINE, TAVERN_LOG, FIGHT_LOG,
  LEADERS, FIGHT_HISTORY, RARITY_COLOR,
});
