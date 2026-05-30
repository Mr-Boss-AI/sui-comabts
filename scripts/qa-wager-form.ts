/**
 * Wager-stake input gauntlet (live test 2026-05-03).
 *
 *   $ cd server && npx tsx ../scripts/qa-wager-form.ts
 *
 * Pre-fix repro: backspace through the stake input snapped right back
 * to "0.1"; typing "0.5" required entering "5" first ("0.15") then
 * deleting the "1". Three keystrokes for a two-character intent. Root
 * cause: the input was bound directly to a `number` state with a
 * `Math.max(0.1, …)` clamp on every keystroke. Empty string parsed
 * as NaN → 0.1; partial like "0." parsed as 0 → clamped to 0.1.
 *
 * Fix: input holds a string, validation runs on submit (and live for
 * UX hints) via `parseWagerInput`. This gauntlet pins every parse
 * branch so a future "small refactor" can't quietly snap the input
 * back to clamp behavior.
 *
 * Pure function, no React, no chain. Exits 0 on full pass, 1 on any
 * failure.
 */
import {
  parseWagerInput,
  MIN_STAKE_SUI,
  MAX_STAKE_DECIMALS,
} from '../frontend/src/lib/wager-input';

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

function expectOk(input: string, expectedAmount: number, label: string): void {
  const r = parseWagerInput(input);
  if (r.ok && r.amount === expectedAmount) {
    ok(`${label} → ok (amount=${r.amount})`);
  } else if (r.ok) {
    fail(label, `parsed ok but amount=${r.amount} expected=${expectedAmount}`);
  } else {
    fail(label, `expected ok, got reason=${r.reason}`);
  }
}

function expectErr(input: string, label: string): void {
  const r = parseWagerInput(input);
  if (!r.ok) ok(`${label} → err (${r.reason})`);
  else fail(label, `expected err, got ok with amount=${r.amount}`);
}

