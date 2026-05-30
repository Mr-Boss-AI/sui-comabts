#!/usr/bin/env tsx
/**
 * v5.1 13-slot test catalog — mint a minimal viable item set to Mr_Boss + Sx
 * test wallets so the new pants/bracelets/pauldrons slots are testable from
 * first session boot, AND a representative sample of every slot is in
 * inventory.
 *
 * Run from project root with:
 *   cd ~/sui-comabts/server && npx tsx ../scripts/mint-v5.1-13slot-catalog.ts
 *
 * Reads:
 *   SUI_PACKAGE_ID, ADMIN_CAP_ID, SUI_TREASURY_PRIVATE_KEY  (from server/.env)
 *
 * Notes on rarity stat budgets (enforced on chain by item::mint_item_admin):
 *   Common=20, Uncommon=40, Rare=70, Epic=110, Legendary=160.
 *   Each item below stays under its rarity's budget.
 *
 * Two test wallets (same as v5.0 split):
 *   - Mr_Boss = 0xf669789c0e6d30627e8480b5886721d608d796277aab0664cfa84b2c04590f33
 *     Build philosophy: CRIT/INT/STR (high crit, high damage, glass cannon)
 *   - Sx     = 0x03c33df0c97d4dfb3792d340bbf83891e2a20d653155874fd37a350ad443985f
 *     Build philosophy: EVASION/DEX (dodge-based attrition fighter)
 *
 * Each wallet gets one item per slot (13 items × 2 wallets = 26 NFTs).
 * Stat profiles for the 3 new slots:
 *   - pants:     armor + endurance + small HP (legs lower armor; ~boots-shaped)
 *   - bracelets: dex + crit_chance + small attack (forearm accessory; lighter)
 *   - pauldrons: armor + strength + small HP (shoulder armor; heavier)
 */

import 'dotenv/config';
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { Transaction } from '@mysten/sui/transactions';

const PKG = process.env.SUI_PACKAGE_ID!;
const ADMIN_CAP = process.env.ADMIN_CAP_ID!;
const TRZ_KEY = process.env.SUI_TREASURY_PRIVATE_KEY!;
if (!PKG || !ADMIN_CAP || !TRZ_KEY) {
  console.error('Missing env: SUI_PACKAGE_ID, ADMIN_CAP_ID, SUI_TREASURY_PRIVATE_KEY required.');
  process.exit(1);
}

const MR_BOSS = '0xf669789c0e6d30627e8480b5886721d608d796277aab0664cfa84b2c04590f33';
const SX      = '0x03c33df0c97d4dfb3792d340bbf83891e2a20d653155874fd37a350ad443985f';

// Item type constants (mirrors item.move v5.1 — pauldrons REMOVED, ring_3
// reuses RING=8).
const IT_WEAPON = 1, IT_SHIELD = 2, IT_HELMET = 3, IT_CHEST = 4, IT_GLOVES = 5;
const IT_BOOTS = 6, IT_BELT = 7, IT_RING = 8, IT_NECKLACE = 9;
const IT_PANTS = 10, IT_BRACELETS = 11;
// Slot type constants.
const SLOT_MAINHAND = 0, SLOT_OFFHAND = 1, SLOT_BOTH_HANDS = 2;

interface ItemSpec {
  name: string;
  image_url: string;
  item_type: number;
  class_req: number;
  level_req: number;
  rarity: number;        // 1..5
  slot_type: number;     // 0=mainhand, 1=offhand, 2=both_hands
  strength_bonus: number;
  dexterity_bonus: number;
  intuition_bonus: number;
  endurance_bonus: number;
  hp_bonus: number;
  armor_bonus: number;
  defense_bonus: number;
  attack_bonus: number;
  crit_chance_bonus: number;
  crit_multiplier_bonus: number;
  evasion_bonus: number;
  anti_crit_bonus: number;
  anti_evasion_bonus: number;
  min_damage: number;
  max_damage: number;
  to: string;            // recipient wallet
}

