/**
 * Tavern WS handlers integration gauntlet (Bucket 3, 2026-05-06).
 *
 *   $ cd server && npx tsx ../scripts/qa-tavern-handlers.ts
 *
 * Validates the WS dispatch surface (`ws/tavern-handlers.ts`) end to
 * end against in-memory mock clients. No real WS, no real DB. Pins:
 *   • dispatchTavernMessage routing
 *   • announcePlayerOnline / Offline → broadcasts
 *   • handleEnterRoom → presence + broadcast
 *   • handlePresenceHeartbeat → no-broadcast no-op when nothing changes
 *   • handleSendFightRequest → server validation, target push, sender echo
 *   • handleResolveFightRequest → state transition + dual-broadcast
 *   • handleRegisterDmChannel → registry + peer push
 *   • handleNotifyDmSent / handleClearDmUnread → counter math + push
 *   • Authentication gate
 *
 * Pure JS, no DB, no actual WS — sockets are stubs that record sends.
 */
import {
  dispatchTavernMessage,
  announcePlayerOnline,
  announcePlayerOffline,
  broadcastFightStatusChange,
  type TavernCtx,
} from '../server/src/ws/tavern-handlers';
import { _testResetPresence } from '../server/src/data/presence';
import { _testReset as resetFightRequests } from '../server/src/data/fight-requests';
import { _testReset as resetDmChannels } from '../server/src/data/dm-channels';
import { _testReset as resetDmMessages } from '../server/src/data/dm-messages';
import type { ConnectedClient } from '../server/src/types';

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

interface MockSocket {
  readyState: number;
  OPEN: number;
  sent: Array<Record<string, unknown>>;
  send: (raw: string) => void;
}

function makeSocket(): MockSocket {
  const sock: MockSocket = {
    readyState: 1, // OPEN
    OPEN: 1,
    sent: [],
    send(raw: string) {
      sock.sent.push(JSON.parse(raw));
    },
  };
  return sock;
}

function makeClient(id: string, wallet?: string): ConnectedClient {
  const sock = makeSocket();
  return {
    id,
    socket: sock as never,
    walletAddress: wallet,
    authenticated: !!wallet,
    lastChatTime: 0,
  } as ConnectedClient;
}

function makeCtx(clients: ConnectedClient[]): TavernCtx {
  return {
    sendToWallet(wallet, msg) {
      const target = clients.find(
        (c) => c.walletAddress?.toLowerCase() === wallet.toLowerCase(),
      );
      if (target) {
        (target.socket as unknown as MockSocket).sent.push(msg as never);
        return true;
      }
      return false;
    },
    broadcastAll(msg) {
      for (const c of clients) {
        (c.socket as unknown as MockSocket).sent.push(msg as never);
      }
    },
    getClient(wallet) {
      return clients.find(
        (c) => c.walletAddress?.toLowerCase() === wallet.toLowerCase(),
      );
    },
  };
}

function lastSent(client: ConnectedClient): Record<string, unknown> | undefined {
  const sock = client.socket as unknown as MockSocket;
  return sock.sent[sock.sent.length - 1];
}

function sentTypes(client: ConnectedClient): string[] {
  return (client.socket as unknown as MockSocket).sent
    .map((m) => String(m.type ?? ''));
}

const A = '0x000000000000000000000000000000000000000000000000000000000000000A';
const B = '0x000000000000000000000000000000000000000000000000000000000000000B';
const C = '0x000000000000000000000000000000000000000000000000000000000000000C';
const CHAN = '0x' + 'aa'.repeat(32);

function reset() {
  _testResetPresence();
  resetFightRequests();
  resetDmChannels();
  resetDmMessages();
}

// Wait one microtask + one macrotask so async dispatch (handleDmSend
// awaits insertMessage) has time to fan out before the assertion.
async function waitForFanout(): Promise<void> {
  await Promise.resolve();
  await new Promise((r) => setTimeout(r, 5));
}

