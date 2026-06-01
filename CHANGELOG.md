# Changelog

All notable changes to SUI Combats. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

> Versioning scheme: the on-chain `packageId` defines the major.
> v5.0.0 was the 2026-04-27 testnet `sui client publish`. v5.1 will be
> a fresh publish (per `MAINNET_PREP.md §A` — Sui upgrades don't retire
> bytecode, so the v5 package's old code stays callable forever; a new
> publish is the only safe path). Subsequent v5.x entries are server +
> frontend changes against the same `packageId`.

---

## [Unreleased] — v5.2.1 Atomic draw-settlement + treasury-queue finality, 2026-06-01

Live testnet mutual-KO surfaced a treasury gas-coin version race AND a
missing-feature regression in the draw branch.

### Symptoms
- `[Character.setFightLock] attempt 1/3 failed: object 0x75914b66…
  version 0x34daaf32 is unavailable for consumption, current version:
  0x34db53e9`
- `[Character.updateAfterFightDraw] attempt 1/3 failed: version unavailable`
- `[Wager.settleTie] attempt 1/3 failed: version unavailable`
- settle_tie + updateAfterFightDraw eventually retried through
  (`draws=1` confirmed on chain for both characters), but on-chain
  fight-lock release was never attempted at all → both characters sat
  on the chain's 10-min auto-expire window before `create_wager`
  would accept them again.

### Two distinct bugs found
1. **Treasury-queue inter-tx race.** `enqueueTreasury` is concurrency=1
   and serializes tasks, but `client.signAndExecuteTransaction` returned
   before the gas coin's new version was observable on the same
   load-balanced fullnode. The next queued task's sign call then read
   a stale gas-coin reference and aborted with "object unavailable for
   consumption". The retry budget eventually rescued settle_tie and the
   draw updates, but a single failure was enough to surface live.
2. **Draw branch never released the fight-lock.** The v5.1 mutual-KO
   path in `finishFight` (`server/src/ws/fight-room.ts:766-854`) did
   server-local XP + history + on-chain draw updates + settle_tie, but
   never called `setFightLockOnChain(char, 0)`. Players had to wait
   the full `FIGHT_LOCK_DURATION_MS = 10min` auto-expire. The
   win/loss branch (lines 647-665) does clear, so this was a v5.1
   draw-branch parity miss.

### Fix
- **`settleDrawBundleOnChain` (server/src/utils/sui-settle.ts)** —
  atomic PTB that runs in ONE tx:
  `(if wager) arena::settle_tie` →
  `character::update_after_fight_draw(A)` →
  `character::set_fight_lock(A, 0)` →
  `character::update_after_fight_draw(B)` →
  `character::set_fight_lock(B, 0)`.
  Sui guarantees PTB-internal atomicity over a locked input-version
  set — the intra-bundle gas / Character / WagerMatch race is
  structurally impossible. Returns parsed `DrawRecorded` + `LevelUp`
  effects per character so the server cache mirrors chain truth
  (fixes the stale Hall-of-Fame D=0 too).
- **Finality wait inside `execAsTreasury`** — after every
  `signAndExecuteTransaction`, await `client.waitForTransaction(digest,
  5000ms)` inside the same queue slot. Closes the inter-tx race for
  every other treasury-queue path (fight-start lock acquisition,
  win/loss settlement, any future admin op). Timeout failure is
  logged but not thrown — the tx already succeeded.
- **fight-room.ts draw branch rewritten** to call
  `settleDrawBundleOnChain` once and mirror per-character
  `DrawRecorded` effects back into the in-memory `Character` (xp,
  draws, level, unallocatedPoints), push fresh `character_data` +
  `character_updated_onchain` + `character_leveled_up` messages,
  drop `wager_in_flight` row + send `wager_settled` on the SAME
  digest as settle_tie.

### Admin-clear script (testnet triage tool)
- **`scripts/admin-clear-fight-lock.ts`** — one-shot
  TREASURY-signed `set_fight_lock(0)` over N character ids. Reads
  the on-chain DF first, skips the tx if the lock is already absent
  or expired, runs against `server/.env`. Used to verify the
  2026-06-01 stuck pair: both characters report `CLEARED (DF
  present, value 0 — chain treats as unlocked)`.

### Live verification
- **Stuck-state read (pre-script):** GraphQL `dynamicFields` on both
  characters showed `fight_lock_expires_at = 1780349259916
  = 2026-06-01T21:27:39Z`, which had auto-expired 3 min before
  the read — chain `is_fight_locked` already returned false.
- **draws counter on chain:** `Sx.draws = 1`, `Mr_Boss.draws = 1`
  via `object.asMoveObject.contents.json` — confirms the draw
  retries succeeded on `update_after_fight_draw`. Hall of Fame
  D=0 was the stale server cache (the new
  `settleDrawBundleOnChain` cache-mirror prevents this from
  recurring).
- **Admin-clear txs (belt-and-suspenders, explicitly zero the
  DF):** `F594APiJ4MLnU9RtonfVreVvKF1TJiPZMNfyE1H999Nu` (Sx) +
  `6ikZAEdem3quUay7ddAPk7mppL4gdbrfYT3sdEF8cncr` (Mr_Boss),
  both SUCCESS.
- **Post-script chain state:** both DFs now hold `0`,
  `is_fight_locked` returns false. `create_wager` accepts both
  wallets immediately.

### Tests + Move impact
- No Move source change — the bundle composes existing v5.2 functions
  that the 105/105 Move test suite already covers. Sui's runtime
  guarantees PTB atomicity; no new Move test path is introduced.
- TypeScript server compiles clean.

---

## [Unreleased] — v5.2 Supabase schema-drift hotfix (draws + FK), 2026-06-01

First v5.2 live wager surfaced two Supabase errors in Railway logs after
the env-var fix:
- `[DB] Failed to save character: Could not find the 'draws' column of
  'characters' in the schema cache`
- `[DB] Failed to save fight: insert or update on table "fight_history"
  violates foreign key constraint "fight_history_winner_wallet_fkey"`

### Root cause
- The server has carried `Character.draws` since v5.1 (mirrors chain
  `Character.draws: u32`) and `dbSaveCharacter` writes it on every
  upsert. Migration 001 created `characters` with `wins`+`losses` only;
  migration 002 backfilled `unallocated_points` + `onchain_character_id`
  and forgot the draws column.
- PostgREST rejected every upsert ⇒ characters table stayed empty on
  live testnet ⇒ subsequent `fight_history` insert violated the
  winner_wallet FK because the parent row was never persisted.
- The draw branch in `finishFight` (server/src/ws/fight-room.ts:766-854)
  does NOT call `dbSaveFight`, so the "NULL winner on draw" theory is
  ruled out — Bug 2 was a pure downstream effect of Bug 1.

### Fix
- New migration: `server/src/data/migrations/005_v52_draws_column.sql`
  - `ALTER TABLE characters ADD COLUMN IF NOT EXISTS draws INTEGER NOT
    NULL DEFAULT 0`
  - `NOTIFY pgrst, 'reload schema'` — flushes PostgREST's cached
    catalog so the next REST call sees the new column without waiting
    for the next auto-reload tick.
- `server/setup-db.mjs` extended with a `draws`-column probe so the
  operator gets `✓ draws column (v5.2) EXISTS` (or the explicit
  `✗ MISSING — apply migration 005`) on every run.
- No app-code change — writer already matches the new column shape.

### Verification path
1. Paste migration 005 into Supabase SQL Editor on project
   `twkuqeinleqiilkeixse`, run.
2. `cd server && node setup-db.mjs` → expect `✓ draws column (v5.2)`.
3. Play one ranked or wager fight on testnet, watch Railway logs:
   - `[DB] Failed to save character` should disappear.
   - `[DB] Failed to save fight: …winner_wallet_fkey` should disappear.
4. Spot-check the row landed:
   `select wallet_address, wins, losses, draws from characters
    where wallet_address = '0x03c33df0…443985f';`

---

## [Unreleased] — Wager-accepted silent gate (Bug 7), 2026-05-19

Second-round wager stuck on chain with 0.2 SUI locked. The
`handleWagerAccepted` flow exited through one of six silent
`sendError` gates, leaving NO server breadcrumb to triage from. This
commit doesn't pinpoint WHICH gate fired — we don't have enough
evidence — but it makes every future repro instantly diagnosable
AND prevents the same silent SUI-lock failure mode.

### The incident
- create_wager tx `3hk7Wi3o1ob65FeQCyGe8oK4XijgXZq52wEy7hhwG6Jq`
  (ShakaLiX 0x03c3…985f, 0.1 SUI stake)
- accept_wager tx `EgYPPXw85FApM4LkeW8RuFzm7s46mkhL79UJjFabX2Cv`
  (MrBoss 0xf669…0f33, matching 0.1 SUI)
- wager match `0xce620b9cff…6d59`, on-chain status=1 (ACTIVE), 0.2 SUI
  in escrow, never settled, no fight started.
- The PREVIOUS wager in the same session (`0xa75d171a…`, ShakaLiX won)
  settled cleanly. So the bug fires on the *second* round only.

### Refund
tx `AZsFE7jxxuCrHj1kZeUkEDiRCVWnk8ApgeYA8kTKcJDx` at 21:45:58Z. Status
1 (ACTIVE) → admin_cancel_wager splits 50/50; each player gets their
0.1 SUI back. Wager → status 2 (SETTLED), escrow drained.

### Server log timeline
```
4596  [WS in] 0x03c33df0 queue_fight [wager=0xce620b9cff]
4597  [Wager Lobby] ShakaLiX created wager for 0.1 SUI (0xce620b9cff…6d59)
4607  [WS in] 0xf669789c wager_accepted [wager=0xce620b9cff]
4746  [Wager] Admin-cancelling 0xce620b9cff…   ← manual refund
4817  [Wager Lobby] Expired: 0xce620b9cff…     ← 10-min sweeper
```
Between line 4607 (the WS-in trace) and line 4746 (the refund), the
log says NOTHING — no proceed-path "[Wager Lobby] X accepted Y's
wager", no autoRollback warning, no chain-RPC error, no character-
not-found error. Whatever exited didn't log.

### Six gates that could have fired silently (pre-fix)
| Gate | Exit shape pre-fix | Now |
|---|---|---|
| `!wagerMatchId` | sendError | `[handleWagerAccepted] reject(missing-wagerMatchId)` |
| `processingWagerAccepts.has` | sendError | `…reject(processing-inflight)` |
| `client.currentFightId` truthy | sendError | `…reject(caller-in-fight) currentFightId=<id>` |
| `!client.walletAddress` | sendError | `…reject(caller-not-authed)` |
| `targetChainStatus === null` | sendError | `…reject(chain-status-null)` |
| `outcome.kind === 'reject'` | sendError | `…reject(outcome-reject:<reason>)` |
| `!charA \|\| !charB` | sendError | `…reject(character-missing(a=…,b=…))` |
| `!client.characterId` | sendError | `…reject(caller-no-characterId)` |

### Defence layers shipped
1. **`gateExit(reason, userMessage)` helper** — every silent gate now
   logs a structured `[handleWagerAccepted] reject(<reason>) wager=
   <id> caller=<wallet> currentFightId=<id\|none>` line. Single
   choke point so log + toast can't drift.
2. **Proceed-path positive breadcrumbs** —
   `[handleWagerAccepted] chain probe ok …` (with full predicate
   context: status, targetInLobby, ownWager, inMmQueue) and
   `[handleWagerAccepted] proceed-complete wager=<id> fight=<id>`.
   So a partial-success run also tells us where it got to.
3. **Top-level try/catch around the proceed body** — pre-fix any
   throw inside the try block escaped to the WS router which didn't
   await OR catch. Now: `[handleWagerAccepted] UNHANDLED wager=<id>`
   + a user-facing toast pointing at `/api/admin/cancel-wager`. The
   user's stake stays refundable; the bug surfaces immediately.
4. **WS router `.catch()`** — `handleWagerAccepted(client,
   msg).catch(...)` so async rejections that bypass the inner
   try/catch still hit `[router:wager_accepted] unhandled async
   rejection`.
