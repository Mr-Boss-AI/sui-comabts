# SUI Combats — Tavern Social Hub Design (Bucket 3)

> Architecture, schema, and message flows for the Bucket 3 Tavern
> rebuild. Shipped 2026-05-06 on branch `feature/v5-redeploy`. Five
> new test gauntlets land 238 assertions over the new surfaces.

The Tavern is the social spine of SUI Combats. Pre-Bucket-3 it was a
two-card layout with a flat global chat and a flat player list. The
rebuild turns it into a real player layer:

- **Player sidebar** grouped by level brackets (Novice / Early /
  Mid / High / Endgame / Hall of Fame) with search + status filter.
- **Player profile modal** showing equipped gear (10-slot doll),
  stats, W/L, level, ELO, truncated wallet, plus three actions:
  Send Message · Wager Challenge · Friendly Fight.
- **Encrypted DMs** via the Sui Stack Messaging SDK (alpha) — each
  message is a wallet-signed on-chain transaction with the cipher
  text stored on Walrus.
- **Direct fight requests** with a state machine, 90 s TTL, inline
  toast notifications for accept/decline.
- **Persistent presence** in Supabase keyed off heartbeats so a
  player who reconnects from a different tab doesn't drop off the
  sidebar.

---

## Architecture

```
┌─────────────────────────── Frontend ────────────────────────────┐
│  TavernRoom                                                     │
│  ├── ChatPanel (global, WS)                                     │
│  └── PlayerSidebar (grouped by level)                           │
│        └─ click → PlayerProfileModal                            │
│              ├─ Send DM   → DmPanel (Sui Stack Messaging SDK)   │
│              ├─ Wager     → SET_PREFILLED_WAGER_TARGET → Arena  │
│              └─ Friendly  → send_fight_request                  │
│  + global mounts (any room):                                    │
│  ├── FightRequestToasts (top-right stack, 90s countdown)        │
│  ├── PlayerProfileModal (single instance)                       │
│  └── DmPanel (single instance, slides up bottom-right)          │
└─────────────────────────────────────────────────────────────────┘
                           │ WebSocket
                           ▼
┌─────────────────────────── Server ──────────────────────────────┐
│  ws/handler.ts                                                  │
│  ├── Auth gate                                                  │
│  ├── Existing flows (chat, queue, fight, marketplace, ...)      │
│  └── dispatchTavernMessage(...)  → ws/tavern-handlers.ts        │
│        ├─ presence service       → data/presence.ts             │
│        ├─ fight-request service  → data/fight-requests.ts       │
│        ├─ DM channel registry    → data/dm-channels.ts          │
│        └─ player profile resolver → data/player-profile.ts      │
└─────────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────── Supabase ────────────────────────────┐
│  presence            (heartbeat-driven; sweep stale on tick)    │
│  fight_requests      (state machine; 90s TTL)                   │
│  dm_channels         (Sui Messaging channel id ↔ wallet pair)   │
│  dm_channel_unread   (per-recipient unread counter)             │
│  friends             (mutual; A→B + B→A; status enum)           │
└─────────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌──────────── Sui chain (testnet) — Sui Stack Messaging ──────────┐
│  Channel objects (one per pair) — encrypted member caps         │
│  Walrus — encrypted message ciphertext                          │
│  Seal — threshold encryption key servers                        │
└─────────────────────────────────────────────────────────────────┘
```

---

## Schema (Supabase migration `003_tavern.sql`)

### `presence`

One row per online wallet. Updated by every heartbeat (~20 s cadence).
Boot-time + tick-time sweepers drop rows older than `PRESENCE_STALE_MS`
(60 s).

| Column           | Type        | Notes                                       |
|------------------|-------------|---------------------------------------------|
| `wallet_address` | text PK     |                                             |
| `character_name` | text        | Denormalised for the player-list query.     |
| `level`          | smallint    |                                             |
| `rating`         | integer     |                                             |
| `current_room`   | text        | tavern / character / arena / marketplace / hall_of_fame / fight |
| `status`         | text        | online / in_fight / in_marketplace / idle (derived from room + activity) |
| `fight_id`       | text        | Set while `status = 'in_fight'`.            |
| `last_seen_at`   | timestamptz | Auto-bumped via trigger on any UPDATE.      |
| `created_at`     | timestamptz |                                             |

Indexes: `last_seen_at`, `current_room`, `level`. RLS: server-only.

### `fight_requests`

Player-to-player challenges. Distinct from the wager lobby
(anonymous open offers) and from the legacy `challenge_player`
in-memory flow (kept for back-compat).

| Column        | Type          | Notes                                  |
|---------------|---------------|----------------------------------------|
| `id`          | text PK       | uuid                                   |
| `request_type`| text          | friendly / wager                       |
| `from_wallet` | text          |                                        |
| `from_name`   | text          |                                        |
| `to_wallet`   | text          |                                        |
| `to_name`     | text          |                                        |
| `stake_mist`  | text (BigInt) | Wager variant only                     |
| `status`      | text          | pending / accepted / declined / canceled / expired |
| `message`     | text          | Capped at 280 chars                    |
| `expires_at`  | timestamptz   | now + 90 s                             |
| `resolved_at` | timestamptz   | Set on any non-pending transition      |
| `created_at`  | timestamptz   |                                        |

