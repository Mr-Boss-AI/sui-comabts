// @ts-nocheck — Sui Stack Messaging SDK ships with its own pinned
// `@mysten/sui` (1.45.2) and `@mysten/seal` (0.9.x) deps. Our app
// uses sui 2.15.0 + seal 1.1.x at the top level. The runtime API
// matches but the TS types from the two copies don't share private
// symbols, so strict cross-version assignability fails. Disabling
// type-checking in THIS file (and only this file) is the most
// honest way to integrate an alpha SDK without polluting the rest of
// the codebase. Wire-shape is exposed via the wrapper, which IS
// type-checked at every call site.

'use client';

/**
 * Sui Stack Messaging SDK wrapper.
 *
 * Encrypted, wallet-linked DMs between players. Built on Mysten's
 * `@mysten/messaging` SDK (alpha, testnet only at time of writing —
 * 2026-05-06). Each message is an on-chain transaction signed by the
 * sender; ciphertexts live on Walrus, decryption uses Seal threshold
 * encryption with Mysten-managed key servers.
 *
 * UX implications callers must understand:
 *   • Sending a message pops the wallet for a signature.
 *   • Each send costs gas (~0.001 SUI on testnet).
 *   • Channel creation is a SEPARATE tx the first time two wallets DM.
 *   • Decryption requires a Seal session key (one-time wallet sign per
 *     30-min session). The wrapper hides that ceremony behind
 *     `ensureSession`.
 */

// Version matrix — see TAVERN_DESIGN.md § "Sui Stack Messaging SDK".
//
// The messaging SDK 0.3.0 was authored against:
//   @mysten/sui    @ 1.45.2   (renamed to SuiGrpcClient in 2.x)
//   @mysten/seal   @ 0.9.6    (static `asClientExtension` removed in 1.x)
//   @mysten/walrus @ 0.8.6
//
// Our app top-level uses sui 2.15.0 (dapp-kit requires it) and seal
// 1.1.1 — both incompatible with messaging 0.3.0's expected client
// shape. We install the SDK-aligned versions under npm aliases so
// the messaging chain gets exactly what it expects, while the rest
// of the app keeps using the modern packages:
//
//   mysten-sui-v1    → @mysten/sui@1.45.2
//   mysten-seal-v0   → @mysten/seal@0.9.6
//   @mysten/messaging→ 0.3.0 (top-level — SDK package itself)
//
// Walrus is configured inline via `walrusStorageConfig` and runs as
// a storage adapter inside messaging, not as a separate $extend.
//
// When the messaging SDK ships a new minor version, re-pin the trio
// to whatever versions its CHANGELOG declares (see node_modules/
// @mysten/messaging/CHANGELOG.md) and re-run qa-messaging-client.ts.
import { SuiClient } from 'mysten-sui-v1/client';
import { SealClient, SessionKey } from 'mysten-seal-v0';
import { messaging } from '@mysten/messaging';

// Network configuration ──────────────────────────────────────────────

const SUI_TESTNET_FULLNODE = 'https://fullnode.testnet.sui.io:443';

/**
 * The Sui Stack Messaging Move package on testnet. The SDK's contract
 * bindings reference this package via the named placeholder
 * `@local-pkg/sui-stack-messaging` — we map it explicitly via MVR
 * overrides on the SuiClient so the SDK doesn't have to round-trip
 * through Mysten's remote MVR registry on every tx build (which was
 * failing on first DM send with "Failed to resolve package: …" before
 * this fix).
 *
 * From `@mysten/messaging/dist/cjs/constants.js`:
 *   const FALLBACK_PACKAGE_ID =
 *     '0x984960ebddd75c15c6d38355ac462621db0ffc7d6647214c802cd3b685e1af3d';
 */
const MESSAGING_TESTNET_PACKAGE_ID =
  '0x984960ebddd75c15c6d38355ac462621db0ffc7d6647214c802cd3b685e1af3d';

const MVR_PACKAGE_OVERRIDES: Record<string, string> = {
  '@local-pkg/sui-stack-messaging': MESSAGING_TESTNET_PACKAGE_ID,
};

/** Seal testnet key servers (Mysten-managed). Threshold 1-of-1 keeps
 *  the latency low; for production we'd want 2-of-3 across operators. */