// Stat-budget sanity helper — sum of all *_bonus + max_damage ≤ rarity budget.
function budget(rarity: number): number {
  return [0, 20, 40, 70, 110, 160][rarity];
}
function statSum(s: ItemSpec): number {
  return s.strength_bonus + s.dexterity_bonus + s.intuition_bonus + s.endurance_bonus
       + s.hp_bonus + s.armor_bonus + s.defense_bonus + s.attack_bonus
       + s.crit_chance_bonus + s.crit_multiplier_bonus + s.evasion_bonus
       + s.anti_crit_bonus + s.anti_evasion_bonus + s.max_damage;
}

// Image CID from v5.0 starter mint (re-usable on testnet).
const IMG_BASE = 'https://gateway.pinata.cloud/ipfs/bafybeiarz5gk3selzpjclugdl2odmvdtbtvi7gtky65m7chkyjymci3yfy';

// Pre-built specs — Mr_Boss (crit/str-leaning) + Sx (evasion/dex-leaning).
// Every item is COMMON (rarity=1, budget=20) for first-session simplicity.
function mrBossKit(): ItemSpec[] {
  const placeholder = `${IMG_BASE}/item.png`;
  return [
    // Weapon — mainhand sword, crit-leaning
    { name: 'Iron Shortsword',     image_url: placeholder, item_type: IT_WEAPON,    class_req: 0, level_req: 1, rarity: 1, slot_type: SLOT_MAINHAND, strength_bonus: 0, dexterity_bonus: 0, intuition_bonus: 1, endurance_bonus: 0, hp_bonus: 0, armor_bonus: 0, defense_bonus: 0, attack_bonus: 2, crit_chance_bonus: 1, crit_multiplier_bonus: 0, evasion_bonus: 0, anti_crit_bonus: 0, anti_evasion_bonus: 0, min_damage: 4, max_damage: 8, to: MR_BOSS },
    // Offhand — small shield
    { name: 'Buckler',             image_url: placeholder, item_type: IT_SHIELD,    class_req: 0, level_req: 1, rarity: 1, slot_type: SLOT_OFFHAND,  strength_bonus: 0, dexterity_bonus: 0, intuition_bonus: 0, endurance_bonus: 2, hp_bonus: 5, armor_bonus: 4, defense_bonus: 1, attack_bonus: 0, crit_chance_bonus: 0, crit_multiplier_bonus: 0, evasion_bonus: 0, anti_crit_bonus: 0, anti_evasion_bonus: 0, min_damage: 0, max_damage: 0, to: MR_BOSS },
    { name: 'Iron Cap',            image_url: placeholder, item_type: IT_HELMET,    class_req: 0, level_req: 1, rarity: 1, slot_type: SLOT_MAINHAND, strength_bonus: 0, dexterity_bonus: 0, intuition_bonus: 0, endurance_bonus: 2, hp_bonus: 5, armor_bonus: 3, defense_bonus: 0, attack_bonus: 0, crit_chance_bonus: 0, crit_multiplier_bonus: 0, evasion_bonus: 0, anti_crit_bonus: 0, anti_evasion_bonus: 0, min_damage: 0, max_damage: 0, to: MR_BOSS },
    { name: 'Leather Vest',        image_url: placeholder, item_type: IT_CHEST,     class_req: 0, level_req: 1, rarity: 1, slot_type: SLOT_MAINHAND, strength_bonus: 1, dexterity_bonus: 0, intuition_bonus: 0, endurance_bonus: 2, hp_bonus: 6, armor_bonus: 4, defense_bonus: 0, attack_bonus: 0, crit_chance_bonus: 0, crit_multiplier_bonus: 0, evasion_bonus: 0, anti_crit_bonus: 0, anti_evasion_bonus: 0, min_damage: 0, max_damage: 0, to: MR_BOSS },
    { name: 'Leather Gloves',      image_url: placeholder, item_type: IT_GLOVES,    class_req: 0, level_req: 1, rarity: 1, slot_type: SLOT_MAINHAND, strength_bonus: 1, dexterity_bonus: 0, intuition_bonus: 1, endurance_bonus: 0, hp_bonus: 0, armor_bonus: 1, defense_bonus: 0, attack_bonus: 1, crit_chance_bonus: 1, crit_multiplier_bonus: 0, evasion_bonus: 0, anti_crit_bonus: 0, anti_evasion_bonus: 0, min_damage: 0, max_damage: 0, to: MR_BOSS },
    { name: 'Leather Boots',       image_url: placeholder, item_type: IT_BOOTS,     class_req: 0, level_req: 1, rarity: 1, slot_type: SLOT_MAINHAND, strength_bonus: 0, dexterity_bonus: 1, intuition_bonus: 0, endurance_bonus: 1, hp_bonus: 4, armor_bonus: 2, defense_bonus: 0, attack_bonus: 0, crit_chance_bonus: 0, crit_multiplier_bonus: 0, evasion_bonus: 0, anti_crit_bonus: 0, anti_evasion_bonus: 0, min_damage: 0, max_damage: 0, to: MR_BOSS },
    { name: 'Studded Belt',        image_url: placeholder, item_type: IT_BELT,      class_req: 0, level_req: 1, rarity: 1, slot_type: SLOT_MAINHAND, strength_bonus: 1, dexterity_bonus: 0, intuition_bonus: 0, endurance_bonus: 1, hp_bonus: 3, armor_bonus: 1, defense_bonus: 0, attack_bonus: 0, crit_chance_bonus: 0, crit_multiplier_bonus: 0, evasion_bonus: 0, anti_crit_bonus: 0, anti_evasion_bonus: 0, min_damage: 0, max_damage: 0, to: MR_BOSS },
    { name: 'Iron Signet',         image_url: placeholder, item_type: IT_RING,      class_req: 0, level_req: 1, rarity: 1, slot_type: SLOT_MAINHAND, strength_bonus: 1, dexterity_bonus: 0, intuition_bonus: 1, endurance_bonus: 0, hp_bonus: 0, armor_bonus: 0, defense_bonus: 0, attack_bonus: 1, crit_chance_bonus: 1, crit_multiplier_bonus: 0, evasion_bonus: 0, anti_crit_bonus: 0, anti_evasion_bonus: 0, min_damage: 0, max_damage: 0, to: MR_BOSS },
    { name: 'Bone Ring',           image_url: placeholder, item_type: IT_RING,      class_req: 0, level_req: 1, rarity: 1, slot_type: SLOT_MAINHAND, strength_bonus: 0, dexterity_bonus: 0, intuition_bonus: 2, endurance_bonus: 0, hp_bonus: 0, armor_bonus: 0, defense_bonus: 0, attack_bonus: 0, crit_chance_bonus: 2, crit_multiplier_bonus: 0, evasion_bonus: 0, anti_crit_bonus: 0, anti_evasion_bonus: 0, min_damage: 0, max_damage: 0, to: MR_BOSS },
    { name: 'Wolf Tooth Pendant',  image_url: placeholder, item_type: IT_NECKLACE,  class_req: 0, level_req: 1, rarity: 1, slot_type: SLOT_MAINHAND, strength_bonus: 1, dexterity_bonus: 0, intuition_bonus: 1, endurance_bonus: 0, hp_bonus: 0, armor_bonus: 0, defense_bonus: 0, attack_bonus: 1, crit_chance_bonus: 1, crit_multiplier_bonus: 0, evasion_bonus: 0, anti_crit_bonus: 0, anti_evasion_bonus: 0, min_damage: 0, max_damage: 0, to: MR_BOSS },
    // v5.1 new slots — Mr_Boss
    { name: 'Iron Greaves',        image_url: placeholder, item_type: IT_PANTS,     class_req: 0, level_req: 1, rarity: 1, slot_type: SLOT_MAINHAND, strength_bonus: 0, dexterity_bonus: 0, intuition_bonus: 0, endurance_bonus: 2, hp_bonus: 5, armor_bonus: 3, defense_bonus: 0, attack_bonus: 0, crit_chance_bonus: 0, crit_multiplier_bonus: 0, evasion_bonus: 0, anti_crit_bonus: 0, anti_evasion_bonus: 0, min_damage: 0, max_damage: 0, to: MR_BOSS },
    { name: 'Spiked Bracelets',    image_url: placeholder, item_type: IT_BRACELETS, class_req: 0, level_req: 1, rarity: 1, slot_type: SLOT_MAINHAND, strength_bonus: 1, dexterity_bonus: 1, intuition_bonus: 0, endurance_bonus: 0, hp_bonus: 0, armor_bonus: 0, defense_bonus: 0, attack_bonus: 1, crit_chance_bonus: 1, crit_multiplier_bonus: 0, evasion_bonus: 0, anti_crit_bonus: 0, anti_evasion_bonus: 0, min_damage: 0, max_damage: 0, to: MR_BOSS },
    // v5.1 (final) — third ring for Mr_Boss (reuses RING item_type=8).
    { name: 'Obsidian Band',       image_url: placeholder, item_type: IT_RING,      class_req: 0, level_req: 1, rarity: 1, slot_type: SLOT_MAINHAND, strength_bonus: 1, dexterity_bonus: 0, intuition_bonus: 1, endurance_bonus: 0, hp_bonus: 0, armor_bonus: 0, defense_bonus: 0, attack_bonus: 1, crit_chance_bonus: 1, crit_multiplier_bonus: 0, evasion_bonus: 0, anti_crit_bonus: 0, anti_evasion_bonus: 0, min_damage: 0, max_damage: 0, to: MR_BOSS },
  ];
}

