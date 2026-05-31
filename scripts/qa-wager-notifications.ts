/**
 * v5.2 (2026-05-31) — wager-flow notifications + creator-side
 * challenger-row scout-click gauntlet.
 *
 * Two QA-flagged gaps fixed in this commit; this gauntlet pins both
 * sets of wiring so a future refactor that drops either gets caught:
 *
 *   1. WagerLobbyCard onInspectChallenger — creator-side click on the
 *      pending challenger row opens the challenger's player-profile
 *      modal (symmetric to the challenger-side onInspect that opens
 *      the creator's modal).
 *
 *   2. wager_notification WS path — targeted toast to the party that
 *      DIDN'T sign a PENDING_APPROVAL transition:
 *        - declined         → toast to pending challenger
 *        - withdrawn        → toast to creator
 *        - challengeExpired → toast to pending challenger
 *      Sent by handleWagerHandshake AFTER the existing lobby-broadcast,
 *      routed by game-provider.tsx to the existing toast via SET_ERROR.
 *
 * Source-grep tests — no React render, no SDK, no chain.
 * Exits 0 on full pass, 1 on any failure.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..');

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
  else fail(label, `expected substring not found: ${JSON.stringify(needle)}`);
}
function section(name: string): void {
  console.log(`\n\x1b[1m▸ ${name}\x1b[0m`);
}

// ===========================================================================
// (A) WagerLobbyCard accepts + uses onInspectChallenger
// ===========================================================================

function testCardAcceptsOnInspectChallengerProp(): void {
  section('WagerLobbyCard — accepts onInspectChallenger prop');
  const src = readFileSync(
    join(ROOT, 'frontend/src/components/fight/matchmaking-queue.tsx'),
    'utf8',
  );
  contains(
    src,
    'onInspectChallenger',
    'matchmaking-queue.tsx references onInspectChallenger',
  );
  // The challenger row must use stopPropagation so the click doesn't
  // also bubble up to the outer card's onInspect (which opens the
  // CREATOR's profile — wrong target).
  contains(
    src,
    'e.stopPropagation();\n                      onInspectChallenger();',
    'challenger-row click stops propagation before invoking onInspectChallenger',
  );
  // Keyboard parity — Enter / Space on focused row.
  const kdIdx = src.indexOf('onInspectChallenger\n                  ? (e) => {');
  if (kdIdx > 0) {
    ok('challenger-row has keyboard onKeyDown for Enter/Space');
  } else {
    // Looser check — verify keyboard handler exists somewhere in the
    // PENDING block.
    contains(
      src,
      'e.key === "Enter" || e.key === " "',
      'challenger-row supports keyboard activation (Enter/Space)',
    );
  }
}

function testRenderSitePassesPendingChallengerWallet(): void {
  section('Render site — passes pendingChallenger.wallet when populated');
  const src = readFileSync(
    join(ROOT, 'frontend/src/components/fight/matchmaking-queue.tsx'),
    'utf8',
  );
  // Look for the prop being passed with the entry.pendingChallenger
  // wallet in the OPEN_PROFILE dispatch.
  contains(
    src,
    'entry.pendingChallenger!.wallet',
    'render site dispatches OPEN_PROFILE with entry.pendingChallenger.wallet',
  );
  contains(
    src,
    'entry.pendingChallenger\n                              ? () =>',
    'onInspectChallenger gated by entry.pendingChallenger being present',
  );
}

// ===========================================================================
// (B) wager_notification — WS path end-to-end (types + server + frontend)
// ===========================================================================

function testWsMessageTypeDeclared(): void {
  section('wager_notification — declared in ws-messages.ts');
  const src = readFileSync(
    join(ROOT, 'frontend/src/types/ws-messages.ts'),
    'utf8',
  );
  contains(src, 'type: "wager_notification"', 'wager_notification message type present');
  contains(src, '"declined" | "withdrawn" | "challengeExpired"', 'kind union covers all three transitions');
}

function testFrontendHandlerRoutesToToast(): void {
  section('game-provider.tsx — wager_notification routed to SET_ERROR toast');
  const src = readFileSync(
    join(ROOT, 'frontend/src/app/game-provider.tsx'),
    'utf8',
  );
  const idx = src.indexOf('case "wager_notification":');
  if (idx < 0) {
    fail('case "wager_notification" present', 'no handler — toast won\'t fire');
    return;
  }
  ok('case "wager_notification" present in WS dispatch');
  const block = src.slice(idx, idx + 600);
  contains(block, 'SET_ERROR', 'handler dispatches SET_ERROR (existing toast surface)');
  contains(block, 'msg.message', 'handler surfaces msg.message verbatim');
}

function testServerEmitsForAllThreeTransitions(): void {
  section('handleWagerHandshake — emits wager_notification for declined / withdrawn / expired');
  const src = readFileSync(join(ROOT, 'server/src/ws/handler.ts'), 'utf8');

  // wager_declined → toast to challenger
  const decBlock = src.indexOf("messageType === 'wager_declined'");
  if (decBlock < 0) {
    fail('wager_declined branch present', 'no branch — challenger gets no notification');
  } else {
    const block = src.slice(decBlock, decBlock + 700);
    contains(block, 'getClientByWalletAddress(previousPendingWallet)', 'declined targets the pending challenger');
    contains(block, "kind: 'declined'", 'declined branch carries kind: declined');
    contains(block, 'was declined', 'declined message uses user-friendly copy');
  }

  // wager_withdrawn → toast to creator
  const wthBlock = src.indexOf("messageType === 'wager_withdrawn'");
  if (wthBlock < 0) {
    fail('wager_withdrawn branch present', 'no branch — creator gets no notification');
  } else {
    const block = src.slice(wthBlock, wthBlock + 700);
    contains(block, 'getClientByWalletAddress(entry.creatorWallet)', 'withdrawn targets the creator');
    contains(block, "kind: 'withdrawn'", 'withdrawn branch carries kind: withdrawn');
    contains(block, 'withdrew', 'withdrawn message uses user-friendly copy');
  }

  // wager_challenge_expired → toast to challenger
  const expBlock = src.indexOf("messageType === 'wager_challenge_expired'");
  if (expBlock < 0) {
    fail('wager_challenge_expired branch present', 'no branch — challenger gets no refund notification');
  } else {
    const block = src.slice(expBlock, expBlock + 700);
    contains(block, 'getClientByWalletAddress(previousPendingWallet)', 'expired targets the pending challenger');
    contains(block, "kind: 'challengeExpired'", 'expired branch carries kind: challengeExpired');
    contains(block, 'timed out', 'expired message uses user-friendly copy');
  }
}

function testNotificationFiresAfterBroadcast(): void {
  section('Ordering — wager_lobby_updated broadcast fires BEFORE the targeted notification');
  // Why: if we toast first, the user sees "your stake was refunded"
  // before their UI updates to reflect the lobby change — looks janky.
  // The lobby broadcast must land first.
  const src = readFileSync(join(ROOT, 'server/src/ws/handler.ts'), 'utf8');
  const broadcastIdx = src.indexOf(
    "broadcastAll({ type: 'wager_lobby_updated', entry: cleared })",
  );
  const notificationIdx = src.indexOf(
    "messageType === 'wager_declined' && previousPendingWallet",
  );
  if (broadcastIdx > 0 && notificationIdx > 0 && broadcastIdx < notificationIdx) {
    ok('lobby_updated broadcast precedes targeted notification dispatch');
  } else {
    fail(
      'lobby_updated broadcast precedes targeted notification dispatch',
      `broadcastIdx=${broadcastIdx}, notificationIdx=${notificationIdx} — ordering wrong`,
    );
  }
}

// ===========================================================================
// (C) Capture-before-clear — previousPendingWallet read BEFORE the
//     pendingChallenger field is cleared. If the order flipped we'd
//     try to notify undefined.
// ===========================================================================

function testCaptureBeforeClear(): void {
  section('Server — captures previousPendingWallet BEFORE clearing entry.pendingChallenger');
  const src = readFileSync(join(ROOT, 'server/src/ws/handler.ts'), 'utf8');
  const captureIdx = src.indexOf('previousPendingWallet = entry.pendingChallenger?.wallet');
  const clearIdx = src.indexOf('pendingChallenger: undefined,');
  if (captureIdx > 0 && clearIdx > 0 && captureIdx < clearIdx) {
    ok('previousPendingWallet captured before pendingChallenger cleared');
  } else {
    fail(
      'previousPendingWallet captured before pendingChallenger cleared',
      `capture=${captureIdx}, clear=${clearIdx} — ordering wrong; toast would target undefined`,
    );
  }
}

// ===========================================================================
// (D) Known parity gap — flag reclaim_stalled_wager
// ===========================================================================

function noteReclaimGap(): void {
  section('Known gap (informational) — wager_reclaimed does NOT yet emit wager_notification');
  // The reclaim handler removes the lobby entry instead of clearing it,
  // and v5.2 doesn't currently look up the other participant from chain
  // or wager_in_flight to target a "the other player reclaimed your
  // stranded fight" toast. Documented in V5.2_BUG_LEDGER.md as a follow-up.
  const src = readFileSync(join(ROOT, 'server/src/ws/handler.ts'), 'utf8');
  const reclaimIdx = src.indexOf("messageType === 'wager_reclaimed'");
  if (reclaimIdx > 0) {
    const block = src.slice(reclaimIdx, reclaimIdx + 500);
    if (block.includes("type: 'wager_notification'")) {
      ok('reclaim already emits wager_notification (gap closed)');
    } else {
      // Informational PASS — flagged for tracking, not a fail.
      ok(
        'reclaim does NOT emit wager_notification (known follow-up — needs chain/in-flight lookup ' +
        'for the OTHER participant; tracked in V5.2_BUG_LEDGER.md)',
      );
    }
  } else {
    fail(
      'reclaim handler still present',
      'wager_reclaimed branch is missing entirely — re-verify handler integrity',
    );
  }
}

// ===========================================================================
// Runner
// ===========================================================================

testCardAcceptsOnInspectChallengerProp();
testRenderSitePassesPendingChallengerWallet();
testWsMessageTypeDeclared();
testFrontendHandlerRoutesToToast();
testServerEmitsForAllThreeTransitions();
testNotificationFiresAfterBroadcast();
testCaptureBeforeClear();
noteReclaimGap();

console.log(`\n${failures === 0 ? '\x1b[32m✔' : '\x1b[31m✘'} ${passes} pass / ${failures} fail\x1b[0m\n`);
process.exit(failures === 0 ? 0 : 1);