Indexes: `(to_wallet, status)`, `(from_wallet, status)`,
`expires_at WHERE status = 'pending'`.

State machine:

```
                ┌──────────┐
                │ pending  │
                └────┬─────┘
            ┌───────┼────────┬──────────┐
            ▼       ▼        ▼          ▼
       accepted declined canceled  expired
            │       │        │          │
            └───────┴────────┴──────────┴── resolved_at stamped
```

### `dm_channels`

Maps a Sui Stack Messaging channel id to the unordered wallet pair
`{participant_a, participant_b}`. `participant_a` is always the
lex-smaller lowercase address — a CHECK enforces canonical ordering
so misordered inserts surface immediately.

| Column             | Type        | Notes                                |
|--------------------|-------------|--------------------------------------|
| `channel_id`       | text PK     | Sui shared object id (0x…)          |
| `participant_a`    | text        | LOWER(LEAST(a, b))                   |
| `participant_b`    | text        | LOWER(GREATEST(a, b))                |
| `member_cap_a`     | text        | A's MemberCap object id (cached)    |
| `member_cap_b`     | text        | B's MemberCap object id (cached)    |
| `encrypted_key_b64`| text        | Base64 EncryptedSymmetricKey bytes  |
| `created_by`       | text        | The wallet that initiated the DM    |
| `created_at`       | timestamptz |                                      |
| `last_message_at`  | timestamptz | Bumped by `notify_dm_sent`          |

CHECK constraint: `participant_a < participant_b`.

### `dm_channel_unread`

Per-recipient unread counter. Bumped by the sender's
`notify_dm_sent`, reset to 0 by the recipient's `clear_dm_unread`.

| Column        | Type         | Notes                            |
|---------------|--------------|----------------------------------|
| `channel_id`  | text FK      | dm_channels(channel_id) cascade  |
| `recipient`   | text         | One row per (channel, recipient) |
| `unread_count`| integer      |                                   |
| `updated_at`  | timestamptz  |                                   |

PK: `(channel_id, recipient)`. Partial index on
`recipient WHERE unread_count > 0`.

### `friends`

Mutual friendship via two rows: A→B and B→A. Initial request inserts
one row with status='requested'. Acceptance inserts the mirror row
with status='accepted' and updates the original to 'accepted'.
Block is unilateral.

| Column     | Type        | Notes                       |
|------------|-------------|-----------------------------|
| `owner`    | text PK     |                              |
| `friend`   | text PK     |                              |
| `status`   | text        | requested / accepted / blocked |
| `created_at` | timestamptz |                            |
| `updated_at` | timestamptz | Auto-bumped via trigger    |

CHECK: `owner <> friend`. Indexes: `(owner, status)`,
`(friend, status)`.

---

## Server services

### `data/presence.ts`

In-memory `Map<wallet, PresenceRow>` is the canonical view. Every
state change fires a fire-and-forget Supabase upsert (throttled to
once per 5 s per wallet). Heartbeat at 20 s cadence; stale window
60 s.

Pure helpers (testable without DB):

- `derivePlayerStatus(room, fightId, lastSeen, now)` — status logic
- `groupPlayersByLevelBucket(players)` — bucketing
- `bucketKeyForLevel(level)` — bracket lookup

Stateful API:

- `upsertPresence({...})` — returns
  `{ row, inserted, statusChanged, roomChanged, dataChanged }`
- `heartbeat(wallet)` — refreshes `lastSeenAt`, no state change
- `removePresence(wallet)` — drops + persists delete
- `getOnlinePlayers()` / `getOnlinePlayersBucketed()`
- `sweepStalePresence(now)` — TTL eviction
- `flushPresenceToSupabase(wallet, force?)` — durable sync
- `sweepStalePresenceInDb()` — boot-time cleanup

> 2026-05-08 hotfix #7 — `upsertPresence`'s identity-fields fallback
> chain runs `input → character (canonical store) → existing →
> truncated-wallet stub`. Putting the canonical character store
> AHEAD of the existing presence row means a row that was first
> upserted with stub fallback values (because an `enter_room` raced
> ahead of `handleRestoreCharacter`) gets corrected on the next
> upsert. `dataChanged` lets every entry-point caller emit a
> `player_joined` re-broadcast (the frontend's `ADD_ONLINE_PLAYER`
> reducer replaces by wallet) so peers holding stub copies pick up
> the corrected identity without waiting for a full
> `get_online_players` snapshot.

The broadcast wire choice lives in
`ws/tavern-handlers.ts::broadcastPresenceUpdate`:

| Trigger                            | Wire emission                          |
|------------------------------------|----------------------------------------|
| `inserted` OR `dataChanged`        | `player_joined` (full row payload)     |
| `statusChanged` OR `roomChanged`   | `player_status_changed` (light payload)|
| neither                            | silent                                 |

`handleRestoreCharacter` calls `announcePlayerOnline` after both the
cached-existing and fresh-restore paths. The cached path is
idempotent (already-correct rows produce no broadcast); the
fresh-restore path is the safety net for the bootstrap race where
auth ran before the in-memory character record existed.

### `data/fight-requests.ts`

In-memory `Map<id, FightRequest>` + per-wallet target/sender indexes.
Persisted to Supabase. Boot-time `rehydratePendingFromDb()` restores
live requests; expired ones are flipped to `'expired'` in DB.

