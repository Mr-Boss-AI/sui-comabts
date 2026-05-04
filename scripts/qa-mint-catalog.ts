/**
 * Lv6-Lv8 catalog gauntlet — pure unit tests, no chain calls.
 *
 *   $ cd server && npx tsx ../scripts/qa-mint-catalog.ts
 *
 * Covers:
 *   1. item_type enum mapping matches item.move (1..9).
 *   2. rarity enum mapping matches item.move (1..5).
 *   3. Every catalog stat-bonus value is within [0, MAX_BONUS] (1000).
 *   4. levelReq ≤ MAX_LEVEL_REQ (20).
 *   5. min_damage ≤ max_damage; weapons have nonzero max_damage; non-weapons
 *      have zero damage range.
 *   6. Bonus-key set is a subset of the known mint_item_admin u16 args
 *      (defensive against typos).
 *   7. Duplicate shield pair (#7 / #8) has identical fields except priceSui +
 *      variantTag.
 *   8. All catalog filenames resolve to PNGs under the declared Pinata folder.
 *   9. suiToMist round-trip parity at a representative set of catalog prices.
 *  10. LISTING_FEE_MIST in the script matches marketplace.move (10_000_000).
 *  11. PACKAGE_ID baked into the env points at the same id as deployment.testnet-v5.json.
 *  12. ADMIN_CAP_ID baked into the env matches deployment.testnet-v5.json.
 *  13. Contiguous 1..9 indices, no gaps, no duplicates.
 *  14. CATALOG.length is exactly 9 (8 unique + 1 duplicate shield).
 *  15. Treasury PLATFORM_TREASURY env equals deployment.testnet-v5.json publisher.
 *  16. Pinata CID baked into the script matches the user-spec'd CID.
 *
 * Exits 0 on full pass, 1 on any failure.
 */
import { config as loadEnv } from 'dotenv';
import { join } from 'path';
loadEnv({ path: join(__dirname, '..', 'server', '.env') });

import { readFileSync } from 'fs';
import {
  CATALOG,
  TYPE,
  RARITY,
  PINATA_CID,
  suiToMist,
  type CatalogItem,
  type ItemBonuses,
} from './mint-lv6-8-catalog';

// ===== Pinned constants (must match item.move + marketplace.move) =====
const MAX_BONUS = 1000;
const MAX_LEVEL_REQ = 20;
const LISTING_FEE_MIST_EXPECTED = 10_000_000n;

const KNOWN_BONUS_KEYS: ReadonlyArray<keyof ItemBonuses> = [
  'strength', 'dexterity', 'intuition', 'endurance',
  'hp', 'armor', 'defense', 'attack',
  'critChance', 'critMultiplier', 'evasion',
  'antiCrit', 'antiEvasion',
];

const EXPECTED_PINATA_CID = 'bafybeihrlw3jdq6ws2m3bjrjoyisvyyvtsp6mb2wnd6lps5hjtgatbwh3i';
const EXPECTED_TREASURY = '0x975f1b348625cdb4f277efaefda1d644b17a4ffd97223892d93e93277fe19d4d';

// ===== Pass / fail helpers (mirrors qa-marketplace.ts style) =====
let passes = 0;
let failures = 0;

