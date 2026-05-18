/**
 * Wallet-disconnect reset gauntlet — pure unit tests, no React render.
 *
 *   $ cd server && npx tsx ../scripts/qa-wallet-disconnect-reset.ts
 *
 * Locks the Bug 1 fix (2026-05-18). Before the fix, when dApp Kit's
 * `useCurrentAccount()` flipped from a connected wallet back to null
 * (Disconnect button, account switcher dismissing the session, wallet
 * extension removed mid-session, Enoki sign-out), every slice in the
 * reducer that was tied to the previous wallet's session kept its
 * value — the Navbar still rendered the old character avatar / name /
 * LV badge / ELO over the LandingPage until manual refresh.
 *
 * The fix lives in two pieces:
 *
 *   1. `buildWalletScopedReset` (helper in useGameStore.ts) — the
 *      single source of truth for "what does logged-out state look
 *      like." Reuses `initialGameState`, preserving only the live
 *      socket ref and (optionally) the spectatorMode flag.
 *
 *   2. `RESET_WALLET_SCOPED` reducer action — fired by GameProvider's
 *      wallet-disconnect watcher. Dispatches the helper output.
 *
 * This gauntlet pins:
 *   - Every wallet-scoped slice is wiped (audited 27-field exhaustive list).
 *   - `socket` is preserved (the WS lifecycle has its own teardown
 *     inside useGameSocket; we don't replace the reference on logout).
 *   - `spectatorMode` resets to false by default, but can be preserved
 *     via the `keepSpectatorMode` opt (used by account-swap → spectator
 *     handoff path).
 *   - The reducer dispatch path matches the helper exactly (so the
 *     reducer doesn't drift from the spec).
 *   - SET_SPECTATOR_MODE toggle clears spectatingFight + the
 *     activeSpectateFights picker list on its way out of guest mode
 *     (otherwise a stale fight could render against LandingPage during
 *     the transition).
 *
 * Exits 0 on full pass, 1 on any failure.
 */
import {
  buildWalletScopedReset,
  gameReducer,
  initialGameState,
  type GameState,
} from '../frontend/src/hooks/useGameStore';

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
function deepEq<T>(actual: T, expected: T, label: string): void {
  if (JSON.stringify(actual) === JSON.stringify(expected)) ok(label);
  else fail(label, `\n          actual=${JSON.stringify(actual)}\n          expected=${JSON.stringify(expected)}`);
}
function section(name: string): void {
  console.log(`\n\x1b[1m▸ ${name}\x1b[0m`);
}

// ============================================================================
// Fixtures
// ============================================================================

/**
 * A maximally-populated wallet-scoped state. Every slice that should be
 * cleared on disconnect is set to a non-initial value here. If a future
 * field gets added to GameState and is NOT reset by `buildWalletScopedReset`,
 * one of the assertions below will catch it because the diff will include
 * the leaked field.
 */
function loadedState(): GameState {
  // `socket: null!` matches initialGameState; the reducer never touches it.
  return {
    ...initialGameState,
    socket: null!,
    character: {
      walletAddress: '0xabc',
      name: 'mee',
      level: 1,
      xp: 0,
      stats: { strength: 5, dexterity: 5, intuition: 5, endurance: 5 },
      maxHp: 100,
      currentHp: 100,
      unallocatedPoints: 0,
      wins: 0,
      losses: 0,
      rating: 1000,
      equipment: {} as never,
      onChainObjectId: '0xchar',
    } as never,
    inventory: [{ id: 'i1' } as never],
    onChainItems: [{ id: 'oc1' } as never],
    onChainCharacter: { name: 'mee', level: 1 } as never,
    committedEquipment: { weapon: { id: 'w' } } as never,
    pendingEquipment: { weapon: { id: 'w' } } as never,
    fight: { id: 'f1', status: 'active' } as never,
    fightQueue: 'friendly',
    lootResult: { items: [] } as never,
    chatMessages: [{ id: 'c1' } as never],
    onlinePlayers: [{ walletAddress: '0xother' } as never],
    leaderboard: [{ rank: 1 } as never],
    fightHistory: [{ fightId: 'h1' } as never],
    marketplaceListings: [{ id: 'm1' } as never],
    spectatingFight: { id: 'sf' } as never,
    pendingChallenge: { challengeId: 'pc' } as never,
    wagerLobby: [{ wagerMatchId: 'w1' } as never],
    pendingWagerAccept: { wagerMatchId: 'w1', stakeAmount: 1, opponentName: 'x' },
    currentArea: 'arena',
    authPhase: 'no_character',
    errorMessage: 'leftover',
    errorTimestamp: 12345,
    errorSticky: true,
    onChainRefreshTrigger: 7,
    opponentDisconnect: {
      fightId: 'f1',
      walletAddress: '0xabc',
      expiresAt: 1,
      graceMs: 60_000,
    },
    levelUpEvent: {
      oldLevel: 1,
      newLevel: 2,
      pointsGranted: 4,
      newTotalUnallocated: 4,
    },
    pendingStatAllocate: true,
    incomingFightRequests: [{ id: 'r1' } as never],
    outgoingFightRequests: [{ id: 'r2' } as never],
    dmChannels: [{ channelId: 'd1' } as never],
    dmTotalUnread: 3,
    dmUnreadByChannel: { d1: 3 },
    openProfileWallet: '0xother',
    playerProfile: { walletAddress: '0xother' } as never,
    openDmPeer: '0xother',
    prefilledWagerTarget: { wallet: '0xother', name: 'x' },
    dmIncomingToasts: [{ id: 't1' } as never],
    spectatorMode: false,
    activeSpectateFights: [
      {
        fightId: 'af1',
        type: 'friendly',
        playerA: { name: 'a', level: 1 },
        playerB: { name: 'b', level: 1 },
        turn: 0,
      },
    ],
  };
}