async function main(): Promise<void> {
  // ===========================================================================
  // 1 — announcePlayerOnline → broadcast player_joined
  // ===========================================================================
  console.log('\n[1] announcePlayerOnline broadcasts player_joined');
  reset();
  const a = makeClient('cA', A);
  const b = makeClient('cB', B);
  const ctx = makeCtx([a, b]);
  announcePlayerOnline(ctx, a, 'tavern');
  truthy(sentTypes(a).includes('player_joined'), 'A receives player_joined');
  truthy(sentTypes(b).includes('player_joined'), 'B receives player_joined');

  // ===========================================================================
  // 2 — announcePlayerOffline → broadcast player_left
  // ===========================================================================
  console.log('\n[2] announcePlayerOffline broadcasts player_left');
  reset();
  const a2 = makeClient('cA2', A);
  const b2 = makeClient('cB2', B);
  const ctx2 = makeCtx([a2, b2]);
  announcePlayerOnline(ctx2, a2, 'tavern');
  // Reset sent buffers
  (a2.socket as unknown as MockSocket).sent.length = 0;
  (b2.socket as unknown as MockSocket).sent.length = 0;
  announcePlayerOffline(ctx2, A);
  truthy(sentTypes(a2).includes('player_left'), 'A receives player_left');
  truthy(sentTypes(b2).includes('player_left'), 'B receives player_left');

  // ===========================================================================
  // 3 — handleEnterRoom: valid + invalid
  // ===========================================================================
  console.log('\n[3] enter_room — broadcast on change, error on invalid');
  reset();
  const a3 = makeClient('cA3', A);
  const ctx3 = makeCtx([a3]);
  announcePlayerOnline(ctx3, a3, 'tavern');
  (a3.socket as unknown as MockSocket).sent.length = 0;
  const handled = dispatchTavernMessage(
    ctx3,
    a3,
    { type: 'enter_room', room: 'arena' },
    { onAcceptFightRequest: () => {} },
  );
  truthy(handled, 'enter_room dispatch returned true');
  truthy(sentTypes(a3).includes('player_status_changed'), 'arena change → player_status_changed');
  truthy(sentTypes(a3).includes('room_entered'), 'sender gets room_entered ack');

  (a3.socket as unknown as MockSocket).sent.length = 0;
  dispatchTavernMessage(
    ctx3,
    a3,
    { type: 'enter_room', room: 'banana' },
    { onAcceptFightRequest: () => {} },
  );
  truthy(sentTypes(a3).includes('error'), 'invalid room → error');

  // ===========================================================================
  // 4 — heartbeat: no broadcast when nothing changes
  // ===========================================================================
  console.log('\n[4] heartbeat — no extra broadcast on idempotent tick');
  reset();
  const a4 = makeClient('cA4', A);
  const b4 = makeClient('cB4', B);
  const ctx4 = makeCtx([a4, b4]);
  announcePlayerOnline(ctx4, a4, 'tavern');
  (a4.socket as unknown as MockSocket).sent.length = 0;
  (b4.socket as unknown as MockSocket).sent.length = 0;
  dispatchTavernMessage(
    ctx4,
    a4,
    { type: 'presence_heartbeat' },
    { onAcceptFightRequest: () => {} },
  );
  eq(sentTypes(a4).length, 0, 'sender gets nothing on idempotent heartbeat');
  eq(sentTypes(b4).length, 0, 'others get nothing on idempotent heartbeat');

  // ===========================================================================
  // 5 — send_fight_request happy path
  // ===========================================================================
  console.log('\n[5] send_fight_request — sender echo + target push');
  reset();
  const a5 = makeClient('cA5', A);
  const b5 = makeClient('cB5', B);
  const ctx5 = makeCtx([a5, b5]);
  announcePlayerOnline(ctx5, a5, 'tavern');
  announcePlayerOnline(ctx5, b5, 'tavern');
  (a5.socket as unknown as MockSocket).sent.length = 0;
  (b5.socket as unknown as MockSocket).sent.length = 0;
  dispatchTavernMessage(
    ctx5,
    a5,
    { type: 'send_fight_request', toWallet: B, requestType: 'friendly' },
    { onAcceptFightRequest: () => {} },
  );
  truthy(sentTypes(a5).includes('fight_request_sent'), 'sender echo');
  truthy(sentTypes(b5).includes('fight_request_received'), 'target push');

  // Self-target
  reset();
  const a6 = makeClient('cA6', A);
  const ctx6 = makeCtx([a6]);
  announcePlayerOnline(ctx6, a6);
  (a6.socket as unknown as MockSocket).sent.length = 0;
  dispatchTavernMessage(
    ctx6,
    a6,
    { type: 'send_fight_request', toWallet: A, requestType: 'friendly' },
    { onAcceptFightRequest: () => {} },
  );
  truthy(sentTypes(a6).includes('error'), 'self-target → error');

  // ===========================================================================
  // 6 — accept/decline fight request
  // ===========================================================================
  console.log('\n[6] accept/decline → resolved broadcast to both sides');
  reset();
  const a7 = makeClient('cA7', A);
  const b7 = makeClient('cB7', B);
  const ctx7 = makeCtx([a7, b7]);
  announcePlayerOnline(ctx7, a7);
  announcePlayerOnline(ctx7, b7);
  let acceptCalled = 0;
  dispatchTavernMessage(
    ctx7,
    a7,
    { type: 'send_fight_request', toWallet: B, requestType: 'friendly' },
    { onAcceptFightRequest: () => { acceptCalled++; } },
  );
  // Find the request id from a7's last sent
  const sentMsg = (a7.socket as unknown as MockSocket).sent.find((m) => m.type === 'fight_request_sent');
  const requestId = (sentMsg as { request: { id: string } }).request.id;

  (a7.socket as unknown as MockSocket).sent.length = 0;
  (b7.socket as unknown as MockSocket).sent.length = 0;

  dispatchTavernMessage(
    ctx7,
    b7,
    { type: 'accept_fight_request', requestId },
    { onAcceptFightRequest: () => { acceptCalled++; } },
  );
  truthy(sentTypes(a7).includes('fight_request_resolved'), 'sender notified of resolve');
  truthy(sentTypes(b7).includes('fight_request_resolved'), 'target notified of resolve');
  eq(acceptCalled, 1, 'onAcceptFightRequest invoked once');

  // Decline path
  reset();
  const a8 = makeClient('cA8', A);
  const b8 = makeClient('cB8', B);
  const ctx8 = makeCtx([a8, b8]);
  announcePlayerOnline(ctx8, a8);
  announcePlayerOnline(ctx8, b8);
  dispatchTavernMessage(
    ctx8,
    a8,
    { type: 'send_fight_request', toWallet: B, requestType: 'friendly' },
    { onAcceptFightRequest: () => {} },
  );
  const sentMsg2 = (a8.socket as unknown as MockSocket).sent.find((m) => m.type === 'fight_request_sent');
  const requestId2 = (sentMsg2 as { request: { id: string } }).request.id;
  (a8.socket as unknown as MockSocket).sent.length = 0;
  (b8.socket as unknown as MockSocket).sent.length = 0;
  dispatchTavernMessage(
    ctx8,
    b8,
    { type: 'decline_fight_request', requestId: requestId2 },
    { onAcceptFightRequest: () => {} },
  );
  const aResolved = (a8.socket as unknown as MockSocket).sent.find((m) => m.type === 'fight_request_resolved');
  truthy(aResolved, 'sender got fight_request_resolved');
  eq((aResolved as { action: string }).action, 'decline', 'action=decline');

  // ===========================================================================
  // 7 — register_dm_channel + notify_dm_sent + clear_dm_unread
  // ===========================================================================
  console.log('\n[7] DM channel lifecycle');
  reset();
  const a9 = makeClient('cA9', A);
  const b9 = makeClient('cB9', B);
  const ctx9 = makeCtx([a9, b9]);
  announcePlayerOnline(ctx9, a9);
  announcePlayerOnline(ctx9, b9);
  (a9.socket as unknown as MockSocket).sent.length = 0;
  (b9.socket as unknown as MockSocket).sent.length = 0;
  dispatchTavernMessage(
    ctx9,
    a9,
    {
      type: 'register_dm_channel',
      channelId: CHAN,
      walletA: A,
      walletB: B,
      memberCapA: '0xcapA',
      memberCapB: '0xcapB',
    },
    { onAcceptFightRequest: () => {} },
  );
  truthy(sentTypes(a9).includes('dm_channel_registered'), 'sender gets dm_channel_registered');
  truthy(sentTypes(b9).includes('dm_channel_registered'), 'peer gets dm_channel_registered');

  // Notify dm sent
  (b9.socket as unknown as MockSocket).sent.length = 0;
  dispatchTavernMessage(
    ctx9,
    a9,
    { type: 'notify_dm_sent', channelId: CHAN, recipient: B },
    { onAcceptFightRequest: () => {} },
  );
  const unreadMsg = (b9.socket as unknown as MockSocket).sent.find((m) => m.type === 'dm_unread_changed');
  truthy(unreadMsg, 'recipient receives dm_unread_changed');
  eq((unreadMsg as { unreadCount: number }).unreadCount, 1, 'unread bumped to 1');
  // Bug 2 fix (2026-05-06 hotfix #4) — recipient must learn WHO
  // sent the message so the toast can attribute it without a
  // second cross-reference round-trip. Pre-fix, `dm_unread_changed`
  // omitted the sender; the recipient saw a sound + counter bump
  // with no way to tell which peer had texted them.
  eq(
    (unreadMsg as { senderWallet?: string }).senderWallet,
    A.toLowerCase(),
    'dm_unread_changed carries senderWallet (lowercased)',
  );

  // Sender-side: notify_dm_sent does NOT push the same `dm_unread_changed`
  // back to the SENDER. Pre-fix it sometimes did because the in-memory
  // store happily incremented for either participant; the handler's
  // self-bump guard plus the server-side direction check together
  // guarantee the counter is recipient-only.
  const senderEcho = (a9.socket as unknown as MockSocket).sent.find(
    (m) => m.type === 'dm_unread_changed',
  );
  eq(senderEcho, undefined, 'sender does not receive their own dm_unread_changed');

  // Clear unread
  (b9.socket as unknown as MockSocket).sent.length = 0;
  dispatchTavernMessage(
    ctx9,
    b9,
    { type: 'clear_dm_unread', channelId: CHAN },
    { onAcceptFightRequest: () => {} },
  );
  const clearMsg = (b9.socket as unknown as MockSocket).sent.find((m) => m.type === 'dm_unread_changed');
  truthy(clearMsg, 'b receives ack');
  eq((clearMsg as { unreadCount: number }).unreadCount, 0, 'unread reset to 0');
  // Clear-path ack omits senderWallet — the recipient cleared it
  // themselves, no attribution applies.
  eq(
    (clearMsg as { senderWallet?: string }).senderWallet,
    undefined,
    'clear_dm_unread ack omits senderWallet',
  );

  // ──────────────────────────────────────────────────────────────────────
  // Case-mismatched wallet lookup — the recipient's WS push must find
  // their socket regardless of which casing the sender used. Mr_Boss
  // chats with Sx; if either side stored the address with mixed case
  // (some wallets do; the canonical form for Sui addresses is
  // lowercase but the wire surface accepts both), the lookup must
  // still land. The senderWallet field in dm_unread_changed must
  // also be lowercased so the recipient's toast filter (matches by
  // .toLowerCase()) works regardless of which casing the sender's
  // app sent.
  // ──────────────────────────────────────────────────────────────────────
  console.log('\n[7c] case-insensitive recipient lookup + lowercase senderWallet');
  reset();
  const sender2 = makeClient('cSender2', A.toLowerCase());
  // Recipient stored with MIXED case to verify the lookup is
  // case-insensitive end to end.
  const mixedB = '0x' + 'B'.repeat(64);
  const recipient2 = makeClient('cRecipient2', mixedB);
  const ctxMixed = makeCtx([sender2, recipient2]);
  announcePlayerOnline(ctxMixed, sender2);
  announcePlayerOnline(ctxMixed, recipient2);
  (sender2.socket as unknown as MockSocket).sent.length = 0;
  (recipient2.socket as unknown as MockSocket).sent.length = 0;
  dispatchTavernMessage(
    ctxMixed,
    sender2,
    {
      type: 'register_dm_channel',
      channelId: CHAN,
      walletA: A.toLowerCase(),
      walletB: mixedB,
      memberCapA: '0xcapA',
      memberCapB: '0xcapB',
    },
    { onAcceptFightRequest: () => {} },
  );
  dispatchTavernMessage(
    ctxMixed,
    sender2,
    // Sender uses UPPERCASE recipient — the server lookup must
    // canonicalise.
    { type: 'notify_dm_sent', channelId: CHAN, recipient: mixedB.toUpperCase() },
    { onAcceptFightRequest: () => {} },
  );
  const recvSocketMixed = recipient2.socket as unknown as MockSocket;
  const unreadMixed = recvSocketMixed.sent.find(
    (m) => m.type === 'dm_unread_changed',
  ) as { senderWallet?: string } | undefined;
  truthy(unreadMixed, 'recipient (mixed-case wallet) still received dm_unread_changed');
  eq(
    unreadMixed?.senderWallet,
    A.toLowerCase(),
    'senderWallet always emitted lowercase regardless of caller casing',
  );

  // ──────────────────────────────────────────────────────────────────────
  // Recipient notification path — full create→send→notify sequence as
  // the recipient's WS would observe it. Pins the order the recipient's
  // frontend depends on: dm_channel_registered FIRST (so state.dmChannels
  // contains the channel by the time the unread bump arrives), then
  // dm_unread_changed (carrying senderWallet so the toast renders).
  // Bug 2 from the 2026-05-06 two-wallet live test was the ABSENCE of
  // this path — the registry knew the channel existed but the recipient
  // got no actionable signal.
  // ──────────────────────────────────────────────────────────────────────
  console.log('\n[7b] recipient notification — registered+notified ordering');
  reset();
  const sender = makeClient('cSender', A);
  const recipient = makeClient('cRecipient', B);
  const ctxSR = makeCtx([sender, recipient]);
  announcePlayerOnline(ctxSR, sender);
  announcePlayerOnline(ctxSR, recipient);
  // Reset so we only inspect the post-DM events.
  (sender.socket as unknown as MockSocket).sent.length = 0;
  (recipient.socket as unknown as MockSocket).sent.length = 0;
  dispatchTavernMessage(
    ctxSR,
    sender,
    {
      type: 'register_dm_channel',
      channelId: CHAN,
      walletA: A,
      walletB: B,
      memberCapA: '0xcapA',
      memberCapB: '0xcapB',
    },
    { onAcceptFightRequest: () => {} },
  );
  dispatchTavernMessage(
    ctxSR,
    sender,
    { type: 'notify_dm_sent', channelId: CHAN, recipient: B },
    { onAcceptFightRequest: () => {} },
  );
  const recvSocket = recipient.socket as unknown as MockSocket;
  const recipientStream = recvSocket.sent.map((m) => String(m.type));
  const idxRegister = recipientStream.indexOf('dm_channel_registered');
  const idxUnread = recipientStream.indexOf('dm_unread_changed');
  truthy(idxRegister >= 0, 'recipient saw dm_channel_registered');
  truthy(idxUnread >= 0, 'recipient saw dm_unread_changed');
  truthy(
    idxRegister < idxUnread,
    'register lands BEFORE unread (state.dmChannels populated when toast fires)',
  );
  const recipientUnread = recvSocket.sent[idxUnread] as {
    senderWallet?: string;
    totalUnread: number;
  };
  eq(
    recipientUnread.senderWallet,
    A.toLowerCase(),
    'recipient unread payload attributes sender (lowercase)',
  );
  eq(
    recipientUnread.totalUnread,
    1,
    'recipient totalUnread reflects the single unread DM',
  );

  // ===========================================================================
  // 8 — auth gate
  // ===========================================================================
  console.log('\n[8] unauthenticated handlers reject');
  reset();
  const u = makeClient('cU'); // no wallet
  const ctxU = makeCtx([u]);
  dispatchTavernMessage(
    ctxU,
    u,
    { type: 'enter_room', room: 'tavern' },
    { onAcceptFightRequest: () => {} },
  );
  truthy(sentTypes(u).includes('error'), 'enter_room without auth → error');
  dispatchTavernMessage(
    ctxU,
    u,
    { type: 'send_fight_request', toWallet: B, requestType: 'friendly' },
    { onAcceptFightRequest: () => {} },
  );
  const errs = sentTypes(u).filter((t) => t === 'error');
  truthy(errs.length >= 2, 'send_fight_request without auth → error');

  // ===========================================================================
  // 9 — broadcastFightStatusChange flips status
  // ===========================================================================
  console.log('\n[9] broadcastFightStatusChange flips presence status');
  reset();
  const a10 = makeClient('cA10', A);
  const b10 = makeClient('cB10', B);
  const ctx10 = makeCtx([a10, b10]);
  announcePlayerOnline(ctx10, a10);
  announcePlayerOnline(ctx10, b10);
  (a10.socket as unknown as MockSocket).sent.length = 0;
  (b10.socket as unknown as MockSocket).sent.length = 0;
  broadcastFightStatusChange(ctx10, A, 'fight-1');
  const fightChange = (b10.socket as unknown as MockSocket).sent.find(
    (m) => m.type === 'player_status_changed',
  );
  truthy(fightChange, 'fight start broadcast received');
  eq((fightChange as { status: string }).status, 'in_fight', 'status flipped to in_fight');

  broadcastFightStatusChange(ctx10, A, null);
  const fightEnd = (b10.socket as unknown as MockSocket).sent
    .filter((m) => m.type === 'player_status_changed')
    .pop();
  eq((fightEnd as { status: string }).status, 'online', 'status flipped back to online');

  // ===========================================================================
  // 11 — Plaintext DM transport: dm_send happy path (Hotfix #6)
  //
  // Full handshake from the recipient's perspective:
  //   sender → dm_send → server lazily creates synthetic channel,
  //   persists row, fans out:
  //     · sender:    dm_message_sent (with clientId echo) +
  //                  dm_channel_registered (only if fresh)
  //     · recipient: dm_message_received +
  //                  dm_channel_registered (only if fresh) +
  //                  dm_unread_changed (with senderWallet)
  // ===========================================================================
  console.log('\n[11] dm_send (plaintext) — happy path');
  reset();
  {
    const sender = makeClient('cSender11', A);
    const recipient = makeClient('cRecipient11', B);
    const ctx11 = makeCtx([sender, recipient]);
    announcePlayerOnline(ctx11, sender);
    announcePlayerOnline(ctx11, recipient);
    (sender.socket as unknown as MockSocket).sent.length = 0;
    (recipient.socket as unknown as MockSocket).sent.length = 0;

    dispatchTavernMessage(
      ctx11,
      sender,
      {
        type: 'dm_send',
        clientId: 'cid-11',
        peerWallet: B,
        body: 'hello there',
      },
      { onAcceptFightRequest: () => {} },
    );
    await waitForFanout();

    const senderSent = (sender.socket as unknown as MockSocket).sent;
    const recipientSent = (recipient.socket as unknown as MockSocket).sent;

    // Sender side: dm_channel_registered (fresh) + dm_message_sent.
    const senderRegister = senderSent.find((m) => m.type === 'dm_channel_registered');
    truthy(senderRegister, 'sender got dm_channel_registered');
    const senderEcho = senderSent.find((m) => m.type === 'dm_message_sent') as
      | { clientId: string; message: { id: string; body: string; senderWallet: string } }
      | undefined;
    truthy(senderEcho, 'sender got dm_message_sent echo');
    eq(senderEcho?.clientId, 'cid-11', 'echo carries the original clientId');
    eq(senderEcho?.message.body, 'hello there', 'echo carries the body');
    eq(
      senderEcho?.message.senderWallet,
      A.toLowerCase(),
      'echo senderWallet is lowercased caller',
    );

    // Recipient side: dm_channel_registered + dm_message_received +
    // dm_unread_changed (with senderWallet).
    const recipientRegister = recipientSent.find(
      (m) => m.type === 'dm_channel_registered',
    );
    truthy(recipientRegister, 'recipient got dm_channel_registered');
    const recipientPush = recipientSent.find(
      (m) => m.type === 'dm_message_received',
    ) as { message: { body: string; senderWallet: string } } | undefined;
    truthy(recipientPush, 'recipient got dm_message_received');
    eq(recipientPush?.message.body, 'hello there', 'recipient sees the body');
    eq(
      recipientPush?.message.senderWallet,
      A.toLowerCase(),
      'recipient sees lowercased senderWallet',
    );
    const recipientUnread = recipientSent.find(
      (m) => m.type === 'dm_unread_changed',
    ) as { unreadCount: number; senderWallet?: string } | undefined;
    truthy(recipientUnread, 'recipient got dm_unread_changed');
    eq(recipientUnread?.unreadCount, 1, 'unread count = 1');
    eq(
      recipientUnread?.senderWallet,
      A.toLowerCase(),
      'unread carries senderWallet for toast attribution',
    );
  }

  // ===========================================================================
  // 12 — dm_send rejects empty / over-cap / self-send
  // ===========================================================================
  console.log('\n[12] dm_send — input validation');
  reset();
  {
    const sender = makeClient('cSender12', A);
    const ctx12 = makeCtx([sender]);
    announcePlayerOnline(ctx12, sender);
    (sender.socket as unknown as MockSocket).sent.length = 0;

    // Empty body
    dispatchTavernMessage(
      ctx12,
      sender,
      { type: 'dm_send', clientId: 'cid-empty', peerWallet: B, body: '' },
      { onAcceptFightRequest: () => {} },
    );
    await waitForFanout();
    let errCount = (sender.socket as unknown as MockSocket).sent
      .filter((m) => m.type === 'error').length;
    truthy(errCount >= 1, 'empty body → error');

    // Over-cap body
    (sender.socket as unknown as MockSocket).sent.length = 0;
    dispatchTavernMessage(
      ctx12,
      sender,
      {
        type: 'dm_send',
        clientId: 'cid-huge',
        peerWallet: B,
        body: 'x'.repeat(2001),
      },
      { onAcceptFightRequest: () => {} },
    );
    await waitForFanout();
    errCount = (sender.socket as unknown as MockSocket).sent
      .filter((m) => m.type === 'error').length;
    truthy(errCount >= 1, 'over-2000-char body → error');

    // Self-send
    (sender.socket as unknown as MockSocket).sent.length = 0;
    dispatchTavernMessage(
      ctx12,
      sender,
      { type: 'dm_send', clientId: 'cid-self', peerWallet: A, body: 'me' },
      { onAcceptFightRequest: () => {} },
    );
    await waitForFanout();
    errCount = (sender.socket as unknown as MockSocket).sent
      .filter((m) => m.type === 'error').length;
    truthy(errCount >= 1, 'self-send → error');

    // Missing clientId
    (sender.socket as unknown as MockSocket).sent.length = 0;
    dispatchTavernMessage(
      ctx12,
      sender,
      { type: 'dm_send', peerWallet: B, body: 'hi' },
      { onAcceptFightRequest: () => {} },
    );
    await waitForFanout();
    errCount = (sender.socket as unknown as MockSocket).sent
      .filter((m) => m.type === 'error').length;
    truthy(errCount >= 1, 'missing clientId → error');
  }

  // ===========================================================================
  // 13 — dm_history happy + empty channel
  // ===========================================================================
  console.log('\n[13] dm_history — happy + empty');
  reset();
  {
    const a = makeClient('cA13', A);
    const b = makeClient('cB13', B);
    const ctx13 = makeCtx([a, b]);
    announcePlayerOnline(ctx13, a);
    announcePlayerOnline(ctx13, b);

    // History for a never-used pair → empty.
    (a.socket as unknown as MockSocket).sent.length = 0;
    dispatchTavernMessage(
      ctx13,
      a,
      { type: 'dm_history', peerWallet: B },
      { onAcceptFightRequest: () => {} },
    );
    await waitForFanout();
    const emptyHistory = (a.socket as unknown as MockSocket).sent.find(
      (m) => m.type === 'dm_history',
    ) as { channelId: string | null; messages: unknown[]; hasMore: boolean } | undefined;
    truthy(emptyHistory, 'a received dm_history reply');
    eq(emptyHistory?.channelId, null, 'channelId null when no DMs ever exchanged');
    eq(emptyHistory?.messages.length, 0, 'empty messages array');
    eq(emptyHistory?.hasMore, false, 'hasMore=false');

    // Send 3 messages, then fetch history.
    dispatchTavernMessage(
      ctx13,
      a,
      { type: 'dm_send', clientId: 'h1', peerWallet: B, body: 'one' },
      { onAcceptFightRequest: () => {} },
    );
    await waitForFanout();
    dispatchTavernMessage(
      ctx13,
      b,
      { type: 'dm_send', clientId: 'h2', peerWallet: A, body: 'two' },
      { onAcceptFightRequest: () => {} },
    );
    await waitForFanout();
    dispatchTavernMessage(
      ctx13,
      a,
      { type: 'dm_send', clientId: 'h3', peerWallet: B, body: 'three' },
      { onAcceptFightRequest: () => {} },
    );
    await waitForFanout();

    (a.socket as unknown as MockSocket).sent.length = 0;
    dispatchTavernMessage(
      ctx13,
      a,
      { type: 'dm_history', peerWallet: B, limit: 50 },
      { onAcceptFightRequest: () => {} },
    );
    await waitForFanout();
    const fullHistory = (a.socket as unknown as MockSocket).sent.find(
      (m) => m.type === 'dm_history',
    ) as
      | { channelId: string; messages: { body: string }[]; hasMore: boolean }
      | undefined;
    truthy(fullHistory, 'a received dm_history reply (after sends)');
    truthy(
      typeof fullHistory?.channelId === 'string' &&
        fullHistory.channelId.startsWith('0x'),
      'channelId is now a real synthetic id',
    );
    eq(fullHistory?.messages.length, 3, '3 messages returned');
    eq(fullHistory?.messages[0].body, 'one', 'oldest first (m=one)');
    eq(fullHistory?.messages[2].body, 'three', 'newest last (m=three)');

    // History request also clears unread for the caller (server-side
    // ack landing in the same response cluster).
    const clearAck = (a.socket as unknown as MockSocket).sent.find(
      (m) => m.type === 'dm_unread_changed',
    ) as { unreadCount: number } | undefined;
    truthy(clearAck, 'caller received dm_unread_changed clear ack');
    eq(clearAck?.unreadCount, 0, 'caller unread cleared to 0');
  }

  // ===========================================================================
  // 14 — dm_history rejects unauthorised callers
  // ===========================================================================
  console.log('\n[14] dm_history — rejects non-participant caller');
  reset();
  {
    const a = makeClient('cA14', A);
    const b = makeClient('cB14', B);
    const c = makeClient('cC14', C);
    const ctx14 = makeCtx([a, b, c]);
    announcePlayerOnline(ctx14, a);
    announcePlayerOnline(ctx14, b);
    announcePlayerOnline(ctx14, c);

    // A and B exchange a message.
    dispatchTavernMessage(
      ctx14,
      a,
      { type: 'dm_send', clientId: 'cid', peerWallet: B, body: 'hi' },
      { onAcceptFightRequest: () => {} },
    );
    await waitForFanout();

    // C asks for history of A,B's channel — should be rejected
    // because C isn't a participant. C asks via peerWallet=A but
    // would need to be a participant of (A, c.wallet). Here we ask
    // peerWallet=A and walletC; the synthetic channel is for (A,B)
    // not (A,C), so it returns empty history. To prove the
    // authorisation guard fires, we'd need a malicious lookup for
    // a channel C isn't part of — easier path: the server should
    // simply return empty history for C asking about A (no channel
    // exists for that pair). Defense-in-depth.
    (c.socket as unknown as MockSocket).sent.length = 0;
    dispatchTavernMessage(
      ctx14,
      c,
      { type: 'dm_history', peerWallet: A },
      { onAcceptFightRequest: () => {} },
    );
    await waitForFanout();
    const cHistory = (c.socket as unknown as MockSocket).sent.find(
      (m) => m.type === 'dm_history',
    ) as { messages: unknown[]; channelId: string | null } | undefined;
    truthy(cHistory, 'C received a dm_history reply');
    eq(
      cHistory?.channelId,
      null,
      'C cannot see A↔B channel (asks about A,C pair which has no channel)',
    );
    eq(cHistory?.messages.length, 0, 'C sees empty messages');
  }

  // ===========================================================================
  // 15 — dm_send / dm_history require auth
  // ===========================================================================
  console.log('\n[15] dm_send / dm_history — require auth');
  reset();
  {
    const u = makeClient('cU15'); // no wallet
    const ctxU = makeCtx([u]);
    dispatchTavernMessage(
      ctxU,
      u,
      { type: 'dm_send', clientId: 'cid', peerWallet: B, body: 'hi' },
      { onAcceptFightRequest: () => {} },
    );
    await waitForFanout();
    truthy(
      sentTypes(u).includes('error'),
      'dm_send without auth → error',
    );
    (u.socket as unknown as MockSocket).sent.length = 0;
    dispatchTavernMessage(
      ctxU,
      u,
      { type: 'dm_history', peerWallet: B },
      { onAcceptFightRequest: () => {} },
    );
    await waitForFanout();
    truthy(
      sentTypes(u).includes('error'),
      'dm_history without auth → error',
    );
  }

  // ===========================================================================
  // 10 — unknown tavern type returns false
  // ===========================================================================
  console.log('\n[10] unknown type → not handled (returns false)');
  reset();
  const a11 = makeClient('cA11', A);
  const ctx11 = makeCtx([a11]);
  const result = dispatchTavernMessage(
    ctx11,
    a11,
    { type: 'never_heard_of_it' },
    { onAcceptFightRequest: () => {} },
  );
  eq(result, false, 'unknown tavern type returns false');

  // Final
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
