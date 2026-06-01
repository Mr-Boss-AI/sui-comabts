/**
 * One-shot — TREASURY-signed `set_fight_lock(character, 0)` rescue.
 *
 * When a fight ends without releasing the on-chain fight-lock (e.g. the
 * post-fight setFightLockOnChain(0) call failed after exhausting retries
 * because of a treasury gas-coin version race) the player has to wait
 * up to 10 min (server FIGHT_LOCK_DURATION_MS) — or up to 60 min
 * (chain MAX_LOCK_MS) for legacy long-set locks — before `is_fight_locked`
 * returns false and `create_wager` will accept them again.
 *
 * The 2026-06-01 live draw-settlement incident hit this on Sx +
 * Mr_Boss after a mutual-KO. The v5.2.1 atomic-PTB draw bundle
 * (settleDrawBundleOnChain) closes the underlying race + adds the
 * missing lock release, but this script remains the canonical
 * triage tool for the next time a single setFightLock RPC blip
 * leaves a lock dangling.
 *
 * Usage:
 *   npx ts-node scripts/admin-clear-fight-lock.ts <characterId> [...characterIds]
 *
 * Example (the 2026-06-01 stuck pair):
 *   npx ts-node scripts/admin-clear-fight-lock.ts \
 *     0xcb5ba743aa42944bf4b2032debfe25a89d315afae4abeea9f0c40eb52d3471a6 \
 *     0x620d5008070b11d08fa1c5766fe8a8d53b78acbea4c8e63b0b0852698bcb4e42
 *
 * Reads server/.env for SUI_TREASURY_PRIVATE_KEY / SUI_PACKAGE_ID /
 * ADMIN_CAP_ID. Reuses the server's `setFightLockOnChain` so retry
 * budget + treasury queue serialization match production exactly.
 *
 * Outputs per-character: pre-flight lock state (DF value or "no lock"),
 * the clear tx digest, post-flight verification. Exits non-zero if any
 * clear fails so it composes with CI / cron.
 */
// dotenv MUST run before any module-level import of server/src/config
// is evaluated, otherwise `required('SUI_PACKAGE_ID')` throws. TS hoists
// `import` statements above top-level statements at runtime, so we use
// `require` + dynamic `import()` to enforce the order.
//
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { config: loadEnv } = require('dotenv');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { join } = require('path') as typeof import('path');
loadEnv({ path: join(__dirname, '..', 'server', '.env') });

import type { SuiJsonRpcClient as SuiJsonRpcClientT } from '@mysten/sui/jsonRpc';

const LOCK_KEY_NAME = 'fight_lock_expires_at';

async function readLockExpiry(
  client: SuiJsonRpcClientT,
  characterId: string,
): Promise<number | null> {
  try {
    const df = await client.getDynamicFieldObject({
      parentId: characterId,
      name: { type: 'vector<u8>', value: Array.from(Buffer.from(LOCK_KEY_NAME)) },
    });
    const fields = (df.data?.content as { fields?: Record<string, unknown> } | undefined)?.fields;
    if (!fields) return null;
    const raw = fields.value ?? fields.expires_at_ms ?? null;
    if (raw == null) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function formatLockStatus(expiresAtMs: number | null): string {
  if (expiresAtMs == null) return 'no lock DF';
  if (expiresAtMs === 0) return 'CLEARED (DF present, value 0 — chain treats as unlocked)';
  const now = Date.now();
  const deltaSec = Math.round((expiresAtMs - now) / 1000);
  const iso = new Date(expiresAtMs).toISOString();
  if (deltaSec > 0) return `LOCKED — expires ${iso} (in ${deltaSec}s)`;
  return `AUTO-EXPIRED — DF present with stale ts ${iso} (${-deltaSec}s ago); chain treats as unlocked`;
}

/** True when chain `is_fight_locked` would return false. The Move
 *  `set_fight_lock(_, 0)` doesn't delete the DF — it sets the value
 *  to 0. `is_fight_locked` returns `*expires > now`, so either
 *  DF-absent or DF-value <= now means unlocked. */
function isUnlocked(expiresAtMs: number | null): boolean {
  if (expiresAtMs == null) return true;
  return expiresAtMs <= Date.now();
}

async function clearOne(
  client: SuiJsonRpcClientT,
  setFightLockOnChain: (characterId: string, expiresAtMs: number) => Promise<{ digest: string }>,
  characterId: string,
): Promise<boolean> {
  console.log(`\n▸ ${characterId}`);
  const before = await readLockExpiry(client, characterId);
  console.log(`  pre:  ${formatLockStatus(before)}`);

  if (isUnlocked(before)) {
    if (before == null) {
      console.log('  ✔ no lock DF — nothing to clear');
      return true;
    }
    // DF exists but already unlocked (auto-expired or previously cleared).
    // Treat as success — chain semantics for `is_fight_locked` are false,
    // and re-zeroing a zero is wasted gas. Caller can pass --force to
    // re-zero anyway, but the default is to skip.
    console.log('  ✔ already unlocked on chain — skipping tx');
    return true;
  }

  try {
    const { digest } = await setFightLockOnChain(characterId, 0);
    console.log(`  tx:   ${digest}`);
    await client.waitForTransaction({ digest, options: { showEffects: true } });
    const after = await readLockExpiry(client, characterId);
    console.log(`  post: ${formatLockStatus(after)}`);
    return isUnlocked(after);
  } catch (err) {
    console.error(`  ✘ clear failed: ${(err as Error)?.message || err}`);
    return false;
  }
}

async function main() {
  const ids = process.argv.slice(2).filter((s) => s.startsWith('0x'));
  if (ids.length === 0) {
    console.error(
      'Usage: npx ts-node scripts/admin-clear-fight-lock.ts <characterId> [...characterIds]',
    );
    process.exit(1);
  }

  // CJS `require` AFTER loadEnv has populated process.env, so the server
  // config module evaluates with SUI_PACKAGE_ID set. `require` (vs.
  // `await import`) keeps NODE_PATH-based resolution working from
  // outside the server/ directory.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { SuiJsonRpcClient, getJsonRpcFullnodeUrl } = require('@mysten/sui/jsonRpc');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { setFightLockOnChain } = require('../server/src/utils/sui-settle');

  const network = (process.env.SUI_NETWORK ?? 'testnet') as 'testnet' | 'mainnet';
  const client = new SuiJsonRpcClient({
    url: getJsonRpcFullnodeUrl(network),
    network,
  });

  console.log(`\nadmin-clear-fight-lock — clearing ${ids.length} character(s) on ${network}\n`);

  let allOk = true;
  for (const id of ids) {
    const ok = await clearOne(client, setFightLockOnChain, id);
    if (!ok) allOk = false;
  }

  console.log(`\n${allOk ? '✔ All clears succeeded.' : '✘ At least one clear failed — see per-character log above.'}\n`);
  process.exit(allOk ? 0 : 1);
}

main().catch((err) => {
  console.error('\n✘ Script failed:', err?.message || err);
  if (err?.stack) console.error(err.stack);
  process.exit(1);
});