function main(): void {
  // ===========================================================================
  // 1 — happy paths (above the floor)
  // ===========================================================================
  console.log('\n[1] Happy path — valid stakes');
  expectOk('0.1', 0.1, 'exact minimum 0.1');
  expectOk('0.5', 0.5, '0.5');
  expectOk('1', 1, 'integer 1');
  expectOk('1.0', 1, '1.0');
  expectOk('10', 10, 'integer 10');
  expectOk('100.5', 100.5, '100.5');
  expectOk('0.10', 0.1, 'trailing zero 0.10');
  expectOk('0.123456789', 0.123456789, 'max-precision 9 decimals');

  // ===========================================================================
  // 2 — ⚡ THE BUG: empty / partial / clearable inputs are NOT auto-snapped
  // ===========================================================================
  console.log('\n[2] ⚡ Empty / partial inputs return error rather than snap-back');
  expectErr('', 'empty string is invalid (UX hint, NOT a silent 0.1)');
  expectErr(' ', 'whitespace only');
  expectErr('   ', 'multiple whitespace');
  expectErr('.', 'lone dot');

  // ===========================================================================
  // 3 — below the minimum
  // ===========================================================================
  console.log('\n[3] Below-minimum stakes rejected with named floor');
  expectErr('0', 'zero');
  expectErr('0.0', 'zero with decimal');
  expectErr('0.05', 'just under min');
  expectErr('0.099999', 'epsilon below');

  // ===========================================================================
  // 4 — non-numeric / mixed input
  // ===========================================================================
  console.log('\n[4] Non-numeric inputs rejected');
  expectErr('abc', 'letters');
  expectErr('0.1abc', 'mixed (parseFloat would have accepted)');
  expectErr('-1', 'negative sign');
  expectErr('+1', 'positive sign');
  expectErr('1e2', 'scientific notation');
  expectErr('1,000', 'comma separator');
  expectErr('0x1', 'hex literal');
  expectErr('Infinity', 'word infinity');
  expectErr('NaN', 'word NaN');

  // ===========================================================================
  // 5 — too many decimals (SUI is 9-decimal, more loses precision in MIST)
  // ===========================================================================
  console.log('\n[5] Decimal-precision cap');
  expectErr('0.1234567891', '10 decimals (one over cap)');
  expectErr('1.0123456789012', '13 decimals');
  expectOk('0.123456789', 0.123456789, '9 decimals exactly is allowed');

  // ===========================================================================
  // 6 — whitespace tolerance (the user can paste "  0.5 ")
  // ===========================================================================
  console.log('\n[6] Whitespace is trimmed');
  expectOk(' 0.5', 0.5, 'leading whitespace');
  expectOk('0.5 ', 0.5, 'trailing whitespace');
  expectOk('  1.25  ', 1.25, 'both sides');

  // ===========================================================================
  // 7 — the explicit shape of the result (TypeScript discriminated union)
  // ===========================================================================
  console.log('\n[7] Result shape');
  const okResult = parseWagerInput('1.5');
  if (okResult.ok) {
    eq(typeof okResult.amount, 'number', 'ok branch carries number amount');
    eq('reason' in okResult, false, 'ok branch has no reason field');
  } else {
    fail('ok branch shape', `expected ok, got reason=${okResult.reason}`);
  }
  const errResult = parseWagerInput('');
  if (!errResult.ok) {
    eq(typeof errResult.reason, 'string', 'err branch carries string reason');
    eq('amount' in errResult, false, 'err branch has no amount field');
    eq(errResult.reason.length > 0, true, 'reason is non-empty');
  } else {
    fail('err branch shape', `expected err`);
  }

  // ===========================================================================
  // 8 — error reasons are user-readable and specific
  // ===========================================================================
  console.log('\n[8] Error reasons are user-readable');
  const reasons = {
    empty: parseWagerInput(''),
    belowMin: parseWagerInput('0.05'),
    nonNumeric: parseWagerInput('abc'),
    tooDeep: parseWagerInput('0.1234567891'),
  };
  if (!reasons.empty.ok) {
    eq(reasons.empty.reason.toLowerCase().includes('enter'), true,
       'empty reason mentions "enter"');
  }
  if (!reasons.belowMin.ok) {
    eq(reasons.belowMin.reason.includes(String(MIN_STAKE_SUI)), true,
       `below-min reason names the floor (${MIN_STAKE_SUI})`);
  }
  if (!reasons.nonNumeric.ok) {
    eq(reasons.nonNumeric.reason.toLowerCase().includes('numbers'), true,
       'non-numeric reason mentions "numbers"');
  }
  if (!reasons.tooDeep.ok) {
    eq(reasons.tooDeep.reason.toLowerCase().includes('decimal'), true,
       'too-deep reason mentions "decimal"');
    eq(reasons.tooDeep.reason.includes(String(MAX_STAKE_DECIMALS)), true,
       `too-deep reason names the cap (${MAX_STAKE_DECIMALS})`);
  }

  // ===========================================================================
  // 9 — null / undefined defensive (TS forbids but JS could)
  // ===========================================================================
  console.log('\n[9] Defensive null/undefined input');
  expectErr(null as unknown as string, 'null is invalid');
  expectErr(undefined as unknown as string, 'undefined is invalid');

  // ===========================================================================
  // 10 — the user's exact 2026-05-03 repro: clearing field, retyping
  // ===========================================================================
  console.log('\n[10] ⚡ Repro: cleared field reads as a clear error, not 0.1');
  // After clearing: input = "" → not auto-snapped to 0.1.
  expectErr('', 'cleared field is empty (the user can now type freely)');
  // After typing "0": input = "0" → still invalid, but no snap-back.
  expectErr('0', 'partial "0" is invalid but kept as the input');
  // After typing "0.": input = "0." → invalid (lone dot already covered).
  expectErr('0.', 'partial "0." is invalid but kept');
  // After typing "0.5": input = "0.5" → valid.
  expectOk('0.5', 0.5, 'completed "0.5" is valid');

  // ===========================================================================
  // Summary
  // ===========================================================================
  const total = passes + failures;
  console.log('\n' + '='.repeat(60));
  console.log(`wager-form gauntlet: ${passes}/${total} PASS, ${failures} FAIL`);
  console.log('='.repeat(60));
  if (failures > 0) process.exit(1);
}

main();