Pure decision helpers:

- `evaluateCreate(input, ctx)` — input validation + per-sender
  throttle (max 5) + duplicate-pair detection
- `evaluateTransition(req, action, actor, now)` — state-machine
  transition with actor authorisation

Stateful API:

- `createRequest(input)` — returns `{ request? error? }`
- `transitionRequest(id, action, actor, now)` — accept / decline /
  cancel / expire
- `getPendingForTarget(wallet)` / `getPendingFromSender(wallet)`
- `sweepExpired(callback)` — TTL eviction; tick every 10 s

### `data/dm-channels.ts`

Maps Sui Messaging channel ids to canonical wallet pairs. The
encrypted message bodies live on chain (channel object) + Walrus
(attachments) — this table only knows the channel exists.

Pure helpers:

- `canonicalPair(a, b)` — unordered → canonical
- `isCanonicalPair(a, b)` — predicate

API:

- `registerChannel({ channelId, walletA, walletB, ... })` — insert + dedupe
- `getChannelById(id)` / `getChannelForPair(a, b)` — bi-directional lookup
- `listChannelsForWallet(wallet)` — sorted by `lastMessageAt` desc
- `bumpUnread(channelId, recipient)` / `clearUnread` / `getUnread`
- `getTotalUnreadForWallet(wallet)`

### `data/player-profile.ts`

Resolves the full character + DOF-equipment for "view another
player". Hot path is in-memory; Supabase fallback for offline
players; chain DOF refresh keeps equipment fresh.

API:

- `getPlayerProfile(wallet, { refreshChain? })` — returns `PlayerProfileWire | null`
- `characterToProfileWire(character, fresh)` — pure shape converter

---

## WebSocket protocol

### Client → Server (Bucket 3 additions)

| Type                          | Body                                          | Effect |
|-------------------------------|-----------------------------------------------|--------|
| `enter_room`                  | `{ room: TavernRoom }`                        | Updates presence room; broadcasts status change. |
| `presence_heartbeat`          | `{}`                                          | Refreshes `last_seen_at`; no broadcast unless status changed. |
| `get_player_profile`          | `{ walletAddress: string }`                   | Triggers async `player_profile` reply. |
| `send_fight_request`          | `{ toWallet, requestType, stakeMist?, message? }` | Creates a fight request; pushes to target. |
| `accept_fight_request`        | `{ requestId }`                               | Transition → accepted; both sides notified. Friendly variant kicks off `createFight`. Wager variant pushes `wager_challenge_ready` to challenger. |
| `decline_fight_request`       | `{ requestId }`                               | Transition → declined. |
| `cancel_fight_request`        | `{ requestId }`                               | Transition → canceled (sender only). |
| `get_pending_fight_requests`  | `{}`                                          | Bootstrap reply with `incoming` + `outgoing`. |
| `register_dm_channel`         | `{ channelId, walletA, walletB, memberCapA?, memberCapB?, encryptedKeyB64? }` | Inserts / dedupes channel; pushes peer notification. |
| `notify_dm_sent`              | `{ channelId, recipient }`                    | Bumps recipient's unread counter; pushes `dm_unread_changed`. |
| `clear_dm_unread`             | `{ channelId }`                               | Resets caller's unread to 0. |
| `get_dm_channels`             | `{}`                                          | Bootstrap reply with `dm_channels_list`. |
| `lookup_dm_channel`           | `{ peerWallet }`                              | Targeted lookup for a wallet pair. |

### Server → Client (Bucket 3 additions)

| Type                          | Body                                          |
|-------------------------------|-----------------------------------------------|
| `room_entered`                | `{ room }` — ack                              |
| `player_profile`              | `{ profile: PlayerProfileWire }`              |
| `player_profile_not_found`    | `{ walletAddress }`                           |
| `fight_request_sent`          | `{ request: FightRequestWire }` — sender echo |
| `fight_request_received`      | `{ request: FightRequestWire }` — target push |
| `fight_request_resolved`      | `{ request: FightRequestWire, action }`        |
| `fight_request_pending_list`  | `{ incoming, outgoing }`                       |
| `wager_challenge_ready`       | `{ request: { id, toWallet, toName, stakeMist } }` — challenger trigger |
| `wager_challenge_waiting`     | `{ request: { id, fromWallet, fromName, stakeMist } }` — target hint |
| `dm_channel_registered`       | `{ channel: DmChannelWire }`                   |
| `dm_channel_lookup`           | `{ peerWallet, channel: DmChannelWire \| null }` |
| `dm_unread_changed`           | `{ channelId, unreadCount, totalUnread, lastMessageAt }` |
| `dm_channels_list`            | `{ channels, totalUnread }`                    |

Existing `online_players`, `player_joined`, `player_left`, and
`player_status_changed` survive — the player-list slice still uses
them — but they now carry `currentRoom` so the sidebar can render
the activity badge.

---

## Sui Stack Messaging SDK integration

The SDK (`@mysten/messaging@0.3.0`) ships in alpha and is testnet only.
Each message is an on-chain signed transaction with the encrypted
body stored on Walrus and decryption keys held by Seal threshold
key servers.

### Version matrix

