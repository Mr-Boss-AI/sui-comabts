/**
 * Stat-points drift gauntlet.
 *
 *   $ cd server && npx tsx ../scripts/qa-stat-points.ts
 *
 * History:
 *
 *  Race A (BUG 1, live test 2026-05-02): server's `applyXp`
 *  optimistically incremented `unallocatedPoints` to 3 the instant a
 *  fight ended, but the on-chain `update_after_fight` lagged ~5-25s
 *  behind. Modal pre-helper showed "+3 to allocate" → user clicked →
 *  Slush dry-ran against the still-old chain object (0 unallocated) →
 *  abort code 2 (`ENotEnoughPoints`).
 *
 *  Race B (BUG, live test 2026-05-30 v5.2 QA): the SYMMETRIC race —
 *  chain `update_after_fight` lands and the server's in-memory record
 *  syncs (fight-room.ts:688), but no fresh `character_data` is pushed.
 *  Frontend's `state.character.unallocatedPoints` stays at 0; the
 *  chain-refetched `state.onChainCharacter.unallocatedPoints` is 3.
 *  Under the OLD `min(server, chain)` clamp, the modal showed
 *  "Remaining: 0" and refused to allocate even though the chain would
 *  have accepted 3.
 *
 * Fix: `effectiveUnallocatedPoints` trusts chain when present (it's
 * the binding gate for `allocate_points` — `assert!(total <=
 * unallocated_points, ENotEnoughPoints)`). Race A: chain=0 → return 0,
 * still safe. Race B: chain=3 → return 3, correct. Server-side
 * `character_data` push after fight-end (fight-room.ts) makes the
 * server-side mirror catch up — but the helper remains the canonical
 * defence (the WS push could still race the modal open).
 *
 * Pure-function tests + source-grep tests (REST + WS serializer +
 * fight-room push) pin every drop point the live-QA bug uncovered.
 *
 * Exits 0 on full pass, 1 on any failure.
 */
import {
  effectiveUnallocatedPoints,
  isAwaitingChainCatchup,
  applyLocalAllocate,
} from '../frontend/src/lib/stat-points';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..');

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

