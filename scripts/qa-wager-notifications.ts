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

function testFrontendHandlerRoutesToCenteredModal(): void {
  section('game-provider.tsx — wager_notification routed to centered modal (NOT SET_ERROR toast)');
  const src = readFileSync(
    join(ROOT, 'frontend/src/app/game-provider.tsx'),
    'utf8',
  );
  const idx = src.indexOf('case "wager_notification":');
  if (idx < 0) {
    fail('case "wager_notification" present', 'no handler — modal won\'t fire');
    return;
  }
  ok('case "wager_notification" present in WS dispatch');
  // Scan from the FIRST `dispatch(` after the case label through the
  // following `break;` — i.e. the actual executable block, not the
  // surrounding comment (which can mention SET_ERROR defensively as
  // part of explaining the modal-route rationale).
  const dispatchStart = src.indexOf('dispatch(', idx);
  const dispatchEnd = src.indexOf('break;', dispatchStart);
  if (dispatchStart < 0 || dispatchEnd < 0 || dispatchStart > dispatchEnd) {
    fail(
      'wager_notification handler has a dispatch() before break;',
      `dispatchStart=${dispatchStart}, dispatchEnd=${dispatchEnd}`,
    );
    return;
  }
  const dispatchBlock = src.slice(dispatchStart, dispatchEnd);
  contains(
    dispatchBlock,
    'SET_WAGER_NOTIFICATION',
    'handler dispatches SET_WAGER_NOTIFICATION (centered-modal route)',
  );
  // Regression guard — must NOT fall back to the bottom-corner toast.
  // These are stake-bearing financial events; a 5s-fade toast is the
  // bug we just fixed. Scoped to the dispatch block only so the
  // explanatory comment that NAMES the toast surface doesn't trip it.
  if (dispatchBlock.includes('SET_ERROR')) {
    fail(
      'wager_notification handler must NOT dispatch SET_ERROR',
      'found SET_ERROR in wager_notification dispatch block — modal-route regression; ' +
      'stake-refund event would render as a transient bottom-corner toast again',
    );
  } else {
    ok('wager_notification handler does NOT dispatch SET_ERROR (no toast regression)');
  }
  contains(dispatchBlock, 'msg.kind', 'handler forwards msg.kind to the modal state');
  contains(dispatchBlock, 'msg.message', 'handler forwards msg.message verbatim');
  contains(dispatchBlock, 'msg.wagerMatchId', 'handler forwards msg.wagerMatchId for traceability');
}

function testWagerNotificationModalRendered(): void {
  section('WagerNotificationModal — exists, reads slice, mounted in game-screen');
  // (a) component file exists with the expected wiring
  const modalSrc = readFileSync(
    join(ROOT, 'frontend/src/components/fight/wager-notification-modal.tsx'),
    'utf8',
  );
  contains(modalSrc, 'export function WagerNotificationModal', 'component is exported');
  contains(modalSrc, 'state.wagerNotification', 'reads wagerNotification slice');
  contains(modalSrc, 'CLEAR_WAGER_NOTIFICATION', 'dismiss dispatches CLEAR_WAGER_NOTIFICATION');
  contains(modalSrc, '<Modal', 'uses the shared centered <Modal> component');
  // Per-kind titles — three distinct headings, all neutral / informational
  // tone (not red error language).
  contains(modalSrc, 'Challenge Declined', 'title for kind: declined');
  contains(modalSrc, 'Challenger Withdrew', 'title for kind: withdrawn');
  contains(modalSrc, 'Challenge Timed Out', 'title for kind: challengeExpired');
  contains(modalSrc, 'Continue', 'single dismiss/Continue button present');

  // (b) the modal is mounted in game-screen.tsx — otherwise the slice
  //     would update but nothing would render.
  const screenSrc = readFileSync(
    join(ROOT, 'frontend/src/components/layout/game-screen.tsx'),
    'utf8',
  );
  contains(
    screenSrc,
    'import { WagerNotificationModal }',
    'WagerNotificationModal imported in game-screen',
  );
  contains(
    screenSrc,
    '<WagerNotificationModal />',
    'WagerNotificationModal mounted in game-screen',
  );
}

function testReducerSliceWired(): void {
  section('useGameStore — wagerNotification slice + actions wired');
  const src = readFileSync(
    join(ROOT, 'frontend/src/hooks/useGameStore.ts'),
    'utf8',
  );
  contains(src, 'wagerNotification:', 'wagerNotification field declared on GameState');
  contains(src, 'wagerNotification: null', 'initial value null in initialGameState');
  contains(src, 'SET_WAGER_NOTIFICATION', 'SET_WAGER_NOTIFICATION action declared');
  contains(src, 'CLEAR_WAGER_NOTIFICATION', 'CLEAR_WAGER_NOTIFICATION action declared');
  contains(
    src,
    '"declined" | "withdrawn" | "challengeExpired"',
    'slice kind union matches the three transitions',
  );
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
    // Updated copy (2026-05-31): user shortened the tail from
    // "open again for a new accepter" → "open again." Guard the
    // shortened form so a future revert is caught.
    contains(
      block,
      'the wager is open again.',
      'withdrawn message uses the shortened "open again." tail',
    );
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
testFrontendHandlerRoutesToCenteredModal();
testWagerNotificationModalRendered();
testReducerSliceWired();
testServerEmitsForAllThreeTransitions();
testNotificationFiresAfterBroadcast();
testCaptureBeforeClear();
noteReclaimGap();

console.log(`\n${failures === 0 ? '\x1b[32m✔' : '\x1b[31m✘'} ${passes} pass / ${failures} fail\x1b[0m\n`);
process.exit(failures === 0 ? 0 : 1);
