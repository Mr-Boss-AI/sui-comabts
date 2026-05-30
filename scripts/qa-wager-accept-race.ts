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

  // v5.2 (2026-05-30) — handleAcceptWager → handleRequestAccept rename
  // as part of the wager-fairness cut-over. The pre-flight pattern is
  // identical; the simulation label is now "request_accept_wager".
  const acceptIdx = matchmakingSrc.indexOf('const handleRequestAccept = useCallback');
  const acceptBlock = matchmakingSrc.slice(acceptIdx, acceptIdx + 7000);
  contains(acceptBlock, 'simulateWagerTx(', 'handleRequestAccept calls simulateWagerTx');
  contains(acceptBlock, '"request_accept_wager"', 'handleRequestAccept labels the simulation "request_accept_wager"');

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
// (B) Pre-flight failure surfaces the error
// ============================================================================

function testPreflightFailureRemovesEntry(): void {
  section("Pre-flight failure path surfaces preflight.message");
  const acceptIdx = matchmakingSrc.indexOf('const handleRequestAccept = useCallback');
  const acceptBlock = matchmakingSrc.slice(acceptIdx, acceptIdx + 7000);
  contains(
    acceptBlock,
    'if (!preflight.ok)',
    'handleRequestAccept branches on preflight.ok',
  );
  const failBranch = acceptBlock.slice(acceptBlock.indexOf('if (!preflight.ok)'));
  // v5.2 — request_accept_wager STILL removes the stale entry locally on
  // pre-flight failure (e.g. someone else already requested → status
  // PENDING_APPROVAL) to keep the lobby view honest while the server
  // broadcast lands.
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
// (C) v5.2 — wager STAYS in lobby after request_accept (transitions to
// PENDING_APPROVAL via server broadcast); no optimistic REMOVE on success.
// Instead we verify the WS notify shape is `wager_request_accepted`.
// ============================================================================

function testOptimisticRemovalOnSuccess(): void {
  section("Post-sign WS notify is wager_request_accepted (v5.2 wire)");
  const acceptIdx = matchmakingSrc.indexOf('const handleRequestAccept = useCallback');
  const acceptBlock = matchmakingSrc.slice(acceptIdx, acceptIdx + 7000);

  const successIdx = acceptBlock.indexOf('assertTxSucceeded(result, "request_accept_wager"');
  const catchIdx = acceptBlock.indexOf('} catch (err:');
  if (successIdx < 0 || catchIdx < 0 || catchIdx < successIdx) {
    fail('locate post-sign success region', 'could not bracket the success branch in handleRequestAccept');
    return;
  }
  const successBlock = acceptBlock.slice(successIdx, catchIdx);
  const sendIdx = successBlock.indexOf('"wager_request_accepted"');
  if (sendIdx < 0) {
    fail(
      'socket.send("wager_request_accepted") present',
      'v5.2 frontend must notify server via wager_request_accepted after request_accept_wager lands',
    );
    return;
  }
  ok('wager_request_accepted WS notification fires after successful request_accept_wager');
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