function sxKit(): ItemSpec[] {
  const placeholder = `${IMG_BASE}/item.png`;
  return [
    { name: 'Twin Stiletto',       image_url: placeholder, item_type: IT_WEAPON,    class_req: 0, level_req: 1, rarity: 1, slot_type: SLOT_MAINHAND, strength_bonus: 0, dexterity_bonus: 1, intuition_bonus: 0, endurance_bonus: 0, hp_bonus: 0, armor_bonus: 0, defense_bonus: 0, attack_bonus: 1, crit_chance_bonus: 0, crit_multiplier_bonus: 0, evasion_bonus: 2, anti_crit_bonus: 0, anti_evasion_bonus: 0, min_damage: 3, max_damage: 6, to: SX },
    { name: 'Twin Stiletto B',     image_url: placeholder, item_type: IT_WEAPON,    class_req: 0, level_req: 1, rarity: 1, slot_type: SLOT_MAINHAND, strength_bonus: 0, dexterity_bonus: 1, intuition_bonus: 0, endurance_bonus: 0, hp_bonus: 0, armor_bonus: 0, defense_bonus: 0, attack_bonus: 1, crit_chance_bonus: 0, crit_multiplier_bonus: 0, evasion_bonus: 2, anti_crit_bonus: 0, anti_evasion_bonus: 0, min_damage: 3, max_damage: 6, to: SX },
    { name: 'Hunter Hood',         image_url: placeholder, item_type: IT_HELMET,    class_req: 0, level_req: 1, rarity: 1, slot_type: SLOT_MAINHAND, strength_bonus: 0, dexterity_bonus: 2, intuition_bonus: 0, endurance_bonus: 1, hp_bonus: 3, armor_bonus: 1, defense_bonus: 0, attack_bonus: 0, crit_chance_bonus: 0, crit_multiplier_bonus: 0, evasion_bonus: 2, anti_crit_bonus: 0, anti_evasion_bonus: 0, min_damage: 0, max_damage: 0, to: SX },
    { name: 'Shadow Vest',         image_url: placeholder, item_type: IT_CHEST,     class_req: 0, level_req: 1, rarity: 1, slot_type: SLOT_MAINHAND, strength_bonus: 0, dexterity_bonus: 2, intuition_bonus: 0, endurance_bonus: 1, hp_bonus: 4, armor_bonus: 2, defense_bonus: 0, attack_bonus: 0, crit_chance_bonus: 0, crit_multiplier_bonus: 0, evasion_bonus: 2, anti_crit_bonus: 0, anti_evasion_bonus: 0, min_damage: 0, max_damage: 0, to: SX },
    { name: 'Shadow Gloves',       image_url: placeholder, item_type: IT_GLOVES,    class_req: 0, level_req: 1, rarity: 1, slot_type: SLOT_MAINHAND, strength_bonus: 0, dexterity_bonus: 2, intuition_bonus: 0, endurance_bonus: 0, hp_bonus: 0, armor_bonus: 1, defense_bonus: 0, attack_bonus: 1, crit_chance_bonus: 0, crit_multiplier_bonus: 0, evasion_bonus: 1, anti_crit_bonus: 0, anti_evasion_bonus: 1, min_damage: 0, max_damage: 0, to: SX },
    { name: 'Whisperwind Boots',   image_url: placeholder, item_type: IT_BOOTS,     class_req: 0, level_req: 1, rarity: 1, slot_type: SLOT_MAINHAND, strength_bonus: 0, dexterity_bonus: 2, intuition_bonus: 0, endurance_bonus: 0, hp_bonus: 0, armor_bonus: 0, defense_bonus: 0, attack_bonus: 0, crit_chance_bonus: 0, crit_multiplier_bonus: 0, evasion_bonus: 3, anti_crit_bonus: 0, anti_evasion_bonus: 0, min_damage: 0, max_damage: 0, to: SX },
    { name: 'Quicksilver Belt',    image_url: placeholder, item_type: IT_BELT,      class_req: 0, level_req: 1, rarity: 1, slot_type: SLOT_MAINHAND, strength_bonus: 0, dexterity_bonus: 1, intuition_bonus: 0, endurance_bonus: 1, hp_bonus: 3, armor_bonus: 0, defense_bonus: 0, attack_bonus: 0, crit_chance_bonus: 0, crit_multiplier_bonus: 0, evasion_bonus: 2, anti_crit_bonus: 0, anti_evasion_bonus: 0, min_damage: 0, max_damage: 0, to: SX },
    { name: 'Moonstone Ring',      image_url: placeholder, item_type: IT_RING,      class_req: 0, level_req: 1, rarity: 1, slot_type: SLOT_MAINHAND, strength_bonus: 0, dexterity_bonus: 2, intuition_bonus: 0, endurance_bonus: 0, hp_bonus: 0, armor_bonus: 0, defense_bonus: 0, attack_bonus: 0, crit_chance_bonus: 0, crit_multiplier_bonus: 0, evasion_bonus: 2, anti_crit_bonus: 0, anti_evasion_bonus: 0, min_damage: 0, max_damage: 0, to: SX },
    { name: 'Fox Pearl',           image_url: placeholder, item_type: IT_RING,      class_req: 0, level_req: 1, rarity: 1, slot_type: SLOT_MAINHAND, strength_bonus: 0, dexterity_bonus: 1, intuition_bonus: 0, endurance_bonus: 0, hp_bonus: 0, armor_bonus: 0, defense_bonus: 0, attack_bonus: 0, crit_chance_bonus: 0, crit_multiplier_bonus: 0, evasion_bonus: 2, anti_crit_bonus: 1, anti_evasion_bonus: 0, min_damage: 0, max_damage: 0, to: SX },
    { name: 'Cat-eye Amulet',      image_url: placeholder, item_type: IT_NECKLACE,  class_req: 0, level_req: 1, rarity: 1, slot_type: SLOT_MAINHAND, strength_bonus: 0, dexterity_bonus: 2, intuition_bonus: 1, endurance_bonus: 0, hp_bonus: 0, armor_bonus: 0, defense_bonus: 0, attack_bonus: 0, crit_chance_bonus: 0, crit_multiplier_bonus: 0, evasion_bonus: 2, anti_crit_bonus: 0, anti_evasion_bonus: 0, min_damage: 0, max_damage: 0, to: SX },
    // v5.1 new slots — Sx
    { name: 'Quicksilver Trousers',image_url: placeholder, item_type: IT_PANTS,     class_req: 0, level_req: 1, rarity: 1, slot_type: SLOT_MAINHAND, strength_bonus: 0, dexterity_bonus: 2, intuition_bonus: 0, endurance_bonus: 0, hp_bonus: 0, armor_bonus: 0, defense_bonus: 0, attack_bonus: 0, crit_chance_bonus: 0, crit_multiplier_bonus: 0, evasion_bonus: 3, anti_crit_bonus: 0, anti_evasion_bonus: 0, min_damage: 0, max_damage: 0, to: SX },
    { name: 'Silken Wraps',        image_url: placeholder, item_type: IT_BRACELETS, class_req: 0, level_req: 1, rarity: 1, slot_type: SLOT_MAINHAND, strength_bonus: 0, dexterity_bonus: 2, intuition_bonus: 0, endurance_bonus: 0, hp_bonus: 0, armor_bonus: 0, defense_bonus: 0, attack_bonus: 1, crit_chance_bonus: 0, crit_multiplier_bonus: 0, evasion_bonus: 2, anti_crit_bonus: 0, anti_evasion_bonus: 0, min_damage: 0, max_damage: 0, to: SX },
    // v5.1 (final) — third ring for Sx (reuses RING item_type=8).
    { name: 'Moonshade Band',      image_url: placeholder, item_type: IT_RING,      class_req: 0, level_req: 1, rarity: 1, slot_type: SLOT_MAINHAND, strength_bonus: 0, dexterity_bonus: 2, intuition_bonus: 0, endurance_bonus: 0, hp_bonus: 0, armor_bonus: 0, defense_bonus: 0, attack_bonus: 0, crit_chance_bonus: 0, crit_multiplier_bonus: 0, evasion_bonus: 2, anti_crit_bonus: 0, anti_evasion_bonus: 0, min_damage: 0, max_damage: 0, to: SX },
  ];
}

