/**
 * Wager-accept double-click race gauntlet — pure source-grep tests.
 *
 *   $ NODE_PATH=frontend/node_modules ./server/node_modules/.bin/tsx \
 *       --tsconfig frontend/tsconfig.json scripts/qa-wager-accept-race.ts
 *
 * Locks the 2026-05-18 EMatchNotWaiting fix at the source level.
 *
 * Root cause (chain-evidenced):
 *   On-chain query showed MrBoss's wager `0xbc34...7056` flipping
 *   WAITING→ACTIVE at 2026-05-18T19:49:04Z under ShakaLiX's accept_wager
 *   tx `8nv6hd1u…`. The user-visible MoveAbort (code 1) was a SECOND
 *   accept click that hit the now-ACTIVE wager. Three conditions
 *   combined to produce it:
 *
 *     1. handleAcceptWager's finally block flipped `signing=false` as
 *        soon as the first sign-and-execute resolved, re-enabling the
 *        Accept button before the server's `wager_lobby_removed`
 *        broadcast arrived.
 *     2. The lobby entry stayed in `state.wagerLobby` during that race
 *        window because removal was server-pushed only.
 *     3. The second click went straight to `signAndExecuteTransaction`
 *        with no dry-run, so the only failure surface was the SDK's
 *        cryptic post-sign `MoveAbort in 2nd command, abort code: 1`
 *        toast — no friendly message, no recovery hint.
 *
 * The fix bundles three pieces:
 *   (A) Pre-flight `simulateWagerTx` before every accept/cancel/create.
 *       Aborts surface as ARENA_ABORT_CODES copy BEFORE the wallet popup.
 *   (B) Optimistic `REMOVE_WAGER_LOBBY_ENTRY` dispatch on accept success
 *       (and on cancel success) so the local lobby reflects truth before
 *       the WS round-trip lands.
 *   (C) Pre-flight failure path ALSO removes the entry locally —
 *       handles the case where the user clicks Accept on a stale entry
 *       that's already been accepted by someone else.
 *
 * This gauntlet pins the source-level wiring for all three. The
 * runtime behaviour is exercised by:
 *   - `qa-arena-aborts.ts` (the humanizer + map completeness)
 *   - `qa-wager-accept-gate.ts` (the existing canAcceptWager predicate)
 *   - Move tests `test_double_accept_aborts` + `test_cancel_after_accept_aborts`
 *     (the on-chain invariant)
 *
 * Exits 0 on full pass, 1 on any failure.
 */
import { readFileSync } from "fs";
import { join } from "path";

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
function contains(haystack: string, needle: string, label: string): void {
  if (haystack.includes(needle)) ok(label);
  else fail(label, `expected to find ${JSON.stringify(needle)}`);
}
function notContains(haystack: string, needle: string, label: string): void {
  if (!haystack.includes(needle)) ok(label);
  else fail(label, `expected NOT to find ${JSON.stringify(needle)}`);
}
function section(name: string): void {
  console.log(`\n\x1b[1m▸ ${name}\x1b[0m`);
}

const ROOT = join(__dirname, "..");
const matchmakingSrc = readFileSync(
  join(ROOT, "frontend", "src", "components", "fight", "matchmaking-queue.tsx"),
  "utf8",
);
const preflightSrc = readFileSync(
  join(ROOT, "frontend", "src", "lib", "wager-preflight.ts"),
  "utf8",
);

// ============================================================================
// (A) Pre-flight is wired into all three wager-signing paths
// ============================================================================

function testPreflightWiredEverywhere(): void {
  section("Pre-flight simulateWagerTx wired into all signing paths");

  // Locate each handler by its `const ... = useCallback(` declaration so we
  // skip any earlier references inside comments / dependency arrays.
  const acceptIdx = matchmakingSrc.indexOf('const handleAcceptWager = useCallback');
  const acceptBlock = matchmakingSrc.slice(acceptIdx, acceptIdx + 7000);
  contains(acceptBlock, 'simulateWagerTx(', 'handleAcceptWager calls simulateWagerTx');
  contains(acceptBlock, '"accept_wager"', 'handleAcceptWager labels the simulation "accept_wager"');

  // cancel_wager pre-flight (same race shape — was equally vulnerable)
  const cancelIdx = matchmakingSrc.indexOf('const handleCancelWager = useCallback');
  const cancelBlock = matchmakingSrc.slice(cancelIdx, cancelIdx + 3500);
  contains(cancelBlock, 'simulateWagerTx(', 'handleCancelWager calls simulateWagerTx');
  contains(cancelBlock, '"cancel_wager"', 'handleCancelWager labels the simulation "cancel_wager"');

  // create_wager pre-flight (catches EInvalidStake before the popup)
  const queueIdx = matchmakingSrc.indexOf('const handleQueue = useCallback');
  const queueBlock = matchmakingSrc.slice(queueIdx, queueIdx + 6000);
  contains(queueBlock, 'simulateWagerTx(', 'handleQueue (create_wager branch) calls simulateWagerTx');
  contains(queueBlock, '"create_wager"', 'handleQueue labels the simulation "create_wager"');
}

