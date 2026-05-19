/**
 * auth_ok server-amnesia self-heal gauntlet — pure reducer tests.
 *
 *   $ NODE_PATH=frontend/node_modules ./server/node_modules/.bin/tsx \
 *       --tsconfig frontend/tsconfig.json scripts/qa-auth-ok-server-amnesia.ts
 *
 * Locks the Bug 6 (2026-05-19) self-heal: when `auth_ok` arrives with
 * `hasCharacter: false` while the frontend reducer holds a cached
 * character, the BEGIN_SERVER_REHYDRATE action drops the cached
 * character + flips authPhase to chain_check_pending so the chain-
 * check effect re-arms.
 *
 * Why this matters: pre-fix the auth_ok handler's null-character
 * branch was silent. State stayed stale, the chain-check effect's
 * `if (state.character) return;` guard fired, restore_character was
 * never sent. Every downstream action (queue_fight, allocate_points,
 * equip_item, …) then hit a missing-character sendError on the server.
 * create_wager went further: SUI was locked on chain (0xd94d…01a2)
 * but the queue_fight follow-up failed silently → orphan toast →
 * manual admin/cancel-wager refund.
 *
 * This gauntlet pins:
 *   - Reducer dispatch of BEGIN_SERVER_REHYDRATE drops character,
 *     equipment (committed + pending), and flips authPhase.
 *   - Other slices (fight, spectatorMode, socket, dmChannels) are
 *     untouched — a server-restart shouldn't blow up an active fight
 *     the user is watching, just the character record.
 *   - Source-grep that game-provider.tsx wires the dispatch
 *     specifically on `msg.hasCharacter === false`.
 *
 * Exits 0 on full pass, 1 on any failure.
 */
import { readFileSync } from "fs";
import { join } from "path";
import {
  gameReducer,
  initialGameState,
  type GameState,
} from "../frontend/src/hooks/useGameStore";

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
  else
    fail(label, `\n          actual=${JSON.stringify(actual)}\n          expected=${JSON.stringify(expected)}`);
}
function contains(hay: string, needle: string, label: string): void {
  if (hay.includes(needle)) ok(label);
  else fail(label, `expected to find ${JSON.stringify(needle)}`);
}
function section(name: string): void {
  console.log(`\n\x1b[1m▸ ${name}\x1b[0m`);
}

// ============================================================================
// Fixture — a fully-populated post-auth state, identical to what the
// reducer holds when the user is mid-session and the server restarts.
// ============================================================================

function postAuthState(): GameState {
  return {
    ...initialGameState,
    socket: null!,
    character: {
      walletAddress: "0xabc",
      name: "MrBoss",
      level: 3,
      xp: 1234,
      stats: { strength: 8, dexterity: 5, intuition: 4, endurance: 4 },
      maxHp: 120,
      currentHp: 120,
      unallocatedPoints: 0,
      wins: 5,
      losses: 2,
      rating: 1050,
      equipment: { weapon: { id: "w1" } } as never,
      onChainObjectId: "0xchar",
    } as never,
    committedEquipment: { weapon: { id: "w1" } } as never,
    pendingEquipment: { weapon: { id: "w1" } } as never,
    authPhase: "no_character", // pretend a stale phase to confirm reset works
    fight: { id: "f1", status: "active" } as never,
    spectatorMode: false,
    dmChannels: [{ channelId: "d1" } as never],
  };
}

// ============================================================================
// BEGIN_SERVER_REHYDRATE
// ============================================================================

function testCharacterDropped(): void {
  section("BEGIN_SERVER_REHYDRATE clears character + equipment");
  const before = postAuthState();
  const after = gameReducer(before, { type: "BEGIN_SERVER_REHYDRATE" });
  eq(after.character, null, "character → null");
  deepEq(after.committedEquipment, initialGameState.committedEquipment, "committedEquipment → EMPTY");
  deepEq(after.pendingEquipment, initialGameState.pendingEquipment, "pendingEquipment → EMPTY");
}

function testAuthPhaseFlips(): void {
  section("BEGIN_SERVER_REHYDRATE arms the chain-check effect");
  const before = postAuthState();
  const after = gameReducer(before, { type: "BEGIN_SERVER_REHYDRATE" });
  eq(
    after.authPhase,
    "chain_check_pending",
    "authPhase → chain_check_pending (chain-check effect re-runs and fires restore_character)",
  );
}

function testUnrelatedSlicesPreserved(): void {
  section("BEGIN_SERVER_REHYDRATE leaves unrelated slices untouched");
  const before = postAuthState();
  const after = gameReducer(before, { type: "BEGIN_SERVER_REHYDRATE" });
  // Fight / spectator / DM state must survive: a server restart while
  // the user is watching a fight shouldn't blow that view away.
  deepEq(after.fight, before.fight, "fight slice preserved");
  eq(after.spectatorMode, before.spectatorMode, "spectatorMode preserved");
  deepEq(after.dmChannels, before.dmChannels, "dmChannels preserved");
  eq(after.socket, before.socket, "socket reference preserved");
}

function testIdempotentWhenAlreadyNull(): void {
  section("BEGIN_SERVER_REHYDRATE is safe to fire when state.character is already null");
  // Brand-new user (never minted) — auth_ok with hasCharacter:false +
  // state.character:null. The dispatch is harmless: character stays
  // null, equipment stays empty, authPhase moves to chain_check_pending
  // which the chain-check effect will resolve to "no_character" once
  // the on-chain probe returns null.
  const before: GameState = {
    ...initialGameState,
    socket: null!,
    authPhase: "auth_pending",
  };
  const after = gameReducer(before, { type: "BEGIN_SERVER_REHYDRATE" });
  eq(after.character, null, "character stays null");
  eq(after.authPhase, "chain_check_pending", "authPhase flips to chain_check_pending");
}

// ============================================================================
// game-provider.tsx — auth_ok handler wiring
// ============================================================================

function testProviderHandlerWiring(): void {
  section("game-provider.tsx auth_ok handler dispatches BEGIN_SERVER_REHYDRATE");
  const src = readFileSync(
    join(__dirname, "..", "frontend", "src", "app", "game-provider.tsx"),
    "utf8",
  );
  // The handler must branch on msg.hasCharacter === false explicitly
  // (not just `!msg.character`) — that wording survives if a future
  // refactor returns `hasCharacter: undefined` for malformed messages.
  contains(
    src,
    "msg.hasCharacter === false",
    "auth_ok handler branches on hasCharacter === false",
  );
  contains(
    src,
    '{ type: "BEGIN_SERVER_REHYDRATE" }',
    "auth_ok handler dispatches BEGIN_SERVER_REHYDRATE on the false branch",
  );
  // Must NOT fire when msg.character is truthy — that's the normal
  // post-auth hydration path.
  contains(
    src,
    "if (msg.character) {",
    "happy path (character present) still calls SET_CHARACTER",
  );
}

// ============================================================================
// Runner
// ============================================================================

function runAll(): void {
  testCharacterDropped();
  testAuthPhaseFlips();
  testUnrelatedSlicesPreserved();
  testIdempotentWhenAlreadyNull();
  testProviderHandlerWiring();

  console.log(
    `\n\x1b[1m▸ auth-ok-server-amnesia gauntlet: ${passes} pass, ${failures} fail\x1b[0m`,
  );
  if (failures > 0) process.exit(1);
}

runAll();