The Sui Stack Messaging SDK is alpha — minor releases redo the
extension chain shape. Pinning the trio together is mandatory.
Messaging 0.3.0's `CHANGELOG.md` declares the dependency
versions it was built against:

| Dependency       | Pinned version | Why                                                      | Top-level alias       |
|------------------|----------------|----------------------------------------------------------|-----------------------|
| `@mysten/sui`    | `1.45.2`       | `SuiClient({ url })` + `$extend` — class renamed in 2.x  | `mysten-sui-v1`       |
| `@mysten/seal`   | `0.9.6`        | `SealClient.asClientExtension()` — static removed in 1.x | `mysten-seal-v0`      |
| `@mysten/walrus` | `0.8.6`        | Storage adapter shape; configured inline (not extended)  | `@mysten/walrus`      |
| `@mysten/messaging` | `0.3.0`     | The SDK itself                                           | `@mysten/messaging`   |

The aliases are installed via `npm install --legacy-peer-deps`:

```
mysten-sui-v1@npm:@mysten/sui@^1.45.2
mysten-seal-v0@npm:@mysten/seal@^0.9.6
```

`lib/messaging.ts` imports from the aliases; the rest of the app
continues to use top-level `@mysten/sui@^2.15.0` (required by
`@mysten/dapp-kit-react`) and `@mysten/seal@^1.1.1` (kept as a
peer of dapp-kit, never used directly). Both major versions of
each package live in `node_modules` side-by-side without
conflict.

### Why we pin a separate seal version

> The original Bucket 3 hotfix (2026-05-06): the DM panel crashed
> at first send with `SealClient.asClientExtension is not a
> function`. Top-level seal 1.1.1 deprecated the static method;
> messaging 0.3.0's `messaging()` factory still expects
> `client.seal` to be registered with the 0.9.x extension shape.
> Aligning seal back to 0.9.6 (under an alias) is the permanent
> solve, because the messaging SDK reads `client.seal` at
> register-time and breaks if the seal extension API drifts.

### Upgrade procedure

When the messaging SDK ships a new minor version:

1. Read `node_modules/@mysten/messaging/CHANGELOG.md` for the
   declared dep versions.
2. Re-pin the aliases to the matching seal + sui versions.
3. Run `cd server && npx tsx ../scripts/qa-messaging-client.ts`
   — this gauntlet asserts every method the wrapper depends on
   still exists. It fails loudly if the SDK shape changed.
4. If the gauntlet fails, the wrapper (`lib/messaging.ts` → the
   `buildExtendedClient` chain) needs an update to match the
   new SDK pattern. Update the wrapper, re-run the gauntlet.
5. Two-wallet live walkthrough: open DM panel → first message
   triggers `executeCreateChannelTransaction` (1 wallet popup) →
   subsequent messages trigger `executeSendMessageTransaction`
   (1 popup each). Recipient sees `dm_unread_changed` push and
   the message appears via `getChannelMessages` poll.

### MVR (Move Version Resolution) wiring

The SDK's contract bindings reference the package via the named
placeholder `@local-pkg/sui-stack-messaging`. At tx-build time
the SDK passes that name to `tx.moveCall({ package: '...' })`,
expecting the SuiClient's MVR layer to substitute the real
package id. Without correct wiring, the substitution fails with
`Failed to resolve package: @local-pkg/sui-stack-messaging`.

**The override has to live on TWO clients.** This was the
non-obvious bit — the messaging SDK's tx is built against our
aliased sui 1.x SuiClient, but the SIGN path goes through dapp-
kit's `CurrentAccountSigner`, which routes serialization through
dapp-kit's OWN `SuiGrpcClient` (top-level sui 2.x). If only one
of the two has the override, the failure surfaces in the other:

| Client | Built in | Override needed | Why |
|--------|----------|-----------------|-----|
| Messaging SDK SuiClient (sui 1.x) | `lib/messaging.ts::buildExtendedClient` | Yes | Tx BUILD-time substitution inside the SDK's contract bindings (`tx.moveCall({ package: '@local-pkg/...' })`). |
| dapp-kit `SuiGrpcClient` (sui 2.x) | `config/dapp-kit.ts::createClient` | Yes | Tx SERIALIZATION-time substitution inside `signAndExecuteTransaction`'s `resolveTransactionPlugin` chain. |

The qa gauntlet asserts both files contain the same package id —
diverging values would re-introduce the bug.

The wrapper configures three things to make the resolution work:

```ts
new SuiClient({
  url: SUI_TESTNET_FULLNODE,
  // Required: SDK reads this to pick TESTNET_MESSAGING_PACKAGE_CONFIG
  // and to derive the default MVR URL.
  network: 'testnet',
  // Pre-map the named placeholder to the testnet package id so the
  // SDK substitutes locally without a network call to
  // testnet.mvr.mystenlabs.com.
  mvr: {
    overrides: {
      packages: {
        '@local-pkg/sui-stack-messaging':
          '0x984960ebddd75c15c6d38355ac462621db0ffc7d6647214c802cd3b685e1af3d',
      },
    },
  },
});
```

And on the messaging extension itself:

```ts
messaging({
  // Explicit packageConfig — even though messaging's testnet
  // default is the same id, pinning it here makes the wiring
  // auditable in one place.
  packageConfig: {
    packageId: '0x984960ebddd75c15c6d38355ac462621db0ffc7d6647214c802cd3b685e1af3d',
  },
  walrusStorageConfig: {...},
  sessionKeyConfig: {...},
});
```

The package id is sourced from the SDK's own
`FALLBACK_PACKAGE_ID` constant in
`@mysten/messaging/dist/cjs/constants.js`. The qa gauntlet
cross-references this against the wrapper's override, so a
future SDK package bump fails loudly at build time with a
diff between `TESTNET_MESSAGING_PACKAGE_CONFIG.packageId`
(SDK's view) and the override we set.

### Wrapper failure mode

`ensureClient()` calls `checkMessagingClientShape()` immediately
after building the client. If any expected slot or method is
missing, it throws a structured error pointing at this file's
upgrade procedure — the user-visible error is actionable instead
of an opaque "X is not a function" deep inside the SDK.

### DM stall and recipient surface (Bug 1 + 2 fix, 2026-05-06)

Two-wallet live walkthrough on 2026-05-06 surfaced two distinct
failures the static gauntlet didn't catch.

**Bug 1 — sender stalls on "Signing…".** Mr_Boss approved the
Slush popup, three objects landed on chain (channel + member
caps), but the SDK's promise never settled. The DM panel's
`handleSend` was blocked on an `await` that neither resolved nor
rejected — the catch + finally couldn't run, so `setSending(false)`
never fired. The wallet popup completed; the JS layer hung.
Most likely culprits: Walrus upload polling, Seal session
warmup, or `getUserMemberCap` indexing — all of which the SDK
performs internally before popping the second wallet for
`send_message`.

Fix: every SDK call is wrapped in
`lib/messaging.ts::withTimeout(promise, ms, label)`. Per-call
budgets in `SDK_TIMEOUT_MS`:

| Method | Budget | Why |
|---|---|---|
| `executeCreateChannelTransaction` | 60 s | Chain finality + cap indexing |
| `executeSendMessageTransaction` | 60 s | Walrus upload + chain finality |
| `getChannelMessages` | 30 s | Decryption pass on N messages |
| `getUserMemberCap` | 15 s | Read-only RPC |
| `refreshSessionKey` | 30 s | Seal threshold key fetch |

On timeout the helper rejects with `<label> timed out after Ns`,
the panel's catch fires, the optimistic bubble flips to red
("failed"), and an error toast surfaces. The user can retry
without a page reload. Source-level audit in
`qa-messaging-client.ts §11` asserts every SDK call site is
wrapped — so a future contributor adding a new SDK method has
to wrap it or the gauntlet fails.

**Bug 2 — recipient sees nothing.** Sx (the second wallet) got
no toast, no unread pip, no auto-fetch. The server fired the
right WS messages (`dm_channel_registered`, `dm_unread_changed`)
once Bug 1 was fixed, but the frontend silently absorbed both:
it bumped a state slice and played a chat sound without
rendering anything visible.

Three layered fixes:

1. **Server attribution.** `handleNotifyDmSent` now adds
   `senderWallet` (lowercased) to the `dm_unread_changed`
   payload. The clear-path ack still omits it (no attribution
   applies). `qa-tavern-handlers.ts §7b` pins the ordering
   guarantee — `dm_channel_registered` lands before
   `dm_unread_changed` so `state.dmChannels` is populated by
   the time the toast wants to render.
2. **Toast surface.** New `<DmToasts />` global mount, stacked
   top-right beneath fight-request toasts (z-40 vs z-50 — fight
   challenges have a 90 s decision window so they win
   attention). Toasts coalesce by channelId, FIFO-cap at 4,
   auto-fade in 8 s, dismiss on `OPEN_DM` for the matching peer.
3. **Sidebar pip.** `PlayerSidebar` rows now render a cyan
   unread-count badge (`min-w-[18px]`, `99+` if huge) when the
   peer has DMs the user hasn't read. Computed from
   `state.dmChannels` × `state.dmUnreadByChannel`. The row is
   tinted cyan and the name goes bold for accessibility.
4. **Live refresh in the open panel.** `DmPanel` watches
   `dmUnreadByChannel[openChannelId]` via a ref; when it
   changes, re-runs `getChannelMessages` to pull the new
   message into view, then immediately acks via
   `clear_dm_unread`. Pre-fix the panel only fetched on mount
   — peer messages arriving while the panel was open required
   a manual remount to surface.

The send path also calls `setRefreshKey(k+1)` after a successful
`sdkSendMessage` so the optimistic bubble's local clock-time is
replaced with the chain-truth message id + timestamp.

### Pipeline extraction (hotfix #5, 2026-05-06 retest)

After hotfix #4 landed, the live retest still reproduced both
bugs. The wrapper-only gauntlet (`qa-messaging-client §11`) proved
`withTimeout` rejects a hanging promise correctly when called
directly, but the gauntlet had never exercised the FULL handleSend
orchestration end to end. A bug at the layer above the wrapper
(forgotten await, swallowed rejection, the dynamic
`await import("@/lib/messaging")` for `resolveMemberCap`) could
hang without any unit test catching it.

Hotfix #5 closes the gap structurally:

1. **`frontend/src/lib/dm-send-pipeline.ts::runDmSend(deps, params)`.**
   The SDK + WS orchestration moves out of the React closure into
   a pure async function. Every side effect — `ensureChannel`,
   `resolveMemberCap`, `sendMessage`, `wsSend` — is injected via
   `deps`, so a test can swap any of them for a hanging mock and
   observe the failure shape directly.
2. **Master timeout race.** `runDmSend` wraps its inner
   implementation in `withTimeout(..., PIPELINE_BUDGETS.master,
   "runDmSend")` (default 90 s). If a future SDK call site is
   added without an inner wrapper, the master race still surfaces
   an actionable error within bounded time. Belt-and-braces.
3. **Static `resolveMemberCap` import.** Replaces the dynamic
   `await import("@/lib/messaging")` inside `handleSend` —
   removes one of the few unwrapped awaits and dodges a Next.js
   bundler edge case from the hot path.
4. **Manual Cancel hatch.** After 25 s of `sending=true`, the
   panel surfaces a Cancel button. Click flips the optimistic
   bubble to "failed", releases the Sending lock, lets the user
   retry. Underlying SDK promise may still resolve in the
   background — fine, the UI is reset and the next retry is
   self-consistent.
5. **Console breadcrumbs at every step.** Pipeline emits
   `console.log("[dm-send] <step> @ <iso>")` for every named
   step. A contributor watching the browser console during a
   stuck send pinpoints the in-flight step without re-running.
6. **Module-load version log.** `[dm-panel] pipeline v2 loaded`
   in the console once per session — a contributor reporting
   "the timeout fix isn't firing" can confirm whether the build
   actually reloaded (HMR cache miss = no log).
7. **PUSH_DM_TOAST guard moved into the reducer.** The
   `openDmPeer` check that decides whether to surface a toast
   used to live in `handleMessage`'s memoized closure (deps
   `[walletAddress, socket, client]`); opening a panel just
   before a message landed could still surface a redundant
   toast because the closure's `state.openDmPeer` was stale.
   The reducer always sees live state, so the check is now
   correct.