async function main() {
  const network = (process.env.SUI_NETWORK === 'mainnet' ? 'mainnet' : 'testnet') as 'mainnet' | 'testnet';
  const client = new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl(network), network });
  const { scheme, secretKey } = decodeSuiPrivateKey(TRZ_KEY);
  if (scheme !== 'ED25519') throw new Error(`Expected ED25519, got ${scheme}`);
  const treasury = Ed25519Keypair.fromSecretKey(secretKey);
  console.log(`[mint] TREASURY=${treasury.toSuiAddress()}  pkg=${PKG.slice(0, 14)}…`);

  const specs = [...mrBossKit(), ...sxKit()];
  console.log(`[mint] ${specs.length} items planned. Pre-flighting rarity budgets…`);

  // Pre-flight: refuse to fire any tx if any spec exceeds its rarity budget.
  let bad = 0;
  for (const s of specs) {
    const sum = statSum(s);
    const cap = budget(s.rarity);
    if (sum > cap) {
      console.error(`  BUDGET_EXCEEDED  ${s.name} sum=${sum} > rarity-${s.rarity}-budget=${cap}`);
      bad++;
    }
  }
  if (bad > 0) {
    console.error(`[mint] ${bad}/${specs.length} items exceed rarity budget — aborting.`);
    process.exit(2);
  }
  console.log('[mint] All items within budget. Minting…');

  let successCount = 0;
  let failCount = 0;
  for (const s of specs) {
    const tx = new Transaction();
    tx.setGasBudget(50_000_000n);
    const [item] = tx.moveCall({
      target: `${PKG}::item::mint_item_admin`,
      arguments: [
        tx.object(ADMIN_CAP),
        tx.pure.string(s.name),
        tx.pure.string(s.image_url),
        tx.pure.u8(s.item_type),
        tx.pure.u8(s.class_req),
        tx.pure.u8(s.level_req),
        tx.pure.u8(s.rarity),
        tx.pure.u8(s.slot_type),
        tx.pure.u16(s.strength_bonus),
        tx.pure.u16(s.dexterity_bonus),
        tx.pure.u16(s.intuition_bonus),
        tx.pure.u16(s.endurance_bonus),
        tx.pure.u16(s.hp_bonus),
        tx.pure.u16(s.armor_bonus),
        tx.pure.u16(s.defense_bonus),
        tx.pure.u16(s.attack_bonus),
        tx.pure.u16(s.crit_chance_bonus),
        tx.pure.u16(s.crit_multiplier_bonus),
        tx.pure.u16(s.evasion_bonus),
        tx.pure.u16(s.anti_crit_bonus),
        tx.pure.u16(s.anti_evasion_bonus),
        tx.pure.u16(s.min_damage),
        tx.pure.u16(s.max_damage),
      ],
    });
    // mint_item_admin transfers the new Item to ctx.sender (TREASURY).
    // Subsequent transfer in the same PTB is NOT possible because Item is
    // moved by mint_item_admin's transfer::public_transfer. So we mint in
    // one PTB, then chain a separate transfer call in a follow-up tx using
    // the new object id from effects. To keep this script simple, we use
    // two PTBs per item — minor cost vs. complexity.
    // Settle gas-coin version between txs — the SDK normalises object refs
    // at signing time and rapid back-to-back txs sometimes race the
    // server-side index. A short sleep + one retry is the canonical fix.
    await new Promise((r) => setTimeout(r, 600));
    let mintResult: any;
    try {
      mintResult = await client.signAndExecuteTransaction({
        transaction: tx,
        signer: treasury,
        options: { showEffects: true, showObjectChanges: true },
      });
    } catch (firstErr: any) {
      const msg = firstErr?.message || String(firstErr);
      if (msg.includes('unavailable for consumption') || msg.includes('version')) {
        // Gas-coin version race — retry once after a longer wait.
        await new Promise((r) => setTimeout(r, 2000));
        mintResult = await client.signAndExecuteTransaction({
          transaction: tx,
          signer: treasury,
          options: { showEffects: true, showObjectChanges: true },
        });
      } else {
        throw firstErr;
      }
    }
    try {
      if (mintResult.effects?.status?.status !== 'success') {
        console.error(`  FAIL  ${s.name}: ${mintResult.effects?.status?.error}`);
        failCount++;
        continue;
      }
      // Find the newly created Item.
      const created = mintResult.objectChanges?.find(
        (c: any) => c.type === 'created' && c.objectType?.endsWith('::item::Item'),
      ) as any;
      if (!created) {
        console.error(`  FAIL  ${s.name}: no Item in objectChanges`);
        failCount++;
        continue;
      }
      // Transfer to the recipient.
      const transferTx = new Transaction();
      transferTx.setGasBudget(30_000_000n);
      transferTx.transferObjects([transferTx.object(created.objectId)], transferTx.pure.address(s.to));
      await new Promise((r) => setTimeout(r, 600));
      let transferResult: any;
      try {
        transferResult = await client.signAndExecuteTransaction({
          transaction: transferTx,
          signer: treasury,
          options: { showEffects: true },
        });
      } catch (transferErr: any) {
        const tmsg = transferErr?.message || String(transferErr);
        if (tmsg.includes('unavailable for consumption') || tmsg.includes('version')) {
          await new Promise((r) => setTimeout(r, 2000));
          transferResult = await client.signAndExecuteTransaction({
            transaction: transferTx,
            signer: treasury,
            options: { showEffects: true },
          });
        } else {
          throw transferErr;
        }
      }
      if (transferResult.effects?.status?.status !== 'success') {
        console.error(`  TRANSFER_FAIL  ${s.name}: ${transferResult.effects?.status?.error}`);
        failCount++;
        continue;
      }
      console.log(`  OK    ${s.name.padEnd(28)} → ${s.to.slice(0, 14)}…  id=${created.objectId.slice(0, 14)}…`);
      successCount++;
    } catch (err: any) {
      console.error(`  ERROR ${s.name}: ${err?.message || err}`);
      failCount++;
    }
  }

  console.log();
  console.log(`[mint] DONE: ${successCount} succeeded, ${failCount} failed (of ${specs.length})`);
  if (failCount > 0) process.exit(3);
}

main().catch((err) => {
  console.error('[mint] uncaught:', err?.message || err);
  process.exit(1);
});