const TESTNET_SEAL_KEY_SERVERS = [
  {
    objectId: '0x73d05d62c18d9374e3ea529e8e0ed6161da1a141a94d3f76ae3fe4e99356db75',
    weight: 1,
  },
];

/** Walrus testnet aggregator + publisher. Public endpoints, no auth. */
const TESTNET_WALRUS_CONFIG = {
  aggregator: 'https://aggregator.walrus-testnet.walrus.space',
  publisher: 'https://publisher.walrus-testnet.walrus.space',
  epochs: 1,
};

/** Wire shape for the wrapper's view of a decrypted message. */
export interface DecryptedMessageWire {
  id: string;
  sender: string;
  text: string;
  createdAtMs: number;
}

/** SDK alpha disclosure shown in the DM panel banner. */
export const TESTNET_DISCLOSURE = [
  'Encrypted DMs are powered by the Sui Stack Messaging SDK (alpha,',
  'testnet only). Each message is an on-chain signed transaction',
  'storing the encrypted body on Walrus. Expect a wallet popup per',
  'send. Mainnet support is gated on the SDK reaching beta.',
].join(' ');

/**
 * Timeout budget per SDK call (milliseconds). The SDK is alpha and
 * has been observed to hang silently — wallet popup completes, the
 * underlying tx lands on chain, but the JS promise never settles
 * because Walrus upload polling / Seal session warmup / chain finality
 * polling stalls without raising. Without a hard cap the calling
 * component sticks in "Signing…" forever (Bug 1, 2026-05-06).
 *
 * Numbers chosen to be generous against testnet latency floors
 * (Walrus publisher round-trips in 5–10 s, Seal key fetch ~2 s,
 * checkpoint inclusion ~3 s) while still surfacing a clear error
 * before the user's patience runs out. Each is independently raisable
 * if a particular call needs longer.
 */
export const SDK_TIMEOUT_MS = {
  createChannel: 60_000,
  sendMessage: 60_000,
  getMessages: 30_000,
  resolveCap: 15_000,
  refreshSession: 30_000,
} as const;

/**
 * Race a promise against a fixed timeout. Resolves with the original
 * value, or rejects with `new Error("<label> timed out after Ns")`
 * when the timeout fires first. Cleans the timer up either way so
 * Node tests don't leak handles.
 *
 * Exported (vs inlined) so the QA gauntlet can assert the wrapper
 * actually rejects on a stalled SDK promise — the regression guard
 * for the "stuck on Signing…" bug.
 */
export function withTimeout<T>(
  p: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(
        new Error(
          `${label} timed out after ${Math.round(ms / 1000)}s — ` +
          `the wallet/chain step did not return. Try again; if it ` +
          `repeats, the SDK or testnet endpoint is degraded.`,
        ),
      );
    }, ms);
  });
  return Promise.race([p, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer);
  }) as Promise<T>;
}

// ─── client lifecycle ────────────────────────────────────────────────

let cachedBundle = null;
let pendingSession = null;
let cachedSession = null;

/**
 * Construct (or reuse) a SuiClient extended with Seal + messaging. The
 * bundle is cached per address — switching wallets returns a fresh
 * client because the session key is derived from the active address.
 */
export function ensureClient(signer: any, address: string): { client: any; signer: any; address: string } {
  if (cachedBundle && cachedBundle.address === address) {
    return cachedBundle;
  }
  cachedSession = null;
  pendingSession = null;

  const client = buildExtendedClient(signer, address);
  // Fail fast with a structured error if the SDK changed shape under
  // us. Without this, a missing method surfaces as an opaque
  // "X is not a function" deep inside `executeSendMessageTransaction`
  // on the first user click — exactly the bug we're fixing here.
  const missing = checkMessagingClientShape(client);
  if (missing.length > 0) {
    throw new Error(
      `Sui Stack Messaging SDK shape changed — missing: ${missing.join(', ')}. ` +
      `Re-pin the messaging/seal/sui aliases in package.json against the version ` +
      `matrix in TAVERN_DESIGN.md and re-run \`npx tsx scripts/qa-messaging-client.ts\`.`,
    );
  }
  cachedBundle = { client, signer, address };
  return cachedBundle;
}