// ============================================================================
// buildWalletScopedReset
// ============================================================================

function testHelperEverySliceResets(): void {
  section('buildWalletScopedReset wipes every wallet-scoped slice');
  const before = loadedState();
  const after = buildWalletScopedReset(before);

  // Compare against initialGameState slice-by-slice. The fields that
  // legitimately survive logout are listed in `SURVIVES` and assertedlast.
  const SURVIVES = new Set<keyof GameState>(['socket']);

  for (const key of Object.keys(initialGameState) as (keyof GameState)[]) {
    if (SURVIVES.has(key)) continue;
    const expected = initialGameState[key];
    const actual = after[key];
    deepEq(actual, expected, `slice "${String(key)}" resets to initial`);
  }
}

function testHelperPreservesSocketRef(): void {
  section('buildWalletScopedReset preserves the live socket reference');
  const socketStub = { connected: true, authenticated: false } as never;
  const before: GameState = { ...loadedState(), socket: socketStub };
  const after = buildWalletScopedReset(before);
  eq(after.socket, socketStub, 'socket reference passes through (same identity)');
}

function testHelperDefaultDropsSpectatorMode(): void {
  section('buildWalletScopedReset defaults to dropping spectator mode');
  const before: GameState = { ...loadedState(), spectatorMode: true };
  const after = buildWalletScopedReset(before);
  eq(after.spectatorMode, false, 'spectatorMode → false by default');
}

function testHelperOptInKeepsSpectatorMode(): void {
  section('buildWalletScopedReset preserves spectator mode when asked');
  const before: GameState = { ...loadedState(), spectatorMode: true };
  const after = buildWalletScopedReset(before, { keepSpectatorMode: true });
  eq(after.spectatorMode, true, 'spectatorMode preserved with opt-in');
}

// ============================================================================
// RESET_WALLET_SCOPED reducer dispatch
// ============================================================================

function testReducerMatchesHelper(): void {
  section('RESET_WALLET_SCOPED reducer mirrors buildWalletScopedReset');
  const before = loadedState();
  const viaReducer = gameReducer(before, { type: 'RESET_WALLET_SCOPED' });
  const viaHelper = buildWalletScopedReset(before);
  deepEq(viaReducer, viaHelper, 'reducer output deep-equals helper output');
}

function testReducerRespectsKeepFlag(): void {
  section('RESET_WALLET_SCOPED respects keepSpectatorMode opt');
  const before: GameState = { ...loadedState(), spectatorMode: true };
  const viaReducer = gameReducer(before, {
    type: 'RESET_WALLET_SCOPED',
    keepSpectatorMode: true,
  });
  eq(viaReducer.spectatorMode, true, 'reducer preserves spectatorMode with opt-in');
}

// ============================================================================
// SET_SPECTATOR_MODE toggle invariants
// ============================================================================

function testSpectatorModeEntry(): void {
  section('SET_SPECTATOR_MODE entry — just flips the flag');
  const before = { ...initialGameState, socket: null! };
  const after = gameReducer(before, { type: 'SET_SPECTATOR_MODE', enabled: true });
  eq(after.spectatorMode, true, 'spectatorMode flips on');
  eq(after.spectatingFight, null, 'no active fight on entry');
  deepEq(after.activeSpectateFights, [], 'picker list still empty on entry');
}

function testSpectatorModeExitWipesLiveSlices(): void {
  section('SET_SPECTATOR_MODE exit — wipes spectatingFight + picker list');
  const before: GameState = {
    ...initialGameState,
    socket: null!,
    spectatorMode: true,
    spectatingFight: { id: 'sf' } as never,
    activeSpectateFights: [
      {
        fightId: 'f1',
        type: 'friendly',
        playerA: { name: 'a', level: 1 },
        playerB: { name: 'b', level: 1 },
        turn: 0,
      },
    ],
  };
  const after = gameReducer(before, { type: 'SET_SPECTATOR_MODE', enabled: false });
  eq(after.spectatorMode, false, 'spectatorMode flips off');
  eq(after.spectatingFight, null, 'spectatingFight wiped on exit');
  deepEq(after.activeSpectateFights, [], 'picker list cleared on exit');
}

function testSpectatorModeIdempotent(): void {
  section('SET_SPECTATOR_MODE idempotent — same value returns same state ref');
  const before: GameState = {
    ...initialGameState,
    socket: null!,
    spectatorMode: true,
  };
  const after = gameReducer(before, { type: 'SET_SPECTATOR_MODE', enabled: true });
  if (after === before) ok('same state reference returned (no spurious re-render)');
  else fail('idempotent identity', 'reducer produced a new state object for a no-op toggle');
}

// ============================================================================
// Runner
// ============================================================================

function runAll(): void {
  testHelperEverySliceResets();
  testHelperPreservesSocketRef();
  testHelperDefaultDropsSpectatorMode();
  testHelperOptInKeepsSpectatorMode();
  testReducerMatchesHelper();
  testReducerRespectsKeepFlag();
  testSpectatorModeEntry();
  testSpectatorModeExitWipesLiveSlices();
  testSpectatorModeIdempotent();

  console.log(
    `\n\x1b[1m▸ wallet-disconnect-reset gauntlet: ${passes} pass, ${failures} fail\x1b[0m`,
  );
  if (failures > 0) process.exit(1);
}

runAll();
