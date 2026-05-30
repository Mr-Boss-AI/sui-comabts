/**
 * create_wager orphan-guard gauntlet — pure source-grep tests.
 *
 *   $ NODE_PATH=frontend/node_modules ./server/node_modules/.bin/tsx \
 *       --tsconfig frontend/tsconfig.json scripts/qa-create-wager-orphan-guard.ts
 *
 * Locks the Bug 6 (2026-05-19) defence-in-depth: every wager-signing
 * path in matchmaking-queue.tsx (create_wager, accept_wager) calls
 * `verifyServerHasCharacter` BEFORE the wallet popup opens. On
 * failure the click is cancelled (no orphan SUI) and the user is
 * routed through BEGIN_SERVER_REHYDRATE so the chain-check re-arms.
 *
 * Why this exists separately from `qa-auth-ok-server-amnesia.ts`:
 * the auth_ok self-heal covers the COMMON case (server restart → WS
 * reconnect → auth_ok with hasCharacter:false). This guard covers
 * the SECONDARY race — server restart while the wager form is open,
 * before any auth_ok arrives. Both layers are needed; either alone
 * leaves a window.
 *
 * Reverse-pinned: the helper itself must short-circuit when the WS
 * isn't connected/authenticated. The user shouldn't have their click
 * burned with a misleading "server lost your character" toast just
 * because the WS is mid-reconnect; the helper returns ok:false with
 * a "connection still coming up" message instead.
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
const matchmaking = readFileSync(
  join(ROOT, "frontend", "src", "components", "fight", "matchmaking-queue.tsx"),
  "utf8",
);
const presence = readFileSync(
  join(ROOT, "frontend", "src", "lib", "character-presence-check.ts"),
  "utf8",
);

// ============================================================================
// Helper module structure
// ============================================================================

function testHelperStructure(): void {
  section("character-presence-check.ts — module structure");
  contains(
    presence,
    "export async function verifyServerHasCharacter",
    "exports verifyServerHasCharacter",
  );
  contains(
    presence,
    'socket.send({ type: "get_character" }',
    "round-trips via the existing get_character WS message (no new server endpoint required)",
  );
  contains(
    presence,
    'msg.type === "character_data"',
    "treats character_data as success",
  );
  contains(
    presence,
    'msg.type === "error"',
    "treats any error reply as failure",
  );
  contains(
    presence,
    "setTimeout",
    "has a timeout guard so a stuck server doesn't block the wallet popup forever",
  );
  contains(
    presence,
    "!socket.connected || !socket.authenticated",
    "short-circuits when WS isn't ready (returns a 'still coming up' message instead of burning the click)",
  );
}

// ============================================================================
// matchmaking-queue.tsx call sites
// ============================================================================

function testWiringInAcceptWager(): void {
  // v5.2 (2026-05-30) — handleAcceptWager → handleRequestAccept rename.
  section("handleRequestAccept — pre-sign presence check wired");
  const idx = matchmaking.indexOf("const handleRequestAccept = useCallback");
  const block = matchmaking.slice(idx, idx + 7500);
  contains(block, "verifyServerHasCharacter", "handleRequestAccept calls verifyServerHasCharacter");
  // Ordering: presence check must run BEFORE simulateWagerTx (pre-flight
  // dry-run) — if the server lost the character there's no point dry-
  // running, and the popup must not open.
  const pIdx = block.indexOf("verifyServerHasCharacter");
  const sIdx = block.indexOf("simulateWagerTx(");
  if (pIdx > 0 && sIdx > 0 && pIdx < sIdx) {
    ok("presence check runs BEFORE simulateWagerTx");
  } else {
    fail(
      "presence check runs BEFORE simulateWagerTx",
      `pIdx=${pIdx}, sIdx=${sIdx} — ordering wrong`,
    );
  }
  // On failure must dispatch BEGIN_SERVER_REHYDRATE so the user lands
  // in the loader. Surfacing only SET_ERROR would leave them stuck on
  // the stale wager form.
  const failBranch = block.slice(block.indexOf("if (!presence.ok)"));
  contains(
    failBranch.slice(0, 800),
    "BEGIN_SERVER_REHYDRATE",
    "presence-failure dispatches BEGIN_SERVER_REHYDRATE",
  );
  contains(failBranch.slice(0, 800), "SET_ERROR", "presence-failure surfaces SET_ERROR toast");
  contains(failBranch.slice(0, 800), "return;", "presence-failure short-circuits before signing");
}

function testWiringInCreateWager(): void {
  section("handleQueue (create_wager branch) — pre-sign presence check wired");
  const idx = matchmaking.indexOf("const handleQueue = useCallback");
  const block = matchmaking.slice(idx, idx + 7000);
  contains(block, "verifyServerHasCharacter", "create_wager path calls verifyServerHasCharacter");
  const pIdx = block.indexOf("verifyServerHasCharacter");
  const signIdx = block.indexOf("signAndExecuteTransaction({ transaction: tx })");
  if (pIdx > 0 && signIdx > 0 && pIdx < signIdx) {
    ok("presence check runs BEFORE signAndExecuteTransaction (no wallet popup until verified)");
  } else {
    fail(
      "presence check runs BEFORE signAndExecuteTransaction",
      `pIdx=${pIdx}, signIdx=${signIdx} — ordering wrong`,
    );
  }
  // Same dispatch pattern as accept.
  const failBranch = block.slice(block.indexOf("if (!presence.ok)"));
  contains(
    failBranch.slice(0, 800),
    "BEGIN_SERVER_REHYDRATE",
    "create_wager presence-failure dispatches BEGIN_SERVER_REHYDRATE",
  );
}

// ============================================================================
// Audit pin — every wager-signing path is guarded
// ============================================================================

function testAuditCompleteness(): void {
  section("Audit pin — every signAndExecuteTransaction call site routes through the guard");
  // v5.2 (2026-05-30) — expanded to 7 sites for the wager-fairness
  // handshake:
  //   1. create_wager        (handleQueue)              — guarded
  //   2. request_accept_wager (handleRequestAccept)     — guarded
  //   3. approve_challenger  (handleApproveChallenger)  — read-only state mutation (no escrow open)
  //   4. decline_challenger  (handleDeclineChallenger)  — refunds challenger (can't orphan)
  //   5. withdraw_challenge  (handleWithdrawChallenge)  — refunds challenger (can't orphan)
  //   6. cancel_expired_challenge (handleCancelExpiredChallenge) — refunds challenger
  //   7. cancel_wager        (handleCancelWager)        — refunds creator (can't orphan)
  //
  // Only paths 1 + 2 LOCK new SUI on chain — those are the orphan-vulnerable
  // sites and are presence-check guarded (tested in testWiringInAcceptWager +
  // testWiringInCreateWager above). Paths 3-7 only release escrow, never lock
  // it, so a missing-character race can't orphan funds. The audit pin keeps
  // the count honest so a future "lock new SUI" entrypoint forces the test
  // to fail until its guard is wired.
  const matches = matchmaking.match(/signAndExecuteTransaction\(/g) ?? [];
  if (matches.length === 7) {
    ok("exactly 7 signAndExecuteTransaction sites (v5.2 wager-fairness handshake)");
  } else {
    fail(
      "exactly 7 signAndExecuteTransaction sites",
      `found ${matches.length} — a new site needs the presence-check guard too`,
    );
  }
}

// ============================================================================
// Runner
// ============================================================================

function runAll(): void {
  testHelperStructure();
  testWiringInAcceptWager();
  testWiringInCreateWager();
  testAuditCompleteness();

  console.log(
    `\n\x1b[1m▸ create-wager-orphan-guard gauntlet: ${passes} pass, ${failures} fail\x1b[0m`,
  );
  if (failures > 0) process.exit(1);
}

runAll();
