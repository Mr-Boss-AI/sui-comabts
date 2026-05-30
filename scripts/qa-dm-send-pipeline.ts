/**
 * DM send-pipeline integration gauntlet (Bucket 3 hotfix #5,
 * 2026-05-06 — late retest).
 *
 *   $ cd server && npx tsx ../scripts/qa-dm-send-pipeline.ts
 *
 * The user-visible bug we couldn't reproduce in the wrapper-only
 * gauntlet: Mr_Boss approved the Slush popup, the create_channel tx
 * landed on chain (3 created objects, gas debited), and yet the DM
 * panel sat in "Signing…" indefinitely. The wrapper-only test
 * (qa-messaging-client §11) only verified that `withTimeout` rejects
 * a hanging promise — it never exercised the full handleSend
 * sequence that integrates the SDK + WS sends + member-cap retry.
 *
 * This gauntlet pins the pipeline contract end to end with a stub
 * SDK so we can simulate every realistic failure mode AND prove the
 * happy path emits both `register_dm_channel` and `notify_dm_sent`
 * to the WS in the right order. If the live retest hangs again
 * after this gauntlet passes, it means the bug is at a layer the
 * pipeline doesn't touch (browser HMR cache, dapp-kit, etc.) and
 * the diagnostic console breadcrumbs in the panel will localize it.
 *
 * Coverage:
 *   1. Happy path — every step fires in order, WS messages emitted,
 *      result carries channelId + memberCap + digest.
 *   2. Existing-channel path — ensureChannel skipped, no register_dm_channel.
 *   3. ensureChannel hangs → master timeout fires within budget.
 *   4. resolveMemberCap returns null twice → throws actionable error.
 *   5. sendMessage hangs → master timeout fires; notify_dm_sent NOT
 *      emitted (pipeline aborted before the WS send).
 *   6. sendMessage rejects → original error preserved (not replaced
 *      by timeout error).
 *   7. onStep fires for every named step in order — drives the
 *      browser-console diagnostics the panel surfaces.
 *
 * Pure JS, no DB, no WS, no wallet.
 */

import {
  runDmSend,
  type DmSendDeps,
  type DmSendStep,
} from '../frontend/src/lib/dm-send-pipeline';

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
function truthy(v: unknown, label: string): void {
  if (v) ok(label);
  else fail(label, `expected truthy, got ${JSON.stringify(v)}`);
}

interface StubBundle {
  __stub: true;
}
const STUB_BUNDLE: StubBundle = { __stub: true };

interface StubSdk {
  ensureChannel: DmSendDeps['ensureChannel'];
  resolveMemberCap: DmSendDeps['resolveMemberCap'];
  sendMessage: DmSendDeps['sendMessage'];
}

interface StubRecorder {
  wsSends: Array<Record<string, unknown>>;
  steps: DmSendStep[];
}

function makeRecorder(): StubRecorder {
  return { wsSends: [], steps: [] };
}

function makeDeps(sdk: StubSdk, rec: StubRecorder): DmSendDeps {
  return {
    bundle: STUB_BUNDLE,
    ensureChannel: sdk.ensureChannel,
    resolveMemberCap: sdk.resolveMemberCap,
    sendMessage: sdk.sendMessage,
    wsSend: (msg) => {
      rec.wsSends.push(msg);
    },
    onStep: (s) => {
      rec.steps.push(s);
    },
  };
}

const PEER = '0x' + 'b'.repeat(64);
const ME = '0x' + 'a'.repeat(64);
const CHAN = '0x' + 'c'.repeat(64);
const CAP = '0x' + 'd'.repeat(40);