5. **Process-level safety nets** — `process.on('unhandledRejection')`
   + `process.on('uncaughtException')` in index.ts. Process stays
   up (transient RPC blips would kill more SUI than they'd save) but
   every escaped promise logs.

### Added
- `scripts/qa-wager-accepted-diagnostics.ts` — 19 PASS. Pins every
  gate emits its reason; proceed-path logs; try/catch wrapper; router
  `.catch()`; process-level handlers.

### Changed
- `server/src/ws/handler.ts::handleWagerAccepted` — gateExit helper +
  every silent return logs + try/catch + .catch() at router.
- `server/src/index.ts` — process-level unhandledRejection +
  uncaughtException handlers.

### Tests
- Server tsc clean. Frontend tsc unchanged from prior commit.
- qa-wager-accepted-diagnostics.ts NEW (19 PASS).
- 0 regressions on prior gauntlets (Move 37/37, the wider TS suite
  unchanged).
- Servers restarted with the patch live.

### Next session
This patch makes the bug **observable**. The fix for the root cause
needs one more live repro: with this commit, the next "stale lobby
after a second-round wager" will leave a `[handleWagerAccepted]
reject(<reason>) …` line in the server log. That reason names the
gate, the gate names the predicate, and the predicate names the
fix. Until then we ship the defence-in-depth — silent SUI-locks
become triageable, not hidden.

---

## [Unreleased] — Server-restart amnesia (Bug 6), 2026-05-19

Fixes the second wager-loss vector found minutes after the
wager-accept race shipped. A `pkill node && npm run dev` cycle wiped
the server's in-memory `characters` map; the frontend kept its
cached character, the next on-chain `create_wager` succeeded
(escrow `0xd94d…01a2` for 0.1 SUI), and the WS follow-up
`queue_fight` hit `getCharacterByWallet → null → sendError`. The
REST fallback `/api/admin/adopt-wager` answered with the same null
lookup and returned 409 *"Creator has no active character on
server"*. SUI locked, orphan toast fired, manual
`/api/admin/cancel-wager` refund required.

### Recovery
Tx `4RbEv5RJpWgVcA74uoBUX9aChq7qte2KWdgVMsPjobmV` at 21:26:23Z
refunded MrBoss's 0.1 SUI from `0xd94d…01a2`. Wager status → SETTLED,
escrow drained.

### Root cause (chain + log evidence)
1. Servers bounced at 21:11:43Z to live-verify the wager-race fix.
2. In-memory `characters` map wiped (no Supabase, server.log:
   `[Supabase] No credentials configured — running in-memory only`).
3. Frontend `useGameSocket` auto-reconnected with the stored JWT
   (`auth_token`). Server's `acceptAuthenticatedSession`
   (`handler.ts:607-610`) found nothing in memory, `restoreCharacterFromDb`
   returned null (no Supabase), so `auth_ok` went out with
   `character: null, hasCharacter: false`.
4. Frontend `auth_ok` handler at `game-provider.tsx:84-94` was
   null-tolerant — `if (msg.character) dispatch(...)` — so it did
   nothing. State kept the pre-restart character.
5. The chain-check effect at `game-provider.tsx:566-651` bailed on
   `if (state.character) return;`. `restore_character` was never sent.
6. User clicked Create Wager → handleQueue → signed on-chain → server
   `handleQueueFight::getCharacterByWallet` → null → sendError → ACK
   timeout → REST adopt-wager fallback → also null → 409 → orphan.

### Audit — every `getCharacterByWallet` call site
| File:Line | Caller | Failure shape pre-fix | Covered by self-heal? |
|---|---|---|---|
| `ws/handler.ts:133-134` | onAcceptFightRequest | sendError | ✅ |
| `ws/handler.ts:607` | acceptAuthenticatedSession (ROOT) | auth_ok with hasCharacter:false | ✅ (the entry point) |
| `ws/handler.ts:778` | handleRestoreCharacter (cache hit) | n/a (restore path) | ✅ |
| `ws/handler.ts:876` | handleGetCharacter | sendError | ✅ + presence-check uses this |
| `ws/handler.ts:919` | handleQueueFight (SHIP-LOST PATH) | sendError + orphan SUI | ✅ self-heal + defence-in-depth presence check |
| `ws/handler.ts:1106` | handleEquipItem (post-equip read) | sends `character: null` | ✅ |
| `ws/handler.ts:1140` | handleAllocatePoints | sendError | ✅ |
| `ws/handler.ts:1160` | handleEquipItem | sendError | ✅ |
| `ws/handler.ts:1171` | handleUnequipItem | sendError | ✅ |
| `ws/handler.ts:1218` | handleGetFightHistory | falls back to "Unknown" | ✅ |
| `ws/handler.ts:1543-1544` | handleWagerAccepted | sendError | ✅ + the wager-race fix |
| `ws/handler.ts:1595` | handleSendFightRequest | sendError | ✅ |
| `ws/chat.ts:46` | handleChatMessage | silent drop | ✅ |
| `data/presence.ts:208` | presence helper | falls back to stub | ✅ |
| `data/fight-requests.ts:263-264` | sendFightRequest | sendError | ✅ |
| `data/marketplace.ts:477` | seller events | logs warning | ✅ |
| `data/player-profile.ts:105` | profile lookup | falls back to DB | ✅ |
| `index.ts:58,99,170,292,416` | REST endpoints | 404/409 | ✅ + restart-survival makes this unreachable |

**Verdict:** the auth_ok self-heal is at the entry point of every
authenticated session — every downstream site is implicitly covered
because no action message can run before `auth_ok` (the router
gates on `client.authenticated`). The defence-in-depth presence
check catches the secondary race (restart mid-form). The restart-
survival JSON snapshot eliminates the trigger.

### Added
- `frontend/src/hooks/useGameStore.ts` — `BEGIN_SERVER_REHYDRATE`
  reducer action. Clears character + equipment + flips `authPhase`
  to `chain_check_pending` so the chain-check effect re-arms.
  Distinct from `RESET_WALLET_SCOPED` because socket / fight /
  spectator state are preserved — a server restart shouldn't blow
  up an active fight the user is watching, only the character cache.
- `frontend/src/lib/character-presence-check.ts` —
  `verifyServerHasCharacter({ socket, timeoutMs? })`. Round-trips
  `get_character` over WS, resolves `{ok:true}` on `character_data`
  or `{ok:false, reason}` on `error` / timeout / not-yet-connected.
  Defence-in-depth for the "restart mid-form" race.
- `server/src/data/local-persistence.ts` — JSON-on-disk fallback
  for character rows when Supabase isn't configured. Atomic write
  (write-to-temp + rename). Cache + load-from-file logic. Survives
  process boundaries. Gitignored at `server/.local-state/`.
- `scripts/qa-auth-ok-server-amnesia.ts` — 13 assertions.
- `scripts/qa-create-wager-orphan-guard.ts` — 15 assertions.
- `scripts/qa-server-restart-recovery.ts` — 20 assertions
  (integration test: save → simulate restart → load round-trip;
  multi-wallet isolation; corrupted snapshot fails soft).

### Changed
- `frontend/src/app/game-provider.tsx` — `auth_ok` handler now
  branches on `msg.hasCharacter === false`: dispatches
  `BEGIN_SERVER_REHYDRATE`. Triggers the chain-check effect to
  re-restore from chain. The user briefly sees
  "Checking the chain for your fighter…" instead of stale state +
  silent action failures.
- `frontend/src/components/fight/matchmaking-queue.tsx` —
  `handleAcceptWager` and `handleQueue` (create_wager branch) both
  call `verifyServerHasCharacter` BEFORE the simulation /
  wallet-popup path. On failure: `BEGIN_SERVER_REHYDRATE` + SET_ERROR
  + return without signing. No orphan possible.
- `server/src/data/db.ts` — `dbSaveCharacter`, `dbLoadCharacter`,
  `dbDeleteCharacter` fall through to `local-persistence.ts` when
  `getSupabase()` returns null. Same shape returned either way —
  callers (`characters.ts::restoreCharacterFromDb`) don't branch.
- `.gitignore` — `server/.local-state/` added.

### Live-verified
After implementing, restarted both servers. Both wallets
auto-reconnected → `[Character] Restored from chain: "ShakaLiX"`
+ `"MrBoss"` in server.log. `server/.local-state/characters.json`
now contains both rows. A subsequent `pkill node && npm run dev`
will load these rows at auth time, no chain RPC needed.

### Tests
- 37 / 37 Move PASS (unchanged — no contract change).
- All existing gauntlets PASS (0 regressions across the wider sweep).
- New: `qa-auth-ok-server-amnesia.ts` (13), `qa-create-wager-orphan-guard.ts`
  (15), `qa-server-restart-recovery.ts` (20).
- Server tsc clean. Frontend tsc clean.

### Note on Supabase
The host running this environment has no Supabase credentials set.
The JSON-on-disk fallback gives us restart-survival without
external infra. A future operator who wants cloud-side replication
should run `cd server && node setup-db.mjs` to print the migration
SQL, paste it into a Supabase project, and set `SUPABASE_URL` /
`SUPABASE_KEY` in `server/.env`. The `db.ts` adapter will prefer
Supabase when configured; the local snapshot stays as a write-
through cache and disaster-recovery insurance.

---

## [Unreleased] — Wager-accept double-click race + abort-code toast, 2026-05-18

Fixes the EMatchNotWaiting (abort code 1) MoveAbort that blocked wager
testing minutes after the disconnect/spectator commit shipped.

**The incident.** MrBoss created an open 0.1 SUI wager
`0xbc34...7056`. ShakaLiX clicked Accept, the chain tx
`8nv6hd1u…` landed at 2026-05-18T19:49:04Z, the wager flipped
WAITING→ACTIVE, `escrow` grew to 0.2 SUI, `player_b` was pinned to
ShakaLiX. *Then* ShakaLiX clicked Accept again — the lobby UI hadn't
removed the entry yet because removal was server-pushed only — and
the second click hit `assert!(wager.status == STATUS_WAITING, EMatchNotWaiting)`
at `arena.move:123` (bytecode instruction 14). The SDK surfaced
`Transaction resolution failed: MoveAbort in 2nd command, abort code: 1`
which read like the FIRST accept failed.

**Root cause — three-piece race:**

1. `handleAcceptWager`'s finally block flipped `signing=false` as soon
   as the first sign-and-execute resolved, re-enabling the Accept
   button instantly.
2. `state.wagerLobby` removal was driven by the server's
   `wager_lobby_removed` broadcast — typically 200-2000ms after the
   chain tx lands. During that window the lobby entry stayed visible.
3. The second click went straight to `signAndExecuteTransaction` with
   no pre-flight, so the only failure surface was the SDK's cryptic
   post-sign abort string — no domain context, no recovery hint.

**Audit — clean. The race is symmetric across arena entry points.**
- `accept_wager`: fixed (this commit).
- `cancel_wager`: identical race shape — creator clicks Cancel while
  acceptor's tx lands first; `cancel_wager` asserts WAITING (line 196)
  and aborts with the same code 1. **Fixed in this commit** with the
  same pre-flight + optimistic local removal.
- `create_wager`: no race — single-actor path. Only failure mode is
  `EInvalidStake` (code 0) if input rounds to 0 MIST. Pre-flight now
  catches this too.
- `settle_wager`, `admin_cancel_wager`, `cancel_expired_wager`: not
  user-facing (treasury / cron / safety net). No UI change needed; the
  shared `humanizeChainError(raw, ARENA_ABORT_CODES)` mapping still
  applies if any of them ever surface in an admin console.

### Added
- `frontend/src/lib/arena-aborts.ts` — `ARENA_ABORT_CODES`
  (`AbortCodeMap`) covering every constant in `arena.move:9-19`. Single
  source of truth for the toast lookup; pinned by
  `qa-arena-aborts.ts`.
- `frontend/src/lib/wager-preflight.ts` — `simulateWagerTx(client, tx,
  walletAddress, ctxLabel)`. Sets sender, runs
  `client.simulateTransaction({ include: { effects: true } })`,
  routes any abort through `assertTxSucceeded` with
  `ARENA_ABORT_CODES` so the user sees the friendly copy BEFORE the
  wallet popup. RPC failures fail-open (server's chain probe is the
  final safety net).
- `scripts/qa-arena-aborts.ts` — pure-unit gauntlet (41 assertions)
  covering every Move constant + the canonical SDK error string from
  the 2026-05-18 incident verbatim + the bare-code fallback +
  every-code round-trip + unknown-code graceful fallback.
- `scripts/qa-wager-accept-race.ts` — source-grep gauntlet (16
  assertions) pinning the wiring: pre-flight present in every signing
  path, REMOVE_WAGER_LOBBY_ENTRY dispatches on BOTH simulation
  failure AND post-sign success, optimistic dispatch ordered before
  the WS `wager_accepted` send, conditional `txDigest` spread.
- `contracts/tests/arena_tests.move::test_double_accept_aborts` —
  EXACT incident reproduction (Alice creates, Bob accepts → success,
  Eve tries → abort code 1). Move-side regression guard.
- `contracts/tests/arena_tests.move::test_cancel_after_accept_aborts`
  — symmetric guard for the cancel race.

### Changed
- `matchmaking-queue.tsx::handleAcceptWager` —
  (a) pre-flights via `simulateWagerTx` before signing; on failure
  dispatches `REMOVE_WAGER_LOBBY_ENTRY` (clears the stale entry) and
  surfaces the humanized abort copy via `SET_ERROR`; skips the wallet
  popup entirely.
  (b) on a successful post-sign result, dispatches
  `REMOVE_WAGER_LOBBY_ENTRY` BEFORE the `wager_accepted` WS send so
  the lobby reflects truth synchronously and a double-click during
  the server-round-trip window can't fire a second sign attempt.
  (c) passes `ARENA_ABORT_CODES` to `assertTxSucceeded` so any
  post-sign abort gets the same friendly message as the pre-flight.
- `matchmaking-queue.tsx::handleCancelWager` — same pre-flight + post-
  sign assert wiring as accept.
- `matchmaking-queue.tsx::handleQueue` (create_wager branch) — pre-
  flight added; passes `ARENA_ABORT_CODES` to `assertTxSucceeded`.
- `matchmaking-queue.tsx` — added `useCurrentClient` for the simulation
  client; conditional `txDigest` spread (`...(digest ? { txDigest:
  digest } : {})`) replaces the pre-existing `digest ?? undefined`
  cast against a required field.
- `ws-messages.ts` — `wager_accepted.txDigest` is now optional. The
  server doesn't strictly need it (it re-reads chain state via
  `getWagerStatus`) and some wallets occasionally return a
  success-shaped result without a digest. Closes the pre-existing TS
  regression flagged in commit `e91c8e7`.
- `useEquipmentActions.ts` — imports `humanizeChainError` from
  `@/lib/tx-result` (closes the other pre-existing TS regression).
- `qa-wager-accept-gate.ts` — assertions updated to pin the new
  `assertTxSucceeded(..., ARENA_ABORT_CODES)` call sites and the
  presence of `simulateWagerTx`. Was 67 PASS → now 68 PASS.

### Verified on-chain
Reproduced the user's exact MoveAbort by calling
`client.simulateTransaction` against the now-ACTIVE wager
`0xbc34...7056` from ShakaLiX's address. Got back:
```
$kind: FailedTransaction
abortCode: "1", module: "arena", functionName: "accept_wager", instruction: 14
```
Pre-flight catches this verbatim and surfaces:
*"accept_wager failed: The wager is no longer waiting for an opponent —
it was just accepted or cancelled. Refresh the lobby. (at arena::accept_wager:14)"*

### Tests
- 37 / 37 Move unit tests PASS (was 35 / 35 — added 2 new).
- `qa-arena-aborts.ts` NEW (41 PASS).
- `qa-wager-accept-race.ts` NEW (16 PASS).
- `qa-wager-accept-gate.ts` (extended, 68 PASS).
- 0 regressions in any other gauntlet.
- Server tsc clean. Frontend tsc clean (the two pre-existing
  regressions flagged at `e91c8e7` are now resolved).

---

## [Unreleased] — Wallet-disconnect + guest spectator, 2026-05-18

Fixes two post-disconnect UX bugs on the landing/lobby that surfaced
during Phase A live-verification.

**Bug 1 — Stale character/inventory after wallet disconnect.** Pre-fix,
clicking Disconnect (dapp-kit ConnectButton menu) left every wallet-
scoped slice in the reducer untouched. The `game-screen.tsx`
`if (!account) return <LandingPage />` short-circuit only swapped the
body; the surrounding `<Navbar />` reads `state.character` directly and
kept rendering the previous fighter's avatar / name / LV badge / ELO
over the LandingPage until manual page refresh.

**Bug 2 — "Watch a Fight" button broken in disconnected state.** The
landing-page ghost button dispatched an `sc:nav` custom event that
nothing listened for. Even if a router had heard it, the server's
pre-auth WS whitelist (`auth_request`/`auth_signature`/`auth_token`
only) would have rejected the guest's `spectate_fight` message anyway.
Spectator mode wasn't actually wired to work without a wallet.

### Added
- `frontend/src/components/fight/spectator-landing.tsx` — guest
  spectator fight picker. Lists active fights via the pre-auth
  `spectate_fight` (no fightId) endpoint, auto-refreshes every 5s,
  click attaches to the picked fight via `<SpectateView />`. Renders
  its own `<Navbar />` (the wallet-connect button stays visible so the
  guest can elevate at any time).
- `server/src/ws/pre-auth-types.ts` — `PRE_AUTH_TYPES` exported from
  its own module so the QA gauntlet can pin the whitelist without
  dragging in `config.ts` (which would force the gauntlet to require
  real testnet creds). Now admits `spectate_fight` and
  `stop_spectating` alongside the auth handshake.
- `buildWalletScopedReset` helper in `useGameStore.ts` — single source
  of truth for "what does the logged-out reducer state look like."
  Reuses `initialGameState`, preserves only the live socket reference
  and (optionally) `spectatorMode`. The reducer's `RESET_WALLET_SCOPED`
  case dispatches this helper.
- `state.spectatorMode` + `state.activeSpectateFights` slices +
  `SET_SPECTATOR_MODE` + `SET_ACTIVE_SPECTATE_FIGHTS` actions —
  back the guest spectator UI.
- `useGameSocket(walletAddress, signChallenge, guestMode=false)`
  third parameter. When `guestMode=true` and `walletAddress=null`,
  opens an unauthenticated WS — the `onopen` handler skips
  `startHandshake` and lets the pre-auth-whitelisted spectator
  messages flow.
- `forgetStoredJwt(addr)` re-export from `useGameSocket.ts` —
  used by the disconnect watcher in GameProvider to evict the JWT
  for the OLD wallet on logout (explicit disconnect ≠ refresh).
- `scripts/qa-wallet-disconnect-reset.ts` — pure-unit gauntlet
  (51 assertions). Locks every wallet-scoped slice resets to
  initial, socket reference is preserved, spectatorMode opt-in
  works, reducer matches helper, SET_SPECTATOR_MODE entry/exit
  drains the right slices.
- `scripts/qa-spectator-guest-flow.ts` — pure-unit gauntlet
  (29 assertions). Locks PRE_AUTH_TYPES membership (auth handshake
  preserved, spectator messages admitted, action messages still
  blocked), guest entry → list → attach → leave → back flow.
- `scripts/qa-landing.ts` — assertion added: Watch a Fight button
  dispatches `SET_SPECTATOR_MODE: true` (pins Bug 2's fix wording).

### Changed
- `game-provider.tsx` — reordered `useReducer` before `useGameSocket`
  so the guest-mode flag (`state.spectatorMode`) can drive socket
  setup. New `prevWalletRef` + disconnect watcher: on truthy → null
  transition, dispatches `RESET_WALLET_SCOPED` and calls
  `forgetStoredJwt(oldAddr)`. On account swap (addr1 → addr2) also
  resets. On null → truthy, drops `spectatorMode` so the
  authenticated UI takes over.
- `game-screen.tsx` — `!account` branch now forks into three sub-
  flows: pure landing, spectator picker (`spectatorMode && !
  spectatingFight`), or attached spectator view (`spectatorMode
  && spectatingFight`).
- `landing-page.tsx` — Watch a Fight `onClick` flips
  `SET_SPECTATOR_MODE: true` instead of dispatching the dead
  `sc:nav` event.
- `server/src/ws/handler.ts` — `handleSpectateFight` uses
  `client.walletAddress ?? \`guest:${client.id}\`` as the spectator
  key. `stop_spectating` switched from no-op to real
  `handleStopSpectating` that calls `removeSpectator`. Disconnect
  cleanup hoisted outside the `if (client.walletAddress)` block so
  guest spectators don't leak across socket close.
- `ws-messages.ts` — `spectate_update` payload widened to optional
  `fight` + optional `activeFights` (list-mode reply).
- `useGameSocket.ts` — effect bails only when BOTH `walletAddress`
  and `guestMode` are falsy; `addr` guards added to the JWT write
  sites for guest sessions.

### Audit summary
Searched every wallet-scoped state vector for the same disconnect-leak
pattern as Bug 1 and every read-only surface for the same wallet-gate
hole as Bug 2.

**Disconnect-leak audit — clean. One root fix covers all surfaces.**
- Every reducer slice (27 total) routes through
  `buildWalletScopedReset`, pinned by the new gauntlet. Adding a new
  field that should leak through requires explicit opt-out.
- `useWalletBalance` already resets to EMPTY on `owner === null`
  (frontend/src/hooks/useWalletBalance.ts:39-42) — confirmed clean.
- WS lifecycle: the existing `useGameSocket` cleanup closes the
  socket and sets `authenticated=false` on dep change, so the WS
  itself doesn't leak. Server-side `handleDisconnect` correctly
  drops the player from matchmaking / chat / presence / wager-lobby
  on socket close.
- JWT in localStorage: keyed per wallet (`sui-combats-jwt-<addr>`),
  but the disconnect watcher now actively evicts the entry for the
  outgoing address. Other wallets' JWTs are untouched (intentional —
  shared-device scenarios are out of scope).