The new `qa-dm-send-pipeline.ts` gauntlet (65 PASS) covers:
happy path, existing channel, ensureChannel hangs, member-cap
unresolvable, sendMessage hangs, sendMessage rejects, monotonic
step trace, resolveMemberCap retry path. Each scenario asserts
not just success/failure but the WS-send side effects: the
recipient never sees a notify_dm_sent for a message that didn't
actually send (no bogus toast), the register_dm_channel always
fires before notify_dm_sent (state.dmChannels populated when the
toast wants to render).

---

## DM transport: plaintext (current) vs encrypted (future)

Hotfix #6 (2026-05-06): the Sui Stack Messaging SDK is alpha and
hangs in `executeCreateChannelTransaction`'s prep phase before the
wallet popup. The ad-hoc workarounds (timeouts, master timeout,
manual cancel — Hotfixes #4 and #5) made the failure recoverable but
didn't fix the root cause: the SDK isn't production-ready yet. We
swapped the DM transport for plain WebSocket + Supabase persistence
— the same shape global Tavern chat uses — and deferred the
encrypted SDK until it reaches beta.

### Feature flag

```
NEXT_PUBLIC_DM_TRANSPORT=plaintext    (default — what ships today)
NEXT_PUBLIC_DM_TRANSPORT=encrypted    (future re-enable, when SDK is stable)
```

`NEXT_PUBLIC_*` env vars are inlined at build time by Next.js, so
the unused branch's body tree-shakes out of the production bundle.
Source code stays in place ready to flip back.

### Plaintext data flow (current)

```
sender                                  server                                recipient
  │                                       │                                       │
  │── dm_send {clientId, peer, body} ───→ │                                       │
  │                                       │  ── sb insert dm_messages row ──     │
  │                                       │  ── dm_channels lazy upsert (sha256  │
  │                                       │     of canonical pair, fresh? push   │
  │                                       │     dm_channel_registered to both)   │
  │ ←── dm_message_sent {clientId, msg} ──│                                       │
  │ ←── dm_channel_registered ────────────│ ──→ dm_channel_registered ─────────→ │
  │                                       │ ──→ dm_message_received {msg} ─────→ │
  │                                       │ ──→ dm_unread_changed {sender} ────→ │
  │                                                                               │
  │                                       │                                       │
  │                                       │ ←── dm_history {peer, limit} ─────── │
  │                                       │  ── sb select recent N from          │
  │                                       │     dm_messages where channel_id=… ──│
  │                                       │ ──→ dm_history {channelId,           │
  │                                       │      messages, hasMore} ───────────→ │
```

### Synthetic channel id

Plaintext channels need a `channel_id` for the existing
`dm_channels` registry (the Tavern's per-pair metadata + unread
counters). We generate it deterministically:

```
synthetic_id = "0x" + sha256(canonical_pair_string).hex
             = "0x" + 64 hex chars (66 total — same shape as a
                                    real on-chain channel id)
```

Idempotent: the same wallet pair always hashes to the same id,
so two clients sending DMs to each other land on the same row
without coordinating. The synthetic id passes the registry's
`startsWith('0x') && length >= 42` validator unchanged. When the
encrypted SDK comes back online and gets its own real on-chain
channel ids, the two id spaces don't conflict (sha256 hashes vs.
Sui object ids).