async function main(): Promise<void> {
  // ===========================================================================
  // 1 — happy path: fresh channel, every stage fires, WS sends emitted
  // ===========================================================================
  console.log('\n[1] happy path — fresh channel, every stage fires');
  {
    const rec = makeRecorder();
    const sdk: StubSdk = {
      ensureChannel: async (_b, peer) => ({
        channelId: CHAN,
        callerMemberCapId: CAP,
        encryptedKeyB64: 'ZW5j',
        fresh: true,
      }),
      resolveMemberCap: async () => CAP,
      sendMessage: async (_b, p) => ({
        digest: '0xdeadbeef',
        messageId: '42',
      }),
    };
    const result = await runDmSend(makeDeps(sdk, rec), {
      peer: PEER,
      myAddress: ME,
      text: 'hi',
      existingChannelId: null,
      existingMemberCapId: null,
      masterTimeoutMs: 1_000,
    });
    eq(result.channelId, CHAN, 'returns channelId from ensureChannel');
    eq(result.memberCapId, CAP, 'returns memberCapId');
    eq(result.digest, '0xdeadbeef', 'returns digest');
    eq(result.messageId, '42', 'returns messageId');
    eq(result.freshChannel, true, 'freshChannel=true on first send');
    // WS sends — order is critical: register_dm_channel BEFORE
    // notify_dm_sent. Recipient's frontend depends on the channel
    // existing in state.dmChannels by the time the unread bump
    // (driven by notify_dm_sent → server → dm_unread_changed) lands.
    eq(rec.wsSends.length, 2, 'two WS sends fired');
    eq(rec.wsSends[0].type, 'register_dm_channel', 'first WS = register_dm_channel');
    eq(rec.wsSends[0].channelId, CHAN, 'register carries channelId');
    eq(rec.wsSends[0].walletA, ME, 'register carries my wallet as A');
    eq(rec.wsSends[0].walletB, PEER, 'register carries peer wallet as B');
    eq(rec.wsSends[0].memberCapA, CAP, 'register carries my memberCap');
    eq(rec.wsSends[0].encryptedKeyB64, 'ZW5j', 'register carries encryptedKey');
    eq(rec.wsSends[1].type, 'notify_dm_sent', 'second WS = notify_dm_sent');
    eq(rec.wsSends[1].channelId, CHAN, 'notify carries channelId');
    eq(rec.wsSends[1].recipient, PEER, 'notify carries peer as recipient');
    // Step ordering — drives the browser-console diagnostics.
    eq(rec.steps[0], 'createChannel:start', 'first step is createChannel:start');
    eq(rec.steps[1], 'createChannel:done', 'next is createChannel:done');
    eq(rec.steps[2], 'registerWs:start', 'register WS pair fires after channel');
    eq(rec.steps[3], 'registerWs:done', 'register WS done');
    eq(rec.steps[rec.steps.length - 1], 'pipeline:done', 'pipeline:done is the last step');
  }

  // ===========================================================================
  // 2 — existing channel: ensureChannel skipped, no register_dm_channel
  // ===========================================================================
  console.log('\n[2] existing channel — second send skips ensureChannel');
  {
    const rec = makeRecorder();
    let ensureCalled = 0;
    const sdk: StubSdk = {
      ensureChannel: async () => {
        ensureCalled++;
        return { channelId: CHAN, callerMemberCapId: CAP, fresh: true };
      },
      resolveMemberCap: async () => CAP,
      sendMessage: async () => ({ digest: '0x42', messageId: '7' }),
    };
    const result = await runDmSend(makeDeps(sdk, rec), {
      peer: PEER,
      myAddress: ME,
      text: 'hi again',
      existingChannelId: CHAN,
      existingMemberCapId: CAP,
      masterTimeoutMs: 1_000,
    });
    eq(ensureCalled, 0, 'ensureChannel NOT called when channel pre-known');
    eq(result.freshChannel, false, 'freshChannel=false on subsequent send');
    eq(rec.wsSends.length, 1, 'only ONE WS send (the notify)');
    eq(rec.wsSends[0].type, 'notify_dm_sent', 'WS send is notify (no register)');
    truthy(
      !rec.steps.includes('createChannel:start'),
      'createChannel step NOT in trace',
    );
    truthy(
      !rec.steps.includes('registerWs:start'),
      'registerWs step NOT in trace',
    );
    truthy(
      rec.steps.includes('sendMessage:start'),
      'sendMessage step IS in trace',
    );
  }

  // ===========================================================================
  // 3 — ensureChannel hangs forever → master timeout fires
  //
  // This is the EXACT bug shape from the live retest. The user
  // approved the Slush popup, but the SDK's promise never resolved.
  // We simulate it with a never-resolving Promise. The pipeline must
  // reject within `masterTimeoutMs + a little slack` so the panel
  // can surface an error toast.
  // ===========================================================================
  console.log('\n[3] ensureChannel hangs forever → master timeout fires');
  {
    const rec = makeRecorder();
    const sdk: StubSdk = {
      ensureChannel: () => new Promise(() => {}),
      resolveMemberCap: async () => null,
      sendMessage: async () => ({ digest: '', messageId: '' }),
    };
    const start = Date.now();
    let err: Error | null = null;
    try {
      await runDmSend(makeDeps(sdk, rec), {
        peer: PEER,
        myAddress: ME,
        text: 'hi',
        existingChannelId: null,
        existingMemberCapId: null,
        masterTimeoutMs: 200,
      });
      fail('hanging ensureChannel', 'expected rejection but resolved');
    } catch (e: any) {
      err = e;
    }
    const elapsed = Date.now() - start;
    truthy(err instanceof Error, 'pipeline rejected with an Error');
    truthy(
      err && /timed out/.test(err.message),
      'rejection message includes "timed out"',
    );
    truthy(
      err && /runDmSend/.test(err.message),
      'rejection labelled with "runDmSend" (the master timeout)',
    );
    truthy(
      elapsed >= 200 && elapsed < 1_500,
      `rejection fires near master budget (got ${elapsed}ms, budget 200ms)`,
    );
    // The createChannel step started but never completed.
    eq(rec.steps[0], 'createChannel:start', 'createChannel:start was reached');
    truthy(
      !rec.steps.includes('createChannel:done'),
      'createChannel:done NOT reached (the hang)',
    );
    // Crucial: NO WS sends fired — the pipeline aborted before
    // either register_dm_channel or notify_dm_sent could go out.
    // This means the recipient's UI is correctly NOT showing a
    // bogus toast for a message that didn't actually send.
    eq(rec.wsSends.length, 0, 'no WS sends fired during hung pipeline');
  }

  // ===========================================================================
  // 4 — member cap unresolvable → actionable error message
  // ===========================================================================
  console.log('\n[4] member cap unresolvable → actionable error');
  {
    const rec = makeRecorder();
    const sdk: StubSdk = {
      // ensureChannel returns WITHOUT a callerMemberCapId — the chain
      // indexer hadn't caught up yet. The pipeline will fall through
      // to `resolveMemberCap`.
      ensureChannel: async () => ({
        channelId: CHAN,
        callerMemberCapId: undefined,
        fresh: true,
      }),
      // ...and resolveMemberCap also can't find it (cap not visible).
      resolveMemberCap: async () => null,
      sendMessage: async () => ({ digest: '', messageId: '' }),
    };
    let err: Error | null = null;
    try {
      await runDmSend(makeDeps(sdk, rec), {
        peer: PEER,
        myAddress: ME,
        text: 'hi',
        existingChannelId: null,
        existingMemberCapId: null,
        masterTimeoutMs: 1_000,
      });
      fail('unresolvable cap', 'expected rejection but resolved');
    } catch (e: any) {
      err = e;
    }
    truthy(err instanceof Error, 'pipeline rejected with an Error');
    truthy(
      err && /Member cap not yet visible/.test(err.message),
      'rejection message names "Member cap not yet visible"',
    );
    // register_dm_channel DID fire (we got a channel id); the abort
    // is downstream, after register and before sendMessage.
    eq(rec.wsSends.length, 1, 'only register_dm_channel fired');
    eq(rec.wsSends[0].type, 'register_dm_channel', 'WS send is register');
    truthy(
      rec.steps.includes('resolveMemberCap:done'),
      'resolveMemberCap completed (returned null)',
    );
    truthy(
      !rec.steps.includes('sendMessage:start'),
      'sendMessage NOT reached (cap missing)',
    );
  }

  // ===========================================================================
  // 5 — sendMessage hangs → master timeout fires; notify NOT emitted
  // ===========================================================================
  console.log('\n[5] sendMessage hangs → master timeout fires before notify');
  {
    const rec = makeRecorder();
    const sdk: StubSdk = {
      ensureChannel: async () => ({
        channelId: CHAN,
        callerMemberCapId: CAP,
        fresh: true,
      }),
      resolveMemberCap: async () => CAP,
      sendMessage: () => new Promise(() => {}),
    };
    const start = Date.now();
    let err: Error | null = null;
    try {
      await runDmSend(makeDeps(sdk, rec), {
        peer: PEER,
        myAddress: ME,
        text: 'hi',
        existingChannelId: null,
        existingMemberCapId: null,
        masterTimeoutMs: 200,
      });
      fail('hanging sendMessage', 'expected rejection but resolved');
    } catch (e: any) {
      err = e;
    }
    const elapsed = Date.now() - start;
    truthy(err instanceof Error, 'pipeline rejected with an Error');
    truthy(
      err && /timed out/.test(err.message),
      'rejection message includes "timed out"',
    );
    truthy(
      elapsed >= 200 && elapsed < 1_500,
      `rejection fires near master budget (got ${elapsed}ms)`,
    );
    eq(rec.steps.includes('sendMessage:start'), true, 'sendMessage:start was reached');
    truthy(
      !rec.steps.includes('sendMessage:done'),
      'sendMessage:done NOT reached (the hang)',
    );
    truthy(
      !rec.steps.includes('notifyWs:start'),
      'notifyWs:start NOT reached (pipeline aborted before notify)',
    );
    // register_dm_channel DID fire (channel was created OK);
    // notify_dm_sent did NOT — recipient correctly sees no toast
    // for a message that never actually sent.
    eq(rec.wsSends.length, 1, 'only register_dm_channel fired');
    eq(rec.wsSends[0].type, 'register_dm_channel', 'WS send is register, NOT notify');
  }

  // ===========================================================================
  // 6 — sendMessage rejects → original error preserved
  // ===========================================================================
  console.log('\n[6] sendMessage rejects → original error preserved');
  {
    const rec = makeRecorder();
    const sdk: StubSdk = {
      ensureChannel: async () => ({
        channelId: CHAN,
        callerMemberCapId: CAP,
        fresh: true,
      }),
      resolveMemberCap: async () => CAP,
      sendMessage: async () => {
        throw new Error('Walrus publisher 502');
      },
    };
    let err: Error | null = null;
    try {
      await runDmSend(makeDeps(sdk, rec), {
        peer: PEER,
        myAddress: ME,
        text: 'hi',
        existingChannelId: null,
        existingMemberCapId: null,
        masterTimeoutMs: 1_000,
      });
      fail('rejecting sendMessage', 'expected rejection but resolved');
    } catch (e: any) {
      err = e;
    }
    truthy(err instanceof Error, 'pipeline rejected with an Error');
    truthy(
      err && /Walrus publisher 502/.test(err.message),
      'original SDK error preserved (not replaced by timeout error)',
    );
    truthy(
      !rec.steps.includes('notifyWs:start'),
      'notifyWs NOT reached on send rejection',
    );
  }

  // ===========================================================================
  // 7 — step trace is monotonic and complete on happy path
  // ===========================================================================
  console.log('\n[7] step trace — monotonic + complete');
  {
    const rec = makeRecorder();
    const sdk: StubSdk = {
      ensureChannel: async () => ({
        channelId: CHAN,
        callerMemberCapId: CAP,
        fresh: true,
      }),
      resolveMemberCap: async () => CAP,
      sendMessage: async () => ({ digest: '0x', messageId: '0' }),
    };
    await runDmSend(makeDeps(sdk, rec), {
      peer: PEER,
      myAddress: ME,
      text: 'hi',
      existingChannelId: null,
      existingMemberCapId: null,
      masterTimeoutMs: 1_000,
    });
    const expectedTrace: DmSendStep[] = [
      'createChannel:start',
      'createChannel:done',
      'registerWs:start',
      'registerWs:done',
      // resolveMemberCap is SKIPPED on the happy path because
      // ensureChannel returned a callerMemberCapId synchronously.
      'sendMessage:start',
      'sendMessage:done',
      'notifyWs:start',
      'notifyWs:done',
      'pipeline:done',
    ];
    eq(rec.steps.length, expectedTrace.length, 'expected trace length');
    for (let i = 0; i < expectedTrace.length; i++) {
      eq(rec.steps[i], expectedTrace[i], `step ${i}: ${expectedTrace[i]}`);
    }
  }

  // ===========================================================================
  // 8 — resolveMemberCap is invoked when ensureChannel doesn't surface a cap
  // ===========================================================================
  console.log('\n[8] resolveMemberCap invoked when ensureChannel returns no cap');
  {
    const rec = makeRecorder();
    let resolveCalled = 0;
    const sdk: StubSdk = {
      ensureChannel: async () => ({
        channelId: CHAN,
        callerMemberCapId: undefined, // not yet indexed
        fresh: true,
      }),
      resolveMemberCap: async () => {
        resolveCalled++;
        return CAP; // indexer caught up on retry
      },
      sendMessage: async () => ({ digest: '0x', messageId: '0' }),
    };
    const result = await runDmSend(makeDeps(sdk, rec), {
      peer: PEER,
      myAddress: ME,
      text: 'hi',
      existingChannelId: null,
      existingMemberCapId: null,
      masterTimeoutMs: 1_000,
    });
    eq(resolveCalled, 1, 'resolveMemberCap was called exactly once');
    eq(result.memberCapId, CAP, 'pipeline returned the resolved cap');
    truthy(
      rec.steps.includes('resolveMemberCap:start'),
      'resolveMemberCap:start in trace',
    );
    truthy(
      rec.steps.includes('resolveMemberCap:done'),
      'resolveMemberCap:done in trace',
    );
  }

  finalReport();
}

function finalReport(): void {
  console.log(`\n✓ Passed: ${passes}`);
  if (failures > 0) {
    console.log(`✗ Failed: ${failures}`);
    process.exit(1);
  } else {
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('UNCAUGHT', err);
  process.exit(1);
});
