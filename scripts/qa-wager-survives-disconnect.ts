/**
 * Disconnect-survival gauntlet (2026-05-31, bug-ledger fix-3).
 *
 *   $ NODE_PATH=node_modules:server/node_modules ./server/node_modules/.bin/ts-node \
 *       --transpile-only scripts/qa-wager-survives-disconnect.ts
 *
 * Pins the invariant that a WS disconnect MUST NOT cancel a user's
 * open wager. Pre-fix `handleDisconnect` swept `wagerLobby` for any
 * entry whose `creatorWallet` matched the disconnecting client, then:
 *   - deleted it from the in-memory map
 *   - broadcast `wager_lobby_removed` to all clients
 *   - signed `admin_cancel_wager` from TREASURY to refund + close on chain
 *
 * Combined with the boot-time lobby rehydration shipped earlier the
 * same day, this meant ANY tab reload by the creator destroyed their
 * own wager and yanked the card from every other player's UI. Live
 * incident: Sx's 0x9960629f… wager was rehydrated post-restart, both
 * boards reloaded, the disconnect-cancel fired on the old socket
 * teardown, the wager got admin-cancelled mid-reconnect, and the new
 * `get_wager_lobby` snapshot returned empty.
 *
 * This gauntlet is a SOURCE-GREP test — no runtime, no chain. It
 * locks in three guarantees:
 *
 *   (A) `handleDisconnect` MUST NOT contain a wagerLobby-sweep that
 *       deletes / broadcasts / admin-cancels by `creatorWallet`. A
 *       grep-level check, scoped to the function body so a future
 *       reintroduction is caught at the gauntlet stage.
 *
 *   (B) `handleDisconnect` MUST still call `handlePlayerDisconnect`
 *       (the in-fight forfeit path in fight-room.ts:1037). That handler
 *       is INDEPENDENT — it owns the reconnect-grace window for an
 *       ACTIVE wager fight and must not be collateral-damaged by the
 *       lobby-sweep removal.
 *
 *   (C) The bug-ledger entry exists and explains the rationale (so a
 *       future engineer reading the disconnect handler understands
 *       WHY the sweep was removed instead of guessing it was a
 *       missing feature).
 *
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
function section(name: string): void {
  console.log(`\n\x1b[1m▸ ${name}\x1b[0m`);
}

const handlerSrc = readFileSync(
  join(ROOT, 'server/src/ws/handler.ts'),
  'utf8',
);
const fightRoomSrc = readFileSync(
  join(ROOT, 'server/src/ws/fight-room.ts'),
  'utf8',
);
const ledgerSrc = readFileSync(
  join(ROOT, 'docs/V5.2_BUG_LEDGER.md'),
  'utf8',
);

// ───────────────────────────────────────────────────────────────────
// Extract the body of `handleDisconnect` so the regex checks are
// scoped to ONLY that function — we don't want the audit to trip on
// the legitimate admin-cancel sites elsewhere in handler.ts (10-min
// expiry timer, explicit cancel, post-accept cleanup, etc.).
// ───────────────────────────────────────────────────────────────────

function extractFunctionBody(src: string, signaturePrefix: string): string {
  const startIdx = src.indexOf(signaturePrefix);
  if (startIdx < 0) return '';
  // Find the opening `{` after the signature.
  const openIdx = src.indexOf('{', startIdx);
  if (openIdx < 0) return '';
  // Walk forward matching braces.
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return src.slice(openIdx, i + 1);
    }
  }
  return '';
}

const disconnectBody = extractFunctionBody(handlerSrc, 'function handleDisconnect(');

function testDisconnectBodyExtracted(): void {
  section('handleDisconnect — function body extracted for scoped checks');
  if (disconnectBody.length > 100) {
    ok(`handleDisconnect body extracted (${disconnectBody.length} chars)`);
  } else {
    fail(
      'handleDisconnect body extracted',
      `extractor returned ${disconnectBody.length} chars — function signature may have changed`,
    );
  }
}

// ───────────────────────────────────────────────────────────────────
// (A) No silent disconnect-cancel anywhere in handleDisconnect
// ───────────────────────────────────────────────────────────────────

function testNoAdminCancelInDisconnect(): void {
  section('handleDisconnect — does NOT admin-cancel wagers on disconnect');
  if (disconnectBody.includes('adminCancelWagerOnChain')) {
    fail(
      'no adminCancelWagerOnChain call inside handleDisconnect',
      'a 5-second WiFi blip would refund the user\'s stake — exactly the 2026-05-31 bug',
    );
  } else {
    ok('no adminCancelWagerOnChain call inside handleDisconnect');
  }
}

function testNoWagerLobbyDeleteInDisconnect(): void {
  section('handleDisconnect — does NOT delete wagerLobby entries on disconnect');
  if (disconnectBody.includes('wagerLobby.delete')) {
    fail(
      'no wagerLobby.delete inside handleDisconnect',
      'silently dropping the lobby map entry strands the chain wager and breaks rehydration on reconnect',
    );
  } else {
    ok('no wagerLobby.delete inside handleDisconnect');
  }
}

function testNoLobbyRemovedBroadcastInDisconnect(): void {
  section('handleDisconnect — does NOT broadcast wager_lobby_removed on disconnect');
  // Scope: actual call expressions only — not bare-string mentions
  // (the in-source explainer comment names the literal as part of the
  // "why we removed it" paragraph). The canonical removed-broadcast
  // call is `broadcastAll({ type: 'wager_lobby_removed', ...`.
  const callPattern = /broadcast(All|To\w+)?\s*\(\s*\{\s*type:\s*['"]wager_lobby_removed['"]/;
  if (callPattern.test(disconnectBody)) {
    fail(
      'no wager_lobby_removed broadcast call inside handleDisconnect',
      'a reload by one creator would wipe the card from every other player\'s UI',
    );
  } else {
    ok('no wager_lobby_removed broadcast call inside handleDisconnect');
  }
}

function testNoWagerLobbySweepLoopInDisconnect(): void {
  section('handleDisconnect — does NOT loop over wagerLobby with creatorWallet match');
  // The pre-fix shape was:
  //   for (const [id, entry] of wagerLobby) {
  //     if (entry.creatorWallet === client.walletAddress) {
  //
  // Scope check: a future regression that reintroduces a different
  // shape (e.g. `wagerLobby.forEach`, or matching on `client.id`)
  // would still get caught by the three checks above. This one
  // closes the canonical reintroduction.
  const sweepPattern = /for\s*\([^)]*wagerLobby[\s\S]{0,200}creatorWallet/;
  if (sweepPattern.test(disconnectBody)) {
    fail(
      'no creator-wallet sweep loop inside handleDisconnect',
      'the canonical pre-fix shape (for…of wagerLobby + creatorWallet match) is back',
    );
  } else {
    ok('no creator-wallet sweep loop inside handleDisconnect');
  }
}

// ───────────────────────────────────────────────────────────────────
// (B) In-fight handler still wired + independent
// ───────────────────────────────────────────────────────────────────

function testInFightDisconnectStillCalled(): void {
  section('handleDisconnect — still calls handlePlayerDisconnect (in-fight forfeit path)');
  if (disconnectBody.includes('handlePlayerDisconnect(client.walletAddress)')) {
    ok('handlePlayerDisconnect(client.walletAddress) still invoked');
  } else {
    fail(
      'handlePlayerDisconnect still invoked',
      'removing the lobby-sweep must not strand the in-fight forfeit path',
    );
  }
}

function testInFightHandlerExistsInFightRoom(): void {
  section('handlePlayerDisconnect lives in fight-room.ts (independent of lobby state)');
  // Must be an EXPORTED function in fight-room.ts. Its body should
  // walk active FightState instances — i.e. it owns the
  // grace-window / forfeit path and doesn't touch wagerLobby.
  if (/export\s+function\s+handlePlayerDisconnect\s*\(/.test(fightRoomSrc)) {
    ok('handlePlayerDisconnect is exported from fight-room.ts');
  } else {
    fail(
      'handlePlayerDisconnect exported from fight-room.ts',
      'in-fight forfeit path missing — would mean disconnect-survival broke active fights too',
    );
  }
}

function testInFightHandlerDoesNotTouchWagerLobby(): void {
  section('handlePlayerDisconnect (fight-room.ts) does NOT touch wagerLobby');
  // Belt-and-suspenders — the in-fight path is in a different module
  // and conceptually shouldn't see the lobby map. If it ever grew a
  // wagerLobby.delete call we'd have re-created the bug from the
  // other side.
  const inFightStart = fightRoomSrc.indexOf('export function handlePlayerDisconnect(');
  if (inFightStart < 0) {
    fail('handlePlayerDisconnect body found', 'signature lookup failed');
    return;
  }
  // Crude but adequate — grab the next 4kb after the signature and
  // assert no wagerLobby reference. The function is short.
  const window = fightRoomSrc.slice(inFightStart, inFightStart + 4000);
  if (window.includes('wagerLobby')) {
    fail(
      'no wagerLobby reference in handlePlayerDisconnect',
      'the in-fight path cracked into lobby state — the two should stay independent',
    );
  } else {
    ok('no wagerLobby reference in handlePlayerDisconnect');
  }
}

// ───────────────────────────────────────────────────────────────────
// (C) Bug-ledger entry exists + names the rationale
// ───────────────────────────────────────────────────────────────────

function testLedgerDocumentsRemoval(): void {
  section('docs/V5.2_BUG_LEDGER.md — disconnect-sweep removal is documented');
  if (!ledgerSrc.includes('disconnect-cancel') && !ledgerSrc.includes('disconnect-sweep')) {
    fail(
      'ledger names the disconnect sweep',
      'no entry referencing the disconnect-cancel/disconnect-sweep behaviour',
    );
    return;
  }
  ok('ledger references disconnect-cancel / disconnect-sweep');

  // Must name the THREE root-cause angles: refund-on-blip, racy with
  // rehydration, collateral on other clients.
  const refundCue = /WiFi|reload|disconnect.*refund|refund.*disconnect/i.test(ledgerSrc);
  const racyCue = /racy|rehydration/i.test(ledgerSrc);
  const collateralCue = /broadcast|other player|collateral/i.test(ledgerSrc);
  if (refundCue) ok('ledger explains refund-on-blip rationale');
  else fail('ledger explains refund-on-blip rationale', 'no mention of WiFi/reload/disconnect-refund');
  if (racyCue) ok('ledger explains race with rehydration');
  else fail('ledger explains race with rehydration', 'no mention of racy/rehydration');
  if (collateralCue) ok('ledger explains collateral on other clients');
  else fail('ledger explains collateral on other clients', 'no mention of broadcast/other-player collateral');
}

// ───────────────────────────────────────────────────────────────────
// (D) Sanity — the legitimate admin-cancel sites OUTSIDE handleDisconnect
//     are still there. We want surgery, not a sweep.
// ───────────────────────────────────────────────────────────────────

function testLegitimateAdminCancelSitesStillPresent(): void {
  section('legitimate admin-cancel paths preserved (sanity check)');
  // The 10-min lobby-expiry timer — still must call admin_cancel.
  if (handlerSrc.includes('Periodic cleanup of expired lobby entries')) {
    ok('10-min lobby-expiry sweeper still present (line ~1384)');
  } else {
    fail(
      '10-min lobby-expiry sweeper still present',
      'expiry timer is the intended slow-path cleanup — must not be collateral-removed',
    );
  }
  // Explicit cancel handler.
  if (handlerSrc.includes('handleCancelWagerLobby')) {
    ok('handleCancelWagerLobby (explicit user cancel) still present');
  } else {
    fail(
      'handleCancelWagerLobby still present',
      'explicit user-cancel is the ONLY UX-facing wager-end path — must remain',
    );
  }
}

// ───────────────────────────────────────────────────────────────────
// Runner
// ───────────────────────────────────────────────────────────────────

testDisconnectBodyExtracted();
testNoAdminCancelInDisconnect();
testNoWagerLobbyDeleteInDisconnect();
testNoLobbyRemovedBroadcastInDisconnect();
testNoWagerLobbySweepLoopInDisconnect();
testInFightDisconnectStillCalled();
testInFightHandlerExistsInFightRoom();
testInFightHandlerDoesNotTouchWagerLobby();
testLedgerDocumentsRemoval();
testLegitimateAdminCancelSitesStillPresent();

console.log(`\n${failures === 0 ? '\x1b[32m✔' : '\x1b[31m✘'} ${passes} pass / ${failures} fail\x1b[0m\n`);
process.exit(failures === 0 ? 0 : 1);
