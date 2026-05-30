/**
 * Spectator guest-flow gauntlet — pure unit tests, no WS, no React.
 *
 *   $ cd server && npx tsx ../scripts/qa-spectator-guest-flow.ts
 *
 * Locks the Bug 2 fix (2026-05-18). Pre-fix, the red "Watch a Fight"
 * button on the disconnected landing screen was a no-op: it dispatched
 * a `sc:nav` custom event that nothing in the codebase listened for,
 * and even if a router had heard it, the server's pre-auth whitelist
 * would have rejected the guest's `spectate_fight` message because
 * the message router only allows `auth_*` types before
 * `client.authenticated`.
 *
 * The fix lives in two layers:
 *
 *   1. Server (`PRE_AUTH_TYPES` exported from `ws/handler.ts`) — the
 *      whitelist now includes `spectate_fight` + `stop_spectating`.
 *      Spectator key falls back to `guest:<clientId>` when
 *      `client.walletAddress` is unset.
 *
 *   2. Frontend (`spectatorMode` slice + SET_SPECTATOR_MODE action +
 *      LandingPage `onClick`) — clicking "Watch a Fight" flips the
 *      flag, game-screen routes the disconnected user into
 *      <SpectatorLanding />, and the guest-mode useGameSocket effect
 *      opens an unauthenticated WS that can hit the pre-auth
 *      endpoints.
 *
 * This gauntlet pins:
 *   - PRE_AUTH_TYPES membership — both spectator messages are
 *     whitelisted; the legacy auth-handshake set is preserved verbatim.
 *   - SET_SPECTATOR_MODE round-trips cleanly through the reducer.
 *   - The activeSpectateFights slice round-trips through
 *     SET_ACTIVE_SPECTATE_FIGHTS without disturbing other slices.
 *
 * Exits 0 on full pass, 1 on any failure.
 */
