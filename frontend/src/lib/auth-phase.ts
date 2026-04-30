/**
 * Pre-game gating phase.
 *
 * The frontend's auth flow has a window where the wallet is connected but the
 * server hasn't yet returned `character_data` and the on-chain
 * `CharacterCreated` event scan is still in flight. The pre-fix UI
 * rendered `<CharacterCreation />` as a fallback during that window — a user
 * who clicked Create could mint a SECOND Character NFT on a wallet that
 * already had one (reproduced live 2026-04-30: mr_boss minted "mee" on top
 * of Mr_Boss_v5.1).
 *
 * This module formalises the state machine that closes layer 1 of the bug:
 * `<CharacterCreation />` is reachable only when the chain scan has
 * DEFINITIVELY returned no character. RPC failures land in
 * "chain_check_failed" and surface a retry button instead of falling
 * through to the create form. See STATUS_v5.md.
 *
 * The predicates here are pure — `qa-character-mint.ts` exercises them
 * against the same call sites used in `game-provider.tsx` and
 * `game-screen.tsx`, so a regression in either place fails the gauntlet.
 */

export type AuthPhase =
  | "auth_pending"
  | "chain_check_pending"
  | "chain_check_failed"
  | "no_character";

/** Outcome of `fetchCharacterNFT()`. */
export type ChainCheckResult = "found" | "empty" | "error";

/**
 * Decide the next phase when `socket.authenticated` flips. The state machine
 * is intentionally loose: any transition kicks back to "auth_pending" on
 * disconnect, and forward to "chain_check_pending" on connect (only when no
 * character has been hydrated yet). If a character is already present we
 * leave the phase alone — the gate is bypassed regardless.
 */
export function nextAuthPhaseOnAuthChange(
  authenticated: boolean,
  hasCharacter: boolean,
  currentPhase: AuthPhase,
): AuthPhase {
  if (!authenticated) return "auth_pending";
  if (hasCharacter) return currentPhase;
  return currentPhase === "auth_pending" ? "chain_check_pending" : currentPhase;
}

/**
 * Decide the next phase from a chain-check outcome. `"found"` keeps the
 * phase as "chain_check_pending" — the caller will dispatch
 * `restore_character` and the gate will fall away on `SET_CHARACTER`.
 */
export function nextAuthPhaseOnChainCheckResult(
  result: ChainCheckResult,
): AuthPhase {
  switch (result) {
    case "found":
      // Stay in chain_check_pending until SET_CHARACTER lands. The
      // LoadingScreen continues showing; we never fall through to the
      // create form here.
      return "chain_check_pending";
    case "empty":
      return "no_character";
    case "error":
      return "chain_check_failed";
  }
}

/**
 * Render predicates the gate UI uses. These are mutually exclusive when
 * `hasCharacter` is false; when `hasCharacter` is true the gate is bypassed
 * and none of the three apply (the game renders).
 */
export function shouldRenderLoadingScreen(
  phase: AuthPhase,
  hasCharacter: boolean,
): boolean {
  if (hasCharacter) return false;
  return phase === "auth_pending" || phase === "chain_check_pending";
}

export function shouldRenderRetryScreen(
  phase: AuthPhase,
  hasCharacter: boolean,
): boolean {
  if (hasCharacter) return false;
  return phase === "chain_check_failed";
}

export function shouldRenderCreateForm(
  phase: AuthPhase,
  hasCharacter: boolean,
): boolean {
  if (hasCharacter) return false;
  return phase === "no_character";
}
