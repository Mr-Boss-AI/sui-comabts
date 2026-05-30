/**
 * Wager-stake input parsing.
 *
 * Why this exists: the wager-create form's stake input used to be
 * bound directly to a `number` state with a `Math.max(0.1, …)` clamp
 * fired on every keystroke. Side effects (live test 2026-05-03):
 *   - Backspace through "0.1" snapped right back to "0.1" — the
 *     field could not be cleared.
 *   - Typing "0.5" required entering "5" first ("0.15") then deleting
 *     the "1" — three keystrokes for a two-character intent.
 *   - Empty input was reinterpreted as 0.1 silently, so users who
 *     wanted a higher stake had to wage war against autocomplete.
 *
 * Fix: the input is bound to a *string* (the raw user text) and this
 * module parses it on demand. Validation runs on submit, not on
 * every keystroke. Empty → "Enter a stake amount" rather than a
 * silent snap-back. Below-min → an inline message naming the
 * minimum, but the user can keep typing.
 *
 * Pure function so the qa gauntlet can pin every edge case
 * (empty, whitespace-only, leading dot, scientific notation, NaN,
 * negative, exponent, far-too-many decimals, excessive precision).
 */

/** Minimum on-chain wager stake. 0.1 SUI matches the contract floor
 *  in `arena::create_wager` and the historical "smallest meaningful
 *  bet" — 0.01 SUI was deemed too small for the friction. */
export const MIN_STAKE_SUI = 0.1;

/** SUI is a 9-decimal asset. Inputs deeper than this lose precision
 *  when converted to MIST (`amount * 1e9`), so we reject them at
 *  parse time rather than silently rounding away the user's intent. */
export const MAX_STAKE_DECIMALS = 9;

export type WagerParseResult =
  | { ok: true; amount: number }
  | { ok: false; reason: string };

export function parseWagerInput(raw: string): WagerParseResult {
  const trimmed = (raw ?? "").trim();
  if (trimmed === "") {
    return { ok: false, reason: "Enter a stake amount" };
  }

  // Allow only digits + a single decimal point. This excludes
  // scientific notation (`1e2`), signs (`+`, `-`), commas, hex, and
  // any other surprise. We do this with an explicit regex rather than
  // relying on `parseFloat`, which silently accepts trailing junk
  // ("0.1abc" → 0.1) and would let users submit a stake whose digits
  // they couldn't see in the field.
  if (!/^\d*\.?\d*$/.test(trimmed)) {
    return { ok: false, reason: "Numbers only — e.g. 0.5 or 1.25" };
  }
  if (trimmed === "." || trimmed === "") {
    return { ok: false, reason: "Enter a stake amount" };
  }

  const decimalIdx = trimmed.indexOf(".");
  if (decimalIdx >= 0) {
    const decimals = trimmed.length - decimalIdx - 1;
    if (decimals > MAX_STAKE_DECIMALS) {
      return {
        ok: false,
        reason: `Too many decimals — SUI supports up to ${MAX_STAKE_DECIMALS}`,
      };
    }
  }

  const amount = Number(trimmed);
  if (!Number.isFinite(amount)) {
    // The regex above should have caught this; defensive belt.
    return { ok: false, reason: "Enter a valid number" };
  }
  if (amount < MIN_STAKE_SUI) {
    return {
      ok: false,
      reason: `Minimum stake is ${MIN_STAKE_SUI} SUI`,
    };
  }
  return { ok: true, amount };
}