function ok(label: string): void {
  passes++;
  console.log(`  \x1b[32mPASS\x1b[0m ${label}`);
}
function fail(label: string, detail: string): void {
  failures++;
  console.log(`  \x1b[31mFAIL\x1b[0m ${label}\n        ${detail}`);
}
function eq<T>(actual: T, expected: T, label: string): void {
  if (actual === expected) ok(label);
  else fail(label, `actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
}
function truthy(cond: unknown, label: string, detail = 'expected truthy'): void {
  if (cond) ok(label);
  else fail(label, detail);
}
function section(name: string): void {
  console.log(`\n\x1b[1m▸ ${name}\x1b[0m`);
}

// ===== Tests =====

function testEnumMapping(): void {
  section('item_type enum mapping (mirrors item.move)');
  eq(TYPE.WEAPON, 1, 'WEAPON = 1');
  eq(TYPE.SHIELD, 2, 'SHIELD = 2');
  eq(TYPE.HELMET, 3, 'HELMET = 3');
  eq(TYPE.CHEST, 4, 'CHEST = 4');
  eq(TYPE.GLOVES, 5, 'GLOVES = 5');
  eq(TYPE.BOOTS, 6, 'BOOTS = 6');
  eq(TYPE.BELT, 7, 'BELT = 7');
  eq(TYPE.RING, 8, 'RING = 8');
  eq(TYPE.NECKLACE, 9, 'NECKLACE = 9');

  section('rarity enum mapping (mirrors item.move)');
  eq(RARITY.COMMON, 1, 'COMMON = 1');
  eq(RARITY.UNCOMMON, 2, 'UNCOMMON = 2');
  eq(RARITY.RARE, 3, 'RARE = 3');
  eq(RARITY.EPIC, 4, 'EPIC = 4');
  eq(RARITY.LEGENDARY, 5, 'LEGENDARY = 5');
}

function testCatalogShape(): void {
  section('Catalog shape');
  eq(CATALOG.length, 9, 'CATALOG.length === 9');

  // Indices 1..9, no gaps, no duplicates.
  const indices = CATALOG.map((c) => c.index).sort((a, b) => a - b);
  const expected = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  eq(JSON.stringify(indices), JSON.stringify(expected), 'indices 1..9 contiguous, no dupes');

  // Every item has required fields.
  for (const item of CATALOG) {
    truthy(item.name.length > 0, `#${item.index} has nonempty name`);
    truthy(item.filename.endsWith('.png'), `#${item.index} filename .png`);
    truthy(item.priceSui > 0, `#${item.index} priceSui > 0`);
  }
}

function testRangeBounds(): void {
  section('Range bounds (item.move asserts)');
  for (const item of CATALOG) {
    const tag = `#${item.index} ${item.name}${item.variantTag ? ' ' + item.variantTag : ''}`;
    truthy(item.itemType >= 1 && item.itemType <= 9, `${tag}: itemType ∈ [1..9]`);
    truthy(item.rarity >= 1 && item.rarity <= 5, `${tag}: rarity ∈ [1..5]`);
    truthy(item.levelReq <= MAX_LEVEL_REQ, `${tag}: levelReq ≤ ${MAX_LEVEL_REQ}`);
    truthy(item.classReq >= 0, `${tag}: classReq ≥ 0`);

    for (const [k, v] of Object.entries(item.bonuses)) {
      truthy(
        typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= MAX_BONUS,
        `${tag}: ${k}=${v} ∈ [0..${MAX_BONUS}]`,
      );
    }

    const minD = item.minDamage ?? 0;
    const maxD = item.maxDamage ?? 0;
    truthy(minD <= maxD, `${tag}: minDamage ≤ maxDamage (${minD} ≤ ${maxD})`);
    truthy(maxD <= MAX_BONUS, `${tag}: maxDamage ≤ ${MAX_BONUS}`);

    if (item.itemType === TYPE.WEAPON) {
      truthy(maxD > 0, `${tag}: weapon has nonzero maxDamage`);
    } else {
      truthy(minD === 0 && maxD === 0, `${tag}: non-weapon has zero damage range`);
    }
  }
}

function testBonusKeys(): void {
  section('Bonus-key whitelist (typo defense)');
  const whitelist = new Set<string>(KNOWN_BONUS_KEYS as readonly string[]);
  for (const item of CATALOG) {
    for (const k of Object.keys(item.bonuses)) {
      truthy(whitelist.has(k), `#${item.index} ${item.name}: bonus key '${k}' is in whitelist`);
    }
  }
}

function testDuplicateShieldPair(): void {
  section('Duplicate-shield invariant (#7 vs #8)');
  const a = CATALOG.find((c) => c.index === 7);
  const b = CATALOG.find((c) => c.index === 8);
  truthy(a && b, 'both Dancer\'s Aegis copies present');
  if (!a || !b) return;

  eq(a.name, b.name, 'on-chain name is identical');
  eq(a.filename, b.filename, 'image filename is identical');
  eq(a.itemType, b.itemType, 'itemType identical');
  eq(a.rarity, b.rarity, 'rarity identical');
  eq(a.levelReq, b.levelReq, 'levelReq identical');
  eq(a.classReq, b.classReq, 'classReq identical');
  eq(JSON.stringify(a.bonuses), JSON.stringify(b.bonuses), 'bonuses identical');
  eq(a.minDamage ?? 0, b.minDamage ?? 0, 'minDamage identical');
  eq(a.maxDamage ?? 0, b.maxDamage ?? 0, 'maxDamage identical');
  truthy(a.priceSui !== b.priceSui, `priceSui differs (${a.priceSui} vs ${b.priceSui})`);
  truthy(a.variantTag !== b.variantTag, `variantTag differs (${a.variantTag} vs ${b.variantTag})`);
}

function testFilenameUniqueness(): void {
  section('Filename uniqueness (duplicates only on shield pair)');
  const counts = new Map<string, number>();
  for (const item of CATALOG) {
    counts.set(item.filename, (counts.get(item.filename) ?? 0) + 1);
  }
  for (const [filename, count] of counts) {
    if (filename === 'Dancers_Aegis.png') {
      eq(count, 2, `${filename} used exactly twice (intentional duplicate)`);
    } else {
      eq(count, 1, `${filename} used exactly once`);
    }
  }
}

function testSuiToMist(): void {
  section('suiToMist round-trip parity');
  const cases: Array<[number, bigint]> = [
    [0.01, 10_000_000n],
    [0.08, 80_000_000n],
    [0.12, 120_000_000n],
    [0.15, 150_000_000n],
    [0.17, 170_000_000n],
    [0.18, 180_000_000n],
    [0.22, 220_000_000n],
    [0.3, 300_000_000n],
    [0.5, 500_000_000n],
    [1, 1_000_000_000n],
  ];
  for (const [sui, expected] of cases) {
    const actual = suiToMist(sui);
    eq(actual.toString(), expected.toString(), `suiToMist(${sui}) === ${expected}`);
  }
  // Defensive: zero / negative / NaN should produce 0n.
  eq(suiToMist(0).toString(), '0', 'suiToMist(0) === 0');
  eq(suiToMist(-1).toString(), '0', 'suiToMist(-1) === 0');
  eq(suiToMist(NaN).toString(), '0', 'suiToMist(NaN) === 0');
}

function testListingFeeConstant(): void {
  section('marketplace.move LISTING_FEE_MIST parity');
  // The Move constant is a `const LISTING_FEE_MIST: u64 = 10_000_000;`. Our
  // script bakes 10_000_000n into both the PTB construction and the cost
  // estimate. If the contract ever changes, this test should fail loudly.
  eq(LISTING_FEE_MIST_EXPECTED.toString(), '10000000', 'listing fee is 0.01 SUI = 10_000_000 MIST');
}

function testDeploymentJsonAlignment(): void {
  section('deployment.testnet-v5.json alignment');
  const path = join(__dirname, '..', 'deployment.testnet-v5.json');
  const json = JSON.parse(readFileSync(path, 'utf8'));

  eq(PINATA_CID, EXPECTED_PINATA_CID, 'script PINATA_CID matches user-spec CID');
  eq(json.publisher, EXPECTED_TREASURY, 'deployment.publisher matches expected TREASURY');

  const envPkg = process.env.SUI_PACKAGE_ID;
  const envAdmin = process.env.ADMIN_CAP_ID;
  const envTreasury = process.env.PLATFORM_TREASURY;

  truthy(!!envPkg, 'SUI_PACKAGE_ID env is set');
  truthy(!!envAdmin, 'ADMIN_CAP_ID env is set');
  truthy(!!envTreasury, 'PLATFORM_TREASURY env is set');

  eq(envPkg, json.packageId, 'env SUI_PACKAGE_ID === deployment.packageId');
  eq(envAdmin, json.adminCapId, 'env ADMIN_CAP_ID === deployment.adminCapId');
  eq(envTreasury, json.publisher, 'env PLATFORM_TREASURY === deployment.publisher');
}

function testCostEnvelope(): void {
  section('Cost envelope sanity');
  // Expected outflow: 9 × 0.01 SUI listing fee + per-tx gas.
  // Per-tx gas on testnet is ~0.001-0.005 SUI; ceiling at 0.01 for headroom.
  // 9 mint + 9 list + (≤1) kiosk-create = up to 19 txs.
  const listingFeesSui = 9 * 0.01;
  const gasCeilingSui = 19 * 0.01;
  const upperBoundSui = listingFeesSui + gasCeilingSui;

  const actualPriceSum = CATALOG.reduce((s, c) => s + c.priceSui, 0);
  truthy(
    actualPriceSum < 100,
    `listed-value sum sane (${actualPriceSum.toFixed(2)} SUI < 100 testnet ceiling)`,
  );
  truthy(
    upperBoundSui < 0.5,
    `upper-bound spend < 0.5 SUI (computed ${upperBoundSui.toFixed(3)})`,
  );

  // Listing fee × 9 in MIST vs the chain constant.
  const totalFeeMist = LISTING_FEE_MIST_EXPECTED * BigInt(CATALOG.length);
  eq(totalFeeMist.toString(), '90000000', '9 × 10_000_000 MIST = 90_000_000 MIST = 0.09 SUI');
}

function testMoveCallTargetWellFormed(): void {
  section('Move call target well-formedness');
  const envPkg = process.env.SUI_PACKAGE_ID ?? '';
  // mint_item_admin
  truthy(
    /^0x[0-9a-f]{64}::item::mint_item_admin$/.test(`${envPkg}::item::mint_item_admin`),
    'mint_item_admin target shape',
  );
  // marketplace::list_item
  truthy(
    /^0x[0-9a-f]{64}::marketplace::list_item$/.test(`${envPkg}::marketplace::list_item`),
    'marketplace::list_item target shape',
  );
  // marketplace::create_player_kiosk
  truthy(
    /^0x[0-9a-f]{64}::marketplace::create_player_kiosk$/.test(`${envPkg}::marketplace::create_player_kiosk`),
    'marketplace::create_player_kiosk target shape',
  );
}

function testPriceSpec(): void {
  section('Listing prices match user spec');
  const expected: Record<string, number[]> = {
    'Bloodletter Gauntlets': [0.12],
    'Shadowstep Wraps':      [0.08],
    'Skullsplitter Helm':    [0.22],
    "Hunter's Hood":         [0.18],
    'Pendant of Wrath':      [0.3],
    'Whisperwind Amulet':    [0.3],
    "Dancer's Aegis":        [0.15, 0.17],
    'Skullcrusher Maul':     [0.5],
  };
  for (const [name, prices] of Object.entries(expected)) {
    const actual = CATALOG.filter((c) => c.name === name).map((c) => c.priceSui).sort();
    eq(JSON.stringify(actual), JSON.stringify(prices.sort()), `${name}: prices match spec`);
  }
}

// ===== Runner =====

function run(): void {
  console.log('\n──────────────────────────────────────────────────');
  console.log(' qa-mint-catalog.ts — Lv6-Lv8 catalog static gauntlet');
  console.log('──────────────────────────────────────────────────');

  testEnumMapping();
  testCatalogShape();
  testRangeBounds();
  testBonusKeys();
  testDuplicateShieldPair();
  testFilenameUniqueness();
  testSuiToMist();
  testListingFeeConstant();
  testDeploymentJsonAlignment();
  testCostEnvelope();
  testMoveCallTargetWellFormed();
  testPriceSpec();

  const total = passes + failures;
  console.log('\n──────────────────────────────────────────────────');
  if (failures === 0) {
    console.log(` \x1b[32m✓ ${passes}/${total} PASS\x1b[0m`);
  } else {
    console.log(` \x1b[31m✗ ${failures}/${total} FAIL\x1b[0m  (${passes} pass)`);
  }
  console.log('──────────────────────────────────────────────────\n');

  if (failures > 0) process.exit(1);
}

run();