/**
 * Build the SuiClient → seal → messaging extension chain for the
 * given signer + address. Pulled out as an exported function so the
 * QA gauntlet (`qa-messaging-client.ts`) can assert the SDK exposes
 * every method the wrapper relies on, before any wallet code runs.
 *
 * Dependency chain (left to right is required order):
 *   sui 1.x SuiClient
 *     .$extend(SealClient.asClientExtension({ serverConfigs }))
 *       — seal 0.9.x: registers `client.seal` for the messaging
 *         extension to read at register-time. This static method
 *         was REMOVED in seal 1.x; `mysten-seal-v0` is the alias.
 *     .$extend(messaging({ walrusStorageConfig, sessionKeyConfig }))
 *       — registers `client.messaging` and reads `client.seal` to
 *         wire seal-driven encryption + Walrus-backed storage.
 *
 * If the SDK ever ships a `messaging:` deprecation in favour of a
 * different wiring (e.g. constructor-based), this is the one place
 * to update.
 */
export function buildExtendedClient(signer: any, address: string) {
  // `network: 'testnet'` is required so the messaging extension picks
  // TESTNET_MESSAGING_PACKAGE_CONFIG when no explicit packageConfig is
  // passed. The MVR override pre-maps the SDK's named-package
  // placeholder to the testnet package id — without it, every Move
  // call inside the SDK round-trips through `testnet.mvr.mystenlabs.com`
  // and fails closed if MVR is unreachable.
  const base = new SuiClient({
    url: SUI_TESTNET_FULLNODE,
    network: 'testnet',
    mvr: {
      overrides: {
        packages: MVR_PACKAGE_OVERRIDES,
      },
    },
  });
  const c = base
    .$extend(
      SealClient.asClientExtension({
        serverConfigs: TESTNET_SEAL_KEY_SERVERS,
      }),
    )
    .$extend(
      messaging({
        walrusStorageConfig: TESTNET_WALRUS_CONFIG,
        // Pin packageConfig explicitly. Even though messaging's
        // default for `network === 'testnet'` is the same package id,
        // doing it here makes the wiring auditable in one place and
        // protects against future SDK default changes.
        packageConfig: {
          packageId: MESSAGING_TESTNET_PACKAGE_ID,
        },
        sessionKeyConfig: {
          address,
          ttlMin: 30,
          signer,
        },
      }),
    );
  return c;
}

/**
 * Light "is the SDK still wired correctly?" probe. Used by
 * `qa-messaging-client.ts` and `ensureClient` to fail fast with a
 * helpful error if a future SDK upgrade drops a method we depend on
 * — instead of crashing on the first user click. Returns the list of
 * missing methods (empty array means healthy).
 */
export function checkMessagingClientShape(client: any): string[] {
  const expectedMessaging = [
    'executeCreateChannelTransaction',
    'executeSendMessageTransaction',
    'getChannelMessages',
    'getUserMemberCap',
    'refreshSessionKey',
  ] as const;
  const missing: string[] = [];
  if (!client) {
    missing.push('<root client>');
    return missing;
  }
  if (!client.seal) missing.push('seal');
  if (!client.messaging) {
    missing.push('messaging');
    return missing;
  }
  for (const fn of expectedMessaging) {
    if (typeof client.messaging[fn] !== 'function') {
      missing.push(`messaging.${fn}`);
    }
  }
  return missing;
}

function getMessagingClient(bundle) {
  return bundle.client.messaging;
}

// ─── channel discovery + creation ────────────────────────────────────

/**
 * Look up the MemberCap for `userAddress` in `channelId`. Returns null
 * if the cap isn't visible yet — caller can retry.
 */
export async function resolveMemberCap(bundle: any, channelId: string, userAddress: string): Promise<string | null> {
  const messagingClient = getMessagingClient(bundle);
  try {
    const cap = await withTimeout(
      messagingClient.getUserMemberCap(userAddress, channelId),
      SDK_TIMEOUT_MS.resolveCap,
      'getUserMemberCap',
    );
    if (!cap) return null;
    const capId = cap.id;
    if (typeof capId === 'string') return capId;
    if (capId && typeof capId === 'object' && typeof capId.id === 'string') return capId.id;
    return null;
  } catch (err) {
    console.warn('[messaging] resolveMemberCap failed:', err);
    return null;
  }
}