function main(): void {
  // ===========================================================================
  // 1 — agreement (no drift): both sources match
  // ===========================================================================
  console.log('\n[1] Agreement — server and chain match');
  eq(effectiveUnallocatedPoints(0, 0), 0, '0/0 → 0');
  eq(effectiveUnallocatedPoints(3, 3), 3, '3/3 → 3 (the post-catchup case)');
  eq(effectiveUnallocatedPoints(9, 9), 9, '9/9 → 9');
  eq(isAwaitingChainCatchup(0, 0), false, '0/0 → not awaiting');
  eq(isAwaitingChainCatchup(3, 3), false, '3/3 → not awaiting');

  // ===========================================================================
  // 2 — ⚡ THE BUG: server ahead of chain → clamp to chain (smaller)
  // ===========================================================================
  console.log('\n[2] ⚡ BUG 1 reproduction — server ahead of chain → return chain');
  eq(
    effectiveUnallocatedPoints(3, 0),
    0,
    'server=3, chain=0 → 0 (the EXACT Sx_v5.1 abort scenario)',
  );
  eq(
    effectiveUnallocatedPoints(6, 3),
    3,
    'server=6, chain=3 → 3 (mid-catchup, chain ahead by one tx)',
  );
  eq(
    effectiveUnallocatedPoints(9, 0),
    0,
    'server=9, chain=0 → 0 (multi-level catchup)',
  );
  eq(isAwaitingChainCatchup(3, 0), true, '3/0 → awaiting');
  eq(isAwaitingChainCatchup(6, 3), true, '6/3 → awaiting');

  // ===========================================================================
  // 3 — ⚡ THE v5.2 BUG: chain ahead of server (Race B) → return CHAIN
  //   This is the inverted Race A from 2026-05-30 live QA. Pre-fix
  //   `min(0, 3) = 0` would hide points the chain already has.
  // ===========================================================================
  console.log('\n[3] ⚡ Race B (v5.2 2026-05-30) — chain ahead of server → return CHAIN');
  eq(
    effectiveUnallocatedPoints(0, 3),
    3,
    'server=0, chain=3 → 3 (post-level-up, server-mirror behind, chain already has points)',
  );
  eq(
    effectiveUnallocatedPoints(2, 3),
    3,
    'server=2, chain=3 → 3 (partial server sync, chain authoritative)',
  );
  // isAwaitingChainCatchup is asymmetric — it only flags Race A (server
  // ahead), not Race B. That's intentional UX: the only case the
  // "catching up" banner needs to warn about is the doomed-tx case, and
  // chain-ahead-of-server never produces a doomed tx now that we trust
  // chain directly.
  eq(isAwaitingChainCatchup(0, 3), false, '0/3 → NOT awaiting (Race B is non-blocking)');

  // ===========================================================================
  // 4 — chain unavailable (RPC down at boot) → fall back to server
  //   The wallet popup gate prevents a doomed tx; we still want the badge
  //   to render something rather than 0.
  // ===========================================================================
  console.log('\n[4] Chain unavailable — fall back to server');
  eq(effectiveUnallocatedPoints(3, null), 3, 'chain=null → server (3)');
  eq(effectiveUnallocatedPoints(3, undefined), 3, 'chain=undefined → server (3)');
  eq(effectiveUnallocatedPoints(0, null), 0, 'both 0/null → 0');
  eq(isAwaitingChainCatchup(3, null), false, 'no chain data → NOT awaiting');
  eq(isAwaitingChainCatchup(3, undefined), false, 'undefined chain → NOT awaiting');

  // ===========================================================================
  // 5 — Defensive: server unavailable but chain present → return chain
  //   (chain is authoritative; if server-side mirror is missing entirely,
  //   chain is still the safe-to-spend value.)
  // ===========================================================================
  console.log('\n[5] Defensive: server unavailable but chain present');
  eq(effectiveUnallocatedPoints(null, 3), 3, 'server=null, chain=3 → 3 (trust chain)');
  eq(effectiveUnallocatedPoints(undefined, 3), 3, 'server=undefined, chain=3 → 3');
  eq(effectiveUnallocatedPoints(null, null), 0, 'both null → 0 (no data anywhere)');

  // ===========================================================================
  // 6 — Defensive: NaN / negative / non-integer noise
  // ===========================================================================
  console.log('\n[6] Sanitization — NaN, negative, fractional');
  // With chain present, server-side NaN doesn't matter — chain wins.
  eq(effectiveUnallocatedPoints(Number.NaN, 3), 3, 'NaN server, chain=3 → 3 (chain wins)');
  eq(effectiveUnallocatedPoints(3, Number.NaN), 0, 'NaN chain → 0 (chain sanitized to 0)');
  eq(effectiveUnallocatedPoints(-1, 3), 3, 'negative server, chain=3 → 3 (chain wins)');
  eq(effectiveUnallocatedPoints(3, -1), 0, 'negative chain → 0 (chain sanitized to 0)');
  eq(effectiveUnallocatedPoints(3.7, null), 3, 'fractional server (no chain) floored to 3');
  eq(effectiveUnallocatedPoints(3, 3.9), 3, 'fractional chain floored to 3');

  // ===========================================================================
  // 7 — ⚡ End-to-end timeline: simulate a fight ending → server bumps →
  //   chain catches up → modal switches from clamp to full value
  // ===========================================================================
  console.log('\n[7] ⚡ Timeline simulation — fight end → chain catchup → full unlock');
  // t=0: pre-fight
  let server = 0;
  let chain: number | null = 0;
  eq(effectiveUnallocatedPoints(server, chain), 0, '[t=0] pre-fight: 0');

  // t=fight_end+δ: server applyXp bumps optimistically; chain unchanged
  server = 3;
  // chain still 0
  eq(effectiveUnallocatedPoints(server, chain), 0, '[t=fight_end] modal CLAMPS to 0 (no doomed tx)');
  eq(isAwaitingChainCatchup(server, chain), true, '[t=fight_end] banner shows "catching up"');

  // t=settle_wager_done: still no character update
  // (no state change)

  // t=update_after_fight_winner_done: chain finally has +3
  chain = 3;
  eq(effectiveUnallocatedPoints(server, chain), 3, '[t=update_done] modal NOW offers all 3');
  eq(isAwaitingChainCatchup(server, chain), false, '[t=update_done] banner hidden');

  // t=user spends all 3
  server = 0;
  chain = 0;
  eq(effectiveUnallocatedPoints(server, chain), 0, '[t=spent] back to 0');

  // ===========================================================================
  // 8 — applyLocalAllocate (BUG B fix, 2026-05-02 retest)
  //
  // After a successful on-chain allocate_points tx, the modal dispatches
  // LOCAL_ALLOCATE to reflect the new stats locally — independent of
  // whether the WS sync succeeded. Pre-fix, a WS auth-pending blip caused
  // the server to reject the sync with "Not authenticated", producing a
  // red toast even though the chain accepted the allocation.
  // ===========================================================================
  console.log('\n[8] applyLocalAllocate — pure local stat update');
  {
    const before = {
      stats: { strength: 5, dexterity: 6, intuition: 4, endurance: 5 },
      unallocatedPoints: 3,
    };
    const after = applyLocalAllocate(before, {
      strength: 1,
      dexterity: 1,
      intuition: 1,
      endurance: 0,
    });
    eq(after !== null, true, 'returns updated state on positive allocation');
    if (after) {
      eq(after.stats.strength, 6, 'strength incremented');
      eq(after.stats.dexterity, 7, 'dexterity incremented');
      eq(after.stats.intuition, 5, 'intuition incremented');
      eq(after.stats.endurance, 5, 'endurance unchanged (alloc was 0)');
      eq(after.unallocatedPoints, 0, '3 spent → 0 remaining');
    }
  }

  console.log('\n[9] applyLocalAllocate — zero-total returns null (no-op)');
  {
    const before = {
      stats: { strength: 5, dexterity: 5, intuition: 5, endurance: 5 },
      unallocatedPoints: 3,
    };
    const after = applyLocalAllocate(before, {
      strength: 0,
      dexterity: 0,
      intuition: 0,
      endurance: 0,
    });
    eq(after, null, 'zero-total → null');
  }

  console.log('\n[10] applyLocalAllocate — clamps unallocated to 0 if drift');
  {
    // Server thinks unallocated = 1, but user is requesting 3 (chain has
    // already granted +3 via update_after_fight that the server didn't
    // mirror). Clamp prevents going negative.
    const before = {
      stats: { strength: 5, dexterity: 5, intuition: 5, endurance: 5 },
      unallocatedPoints: 1,
    };
    const after = applyLocalAllocate(before, {
      strength: 1,
      dexterity: 1,
      intuition: 1,
      endurance: 0,
    });
    eq(after?.unallocatedPoints, 0, 'unallocated clamped to 0 (not -2)');
    eq(after?.stats.strength, 6, 'strength still incremented (chain succeeded)');
  }

  console.log('\n[11] applyLocalAllocate — defensive: NaN / negative inputs');
  {
    const before = {
      stats: { strength: 5, dexterity: 5, intuition: 5, endurance: 5 },
      unallocatedPoints: 5,
    };
    const after = applyLocalAllocate(before, {
      strength: Number.NaN,
      dexterity: -1,
      intuition: 2,
      endurance: 0,
    });
    eq(after?.stats.strength, 5, 'NaN sanitized to 0 (no change)');
    eq(after?.stats.dexterity, 5, 'negative sanitized to 0 (no change)');
    eq(after?.stats.intuition, 7, 'valid input applied');
    eq(after?.unallocatedPoints, 3, '5 - 2 = 3');
  }

  // ===========================================================================
  // 12 — Source-grep — every server-side serializer carries unallocatedPoints
  //   (REST /api/character was the v5.2 live-QA drop point; pin all three.)
  // ===========================================================================
  console.log('\n[12] Source-grep — server serializers include unallocatedPoints');

  const restSrc = readFileSync(join(ROOT, 'server/src/index.ts'), 'utf8');
  const wireSrc = readFileSync(join(ROOT, 'server/src/utils/wire-sanitize.ts'), 'utf8');
  const fightSrc = readFileSync(join(ROOT, 'server/src/ws/fight-room.ts'), 'utf8');

  // /api/character REST serializer.
  const restBlockIdx = restSrc.indexOf("app.get('/api/character/:walletAddress'");
  const restBlock = restBlockIdx >= 0 ? restSrc.slice(restBlockIdx, restBlockIdx + 2000) : '';
  if (restBlock.includes('unallocatedPoints: character.unallocatedPoints')) {
    ok('REST /api/character serializer includes unallocatedPoints (v5.2 drop fix)');
  } else {
    fail(
      'REST /api/character serializer includes unallocatedPoints',
      'the v5.2 2026-05-30 live-QA bug was this field missing from the REST response',
    );
  }

  // wire-sanitize.ts (canonical WS sanitizer).
  if (wireSrc.includes('export function sanitizeCharacter') && wireSrc.includes('unallocatedPoints')) {
    ok('utils/wire-sanitize.ts exports sanitizeCharacter with unallocatedPoints');
  } else {
    fail(
      'utils/wire-sanitize.ts exports sanitizeCharacter with unallocatedPoints',
      "moved out of ws/handler.ts in v5.2 to break the handler→fight-room→handler cycle",
    );
  }

  // fight-room.ts pushes fresh character_data after post-fight chain sync.
  // Two sites — winner branch + loser branch.
  const winnerIdx = fightSrc.indexOf('updateCharacter(winnerCharRef)');
  const loserIdx = fightSrc.indexOf('updateCharacter(loserCharRef)');
  if (winnerIdx >= 0) {
    const winnerBlock = fightSrc.slice(winnerIdx, winnerIdx + 800);
    if (
      winnerBlock.includes("type: 'character_data'") &&
      winnerBlock.includes('sanitizeCharacter(winnerCharRef)')
    ) {
      ok('fight-room.ts winner branch pushes fresh character_data after chain sync');
    } else {
      fail(
        'fight-room.ts winner branch pushes fresh character_data',
        'without this push, frontend state.character.unallocatedPoints stays at 0 post-level-up',
      );
    }
  } else {
    fail('locate winner branch in fight-room.ts', 'updateCharacter(winnerCharRef) not found');
  }
  if (loserIdx >= 0) {
    const loserBlock = fightSrc.slice(loserIdx, loserIdx + 800);
    if (
      loserBlock.includes("type: 'character_data'") &&
      loserBlock.includes('sanitizeCharacter(loserCharRef)')
    ) {
      ok('fight-room.ts loser branch pushes fresh character_data after chain sync');
    } else {
      fail(
        'fight-room.ts loser branch pushes fresh character_data',
        'loser can also level up on a wager loss — same staleness applies',
      );
    }
  } else {
    fail('locate loser branch in fight-room.ts', 'updateCharacter(loserCharRef) not found');
  }

  console.log(`\n${failures === 0 ? '\x1b[32m✔' : '\x1b[31m✘'} ${passes} pass / ${failures} fail\x1b[0m\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