### What changed in the panel

- No `CurrentAccountSigner`, no `ensureClient`, no SDK calls in
  the plaintext branch. Module-load log:
  `[dm-panel] transport=plaintext loaded (plaintext WS + Supabase)`.
- Send button shows `Send → Sending… → Send` (no "Signing…",
  no Cancel button — round-trip is single-digit ms, no escape
  hatch needed).
- Disclosure banner replaced with: "Private messages — visible
  only to you and the other player. Stored on the SUI Combats
  server (encrypted in transit; plaintext at rest). End-to-end
  encryption returns when the Sui Stack Messaging SDK reaches
  beta."
- Footer text: "Messages are server-relayed. Encrypted DMs return
  when the Sui Stack Messaging SDK reaches beta."

### Migration path back to encrypted

When `@mysten/messaging` reaches beta:

1. Re-run `qa-messaging-client.ts` — pins the SDK shape; will
   fail loud if the API drifted.
2. If green, set `NEXT_PUBLIC_DM_TRANSPORT=encrypted` and rebuild.
3. Run a two-wallet live walkthrough; the encrypted pipeline
   lights up exactly as it did before (Hotfix #5's `runDmSend`
   stays unchanged).

The plaintext-side data (`dm_messages` rows + synthetic-id channel
rows) remains in Supabase. They don't conflict with on-chain
channel ids because the synthetic ids are sha256 hashes —
collision space disjoint from Sui object id space (which is
derived from tx digests, not user-controlled strings).

### Test coverage for the plaintext path

- `qa-dm-messages.ts` (53 PASS) — data layer:
  `syntheticChannelIdForPair` determinism, `insertMessage`
  validation + happy path, `getHistory` ordering + limit,
  `getOrCreateSyntheticChannel` idempotency.
- `qa-dm-plaintext-pipeline.ts` (36 PASS) — pipeline layer:
  happy send + clientId match, server `error` rejects, server
  hangs → timeout + no late-arrival cross-talk, concurrent sends
  resolve to their own echoes, history happy + null-channel
  + unmatched-peer-ignored, wsSend throws → reject + cleanup.
- `qa-tavern-handlers.ts` extended (+32, total 72 PASS) — WS
  layer: dm_send happy path emits register + echo + push +
  unread to the right sockets in the right order, dm_send
  validation rejects empty / over-cap / self / missing-clientId,
  dm_history happy + empty + non-participant + auth-required.

### Wrapper API (`lib/messaging.ts`)

- `ensureClient(signer, address)` — lazy-builds the extended
  SuiClient (sui 1.x → seal → messaging) and caches per-address
- `ensureChannel(bundle, peer, existingChannelId?)` — looks up or
  creates the channel; returns `{ channelId, callerMemberCapId, encryptedKeyB64, fresh }`
- `resolveMemberCap(bundle, channelId, userAddress)` — async cap
  fetch (returns null if not yet indexed)
- `sendMessage(bundle, params)` — fires `executeSendMessageTransaction`
- `getMessages(bundle, params)` — paginated decryption
- `ensureSession(bundle)` — warms the Seal session key

### UX implications surfaced in the DM panel banner

> Encrypted DMs are powered by the Sui Stack Messaging SDK (alpha,
> testnet only). Each message is an on-chain signed transaction
> storing the encrypted body on Walrus. Expect a wallet popup per
> send. Mainnet support is gated on the SDK reaching beta.

Send flow:

```
draft → user clicks Send
        ↓
        ensureChannel(bundle, peer, channelId?)
          ├─ existing? resolve memberCap, skip create
          └─ new? executeCreateChannelTransaction (1 wallet popup)
                  ↓ register_dm_channel WS
        ↓
        executeSendMessageTransaction (1 wallet popup)
        ↓
        notify_dm_sent WS → recipient unread bumps
        ↓
        getMessages on next render
```

Channel creation is one popup; each send is one popup. We surface
this clearly so the user understands they're signing on-chain.

---

## Frontend components

| Component | File | Purpose |
|-----------|------|---------|
| `TavernRoom` | `components/social/tavern-room.tsx` | The Tavern area body — chat left, sidebar right |
| `PlayerSidebar` | `components/social/player-sidebar.tsx` | Bucketed player list with search + status filter |
| `PlayerProfileModal` | `components/social/player-profile-modal.tsx` | 10-slot doll, stats, W/L, three actions |
| `FightRequestToasts` | `components/social/fight-request-toasts.tsx` | Top-right stack of incoming challenges with 90 s countdown |
| `DmPanel` | `components/social/dm-panel.tsx` | Encrypted DM panel (slides from bottom-right) |
| `lib/messaging.ts` | `lib/messaging.ts` | SDK wrapper — `ensureClient`, `ensureChannel`, `sendMessage`, `getMessages` |
| `lib/player-bucket.ts` | `lib/player-bucket.ts` | Pure player grouping for the sidebar |

Global mounts (live in the main game view):

- `<FightRequestToasts />` — every screen
- `<PlayerProfileModal />` — every screen
- `<DmPanel />` — every screen

---

## Test gauntlets

Five new gauntlets, **238 assertions** total. Run from `server/`:

| Gauntlet | Coverage | Assertions |
|----------|----------|-----------:|
| `qa-tavern-presence.ts` | `derivePlayerStatus`, `bucketKeyForLevel`, `groupPlayersByLevelBucket`, `upsertPresence`, `heartbeat`, `sweepStalePresence`, `getOnlinePlayers`, `toWire`, `removePresence`, multi-bucket scenario | 66 |
| `qa-tavern-fight-requests.ts` | `evaluateCreate`, `evaluateTransition`, `createRequest`, `transitionRequest`, index correctness, `sweepExpired`, per-sender limit, stake/message bounds | 58 |
| `qa-tavern-dm-channels.ts` | `canonicalPair`, `isCanonicalPair`, `registerChannel`, `getChannelForPair`, `listChannelsForWallet`, `bumpUnread`/`clearUnread`/`getUnread`, `getTotalUnreadForWallet`, sort by `lastMessageAt`, **§7b recipient notification preconditions: fresh-channel bump=1, sender keeps 0, lastMessageAt advances, idempotent no-op clears, totalUnread sums across peers** | 51 |
| `qa-tavern-handlers.ts` | `dispatchTavernMessage`, `announcePlayerOnline`/`Offline`, `enter_room`, `presence_heartbeat`, `send_fight_request`, accept/decline, DM channel lifecycle, auth gate, `broadcastFightStatusChange`, unknown-type fallthrough, **§7b recipient notification ordering + senderWallet attribution** | 38 |
| `qa-tavern-sidebar.ts` | Bucket boundaries match server, search/status/exclude filters, in-bucket status priority sort, `hideEmpty`, defensive out-of-range | 42 |
| `qa-messaging-client.ts` | Pinned versions match messaging 0.3.0 CHANGELOG; `SealClient.asClientExtension` exists on aliased seal; SuiClient + `$extend` on aliased sui; `messaging()` factory + `SuiStackMessagingClient`; chain composes; every messaging method the wrapper calls (executeCreate/Send/getChannelMessages/getUserMemberCap/refreshSessionKey/getLatestMessages/createChannelFlow); `checkMessagingClientShape` reports correctly; `buildExtendedClient` round-trip; MVR wiring on the messaging SDK SuiClient; **dapp-kit `SuiGrpcClient` (sign path) also has the override + matching package id with `lib/messaging.ts`**; **§11 withTimeout regression guard: rejects within budget on stalled SDK promises, error message names labelled call, fast-resolve passes through, fast-reject's original error survives, every SDK call site is wrapped** | 65 |
| `qa-dm-send-pipeline.ts` (hotfix #5) | `runDmSend` integration: happy path emits register+notify in correct order with all required fields; existing channel skips ensureChannel + register; ensureChannel hangs → master timeout fires; unresolvable member cap → actionable error + register fired but send NOT reached; sendMessage hangs → master timeout fires AND notify NOT emitted (no bogus recipient toast); sendMessage rejects → original error preserved; step trace monotonic + complete; resolveMemberCap retry path | 65 |
| `qa-dm-plaintext-pipeline.ts` (NEW hotfix #6) | `runPlaintextDmSend` + `runPlaintextDmHistory` integration: happy send + clientId echo match; server `error` rejects; server hangs → timeout + no late-arrival cross-talk; concurrent sends resolve to their own echoes; history happy + null-channel + unmatched-peer-ignored; wsSend throws → pipeline rejects + cleans up subscriber | 36 |
| `qa-dm-messages.ts` (NEW hotfix #6) | data-layer: `syntheticChannelIdForPair` determinism + canonical-pair sanity; `insertMessage` validation (empty / over-cap / self-send / bad channel) + happy with body trim + lowercased participants; `getHistory` chronological + limit + unknown channel; `getOrCreateSyntheticChannel` idempotency + canonical-pair-equivalence; end-to-end insert→history ordering | 53 |

Test totals (project-wide): **20 → 29 static gauntlets** ·
**1195 → 1703 assertions PASS** (last delta: +121 from
hotfix #6 — plaintext WS transport + Supabase persistence + the
two new gauntlets above + dm_send/dm_history coverage in
`qa-tavern-handlers.ts`).

---

## Things explicitly out of scope (Bucket 4+)

- Friend system UI — schema is in place but no add/remove/list flow
  on the frontend yet.
- DM file attachments via Walrus — SDK supports it, our wrapper
  doesn't expose it yet.
- Rich-presence ("playing X build at Y level") — the `currentRoom`
  badge is the v1 surface.
- Moderation tools (mute, block, report) — no UI surface.
- Ranked-only tournament chat / clan chat — would need a multi-channel
  scaling pass.
- Mobile-responsive sidebar — desktop-first today (matches the rest
  of the app).

---

## Reference

- `server/src/data/migrations/003_tavern.sql` — schema source of truth
- `server/src/data/presence.ts` — presence service
- `server/src/data/fight-requests.ts` — fight-request state machine
- `server/src/data/dm-channels.ts` — DM channel registry
- `server/src/data/player-profile.ts` — profile resolver
- `server/src/ws/tavern-handlers.ts` — WS dispatch
- `frontend/src/lib/messaging.ts` — SDK wrapper
- `frontend/src/lib/player-bucket.ts` — sidebar bucketing helper
- `frontend/src/components/social/*` — Tavern UI
- `scripts/qa-tavern-*.ts` — gauntlets