/**
 * Ensure a channel exists between `signer.toSuiAddress()` and `peer`.
 * If none exists, creates one via the SDK (single signed tx).
 */
export async function ensureChannel(
  bundle: any,
  peer: string,
  existingChannelId?: string,
): Promise<{
  channelId: string;
  callerMemberCapId?: string;
  encryptedKeyB64?: string;
  fresh: boolean;
}> {
  if (existingChannelId) {
    const callerMemberCapId =
      (await resolveMemberCap(bundle, existingChannelId, bundle.address)) ?? undefined;
    return { channelId: existingChannelId, callerMemberCapId, fresh: false };
  }
  const messagingClient = getMessagingClient(bundle);
  const result = await withTimeout(
    messagingClient.executeCreateChannelTransaction({
      signer: bundle.signer,
      initialMembers: [peer],
    }),
    SDK_TIMEOUT_MS.createChannel,
    'executeCreateChannelTransaction',
  );
  const callerMemberCapId =
    (await resolveMemberCap(bundle, result.channelId, bundle.address)) ?? undefined;
  const encryptedKeyB64 = uint8ToBase64(result.encryptedKeyBytes);
  return {
    channelId: result.channelId,
    callerMemberCapId,
    encryptedKeyB64,
    fresh: true,
  };
}

// ─── send + read ─────────────────────────────────────────────────────

/**
 * Send a plaintext message into `channelId`. The SDK handles
 * encryption (via Seal) and Walrus upload internally. Will pop the
 * wallet for a signature.
 */
export async function sendMessage(
  bundle: any,
  params: {
    channelId: string;
    memberCapId: string;
    message: string;
    encryptedKeyB64?: string;
  },
): Promise<{ digest: string; messageId: string }> {
  const messagingClient = getMessagingClient(bundle);
  const result = await withTimeout(
    messagingClient.executeSendMessageTransaction({
      signer: bundle.signer,
      channelId: params.channelId,
      memberCapId: params.memberCapId,
      message: params.message,
      encryptedKey: undefined,
    }),
    SDK_TIMEOUT_MS.sendMessage,
    'executeSendMessageTransaction',
  );
  return { digest: result.digest, messageId: result.messageId };
}

/**
 * Fetch the latest `limit` messages from `channelId`, newest last.
 */
export async function getMessages(
  bundle: any,
  params: { channelId: string; cursor?: string; limit?: number },
): Promise<DecryptedMessageWire[]> {
  const messagingClient = getMessagingClient(bundle);
  const result = await withTimeout(
    messagingClient.getChannelMessages({
      channelId: params.channelId,
      userAddress: bundle.address,
      cursor: params.cursor ? BigInt(params.cursor) : null,
      limit: params.limit ?? 50,
      direction: 'backward',
    }),
    SDK_TIMEOUT_MS.getMessages,
    'getChannelMessages',
  );
  const wire = [];
  for (const m of (result.messages ?? []).slice().reverse()) {
    wire.push({
      id: String(m.id ?? ''),
      sender: String(m.sender ?? ''),
      text: String(m.text ?? ''),
      createdAtMs: Number(m.createdAtMs ?? Date.now()),
    });
  }
  return wire;
}

// ─── session key (Seal) ──────────────────────────────────────────────

/** Force-warm the Seal session key. */
export async function ensureSession(bundle: any): Promise<unknown> {
  if (cachedSession) return cachedSession;
  if (pendingSession) return pendingSession;
  pendingSession = (async () => {
    const messagingClient = getMessagingClient(bundle);
    const session = await withTimeout(
      messagingClient.refreshSessionKey(),
      SDK_TIMEOUT_MS.refreshSession,
      'refreshSessionKey',
    );
    cachedSession = session;
    pendingSession = null;
    return session;
  })();
  return pendingSession;
}

// ─── helpers ─────────────────────────────────────────────────────────

function uint8ToBase64(arr) {
  if (typeof Buffer !== 'undefined') return Buffer.from(arr).toString('base64');
  let s = '';
  for (let i = 0; i < arr.byteLength; i++) s += String.fromCharCode(arr[i]);
  return btoa(s);
}

/** Reset cached state — used when the wallet disconnects. */
export function resetMessagingState() {
  cachedBundle = null;
  cachedSession = null;
  pendingSession = null;
}