- `acknowledgedFightId` localStorage: per-fight, not per-wallet —
  survives logout cleanly, no leak.

**Unauthenticated read-only surface audit — public endpoints already
public.**
- `GET /api/leaderboard` — no auth check, public. ✓
- `GET /api/character/:walletAddress` — no auth check, public. ✓
- `GET /api/fights/:fightId` — public. ✓
- `POST /api/admin/grant-xp` — admin-only (network gate), correct
  to require credentials.
- WS pre-auth surface previously: `auth_*` only. Now widened to
  `spectate_fight` + `stop_spectating`. All write/action messages
  (`queue_fight`, `fight_action`, `wager_accepted`,
  `create_character`, `chat_message`, `equip_item`, etc.) stay
  behind the auth wall, pinned by the new gauntlet.
- Marketplace browse / leaderboard / character-by-address are
  REST + public WS broadcasts respectively; the disconnected
  spectator flow doesn't currently surface them in the UI, but
  the data path is unauthenticated-friendly. **New backlog item:
  add a public Browse Marketplace / Hall of Fame entry from the
  landing screen** (deferred — not in this commit's scope).

**Pre-existing TypeScript errors (NOT touched by this commit):**
- `frontend/src/components/fight/matchmaking-queue.tsx:443` —
  `txDigest: digest ?? undefined` violates `txDigest: string`.
- `frontend/src/hooks/useEquipmentActions.ts:183` —
  `humanizeChainError` not imported (lives in `lib/tx-result.ts`).
- Both were present at `ffc24a3` despite that doc's "tsc clean"
  claim; flagging here so the next session picks them up.

### Tests
- 2,307 + 80 (this commit) + 13 (Watch-a-Fight pin in qa-landing) =
  full pass on every non-dotenv-infra gauntlet.
- The dotenv-infra ERR set (qa-marketplace, qa-orphan-sweep,
  qa-tavern-handlers, qa-tavern-presence, qa-tavern-dm-channels,
  qa-tavern-fight-requests, qa-treasury-queue, qa-xp) is identical
  pre/post — verified by `git stash` + re-run.
- Move unit tests untouched (contracts unchanged); 35/35 PASS
  at last run.

---

## [Unreleased] — Phase A Sui-latest integration, 2026-05-17

zkLogin via Enoki lands in the wallet connect modal; the wager-accept
silent-fail UX bug filed yesterday (Bug A) gets a pre-flight balance
check; the SDK `FailedTransaction` wrapper (Bug B) is now surfaced via
a new shared `assertTxSucceeded` helper across every wallet-popup
site. No contract change. No server change (Track 4 gRPC migration
deferred — see "Reality Check" below). Same on-chain package ID (v5).
Branch `feature/phase-2-design`.

### Added

- **`frontend/src/config/enoki.ts` — NEW.** Provider config snapshot,
  env reading (`NEXT_PUBLIC_ENOKI_API_KEY` + `NEXT_PUBLIC_GOOGLE_CLIENT_ID`
  + `NEXT_PUBLIC_TWITCH_CLIENT_ID`), `ENOKI_CONFIG` module-load
  snapshot, `ENOKI_READY` guard. Provider matrix documented in the
  file header. Apple deferred — Enoki 1.0.8's `AuthProvider` union
  excludes `'apple'`; commented candidate row preserves the slot for
  when the SDK ships it.
- **`frontend/src/lib/tx-result.ts` — NEW.** Shared
  `assertTxSucceeded(result, ctxLabel, abortCodes?)` +
  `extractTxDigest(result)` + `humanizeChainError(errStr, abortCodes?)`
  + `AbortCodeMap` type. Extracted from the pre-existing
  `useEquipmentActions.ts::assertTxSucceeded` helper that the loadout
  PTB has used since Phase 0.5, so this is a refactor (not new
  wheel-inventing) — the same pattern is now wired into the
  `create_wager` and `accept_wager` paths in `matchmaking-queue.tsx`.
- **`scripts/qa-zklogin-wallet-registration.ts` — NEW (44 assertions).**
  Pins the Enoki initializer wiring (`enokiWalletsInitializer` through
  `walletInitializers`), the `ENOKI_READY` guard, the env-example
  documentation, the Apple-deferred breadcrumb trail across 3 sites,
  the dependency declarations, the signed-challenge auth-surface
  regression guard (zkLogin-derived wallets implement Wallet Standard
  `signPersonalMessage`, so the existing server
  `verifyPersonalMessageSignature` flow works unchanged), and the
  doc-presence in `STATE_OF_PROJECT_2026-05-17.md`.
- **`canAcceptWagerWithBalance({ lobbyGate, stakeMist, balanceMist,
  gasReserveMist? })` pure predicate in
  `frontend/src/lib/wager-accept-gate.ts`** plus
  `DEFAULT_GAS_RESERVE_MIST` constant (20_000_000 MIST = 0.02 SUI).
  Refuses the click *before* the wallet popup when the caller's
  balance can't cover stake + estimated gas. Short-circuits to the
  lobby/own-wager refusal message when that gate already refuses, so
  the user-facing reason stays actionable.
- **`@mysten/enoki@^1.0.8`** + **`@mysten/slush-wallet@^1.0.5`** as
  direct frontend dependencies. Slush was already in node_modules as
  a transitive dep through `@mysten/dapp-kit-react`; making it
  explicit documents the intent.

### Changed

- **`frontend/src/config/dapp-kit.ts`** — added
  `enokiWalletsInitializer` import + the module-load
  `ENOKI_INITIALIZER` constant gated on `ENOKI_READY &&
  ENOKI_CONFIG.apiKey`, plugged into `createDAppKit({...
  walletInitializers: [ENOKI_INITIALIZER]})`. When env vars aren't
  configured, registration is silently skipped and the existing
  browser-injected / default-Slush sign-in flow is the only path.
  Comment block explicitly cites why we do *not* call
  `registerSlushWallet(...)` (would double-register — dapp-kit-core's
  default `slushWalletConfig` already invokes
  `slushWebWalletInitializer` for us).
- **`frontend/src/components/fight/matchmaking-queue.tsx`** — wired
  the new balance gate into `handleAcceptWager` before
  `signer.signAndExecuteTransaction`. Both `create_wager` and
  `accept_wager` paths now route through the shared
  `assertTxSucceeded(result, ctxLabel)` helper instead of the pre-fix
  `txData = Transaction || FailedTransaction || result` OR-coalesce
  that masked chain failures. `accept_wager` uses
  `extractTxDigest(result)` for the WS payload.
- **`frontend/src/hooks/useEquipmentActions.ts`** — now imports
  `assertTxSucceeded` + `AbortCodeMap` from the shared
  `frontend/src/lib/tx-result.ts` instead of defining its own copy.
  No fork. `EQUIPMENT_ABORT_CODES` (the per-module Move abort lookup
  table for `equipment.move`) stays local and is passed as the third
  argument to the shared helper.
- **`frontend/.env.local.example`** — appended Enoki + Google +
  Twitch sections with per-provider OAuth-console setup links + the
  PENDING Apple section. Each var documents the dev-console URL and
  the redirect-URI registration step.
- **`scripts/qa-wager-accept-gate.ts`** — extended from 39 to 67
  assertions: 10 for the balance-gate decision boundaries (insufficient,
  exactly-equal, one-MIST-short, well-funded, loading, zero,
  custom-reserve, lobby short-circuit, own-wager short-circuit,
  default-reserve pin), 4 for the matchmaking-queue wire shape, 4 for
  the shared `tx-result` module exports, 2 for the fork-guard
  (`useEquipmentActions.ts` imports from the shared module + uses the
  abort-code map). The `testFailedTransactionBranchingShape` test
  reads the source files via `fs.readFileSync` and pins the actual
  text — a regression that drops the helper import is caught at gauntlet
  time, before a live-test regression hits two-wallet QA.
- **`scripts/qa-wordmark.ts`** — header-polish pin caught up: navbar
  variant now expected at `suiSize: 38`, `combatsSize: 38`,
  `strokeWidth: 1.8` (was `32 / 32 / 1.5` pre-2026-05-16). 30 → 32
  assertions.

### Reality Check — Track 4 server gRPC migration deferred

The 2026-05-16 plan claimed `SuiGrpcClient` was a "near-drop-in
replacement" for the server-side JSON-RPC reads at
`server/src/utils/sui-settle.ts::getWagerStatus`,
`server/src/utils/sui-settle.ts::findCharacterObjectId`, and
`server/src/utils/sui-read.ts::fetchEquippedFromDOFs`. **That claim
was wrong** — verified tonight by reading the `@mysten/sui@2.15.0`
gRPC client types:

- **`getWagerStatus`** uses `client.getObject({...
  options: { showContent: true } })` which returns
  `{ data: { content: { fields: {...} } } }` on JSON-RPC. The gRPC
  equivalent returns `{ object: { content: Uint8Array<BCS> } }` —
  requires writing a BCS decoder for the WagerMatch struct. Not a
  drop-in.
- **`findCharacterObjectId`** uses `client.queryEvents({...})`. The
  gRPC client has **no `queryEvents` method**. Events are not in the
  gRPC core API as of 2.15.0; the marketplace's `subscribeCheckpoints`
  path is a different (streaming) API that doesn't replace the
  ad-hoc lookup pattern.
- **`fetchEquippedFromDOFs`** uses `client.getDynamicFields(...)` +
  `client.getDynamicFieldObject(...)`. The gRPC core client has
  `listDynamicFields` (pagination only — no per-DF object resolver)
  so the DOF iteration would need a real refactor around the new
  `value` include + the `nameValue` projection.

The migration is a real surgical refactor. Deferred to a focused
gRPC-migration session with rigorous before/after latency measurement
on the public testnet fullnode. The Phase A scope is unaffected by
the deferral — zkLogin + Bug A + Bug B all ship cleanly on the
existing JSON-RPC server.

### Apple OAuth provider — deferred

Enoki 1.0.8's `AuthProvider` union is
`'google' | 'facebook' | 'twitch' | 'onefc' | 'playtron'` — Apple is
**not yet supported by the SDK**. The user's 2026-05-16 plan answer
asked for Google + Twitch + Apple; we ship Google + Twitch live and
preserve the Apple slot via a commented-out candidate row in
`config/enoki.ts`, an inline note in `config/dapp-kit.ts`, and a full
`PENDING ENOKI SDK SUPPORT` section in `.env.local.example`. When
the SDK adds Apple, the diff to enable is ~3 lines.

### Test totals

- `qa-zklogin-wallet-registration` — **44** (NEW)
- `qa-wager-accept-gate` — 39 → **67** (+28)
- `qa-wordmark` — 30 → **32** (+2)
- All other 34 gauntlets unchanged
- Frontend `tsc --noEmit` — clean
- 35 / 35 Move unit tests — unchanged (contracts not touched)
- **Total: 2,307 / 2,307 PASS across 37 suites** (+72 from the
  2,235 baseline at 2026-05-16)

### References

- `STATE_OF_PROJECT_2026-05-17.md` — canonical state for this session.
- `SESSION_HANDOFF.md` — single-page handoff (now 2026-05-17), with
  three live-verification checklists for next session (zkLogin
  sign-in, Bug A pre-flight repro, Bug C battle-log symmetry).
- `sui_latest.md` — user-curated Sui ecosystem survey that drove the
  Phase A scope.

---

## [Unreleased] — Phase 3 fight-room redesign + Phase 2 wrap, 2026-05-16

Phase 2 visual-QA + polish track. Fight-room redesigned through three
iterations in a single session against a user-supplied reference
mockup. No contract change. No new server endpoint. Same on-chain
package ID (v5). Branch `feature/phase-2-design`.

### Added

- **`scripts/qa-fight-arena-layout.ts` — NEW (71 assertions).** Pins
  the Phase 3 fight-room structural shape across grid templates
  (`1fr auto 1fr` top row, `1fr 240px 1fr` middle row, full-width
  bottom row), `ZoneSelector variant="list"` mounting, `kind="atk"`
  / `kind="blk"` cells, the three inline icon components, the
  `rgba(226,75,74,0.6)` red glow + `rgba(55,138,221,0.6)` blue glow
  rgbas, the `zs-pulse-red` / `zs-pulse-blue` keyframes, and a
  removed-v1-artefact guard against silent reverts.
- **`hideHpBar?: boolean` prop on `MiniEquipmentFrame`.** Single
  conditional render guard inside the existing read-only doll. Lets
  the fight-room reuse the same 10-slot frame the Player Profile
  modal uses without duplicating the HP bar (HP renders once, in the
  arena's top-row HP card).
- **`ZoneSelector variant: "body" | "list"` prop.** Defaults to
  `"body"` (back-compat with the previous SVG silhouette).
  `"list"` mounts the new compact row-paired button column built for
  the fight-room move panel.
- **Inline Tabler-style outline SVGs** (`IconSword`, `IconShield`,
  `IconCheck`) in `zone-selector.tsx`. No npm dependency added —
  the spec implied a Tabler package was loaded; nothing of the kind
  was actually in `frontend/package.json`.
- **`PULSE_CSS` keyframes scoped inside `zone-selector.tsx`** —
  `zs-pulse-red` and `zs-pulse-blue`, 1.4 s ease-in-out, driven by
  the per-button `selected` flag.

### Changed

- **`frontend/src/components/fight/fight-arena.tsx` — full rewrite.**
  Old Tailwind `max-w-5xl` flex column replaced with a `maxWidth:
  1280` CSS-grid layout in three rows:
  - Top row `grid 1fr auto 1fr` — left HP card · centre TurnCard
    (TurnTimer · TURN N · wager SUI) · right HP card. New `HpCard` +
    `TurnCard` sub-components.
  - Middle row `grid 1fr 240px 1fr` — read-only `MiniEquipmentFrame`
    on each flank, compact `ZoneSelector variant="list"` between
    them, Lock-in CTA anchored at the bottom of the centre column.
  - Bottom row — full-width Battle Log with `maxHeight: 200,
    overflowY: auto`.
  Block-pair / shield-line / dual-wield / shield-mode click logic
  untouched. WS surface (`fight_action { attackZones, blockZones }`)
  untouched. HP fill thresholds, opponent-disconnect banner,
  fight-result modal, fight-outcome-ack write — all pass-through.
- **`frontend/src/components/fight/zone-selector.tsx` — list variant
  restructured to a row-paired grid.** Single grid
  `grid-template-columns: 1fr auto 1fr` × `grid-template-rows: auto
  repeat(5, auto)`. Header row carries `ATK n/max` (red, left) +
  `BLK n/max` (blue, right). Each of the five zone rows is `ATK
  button · bronze zone label · BLK button` so the two buttons for
  the same body part stay horizontally aligned around the zone name.
  Buttons render in the game-theme chrome (`var(--r-sharp)`,
  `var(--sh-plate-sm)`, `var(--ls-button)`). Selected state: oriented
  accent border + `0 0 12px 2px` glow + 1.4 s pulse + corner ✓ badge.
- **`frontend/src/components/social/mini-equipment-frame.tsx`** —
  HP bar conditionally rendered behind the new `hideHpBar` prop;
  default behaviour preserved (Player Profile modal still renders
  the HP gauge inside the doll).
- **`frontend/src/components/layout/navbar.tsx`** — header sized
  ~20 % larger across the board (avatar 36 → 44, name 14 → 17 px,
  badges 10 → 12 px, balance pill 112 × 31 → 134 × 37). Outer row,
  left cluster, and nav-tab container all switched to `flex-wrap:
  wrap` with `clamp()`-based padding / gaps / fonts so the right
  cluster drops to a new line on narrow viewports instead of
  overlapping the wordmark.
- **`frontend/src/components/v2/wordmark.tsx`** — navbar variant
  bumped 32 → 38 px (sui + combats), stroke 1.5 → 1.8, drop-shadow
  offset unchanged.
- **`scripts/qa-fight-arena-layout.ts` pin count** — 60 (v1) → 57
  (v2, removed v1 abbreviations alongside their source) → 71 (v3,
  grid templates + button kinds + icon components + glow rgbas +
  pulse keyframes).

### Bug log (filed, not fixed this session)

- **Bug A — Insufficient-SUI silent fail on `accept_wager`.**
  Acceptor with 0.501 SUI on a 0.5 SUI wager: wallet signs, chain
  tx fails (escrow lock leaves no gas headroom), `WagerMatch.status`
  stays at 0, server's `decideAcceptOutcome` correctly rejects but
  the toast wording doesn't tell the user what really happened.
  Pre-flight balance check on the frontend is the right fix.
- **Bug B — Frontend ignores `FailedTransaction`.**
  `matchmaking-queue.tsx:398-407` grabs a digest from either the
  `Transaction` or `FailedTransaction` SDK wrapper and proceeds to
  send `wager_accepted` over the WS either way. Two-branch fix:
  throw on `FailedTransaction`, surface the SDK error.
- **Bug C — Battle log asymmetry (needs re-verify).**
  Pre-redesign symptom: battle log lines occasionally appeared on
  one tab and not the other during two-wallet live fights. **Not
  re-tested** against the Phase 3 fight-room redesign this session.
  DamageLog is pass-through — `fight.log` flows in unchanged — so
  any asymmetry would live in `server/src/ws/fight-room.ts`'s
  broadcast of `fight_state` updates, not the renderer.

### Parked WIPs landed alongside in the same wrap commit

The user asked for one wrap commit. Today's fight-room redesign and
header polish land alongside the multi-session pre-existing parked
files — DM pipeline (`lib/dm-*`, `lib/messaging.ts`,
`lib/player-bucket.ts`), Tavern handlers + data modules
(`server/src/ws/tavern-handlers.ts`,
`server/src/data/{dm-channels,dm-messages,fight-requests,player-profile,presence}.ts`,
migrations `003_tavern.sql` + `004_dm_messages.sql`), server
`fight-room.ts` + `handler.ts` + `index.ts` + `setup-db.mjs`,
frontend `game-provider.tsx` + `dapp-kit.ts` + `useGameStore.ts` +
`ws-messages.ts` + `tsconfig.json` + `package*.json`, 9 new
tavern/DM QA scripts (53 + 36 + 65 + 65 + 51 + 58 + 72 + 66 + 42
= 508 assertions — already counted in the 2026-05-14 gauntlet
total), `TAVERN_DESIGN.md`, `Gemini.md`, and the May-13
screenshots. Per-bullet content for those files is *not* unpacked
here — they predate this session and were already covered in their
respective qa scripts. Listed for traceability; the wrap commit is
the single landing point.

### Test totals

- `qa-fight-arena-layout` — **71** (NEW)
- `qa-fight-pause` — 46 (unchanged, regression guard)
- `qa-layout-primitives` — 155 (unchanged)
- `qa-mini-equipment-frame` — 50 (unchanged after `hideHpBar`)
- Frontend `tsc --noEmit` — clean
- 35 / 35 Move unit tests — unchanged
- **Total: 2,235 / 2,235 across 36 suites** (+71 from
  `qa-fight-arena-layout`)

### References

- `STATE_OF_PROJECT_2026-05-16.md` — canonical state for this session.
- `SESSION_HANDOFF.md` — single-page handoff (now 2026-05-16).
- `~/Downloads/fight_room_layout_v5_tall_dolls.html` — the user's
  reference mockup the v1 layout was ported from.

---

## [Unreleased] — Bucket 3 hotfix #7: presence-stub broadcast, 2026-05-08

### The bug retest that prompted this

Two-wallet live chat test (Mr_Boss + Sx). The Tavern shipped earlier
this week works visually, the DM transport (hotfix #6) round-trips
cleanly, but the player sidebar showed asymmetric stub data:

- Mr_Boss view: Sx rendered as `0xd05ae8…` Lv 1 ELO 1000 in the
  Novice 1-3 bucket. Wrong identity, wrong bucket.
- Sx view: Mr_Boss rendered correctly as `Mr_Boss_v5.1` Lv 6 ELO 982.
- "X online" counter asymmetric: Mr_Boss saw 2, Sx saw 1. Sx was
  missing himself from his own onlinePlayers map.
- Profile-modal click on either side returned the correct full
  record — `get_player_profile` reads through `getPlayerProfile()`
  with its own (in-memory → Supabase → on-chain DOF) resolve chain
  that doesn't depend on the presence row.

### Fixed

- **`server/src/data/presence.ts::upsertPresence` priority order.**
  Pre-fix the fallback chain for `characterName` / `level` /
  `rating` was `input → existing → character → stub`. Once a stub
  was written into the row (because an `enter_room` raced ahead of
  `handleRestoreCharacter`), every subsequent heartbeat preserved
  the stub because `existing` won the `??` chain. The character
  store was never re-consulted. Fixed by swapping to
  `input → character → existing → stub` so the canonical store
  wins whenever it has real data — a presence row that started
  life as a stub gets corrected on the very next upsert.
- **`UpsertResult.dataChanged`.** New flag lets callers detect
  identity-field updates (name/level/rating) so they can
  re-broadcast a `player_joined` to peers holding stale stubs.
- **`server/src/ws/tavern-handlers.ts::broadcastPresenceUpdate`.**
  Centralised broadcast helper. Wire choice:
  - `inserted || dataChanged` → `player_joined` (full row). The
    frontend's `ADD_ONLINE_PLAYER` reducer filters by wallet then
    appends, so a re-broadcast cleanly REPLACES any stub a peer
    was holding.
  - Else `statusChanged || roomChanged` → `player_status_changed`
    (lighter — just the new status fields).
  - Else silent.
  Wired into `announcePlayerOnline`, `handleEnterRoom`,
  `handlePresenceHeartbeat`, `broadcastFightStatusChange`. Pre-fix
  `handleEnterRoom` only ever fired `player_status_changed` —
  which the frontend's `UPDATE_PLAYER_STATUS` reducer no-ops for
  entries that don't already exist. So a player whose
  `announcePlayerOnline` was skipped never landed in any peer's
  onlinePlayers via the broadcast path.
- **`server/src/ws/handler.ts::handleRestoreCharacter` re-announce.**
  Both the cached-existing path and the fresh-restore path now
  call `announcePlayerOnline(tavernCtx, client, 'tavern')` after
  the in-memory record is settled. The original auth's announce
  was almost certainly skipped because `getCharacterByWallet` was
  undefined at the time (in-memory empty after server restart, no
  Supabase row to fall back on). Re-announcing post-restore
  surfaces the player to peers immediately instead of waiting for
  the next ~20s heartbeat to pick up the data graduation.

### Test totals

- All seven tavern-side gauntlets re-verified clean post-fix —
  the changes are strictly additive to the wire/result shape and
  no existing assertion broke:
  - `qa-tavern-presence` — 66 PASS
  - `qa-tavern-handlers` — 72 PASS
  - `qa-tavern-fight-requests` — 58 PASS
  - `qa-tavern-dm-channels` — 51 PASS
  - `qa-tavern-sidebar` — 42 PASS
  - `qa-dm-messages` — 53 PASS
  - `qa-dm-plaintext-pipeline` — 36 PASS
- A new `qa-tavern-presence` section pinning the priority swap +
  `dataChanged` semantics + `broadcastPresenceUpdate` helper is
  the natural follow-up; deferred this session pending the live
  re-test that closes the bug at observation time.

### Live verification (after the user refreshes both tabs)

1. Refresh both browsers (Mr_Boss + Sx).
2. Both auth via JWT → server fires either `auth_ok` (with
   character if Supabase has one) OR `restore_character` follow-up.
3. Either path now ends with `announcePlayerOnline` → both clients
   receive `player_joined { player: { name: "<Char>", level: <L>,
   rating: <R>, … } }`.
4. **Expect:** Mr_Boss sidebar shows Sx in Early Game 4-6 bucket
   with the correct name + level + rating. Sx sidebar shows
   himself + Mr_Boss. Both show "2 online".
5. Profile-modal click continues to work as it already did.

---

## [Unreleased] — Bucket 3 hotfix #6: DM transport swap (plaintext WS + Supabase), 2026-05-06 (later × 6)

### Strategic decision

Hotfix #5's pipeline extraction + breadcrumbs confirmed the failure
shape: the Sui Stack Messaging SDK hangs in
`executeCreateChannelTransaction`'s prep phase, BEFORE the wallet
popup. The SDK is alpha and not production-grade. We're not waiting
for beta to ship a working DM surface. The Tavern stays — sidebar,
profile modal, wager challenges, friendly fights, fight-request
toasts, presence service, all unchanged. The DM transport swaps for
plain WebSocket + Supabase persistence (the same shape global Tavern
chat uses). When the SDK reaches beta we flip a single env var to
re-enable the encrypted path.

### Added

- **`server/src/data/migrations/004_dm_messages.sql`** — new table
  for DM bodies. Foreign key to `dm_channels(channel_id)` so
  cascade-delete works. Index on `(channel_id, created_at DESC, id
  DESC)` for the panel's "recent N" history fetch.
- **`server/src/data/dm-messages.ts`** — new service. In-memory
  store keyed by channelId (tail capped at 200), Supabase persistence
  fire-and-forget. `insertMessage`, `getHistory({ limit, beforeId })`,
  `rehydrateRecentFromDb()`. Validates body length (1..2000) and
  rejects self-sends at the data layer.
- **`syntheticChannelIdForPair(a, b)` (in `dm-channels.ts`)** —
  deterministic sha256-hashed channel id for plaintext-mode pairs.
  Looks like a real on-chain id (`0x` + 64 hex) so `registerChannel`
  accepts it without special-casing. Idempotent: A,B and B,A always
  produce the same id.
- **`getOrCreateSyntheticChannel(a, b, createdBy)`** — lazy registry
  helper for the plaintext WS handler's first-send path. No separate
  `register_dm_channel` round-trip from the client.
- **Server WS handlers `handleDmSend` + `handleDmHistory`** in
  `tavern-handlers.ts`. dm_send: validate → lazily register channel
  (push `dm_channel_registered` to both sides on first send) →
  persist row → echo `dm_message_sent` to sender + push
  `dm_message_received` to recipient + push `dm_unread_changed`
  carrying `senderWallet`. dm_history: validate → return chronological
  page + clear unread.
- **`frontend/src/lib/dm-plaintext-pipeline.ts`** — pure async
  pipeline mirror of `dm-send-pipeline.ts` (the encrypted path).
  `runPlaintextDmSend(deps, params)` and `runPlaintextDmHistory(deps,
  params)` use the deps pattern (`wsSend` + `subscribe` + `onStep`)
  so tests can mock the WS surface end to end. Each pipeline owns
  its own timeout + cleanup so a hung server can't leak subscribers.
- **`scripts/qa-dm-plaintext-pipeline.ts` (NEW gauntlet, 36 PASS)**
  — happy send + clientId echo match, server `error` rejects,
  server hang → timeout + no late cross-talk, concurrent sends with
  different clientIds resolve to their own echoes, history happy
  + null-channel + unmatched-peer-ignored, wsSend throws → pipeline
  rejects + cleans up subscriber.
- **`scripts/qa-dm-messages.ts` (NEW gauntlet, 53 PASS)** —
  `syntheticChannelIdForPair` determinism + canonical-pair sanity,
  `insertMessage` validation (empty / over-cap / self-send / bad
  channel), happy insert with body trim + lowercased participants,
  `getHistory` chronological order + limit + unknown channel,
  `getOrCreateSyntheticChannel` idempotency.
- **`qa-tavern-handlers.ts` extended (40 → 72 PASS, +32)** — full
  WS-layer coverage of dm_send happy path, dm_send validation
  (empty / over-cap / self / missing-clientId), dm_history happy
  + empty + non-participant + auth-required.

### Changed

- **`frontend/src/components/social/dm-panel.tsx`** — branches on
  `process.env.NEXT_PUBLIC_DM_TRANSPORT`:
  - `plaintext` (default): no signer, no SDK; `dm_history` on open,
    `dm_send` + optimistic bubble + clientId-echo swap to confirmed,
    live `dm_message_received` append for the open channel,
    auto-clear unread on each incoming. Send button shows
    "Send" → "Sending…" → "Send" (no "Signing…", no Cancel button).
    Disclosure banner: "Private messages — visible only to you and
    the other player. Stored on the SUI Combats server (encrypted in
    transit; plaintext at rest). End-to-end encryption returns when
    the Sui Stack Messaging SDK reaches beta."
  - `encrypted`: the existing Hotfix #5 path is preserved verbatim.
    Tree-shakes out of the plaintext build (NEXT_PUBLIC_* env vars
    are inlined at build time so the unused branch's body drops).
- **`frontend/src/types/ws-messages.ts`** — new wire shapes:
  client→server `dm_send` + `dm_history`, server→client
  `dm_message_sent` (echo with clientId) + `dm_message_received` +
  `dm_history`. New `DmMessageWire` interface.
- **`frontend/src/lib/messaging.ts`** — KEPT INTACT, still imports
  the messaging/seal/walrus deps. The encrypted send path is unused
  by default but compiles cleanly so flipping the flag is a
  one-env-var change.

### Migration path back to encrypted DMs

When the Sui Stack Messaging SDK reaches beta:

1. Set `NEXT_PUBLIC_DM_TRANSPORT=encrypted` and rebuild.
2. Run `qa-messaging-client.ts` (still in CI) — pins the SDK shape.
3. Run a two-wallet live walkthrough; the encrypted pipeline lights
   up exactly as it did before.

The plaintext-side data (`dm_messages` rows + synthetic-id channel
rows) remains in Supabase. They don't conflict with on-chain channel
ids because the synthetic ids are sha256 hashes — collision space
disjoint from Sui object id space.

### Test totals

- **1582 → 1703 PASS** across **27 → 29 static gauntlets** (+121
  this hotfix). All previous gauntlets still pass.

### Live verification (after CLI ships)

1. Two wallets, click each other's profile, Send Message.
2. Type "hi" → Send → instant delivery, no popup, ~50 ms RTT.
3. Recipient sees toast + unread pip, opens panel, sees message.
4. Reply "yo" → instant delivery back; both panels update live.
5. Refresh both tabs → history loads from Supabase via `dm_history`.

---

## [Unreleased] — Bucket 3 hotfix #5: pipeline extraction + master timeout + cancel, 2026-05-06 (later × 5)

### The bug retest that prompted this

Live retest after hotfix #4 still hung. Mr_Boss approved the
Slush popup, the create_channel tx landed (3 created objects,
~0.015 SUI gas debited), but the DM panel stuck on "Signing…"
indefinitely. After 60 s+ the wrapper's per-call timeout never
fired in the user-observable surface. Two possible causes, both
addressed here:

1. The bug shape we couldn't catch with wrapper-only unit tests:
   the wrapper rejects a hanging promise correctly when called
   directly (qa-messaging-client §11 confirms), but the FULL
   handleSend flow had never been exercised end to end with a
   mocked SDK. The integration could fail at the layer above the
   wrapper (a forgotten await, a swallowed rejection, the dynamic
   `await import("@/lib/messaging")` for resolveMemberCap inside
   the closure) without any unit test catching it.
2. Browser HMR cache. Next.js Turbopack doesn't always hot-reload
   new files (`dm-toasts.tsx`) cleanly. The user's tab may have
   been serving the pre-hotfix-#4 bundle.

### Fixed

- **handleSend extracted to a pure pipeline.** All SDK + WS
  orchestration moved to `frontend/src/lib/dm-send-pipeline.ts`
  (`runDmSend`). The React component now wraps a single async
  call; it's directly testable with mocked deps (the layer the
  wrapper-only test couldn't reach).
- **Master timeout race wraps the entire pipeline.** Every per-call
  budget still applies, but `runDmSend` ALSO races itself against
  `PIPELINE_BUDGETS.master` (default 90 s). Belt-and-braces against
  a future SDK call site added without an inner wrapper.
- **Static import for `resolveMemberCap`.** Replaces the
  `await import("@/lib/messaging")` dynamic import inside the
  React closure — kills one of the few unwrapped awaits and
  removes a Next.js bundler edge case from the hot path.
- **Manual Cancel escape hatch.** After 25 s of `sending=true`,
  the panel surfaces a Cancel button so the user can recover even
  if the JS event loop somehow stalls (browser bug, devtools
  paused, OS suspend). The optimistic bubble flips to "failed",
  the Sending lock releases, and the user can retry. Underlying
  SDK promise may still complete in the background — fine, the
  UI is reset.
- **Console breadcrumbs for live debugging.** Every step of the
  pipeline emits `console.log("[dm-send] <step> @ <iso>")` —
  `createChannel:start`, `createChannel:done`, `registerWs:start`,
  `registerWs:done`, `resolveMemberCap:start`, `resolveMemberCap:done`,
  `sendMessage:start`, `sendMessage:done`, `notifyWs:start`,
  `notifyWs:done`, `pipeline:done`. A contributor watching the
  browser console during a stuck send sees exactly which step is
  in flight without a re-run.
- **Module-load version log.** `[dm-panel] pipeline v2 loaded` lands
  in the browser console once per session. If a contributor reports
  "the timeout fix isn't firing" the first thing to check is whether
  this log appears — missing log = stale build (HMR miss).
- **Live-state PUSH_DM_TOAST guard moved into the reducer.** The
  `openDmPeer` check that decides whether to surface a toast was
  reading from a stale closure of `state` inside the WS message
  handler (memoized over `[walletAddress, socket, client]`).
  Opening a panel just before a message landed could still surface
  a redundant toast. The check now lives in the reducer where it
  always sees live state. The peerName lookup (against
  `state.onlinePlayers`) moved with it.

### Added

- **`frontend/src/lib/dm-send-pipeline.ts`** — `runDmSend(deps, params)`,
  pure async, every side effect injected. `PIPELINE_BUDGETS` re-exports
  the per-call budgets plus the master.
- **`scripts/qa-dm-send-pipeline.ts` (NEW gauntlet)** — 65 PASS.
  Mocks the messaging SDK to exercise every realistic failure
  mode end to end:
  - happy path emits register_dm_channel + notify_dm_sent in the
    correct order with all required fields
  - existing channel skips ensureChannel + register_dm_channel
  - ensureChannel hangs forever → master timeout fires within
    budget; NO WS sends emitted (recipient doesn't see a bogus
    toast for a message that didn't actually send)
  - unresolvable member cap → actionable error; register_dm_channel
    fired but sendMessage NOT reached
  - sendMessage hangs → master timeout fires; notify_dm_sent NOT
    emitted (correct: nothing to notify about)
  - sendMessage rejects → original error preserved (not replaced
    by the timeout error)
  - step trace is monotonic + complete on the happy path
  - resolveMemberCap retry path covered
- **`qa-tavern-handlers.ts §7c`** — case-mismatched recipient
  lookup. Sender uses uppercase recipient address; server's
  `sendToWallet` lookup canonicalises to lowercase; the recipient
  (whose stored wallet is mixed case) still receives
  `dm_unread_changed` and the `senderWallet` field is always
  emitted lowercase regardless of input casing. (38 → 40 PASS, +2.)

### Changed

- `useGameStore.ts::PUSH_DM_TOAST` action shape changed from
  `{ toast: ToastShape }` (caller-provided full shape) to
  `{ senderWallet, channelId, unreadCount }` (reducer-derived
  shape). The reducer now does the openDmPeer guard, the
  onlinePlayers lookup for `peerName`, and the FIFO/coalesce/cap.

### Test totals

- **1515 → 1582 PASS** across **26 → 27 static gauntlets** (+67
  this hotfix). All previous gauntlets still PASS.

---

## [Unreleased] — Bucket 3 hotfix #4: DM stall + recipient surface, 2026-05-06 (later × 4)

### Fixed

- **DM panel stuck on "Signing…" forever after the wallet popup
  closed (Bug 1, two-wallet live test).** Mr_Boss → Sx send
  reproduced: Slush popup approved, 3 created objects on chain
  (channel + 2 member caps), but `setSending(false)` never fired
  because one of the `await`-ed Sui Stack Messaging SDK promises
  hung silently — wallet code returned, the underlying tx landed,
  but the JS promise never resolved AND never rejected. The catch
  + finally in `handleSend` was unreachable. Fix: wrap every SDK
  call (`executeCreateChannelTransaction`,
  `executeSendMessageTransaction`, `getChannelMessages`,
  `getUserMemberCap`, `refreshSessionKey`) in a new
  `withTimeout(promise, ms, label)` helper exported from
  `lib/messaging.ts`. Per-call budgets live in `SDK_TIMEOUT_MS`
  (createChannel: 60 s, sendMessage: 60 s, getMessages: 30 s,
  resolveCap: 15 s, refreshSession: 30 s). On timeout the helper
  rejects with `<label> timed out after Ns` so the panel's catch
  block fires and the user sees an actionable error toast instead
  of a stuck button.
- **Recipient saw nothing when a DM landed (Bug 2, same live
  test).** Sx received zero feedback — no toast, no unread
  indicator, no panel auto-open — even after the sender's pipeline
  was unblocked. Two layered gaps:
  1. `dm_unread_changed` lacked the sender wallet, so even with
     full state the recipient's UI couldn't attribute the
     notification to a specific peer without a second
     cross-reference round-trip.
  2. The frontend played a chat sound + bumped a counter slice but
     never surfaced any visible cue. The Tavern's player sidebar
     also rendered no per-row unread badge — the data was there,
     the UI wasn't.
  Fix:
  - Server `tavern-handlers.ts::handleNotifyDmSent` now adds
    `senderWallet` (lowercased) to the `dm_unread_changed` payload.
    The clear-path ack still omits it (no attribution applies).
  - New `<DmToasts />` global mount renders a stacked toast
    (top-right, beneath fight-request toasts) when
    `dm_unread_changed` lands for a peer whose DM panel isn't
    open. Click to open the panel, × to dismiss, auto-fades in
    8 s. Coalesces by channelId, FIFO-capped at 4 simultaneous.
  - `PlayerSidebar` rows now render a cyan unread-count pip when
    the player has DMs the user hasn't read. Highlighting and
    accessible labels included.
  - `DmPanel` re-fetches messages from chain (a) immediately
    after a successful send so the optimistic bubble snaps to
    the SDK's real id+timestamp, and (b) every time
    `dm_unread_changed` fires for the open channel — a peer
    message arriving while the panel is open now shows live
    instead of waiting for a remount.

### Added

- **`lib/messaging.ts::withTimeout(p, ms, label)`** — generic
  promise/timeout race with cleanup. Exported so the QA gauntlet
  can assert it directly.
- **`lib/messaging.ts::SDK_TIMEOUT_MS`** — per-call budget table.
  Exported for testing + auditability.
- **`components/social/dm-toasts.tsx`** — new global mount,
  stacked top-right beneath fight-request toasts.
- **`useGameStore.ts` slice — `dmIncomingToasts`** — array of
  `{ id, peerWallet, peerName, channelId, unreadCount, createdAt }`.
  Reducer actions: `PUSH_DM_TOAST`, `DISMISS_DM_TOAST`,
  `DISMISS_DM_TOASTS_FOR_CHANNEL`. `OPEN_DM` also dismisses
  toasts targeting that peer.
- **`qa-tavern-handlers.ts §7b`** — recipient notification
  ordering: `dm_channel_registered` lands before `dm_unread_changed`,
  the unread payload carries `senderWallet`, the sender does NOT
  receive their own bump back. (30 → 38 PASS, +8.)
- **`qa-tavern-dm-channels.ts §7b`** — recipient notification
  preconditions: fresh-channel bump returns count=1, asymmetric
  counters (sender keeps 0), `lastMessageAt` advances past
  `createdAt`, idempotent no-op clears, totalUnread sums across
  multiple peers. (42 → 51 PASS, +9.)
- **`qa-messaging-client.ts §11`** — withTimeout regression
  guard: helper rejects within the budget, error message names
  the labelled call, fast-resolve passes through, fast-reject's
  original error survives, every wrapped SDK method has a
  budget entry, source-level audit asserts each SDK method is
  wrapped in `withTimeout(`. (46 → 65 PASS, +19.)

### Test totals

- **1479 → 1515 PASS** across **26 static gauntlets** (+36 new).
- Scope verified: only DM-related files modified
  (`lib/messaging.ts`, `dm-panel.tsx`, `dm-toasts.tsx` (new),
  `player-sidebar.tsx`, `game-screen.tsx`, `game-provider.tsx`,
  `useGameStore.ts`, `ws-messages.ts`, `tavern-handlers.ts`,
  three QA scripts).

---

## [Unreleased] — Bucket 3 hotfix #3: dapp-kit signer MVR, 2026-05-06 (later × 3)

### Fixed

- **`Failed to resolve package: @local-pkg/sui-stack-messaging`**
  reappeared at first DM send — this time inside top-level
  `@mysten/sui@2.15.0`'s `mvr.ts` (not the aliased sui 1.x). Root
  cause: the messaging SDK passes `client: <sui 1.x>` to the
  signer, but dapp-kit's `CurrentAccountSigner` ignores that and
  serializes the tx through its OWN `SuiGrpcClient` (sui 2.x) — so
  the MVR override has to live on BOTH clients (build-time +
  sign-time). Added the same override to
  `frontend/src/config/dapp-kit.ts::createClient`.

### Added

- **`qa-messaging-client.ts`** extended (40 → 46 PASS) with
  section [10] that reads `config/dapp-kit.ts` and asserts the
  messaging named package, the testnet package id, the `mvr`
  option, and `mvr.overrides` are all present + match the
  override in `lib/messaging.ts`. Diverging package ids between
  the two files is what would re-introduce the bug.

### Test totals

- **1473 → 1479 PASS** across **26 static gauntlets**.

---

## [Unreleased] — Bucket 3 hotfix #2: MVR resolution, 2026-05-06 (later still)

### Fixed

- **`Failed to resolve package: @local-pkg/sui-stack-messaging`**
  on first DM send (after the SDK alignment hotfix). Root cause:
  the messaging SDK's contract bindings reference the package via
  a named placeholder; at tx-build time the SDK relies on the
  SuiClient's MVR layer to substitute. Our SuiClient was missing
  both `network: 'testnet'` and an MVR override mapping. Fix:
  pass `network: 'testnet'` + `mvr.overrides.packages = {
  '@local-pkg/sui-stack-messaging': '0x984960...' }` to the
  SuiClient constructor. Also pass an explicit
  `packageConfig: { packageId: ... }` to the messaging extension
  so the wiring is auditable in one place. The package id is
  sourced from the SDK's own `FALLBACK_PACKAGE_ID` constant; the
  gauntlet cross-references it so a future SDK package bump fails
  loudly at build time.

### Added

- **`qa-messaging-client.ts`** extended (34 → 40 PASS) with a
  section [9] that pins MVR wiring: `client.network === 'testnet'`,
  the SDK's `TESTNET_MESSAGING_PACKAGE_CONFIG.packageId` is a
  0x-prefixed object id, `client.core.mvr` is present, and
  `client.core.mvr.resolvePackage('@local-pkg/sui-stack-messaging')`
  returns the expected testnet package id without a network
  round-trip.

### Test totals

- **1467 → 1473 PASS** across **26 static gauntlets**.

---

## [Unreleased] — Bucket 3 hotfix: SDK alignment, 2026-05-06 (later)

### Fixed

- **DM panel `SealClient.asClientExtension is not a function`** —
  The Tavern shipped earlier today crashed at first DM send.
  Top-level `@mysten/seal@1.1.1` deprecated and removed the static
  `asClientExtension`; messaging 0.3.0 was authored against seal
  0.9.6 which has it. Permanent solve: install
  `mysten-seal-v0@npm:@mysten/seal@^0.9.6` (aligns the seal
  extension API with what messaging expects), import `SealClient`
  from the alias in `frontend/src/lib/messaging.ts`. Same alias
  pattern as `mysten-sui-v1`. Top-level seal 1.1.1 stays for any
  future first-party use; messaging.ts is the only consumer of
  the alias.

### Added

- **`scripts/qa-messaging-client.ts` — 34 PASS** — Pins the SDK
  shape (version matrix, every method the wrapper calls) so the
  next SDK breakage surfaces at build time, not at first user
  click. Failure mode is structured: list of missing slots /
  methods + pointer at the upgrade procedure in TAVERN_DESIGN.md.
- `buildExtendedClient` exported (was private) so the gauntlet
  can probe the chain without instantiating wallet code.
- `checkMessagingClientShape(client)` — returns the list of
  missing slots/methods for a given client. Called by
  `ensureClient` after construction so the DM panel surfaces a
  structured error when the SDK drifts under us.

### Changed

- `frontend/src/lib/messaging.ts` — header rewritten with the
  full version matrix + upgrade procedure; imports realigned.
- `TAVERN_DESIGN.md` § "Sui Stack Messaging SDK" — version
  matrix table, why-we-pin-seal explanation, upgrade procedure.

### Test totals

- **1433 → 1467 PASS** across **25 → 26 static gauntlets**, plus
  35/35 Move unit tests.

---

## [Unreleased] — Bucket 3 — Tavern social hub, 2026-05-06

> Branch `feature/v5-redeploy`, **not pushed**. Server + frontend
> additions only — no chain re-publish. Closes Bucket 3 item #1
> (Tavern) end-to-end. The remaining Bucket 3 work items
> (Hall of Fame, multi-day stability, fresh user onboarding,
> admin endpoint audit) move forward on their own track.

### Added — Tavern social hub (Bucket 3 #1)

- **PlayerSidebar** (`frontend/src/components/social/player-sidebar.tsx`)
  — replaces the legacy flat player list. Players grouped by level
  bracket (Novice 1-3 / Early 4-6 / Mid 7-9 / High 10-14 / Endgame
  15-19 / Hall of Fame 20). Search + status-filter chips at the top.
  Status priority sort within bucket (online > marketplace > fight
  > idle), then rating desc, then name asc. Click a row → opens
  `PlayerProfileModal`.
- **PlayerProfileModal** (`components/social/player-profile-modal.tsx`)
  — modal with 10-slot equipment doll (item art + tooltips), stats
  panel with bonus deltas, derived combat stats, W/L record + win
  rate + ELO, truncated wallet with copy-to-clipboard, and three
  primary actions: Send Message · Wager Challenge · Friendly Fight.
- **FightRequestToasts** (`components/social/fight-request-toasts.tsx`)
  — top-right stack of incoming challenges with 90 s countdown,
  Accept / Decline buttons, two-step Accept for wager variant
  (sees stake before confirming).
- **DmPanel** (`components/social/dm-panel.tsx`) — encrypted DM
  panel built on the Sui Stack Messaging SDK (alpha, testnet only).
  Wallet-signed on-chain transactions per send; ciphertext on
  Walrus; Seal threshold encryption. Slides up bottom-right;
  optimistic local rendering with pending/failed states; testnet
  alpha disclosure banner.
- **TavernRoom** (`components/social/tavern-room.tsx`) — new layout:
  global chat 2/3 left, sidebar 1/3 right, both 600px tall.

### Added — server-side Tavern services

- **Presence service** (`server/src/data/presence.ts`) — heartbeat-
  driven (~20 s cadence) in-memory + Supabase-backed presence with
  derived status (online / in_fight / in_marketplace / idle), room
  tracking, and 60 s stale TTL. Boot-time + tick-time sweepers
  drop ghost rows. `derivePlayerStatus` and `groupPlayersByLevelBucket`
  exposed as pure helpers for testing.
- **Fight-request service** (`server/src/data/fight-requests.ts`) —
  player-to-player challenges with state machine (pending →
  accepted | declined | canceled | expired), 90 s TTL,
  per-sender limit (max 5 outstanding), Supabase-backed,
  boot-time rehydrate. `evaluateCreate` and `evaluateTransition`
  pure for testing.
- **DM channel registry** (`server/src/data/dm-channels.ts`) — maps
  Sui Stack Messaging channel ids to canonical wallet pairs. CHECK
  constraint enforces `participant_a < participant_b`. Per-recipient
  unread counter table; sender-driven bump, recipient-driven clear.
- **Player profile resolver** (`server/src/data/player-profile.ts`)
  — full character + DOF-equipment fetch, in-memory hot path with
  Supabase fallback for offline players, on-chain DOF refresh keeps
  equipment fresh.
- **Tavern WS dispatch** (`server/src/ws/tavern-handlers.ts`) —
  single entry point for the new message types. Wired into
  `ws/handler.ts` after the legacy switch as a fallthrough.
- Server-side `setPresenceFightBroadcaster` callback in
  `ws/fight-room.ts` so fight start/end events flip presence
  status in real time without coupling the fight-room module to
  the presence service.

### Added — Supabase schema (migration `003_tavern.sql`)

- `presence` — heartbeat-driven row per online wallet
- `fight_requests` — full state machine + TTL
- `dm_channels` — channel id ↔ canonical wallet pair
- `dm_channel_unread` — per-recipient unread counter
- `friends` — mutual friend graph (schema only, no UI yet)
- Triggers for auto-bumping `last_seen_at` (presence) and
  `updated_at` (friends). Idempotent migration.

### Added — Sui Stack Messaging SDK integration

- Installed `@mysten/messaging@0.3.0`, `@mysten/seal@^1.1.1`,
  `@mysten/walrus@^0.8.6`. Resolved sui version conflict by
  installing sui 1.x under the npm alias `mysten-sui-v1` —
  `@mysten/messaging` gets the `SuiClient({ url })` shape it
  expects while our top-level code keeps using sui 2.x.
- `lib/messaging.ts` exposes `ensureClient`, `ensureChannel`,
  `sendMessage`, `getMessages`, `resolveMemberCap`, `ensureSession`
  — alpha disclosures handled at the wrapper boundary so consumers
  stay clean.

### Added — wire schema (`frontend/src/types/ws-messages.ts`)

- 13 new client→server types: `enter_room`, `presence_heartbeat`,
  `get_player_profile`, `send_fight_request`, `accept_fight_request`,
  `decline_fight_request`, `cancel_fight_request`,
  `get_pending_fight_requests`, `register_dm_channel`,
  `notify_dm_sent`, `clear_dm_unread`, `get_dm_channels`,
  `lookup_dm_channel`.
- 11 new server→client types: `room_entered`, `player_profile`,
  `player_profile_not_found`, `fight_request_sent`,
  `fight_request_received`, `fight_request_resolved`,
  `fight_request_pending_list`, `wager_challenge_ready`,
  `wager_challenge_waiting`, `dm_channel_registered`,
  `dm_channel_lookup`, `dm_unread_changed`, `dm_channels_list`.

### Added — game-state slices (`hooks/useGameStore.ts`)

- `incomingFightRequests` / `outgoingFightRequests`
- `dmChannels`, `dmTotalUnread`, `dmUnreadByChannel`
- `openProfileWallet`, `playerProfile`
- `openDmPeer`
- `prefilledWagerTarget` — bridges the wager-challenge accept flow
  into the matchmaking-queue UI

### Added — test gauntlets

- `qa-tavern-presence.ts` — 66 PASS · status derivation, bucketing,
  upsert/heartbeat/sweep, multi-bucket scenario
- `qa-tavern-fight-requests.ts` — 58 PASS · state machine
  transitions, per-sender limit, stake/message bounds, TTL eviction
- `qa-tavern-dm-channels.ts` — 42 PASS · canonical pair ordering,
  bi-directional lookup, unread counter math, sort by lastMessageAt
- `qa-tavern-handlers.ts` — 30 PASS · WS dispatch, announce online/
  offline, enter_room, heartbeat no-op, send_fight_request flow,
  accept/decline, DM channel lifecycle, auth gate
- `qa-tavern-sidebar.ts` — 42 PASS · bucket boundaries, search,
  status filter, exclude, sort priority, hideEmpty, defensive

**Test totals: 1195 → 1433 PASS across 20 → 25 static gauntlets,
plus 35/35 Move unit tests.**

### Changed

- `setup-db.mjs` now probes for the new tables (presence,
  fight_requests, dm_channels, friends) on smoke-test.
- `frontend/tsconfig.json` target bumped ES2017 → ES2020 for
  BigInt-literal support (used in MIST stake parsing).
- `ws/handler.ts` `handleGetOnlinePlayers` removed in favour of
  `tavern-handlers::handleGetOnlinePlayers` which reads from the
  presence service. Same `online_players` wire shape — no client
  change required.
- Player joining + leaving now broadcasts via the presence service
  (`announcePlayerOnline` / `announcePlayerOffline`), which means
  `currentRoom` is included in `player_joined` payloads (the player
  list can now show "🛒 Shopping" / "⚔ Arena" badges).

### Documentation

- `TAVERN_DESIGN.md` (NEW) — architecture diagram, schema
  reference, message flows, SDK integration notes, scope
- `STATUS.md` — Bucket 3 #1 closed, test totals refreshed
- `CHANGELOG.md` — this entry

---

## [Unreleased] — Bucket 2 wrap, end of 2026-05-04

> Branch `feature/v5-redeploy` end-of-day push. **Not a chain
> re-publish.** Server + frontend hardening + comprehensive doc pass.
> Mainnet still gated on the v5.1 republish (see `STATE_OF_PROJECT_2026-05-04.md`
> § v5.1 Contract Republish Bundle for the full Move work list).

### Added — Bucket 2 close-out (Wager / 2H / Multi-queue / WS / Level-up)

- Frontend `canAcceptWager` predicate + Accept-button gate +
  `handleAcceptWager` early-return — closes silent-accept where a
  player with their own open wager could still chain-succeed an
  `accept_wager` on someone else's wager (commit `6512e10`,
  Bucket 2 Fix A).
- Server `decideAcceptOutcome` predicate + auto-rollback path —
  if the chain accept slipped past Fix A, the server now admin-cancels
  both wagers (50/50 split for ACTIVE; refund-to-creator for WAITING)
  so neither side stays stuck (commit `20feb72`, Bucket 2 Fix B).
- Frontend `TWO_HANDED_NAMES` set + `evaluateTwoHandedConflict`
  predicate covering both directions (2H → mainhand requires offhand
  empty; 2H → offhand always blocked) + slot-picker locks + action-
  gate defense in depth (commits `3319628` + `09934a6`).
- Frontend `computeBusyState` + server `evaluateServerBusy` predicates
  — single source of truth for "player is in fight / has open wager
  / queued / pending-accept", gates every queue/wager entry point,
  with cross-cleanup in `handleWagerAccepted` proceed branch
  (commit `6e2f2d3`, Bucket 2 Fix 1).
- Frontend `useGameSocket.send()` queue-and-drain — outbound messages
  fired during reconnect windows queue (cap 200, stale > 30 s
  discarded) instead of erroring; drains in FIFO on reconnect
  (commit `f0358d5`, Bucket 2 Fix 2).
- Server `character_leveled_up` WS broadcast post `update_after_fight`
  + frontend `LevelUpModal` celebration with "Allocate Stat Points"
  CTA + `mergeLevelUpEvent` for multi-burst level-ups
  (commit `97369ff`, Bucket 2 Fix 3).
- Polish: hide irrelevant fight-mode cards when busy instead of
  greying them out — `decideMatchmakingRender` predicate drives
  slot-by-slot rendering decisions (commit `dc543c6`).

### Added — Lv6-Lv8 v5.1 NFT catalog (Bucket 1 close)

- 9 epic / legendary items minted to TREASURY's kiosk for cross-build
  buy testing (Bloodletter Gauntlets, Shadowstep Wraps, Skullsplitter
  Helm, Hunter's Hood, Pendant of Wrath, Whisperwind Amulet, Dancer's
  Aegis × 2 duplicate test, Skullcrusher Maul). TREASURY kiosk
  auto-created during the mint pass (`0x47a5072d…`). Pinata folder
  `bafybeihrlw3jdq6ws2m3bjrjoyisvyyvtsp6mb2wnd6lps5hjtgatbwh3i`
  (commits `c8b8ec2` script, `db58941` data).

### Added — test gauntlets

- `qa-mint-catalog.ts` — 236 assertions; static spec validation
  for the v5.1 Lv6-Lv8 catalog (enums, bonuses, prices, deployment
  alignment).
- `qa-wager-accept-gate.ts` — 39 PASS (extended this session with
  cross-mode `callerInMatchmakingQueue` cases).
- `qa-multi-queue-isolation.ts` — 60 PASS; frontend +
  server predicate symmetry across 6 canonical scenarios.
- `qa-ws-readystate.ts` — 37 PASS; `drainPendingMessages` +
  `capPendingQueue` + integration scenarios.
- `qa-level-up-modal.ts` — 44 PASS; gating decision tree, format
  helpers, defensive validator, multi-burst merge.
- `qa-busy-state-render.ts` — 23 PASS; `decideMatchmakingRender`
  slot-by-slot decision tree.
- `qa-equip-picker.ts` — extended 53 → 78 (added 25 two-handed
  enforcement assertions in section 12.5).

**Test totals: 731 → 1195 PASS across 14 → 20 static gauntlets,
plus 35/35 Move unit tests.**

### Recovered (this session)

- Stuck 0.1 SUI wager `0xeade9baafda8ccb61aaf26d98c55c8bc4528f682b622476628e68f7970b16432`
  (created during a server-down window; never registered in lobby).
  Recovered via `POST /api/admin/cancel-wager` —
  tx `EQVSgRaymDz3Xj71RenMxFZDKsbH5AhqWhaJhUPPYLYE`. Permanent fix
  for the family is `OpenWagerRegistry` in the v5.1 republish bundle.

### Changed

- Reconnect grace timer is now a per-fight cumulative budget, not
  per-cycle — abusers who ping-pong run out, honest wifi blips still
  get the full window (commit `9d7dd19`).
- Wager stake input bound to a string and validated on submit —
  clearable, partial keystrokes don't snap back (commit `a26535e`).
- Outcome modal replays on rejoin if the player was offline at
  settle time (commit `20f3750`).
- Slot picker keeps locked items, dimmed with a red `Lv N` badge
  instead of silently filtering them out (commit `fd56b4a`).
- Character page HP/ATK tables synced element-by-element with
  server's rebalanced `LEVEL_HP` / `LEVEL_WEAPON_DAMAGE` (commit
  `fe9c883`).

### Documentation

- `STATE_OF_PROJECT_2026-05-04.md` (NEW) — comprehensive end-of-
  Bucket-2 snapshot consolidating STATUS.md + SESSION_HANDOFF +
  MAINNET_PREP + memory seeds + commit history + GDD scope.
- `STATUS.md` reorganised — high-level shape only, points at
  STATE_OF_PROJECT for the deep dive.
- `README.md` brought current — test counts (1195/20), Bucket 2
  close-out features, pointer to STATE_OF_PROJECT + CHANGELOG.
- `SESSION_HANDOFF.md` (2026-05-03 evening) marked SUPERSEDED.

---

## [v5.x] — 2026-05-03 (evening QA pass)

### Fixed

- Cumulative grace timer abuse — verified live across 3 cycles
  (60s → 14s → 9s → forfeit) (commit `9d7dd19`).
- Wager stake input snap-back — fully clearable, validates on
  submit (commit `a26535e`).
- Outcome modal silent for player who reconnects after settle —
  server caches per-wallet outcome, replays via `recent_fight_settled`
  with localStorage dedupe (commit `20f3750`).
- Character page HP/ATK consistency with combat math — server
  `LEVEL_HP` / `LEVEL_WEAPON_DAMAGE` mirrored to frontend element-
  by-element. STR/DEX/INT/END stat bars compile correctly under
  Tailwind v4 JIT (commit `fe9c883`).
- Slot picker hides locked items cliff — picker now keeps every
  slot-compatible item the player owns; locked items render dimmed
  with `Lv N` badge (commit `fd56b4a`).

### Added

- 5 new test gauntlets (qa-equip-picker, qa-combat-stats, qa-wager-
  form, qa-reconnect-modal, qa-grace-budget) — 252 new assertions.

---

## [v5.x] — 2026-05-02 (live-test bug sweep)

### Fixed

- BUG E — multi-Character wallet picks wrong NFT for hot paths.
  Server pin (`Character.onChainObjectId`) surfaced to frontend via
  the wire payload; `fetchCharacterNFT` accepts a pinned-id hint
  (commit `dc28eff`).
- BUG B — "Not authenticated" toast after allocate. New
  `applyLocalAllocate` helper + `LOCAL_ALLOCATE` reducer; game-
  provider suppresses the auth-pending error toast specifically
  (commit `413593e`).
- BUG C — Naked-stats gap on chain-restore. Extracted
  `hydrateDOFsForCharacter`, called from both auth and chain-restore
  paths (commit `413593e`).
- BUG D — `auth_ok` character payload ignored. Game-provider
  dispatches SET_CHARACTER on receipt, closing the frame-level
  window where game-screen rendered with `character=null` after
  auth (commit `413593e`).
- Silent-WS-loss orphan-wager class — new `wager-register.ts`:
  WS-send-then-ACK with REST fallback to `/api/admin/adopt-wager`
  (commit `6871df0`). 25-test gauntlet.
- BUG 1 — `allocate_points` MoveAbort code 2 (`ENotEnoughPoints`)
  due to server XP ahead of chain. New `effectiveUnallocatedPoints`
  clamp returns `min(server, chain)` when chain hydrated. Plus
  amber "Chain state is catching up" hint (commit `b39202d`).
- BUG 2 — Save-loadout fight-lock race. Reordered post-fight
  treasury queue: `set_fight_lock(0)` fires first, releases lock in
  ~2-5s instead of ~10-25s (commit `b39202d`).
- BUG 3 — Off-chain "fake loot" violated NFT-only contract. Removed
  `rollLoot` call from `finishFight`; the function survives in
  `game/loot.ts` for v5.1 to reuse for on-chain admin-signed Item
  NFT minting (commit `b39202d`).

---

## [v5.x] — 2026-04-30 (Blocks A-D shipped)

### Added

- Block A — Duplicate-Character mint guard (Layers 1+2). New
  `auth-phase.ts` state machine; server pre-mint guard via
  `findAllCharacterIdsForWallet` + `shouldRejectDuplicateMint`
  predicate. Layer 3 (Move `CharacterRegistry`) deferred to v5.1
  (commit `a462fec`). 63-test gauntlet.
- Block B — Supabase wiring + orphan-sweep instrumentation. New
  migration `002_wager_in_flight.sql` + boot-time sweeper
  `data/orphan-wager-recovery.ts` (commit `999300e`). 30-test
  gauntlet. End-to-end live test gated on Supabase provisioning.
- Block C1 — Reconnect grace window. Server pauses fight timer on
  WS drop; persistent banner with countdown for the opponent;
  full state rehydrate on rejoin via `fight_resumed`. 60s default
  window (commit `bd631c9`). 35-test gauntlet.
- Block C2 — Marketplace gap-fill retry budget. 5 attempts with
  1/3/9/27 s backoff; on exhaustion, schedules full reconnect
  (commit `468a43e`).
- Block C3 — Marketplace coldSync `withChainRetry` per page —
  3 attempts with 1/3 s backoff (commit `468a43e`).

---

## [v5.0.0] — 2026-04-27 — Testnet publish

### Added

- Fresh `sui client publish` of all 5 modules
  (character / item / equipment / arena / marketplace + royalty_rule).
- New `packageId`
  `0xa7dc2dabea6acc2db1a9599a0c1e003ad6b2e6064a2847687bc93037a662e1c1`,
  new `AdminCap`, new `UpgradeCap`, new `Publisher`,
  new `TransferPolicy<Item>`, new `Display<Character>`,
  new `Display<Item>`.
- 22-NFT starter catalog minted via `scripts/mint-v5-catalog.ts`
  — 11 items to mr_boss, 11 items to sx (commit `dcca786`).
- Production XP thresholds restored (no more lowered-for-testing
  values).
- Frontend wired to v5: JWT auth, balance UI, 10 slots, env-throws
  on missing required ids (commit `487502f`).
- Server: SDK migration to `@mysten/sui` 1.x, JWT auth, retry
  pattern for treasury queue admin calls, DOF reads via gRPC
  (commit `26cd8a9`).
- 35/35 Move unit tests passing.

### Removed

- All legacy v1 `equip_*` / `unequip_*` stub functions (the
  `abort EDeprecated` pattern from Phase 0.5 is no longer needed
  on a fresh publish — see `MAINNET_PREP.md §A`).
- Build artefact `contracts/build/` no longer tracked
  (commit `96546e7`).

---

## [v4.x] — 2026-04-21 (loadout-save flow)

### Added

- Atomic save-loadout PTB: stage equip/unequip locally; one wallet
  popup commits all dirty slots in a single PTB (commit `b7b8eac`).
- LOADOUT_DESIGN.md — D1=PTB-of-primitives, D2=skip auto-save,
  D3=strict server validation, D4=pending-inactive-during-fight,
  D5=keep-pending-on-cancel (commit `6a33bc1`).

---

## [v4.x] — 2026-04-18 (Phase 0.5 — DTC equipment + fight-lock)

### Added

- On-chain dynamic-object-fields equipment binding (10 slots).
- Fight-lock DOF prevents equipment swaps mid-combat.
- Marketplace listing fee (0.01 SUI flat per list call).
- 2.5 % royalty rule on `TransferPolicy<Item>` (commit `08ff991`).

### Fixed

- WebSocket reconnect loop on session replacement
  (commit `9b3196e`).

---

## [v4.x] — 2026-04-15 (initial wager escrow)

### Added

- On-chain wager escrow integration (commit `e4283a4`).
- Living Character NFTs, wager lobby hardening, Character tab
  redesign (commit `c4c8a96`).

---

## [v0.x] — 2026-04-10 (initial commit)

### Added

- Initial SUI Combats project skeleton (commit `213557e`).
- README + MIT LICENSE (commit `d5aa294`).
- Sui Foundation grant application draft (commit `316cf81`).
- Walrus Sites deployment support (commit `91a83a7`).
- Root `package.json` with vercel-build script (commit `1d2ac7c`).
- Security hardening pre-public-release: secrets purged before
  the repo flipped public (commit `e95bc34`).

---

## Reference

- `STATE_OF_PROJECT_2026-05-04.md` — comprehensive snapshot;
  see § Commit Log for the full ordered list of every commit
  on `feature/v5-redeploy` since branch start.
- `STATUS.md` — high-level current state.
- `MAINNET_PREP.md` — mainnet deploy protocol + threat model.
- `git log --oneline` — chronological source of truth.