// ============================================================================
// (B) Pre-flight failure removes the stale lobby entry locally
// ============================================================================

function testPreflightFailureRemovesEntry(): void {
  section("Pre-flight failure path drops the stale entry from local lobby");
  const acceptIdx = matchmakingSrc.indexOf('const handleAcceptWager = useCallback');
  const acceptBlock = matchmakingSrc.slice(acceptIdx, acceptIdx + 7000);
  // We look for the pattern: when preflight.ok === false, dispatch
  // REMOVE_WAGER_LOBBY_ENTRY AND surface preflight.message.
  contains(
    acceptBlock,
    'if (!preflight.ok)',
    'handleAcceptWager branches on preflight.ok',
  );
  // The dispatch + SET_ERROR pair lives in the same `if` block.
  const failBranch = acceptBlock.slice(acceptBlock.indexOf('if (!preflight.ok)'));
  contains(
    failBranch.slice(0, 600),
    'REMOVE_WAGER_LOBBY_ENTRY',
    'preflight-failure branch dispatches REMOVE_WAGER_LOBBY_ENTRY',
  );
  contains(
    failBranch.slice(0, 600),
    'preflight.message',
    'preflight-failure branch surfaces preflight.message in SET_ERROR',
  );
}

// ============================================================================
// (C) Optimistic local removal on successful accept (closes the double-click race)
// ============================================================================

function testOptimisticRemovalOnSuccess(): void {
  section("Successful accept dispatches REMOVE_WAGER_LOBBY_ENTRY before the WS send");
  const acceptIdx = matchmakingSrc.indexOf('const handleAcceptWager = useCallback');
  const acceptBlock = matchmakingSrc.slice(acceptIdx, acceptIdx + 7000);

  // Find the post-sign success region: starts after assertTxSucceeded,
  // ends at the catch block. The dispatch MUST fire before the
  // socket.send so the lobby UI reflects truth synchronously.
  const successIdx = acceptBlock.indexOf('assertTxSucceeded(result, "accept_wager"');
  const catchIdx = acceptBlock.indexOf('} catch (err:');
  if (successIdx < 0 || catchIdx < 0 || catchIdx < successIdx) {
    fail('locate post-sign success region', 'could not bracket the success branch in handleAcceptWager');
    return;
  }
  const successBlock = acceptBlock.slice(successIdx, catchIdx);
  const removeIdx = successBlock.indexOf('REMOVE_WAGER_LOBBY_ENTRY');
  const sendIdx = successBlock.indexOf('"wager_accepted"');
  if (removeIdx < 0) {
    fail('optimistic REMOVE_WAGER_LOBBY_ENTRY present', 'no dispatch in success branch');
    return;
  }
  if (sendIdx < 0) {
    fail('socket.send("wager_accepted") present', 'unable to verify ordering');
    return;
  }
  if (removeIdx < sendIdx) {
    ok('REMOVE_WAGER_LOBBY_ENTRY fires BEFORE the wager_accepted WS send');
  } else {
    fail(
      'REMOVE_WAGER_LOBBY_ENTRY fires BEFORE the wager_accepted WS send',
      'ordering wrong — race window between local clear and server broadcast reopens',
    );
  }
}

// ============================================================================
// (D) txDigest fix — no more `digest ?? undefined`
// ============================================================================

function testTxDigestTypeFix(): void {
  section("txDigest is conditionally spread (no `digest ?? undefined` cast)");
  notContains(
    matchmakingSrc,
    'txDigest: digest ?? undefined',
    'old `digest ?? undefined` form removed',
  );
  contains(
    matchmakingSrc,
    '...(digest ? { txDigest: digest } : {})',
    'conditional spread used instead — type-clean against optional txDigest',
  );
}

// ============================================================================
// (E) Pre-flight module structure
// ============================================================================

function testPreflightModule(): void {
  section("wager-preflight.ts module structure");
  contains(preflightSrc, 'simulateTransaction', 'uses client.simulateTransaction');
  contains(preflightSrc, 'ARENA_ABORT_CODES', 'threads ARENA_ABORT_CODES through assertTxSucceeded');
  contains(preflightSrc, 'setSenderIfNotSet', 'sets sender on the simulation tx');
  contains(
    preflightSrc,
    "return { ok: true };",
    'gRPC failure returns ok=true (UX-only, server is the safety net)',
  );
}

// ============================================================================
// Runner
// ============================================================================

function runAll(): void {
  testPreflightWiredEverywhere();
  testPreflightFailureRemovesEntry();
  testOptimisticRemovalOnSuccess();
  testTxDigestTypeFix();
  testPreflightModule();

  console.log(
    `\n\x1b[1m▸ wager-accept-race gauntlet: ${passes} pass, ${failures} fail\x1b[0m`,
  );
  if (failures > 0) process.exit(1);
}

runAll();