import { PRE_AUTH_TYPES } from '../server/src/ws/pre-auth-types';
import {
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
// Server — pre-auth whitelist
// ============================================================================

function testAuthHandshakeStillPreAuth(): void {
  section('PRE_AUTH_TYPES still admits the auth handshake');
  const need = ['auth_request', 'auth_signature', 'auth_token', 'auth'];
  for (const t of need) {
    if (PRE_AUTH_TYPES.has(t)) ok(`"${t}" is pre-auth`);
    else fail(`"${t}" is pre-auth`, `missing from PRE_AUTH_TYPES`);
  }
}

function testSpectatorMessagesPreAuth(): void {
  section('Bug 2 fix — spectator messages admitted pre-auth');
  if (PRE_AUTH_TYPES.has('spectate_fight')) ok('"spectate_fight" is pre-auth');
  else
    fail(
      '"spectate_fight" is pre-auth',
      'guest spectator cannot list or attach without this — Bug 2 regresses',
    );
  if (PRE_AUTH_TYPES.has('stop_spectating')) ok('"stop_spectating" is pre-auth');
  else
    fail(
      '"stop_spectating" is pre-auth',
      'guest spectator cannot cleanly leave a fight without this',
    );
}

function testActionMessagesStayAuthenticated(): void {
  section('Action messages stay behind the auth wall');
  // A sample of write/action types that MUST require auth. If any of
  // these slips into the pre-auth set, the guest spectator surface
  // accidentally became a free credential-less write path.
  const mustBeBlocked = [
    'create_character',
    'restore_character',
    'delete_character',
    'queue_fight',
    'cancel_queue',
    'fight_action',
    'equip_item',
    'unequip_item',
    'allocate_points',
    'wager_accepted',
    'chat_message',
  ];
  for (const t of mustBeBlocked) {
    if (!PRE_AUTH_TYPES.has(t)) ok(`"${t}" requires auth`);
    else
      fail(
        `"${t}" requires auth`,
        `leaked into PRE_AUTH_TYPES — guest spectator surface has grown a hole`,
      );
  }
}

// ============================================================================
// Frontend — guest spectator state transitions
// ============================================================================

function testSpectatorModeFlagDefaultsOff(): void {
  section('Disconnected baseline — spectatorMode defaults off');
  eq(initialGameState.spectatorMode, false, 'initialGameState.spectatorMode is false');
  deepEq(
    initialGameState.activeSpectateFights,
    [],
    'initialGameState.activeSpectateFights is empty',
  );
}

function testActiveFightsRoundTrip(): void {
  section('SET_ACTIVE_SPECTATE_FIGHTS round-trips without side effects');
  const before: GameState = { ...initialGameState, socket: null! };
  const fights = [
    {
      fightId: 'f1',
      type: 'friendly',
      playerA: { name: 'a', level: 1 },
      playerB: { name: 'b', level: 2 },
      turn: 3,
    },
    {
      fightId: 'f2',
      type: 'ranked',
      playerA: { name: 'c', level: 4 },
      playerB: { name: 'd', level: 5 },
      turn: 1,
    },
  ];
  const after = gameReducer(before, {
    type: 'SET_ACTIVE_SPECTATE_FIGHTS',
    fights,
  });
  deepEq(after.activeSpectateFights, fights, 'picker list populated verbatim');
  // No other slice should mutate.
  for (const k of Object.keys(before) as (keyof GameState)[]) {
    if (k === 'activeSpectateFights') continue;
    if (before[k] !== after[k]) {
      fail(
        `slice "${String(k)}" unchanged by SET_ACTIVE_SPECTATE_FIGHTS`,
        'reducer leaked a write outside the picker slice',
      );
      return;
    }
  }
  ok('no other slice mutated');
}

function testGuestEntryExitFlow(): void {
  section('Full guest entry → exit flow drains both slices');
  let s: GameState = { ...initialGameState, socket: null! };

  // 1. User clicks "Watch a Fight" on landing.
  s = gameReducer(s, { type: 'SET_SPECTATOR_MODE', enabled: true });
  eq(s.spectatorMode, true, 'entry — flag on');

  // 2. Server replies to first spectate_fight with the picker list.
  s = gameReducer(s, {
    type: 'SET_ACTIVE_SPECTATE_FIGHTS',
    fights: [
      {
        fightId: 'f1',
        type: 'friendly',
        playerA: { name: 'a', level: 1 },
        playerB: { name: 'b', level: 2 },
        turn: 3,
      },
    ],
  });
  eq(s.activeSpectateFights.length, 1, 'picker list populated');

  // 3. User picks a fight; server pushes spectate_update with `fight`.
  s = gameReducer(s, {
    type: 'SET_SPECTATING',
    fight: { id: 'f1', status: 'active' } as never,
  });
  if (s.spectatingFight) ok('attached — spectatingFight set');
  else fail('attached — spectatingFight set', 'spectatingFight stayed null');

  // 4. User clicks Leave; spectate-view dispatches SET_SPECTATING null.
  s = gameReducer(s, { type: 'SET_SPECTATING', fight: null });
  eq(s.spectatingFight, null, 'detached — spectatingFight null');
  eq(s.spectatorMode, true, 'still in guest mode after Leave (returns to picker)');

  // 5. User clicks Back. Both slices drain.
  s = gameReducer(s, { type: 'SET_SPECTATOR_MODE', enabled: false });
  eq(s.spectatorMode, false, 'exit — flag off');
  eq(s.spectatingFight, null, 'exit — spectatingFight still null');
  deepEq(s.activeSpectateFights, [], 'exit — picker list cleared');
}

// ============================================================================
// Runner
// ============================================================================

function runAll(): void {
  testAuthHandshakeStillPreAuth();
  testSpectatorMessagesPreAuth();
  testActionMessagesStayAuthenticated();
  testSpectatorModeFlagDefaultsOff();
  testActiveFightsRoundTrip();
  testGuestEntryExitFlow();

  console.log(
    `\n\x1b[1m▸ spectator-guest-flow gauntlet: ${passes} pass, ${failures} fail\x1b[0m`,
  );
  if (failures > 0) process.exit(1);
}

runAll();
