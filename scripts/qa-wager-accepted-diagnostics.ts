/**
 * handleWagerAccepted silent-gate diagnostics gauntlet — source-grep.
 *
 *   $ NODE_PATH=frontend/node_modules ./server/node_modules/.bin/tsx \
 *       --tsconfig frontend/tsconfig.json scripts/qa-wager-accepted-diagnostics.ts
 *
 * Locks the Bug 7 (2026-05-19) diagnostic patch. The 0xce620b9c…
 * incident — second-round wager in same session — left ShakaLiX's
 * accept_wager on chain (status → ACTIVE, 0.2 SUI escrow) but
 * `handleWagerAccepted` exited via one of six silent `sendError`
 * gates, leaving NO server log to triage from. Refund was manual
 * (admin/cancel-wager tx AZsFE7jx…).
 *
 * The patch:
 *   1. A shared `gateExit(reason, userMessage)` helper that logs every
 *      sendError with structured context (wager id, caller, fight id)
 *      AND fires the toast — both in one place so neither drifts.
 *   2. A console.log on the proceed-path chain probe so we know which
 *      branch the gate runs against on a successful flow too.
 *   3. A try/catch around the whole proceed body that surfaces any
 *      unhandled exception as a sticky-friendly error to the client
 *      AND a `[handleWagerAccepted] UNHANDLED` log on the server.
 *   4. A `.catch()` at the WS router call site so async rejections
 *      that bypass the inner try/catch still log.
 *   5. Process-level `unhandledRejection` + `uncaughtException`
 *      handlers in index.ts so anything that escapes still lands
 *      in the server log.
 *
 * Until we get a fresh repro that pinpoints WHICH gate fired, the
 * diagnostic layer is the actionable fix — it converts a silent
 * SUI-lock into a triageable log line.
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
function contains(hay: string, needle: string, label: string): void {
  if (hay.includes(needle)) ok(label);
  else fail(label, `expected to find ${JSON.stringify(needle)}`);
}
function section(name: string): void {
  console.log(`\n\x1b[1m▸ ${name}\x1b[0m`);
}

const ROOT = join(__dirname, "..");
const handler = readFileSync(
  join(ROOT, "server", "src", "ws", "handler.ts"),
  "utf8",
);
const index = readFileSync(
  join(ROOT, "server", "src", "index.ts"),
  "utf8",
);

// ============================================================================
// gateExit helper present + used everywhere
// ============================================================================

function testGateExitHelper(): void {
  section("gateExit helper present");
  contains(
    handler,
    "const gateExit = (reason: string, userMessage: string)",
    "gateExit lambda declared inside handleWagerAccepted",
  );
  contains(
    handler,
    "[handleWagerAccepted] reject(${reason})",
    "gateExit logs structured breadcrumb with reason",
  );
}

function testEveryGateLogs(): void {
  section("Every silent gate routes through gateExit");
  // Each gate must be addressable by a unique reason string so the
  // log is searchable and triage doesn't need to grep for sendError
  // call sites.
  const reasons = [
    "missing-wagerMatchId",
    "processing-inflight",
    "caller-in-fight",
    "caller-not-authed",
    "chain-status-null",
    "outcome-reject:",
    "character-missing(",
    "caller-no-characterId",
  ];
  for (const r of reasons) {
    contains(handler, r, `gate "${r}" emits its reason`);
  }
}

function testProceedPathLogs(): void {
  section("Proceed path emits a positive breadcrumb on chain probe");
  contains(
    handler,
    "[handleWagerAccepted] chain probe ok",
    "successful chain probe is logged so we can correlate with on-chain tx",
  );
  contains(
    handler,
    "[handleWagerAccepted] proceed-complete",
    "successful proceed-path completion is logged",
  );
}

// ============================================================================
// try/catch wrapper around handler body
// ============================================================================

function testUnhandledTryCatch(): void {
  section("handleWagerAccepted wraps the proceed body in try/catch");
  contains(
    handler,
    "[handleWagerAccepted] UNHANDLED",
    "unhandled-exception catch logs with UNHANDLED tag",
  );
  contains(
    handler,
    "Server hit an unexpected error while finalising your wager",
    "unhandled-exception catch sends a user-facing toast pointing at admin/cancel-wager",
  );
}

// ============================================================================
// WS router .catch()
// ============================================================================

function testRouterCatches(): void {
  section("WS router .catch()'s the async handler");
  contains(
    handler,
    "handleWagerAccepted(client, msg).catch",
    "router .catch()'s the async handler so unhandled rejections don't vanish",
  );
  contains(
    handler,
    "[router:wager_accepted] unhandled async rejection",
    "router .catch() emits a labeled error",
  );
}

// ============================================================================
// Global process-level handlers
// ============================================================================

function testProcessHandlers(): void {
  section("Process-level safety nets installed");
  contains(
    index,
    "process.on('unhandledRejection'",
    "unhandledRejection handler installed",
  );
  contains(
    index,
    "process.on('uncaughtException'",
    "uncaughtException handler installed",
  );
  contains(
    index,
    "[unhandledRejection]",
    "unhandledRejection emits a labeled log",
  );
}

// ============================================================================
// Runner
// ============================================================================

function runAll(): void {
  testGateExitHelper();
  testEveryGateLogs();
  testProceedPathLogs();
  testUnhandledTryCatch();
  testRouterCatches();
  testProcessHandlers();

  console.log(
    `\n\x1b[1m▸ wager-accepted-diagnostics gauntlet: ${passes} pass, ${failures} fail\x1b[0m`,
  );
  if (failures > 0) process.exit(1);
}

runAll();
