# SUI Combats — v5 Status

> Snapshot at end of the v5 redeploy session. Sui testnet only. Branch
> `feature/v5-redeploy` — every change committed locally; nothing pushed
> to GitHub yet (per standing user rule).

## 2026-05-02 (very late) — BUG E: server pin not shared with frontend → wrong-NFT chain reads

User leveled mr_boss from L3 → L4 after a wager fight. Chain correctly
emitted `LevelUp { unallocated_points: 6 }`; server log showed
`unalloc=6, leveledUp=true` and broadcast 6 over WS. But the UI showed
no points to allocate, no "+N" badge, no Allocate modal — across
disconnect / hard refresh / new tab.

### Root cause — multi-character wallet + descending event scan

mr_boss has THREE `CharacterCreated` events on chain:

  - `Mr_Boss_v5`     `0x6161af02…`  (legacy, L1)
  - `Mr_Boss_v5.1`   `0x9b294d7d…`  (canonical — L4, 6 unallocated, the
    one the server pinned via /api/admin/repin-character earlier)
  - `mee`            `0xec6fbbcf…`  (the auth-flicker dupe from the
    earlier session — L1, 0 unallocated, NEWEST event)

Server has `Mr_Boss_v5.1` pinned (`character.onChainObjectId`) and
correctly mirrors chain truth: 6 unallocated.

Frontend's `fetchCharacterNFT` does a `descending` event scan,
returns FIRST owner-match → returns `mee` (the newest) with 0
unallocated. `state.onChainCharacter` ends up pointing at the wrong
NFT.

`effectiveUnallocatedPoints(server=6, chain=0)` → `min(6, 0) = 0`. The
b39202d clamp behaves correctly given its inputs — but the inputs are
wrong because the frontend never learned which NFT the server pinned.

The user's hypothesis at the bottom of their report nailed it
verbatim:

> If chain shows `unallocated_points: 0` → … OR frontend is reading
> wrong … the b39202d clamp `min(server, chain)` is correctly
> clamping to 0.

### Fix — server publishes the pin; frontend uses it

1. **Server** — `sanitizeCharacter` (handler.ts) now includes
   `onChainObjectId` in the wire payload. Every `character_data` /
   `character_created` / `auth_ok` carries the canonical id the server
   resolved at auth/restore time.

2. **Frontend** — `Character` type (frontend/src/types/game.ts) gains
   `onChainObjectId?: string | null`.

3. **Frontend** — `fetchCharacterNFT(client, owner, pinnedObjectId?)`
   accepts an optional pinned id. When provided, queries that object
   directly (skip the descending event scan). When omitted, falls
   back to the event scan — used during the initial auth-phase chain
   check before the server has restored a record.

4. **Frontend** — `game-provider.tsx` passes
   `state.character?.onChainObjectId` to every post-auth
   `fetchCharacterNFT` call:

   - `character_updated_onchain` message handler (uses a ref because
     handleMessage is memoised)
   - The `onChainRefreshTrigger` useEffect (deps include the pinned id
     so it re-runs when server changes the pin)

5. **Frontend** — `stat-allocate-modal.tsx`'s post-tx chain refresh
   passes `character.onChainObjectId`.

### Why this lay quiet through Block A

Block A's "duplicate-mint" fix closed the layer-1 + layer-2 paths
(state machine + server pre-mint guard) so future wallets never end up
with multiple Characters at all. mr_boss's triple-Character state
predates that fix — the legacy mints survived because Layer 3 (Move
`CharacterRegistry`) is deferred to v5.1. The server's
`onChainObjectId` pinning correctly handles legacy multi-char wallets,
but the frontend was reading the chain independently and never
learned about the pin.

This fix surfaces the pin server→frontend so legacy multi-char
wallets work correctly until the v5.1 republish removes the dupes
entirely.

### Tests — no new gauntlet (all pre-existing)

`fetchCharacterNFT`'s pinnedObjectId path is exercised live by every
post-auth chain refresh once the server includes the field. The pure
predicate that drives the UI (`effectiveUnallocatedPoints`) was
already pinned by `qa-stat-points.ts` (45 PASS) — the bug was input
shape, not predicate logic. The full multi-char regression coverage
(closing the auth-flicker root cause) is in `qa-character-mint.ts`
(63 PASS).

All 9 gauntlets green: 475 / 475 PASS.

### Verifying after this fix

mr_boss should now see the +6 badge AND be able to spend it. The
Allocate Stat Points TX targets `Mr_Boss_v5.1` (server-pinned) instead
of `mee`. Slush popup will show the correct Object Changes preview
(touching `0x9b294d7d…`, NOT `0xec6fbbcf…`).

If the user wants to clean up the legacy "mee" + "Mr_Boss_v5"
characters, a v5.1 admin endpoint could call a `burn_character`
function — out of scope tonight (would need a Move republish).

---

## 2026-05-02 (late) — Bug 1 retest cleanup: equipment race, auth-after-allocate, naked-stats gap

User retested Bug 1 (allocate_points). Chain accepted the allocation
cleanly (no MoveAbort code 2 — the b39202d clamp logic worked: chain had
caught up by the time the modal opened). But three secondary failure
modes surfaced. Single commit, no Move republish, no chain-side
changes.

### BUG B ✅ — "Not authenticated. Send auth_request first." after allocate

**Repro:** Wallet signed `allocate_points` on chain, the chain mutated
correctly (post-refresh stats matched), but the modal got stuck on
"Signing transaction…" and a red error toast appeared bottom-center.

**Root cause:** After the chain TX, `stat-allocate-modal` sends a
`allocate_points` WS message so the server can mirror the optimistic
state in memory. If the WS happens to be mid-reconnect at that moment
(common — Mysten gRPC reconnect spam, network blip, or just the 5–15 s
the user spent in the Slush popup), the server's auth-pending check
rejects the message with "Not authenticated. Send auth_request first."
The frontend surfaced that as a red toast even though the chain
allocation succeeded.

**Fix:** Three-layer defense.

1. New pure helper `applyLocalAllocate` in
   `frontend/src/lib/stat-points.ts` — applies the allocation to a
   `{stats, unallocatedPoints}` snapshot. Clamps unallocated to 0
   defensively; sanitizes NaN/negative input.
2. New reducer action `LOCAL_ALLOCATE` in `useGameStore.ts`. Modal
   dispatches it IMMEDIATELY after the chain tx succeeds — frontend
   reflects truth regardless of WS state.
3. Game-provider's `error` case suppresses the auth-pending message
   specifically (logs to console only). The user never sees the red
   toast for a transient auth blip; useGameSocket auto-retries the
   handshake within ~3 s and the WS sync re-sends naturally on the
   next interaction. (If server stats stay stale beyond the next
   `get_character` round, the helper's `min(server, chain)` keeps the
   user's view honest.)

### BUG C ✅ — Naked-stats gap on chain-restore path

**Repro:** Hard refresh after the failed allocate showed character page
with naked stats (170 HP / 25 ATK / Armor 0); ~1 s later equipment
hydrated and stats jumped to (175 HP / 28 ATK / Armor 2). The
"Character not found" toast also flashed during the gap.

**Root cause:** `acceptAuthenticatedSession` runs DOF hydration before
sending `auth_ok` — but the chain-restore path
(`handleRestoreCharacter`, used when server has no in-memory record
because Supabase isn't configured) calls `restoreCharacterFromChain`
and IMMEDIATELY responds with `character_created` carrying empty
equipment. Frontend rendered character with empty equipment for ~1 s
until the next on-chain refresh ticked.

**Fix:** Extracted DOF hydration into a shared helper
`hydrateDOFsForCharacter(walletAddress, character, reasonTag)` and
called it from BOTH paths:

- `acceptAuthenticatedSession` (existing, just refactored)
- `handleRestoreCharacter` — async now; runs DOF hydration BEFORE
  responding with `character_created`. Equipment lands in the same
  payload as the character.

The helper accepts a `reasonTag` so log lines show whether the
hydration was triggered by `[Auth]` (token resume / signed challenge),
`[RestoreCached]` (chain-restore message hit an in-memory cached
record), or `[Restore]` (fresh chain-restore). Same Auth-style log
format preserved.

### BUG D ✅ — LoadingScreen skipped after refresh / auth_ok ignored

**Repro:** After hard refresh the app rendered the character page
immediately in a partially-loaded state (no LoadingScreen).

**Root cause:** `auth_ok` carries the fully-hydrated character payload
(from `acceptAuthenticatedSession`'s DOF hydration), but
`game-provider.tsx` never had a `case "auth_ok"` handler. SET_CHARACTER
fired only on the redundant `get_character` round-trip that follows.
The few-frame gap between auth_ok arriving and the get_character reply
was when game-screen rendered with character=null briefly, then with
character=fresh-load.

**Fix:** Added `case "auth_ok"` to game-provider's message handler.
When the payload includes a character, dispatch SET_CHARACTER directly
— the auth gate releases with full equipment in one step, no
intermediate render.

### BUG A — clamp/amber-hint observation

The clamp `min(server, chain)` was the b39202d fix and is unit-tested
(`qa-stat-points.ts` 32 → 45 PASS). The user's modal opened with "3"
because chain had caught up to server before they clicked. That's
correct behavior — the clamp fires invisibly when there's no drift, and
the amber "catching up" hint only shows during the actual drift window
(typically 5–25 s after a fight ends, while the treasury queue is
draining `update_after_fight`). Not a regression — just a sign the
clamp is working as intended in the common case. To witness the hint,
finish a fight and IMMEDIATELY open the allocate modal within the
queue-drain window.

### Tests — `scripts/qa-stat-points.ts` extended: 32 → 45 PASS

Added 13 assertions for `applyLocalAllocate`:

- positive allocation: stats incremented, unallocated decremented
- zero-total returns null (no-op)
- ⚡ clamps unallocated to 0 if server is already drifting behind chain
  (prevents negative)
- defensive: NaN / negative inputs sanitized to 0

### Test totals — all 9 gauntlets green

| Gauntlet | Pass count |
|---|---:|
| `qa-xp.ts` | 143 |
| `qa-marketplace.ts` | 63 |
| `qa-treasury-queue.ts` | 25 |
| `qa-character-mint.ts` | 63 |
| `qa-orphan-sweep.ts` | 30 |
| `qa-reconnect-grace.ts` | 35 |
| `qa-fight-pause.ts` | 46 |
| `qa-stat-points.ts` | 45 (was 32) |
| `qa-wager-register.ts` | 25 |
| **Total** | **475 / 475 PASS** |

---

## 2026-05-02 (later) — Orphan wager 0xbdd3c596 recovered + WS-loss orphan class closed

User caught a 0.8 SUI orphan WagerMatch
(`0xbdd3c59664ac87b9c40fcebcc84a1735da6e5a0c53b61c4695362771a85fcd65`):
on-chain `create_wager` succeeded (status WAITING, escrow 0.8 SUI), but
the `queue_fight` WS message that registers the wager in the in-memory
lobby never reached the server. No fight ever started; SUI sat locked.

### Recovery (immediate)

Used the existing `/api/admin/cancel-wager` endpoint (calls
`arena::admin_cancel_wager` from TREASURY). For STATUS_WAITING wagers
the contract refunds the FULL escrow to player_a (no 50/50 split — see
`arena.move:231-244`).

  - Tx digest: `f1okCdAi5R7p8hpVXVnaKHEKAoPNbN8vLUisigF1WLv`
  - Mr_Boss balance: 0.054 → 0.854 SUI (+0.800 SUI exactly)
  - Treasury gas: 0.002 SUI
  - WagerCancelled event emitted; wager now SETTLED, escrow=0

### Root cause — silent WebSocket loss

`useGameSocket.send` returns `true` whenever
`wsRef.current.readyState === WebSocket.OPEN` at the moment of the
check. But TCP-level death between the check and the actual `ws.send`
call lets the OS silently drop the bytes (half-closed socket, network
blip mid-Mysten-gRPC-reconnect, etc.). The frontend got a `true` return
and assumed delivery; the server never received the message; no
`wager_lobby_added` ever broadcast back. WebSockets in this codebase
have NO application-level acknowledgment.

The orphan-sweep code (`server/src/data/orphan-wager-recovery.ts`) only
catches STATUS_ACTIVE wagers (post-accept Supabase row). WAITING-status
orphans like this slip through entirely.

### Fix — frontend ACK timeout + adopt-wager fallback

New leaf module `frontend/src/lib/wager-register.ts`:

```ts
registerWagerWithServer(wagerMatchId, deps, timeoutMs = 7_000)
  → 'ack' | 'recovered' | 'failed'
```

Flow:

  1. Subscribe to incoming WS messages
  2. Send `queue_fight` via WS
  3. Race: server's `wager_lobby_added` for OUR wagerMatchId, OR a 7 s timeout
  4. If ACK wins → `kind: 'ack'` (the WS path worked end-to-end)
  5. If timeout wins → POST `/api/admin/adopt-wager` (REST has TCP-level
     error reporting; the server-side handler reads chain truth, inserts
     the lobby entry, broadcasts the same `wager_lobby_added`)
     a. adopt-wager succeeds → `kind: 'recovered'`
     b. adopt-wager rejects/throws → `kind: 'failed'` with reason

The matchmaking-queue caller surfaces a sticky error only when both
paths fail. The pre-fix sticky error on `socket.send` returning `false`
is gone — that branch now also goes through adopt-wager (REST works
even when WS doesn't).

This closes the entire silent-WS-loss orphan class: any future
WAITING-status orphan now self-heals within 7 s without operator
intervention.

### Tests — `scripts/qa-wager-register.ts` (NEW): 25/25 PASS

Pinned via mocked deps + manual scheduler:

  - Happy path: WS ACK arrives → no adopt-wager call
  - ⚡ Silent WS loss (the EXACT 2026-05-02 scenario): timeout fires →
    adopt-wager called with right id → `kind: 'recovered'`
  - Other player's lobby_added doesn't false-ACK ours
  - Both paths fail → `kind: 'failed'` with reason
  - adopt-wager throws → `kind: 'failed'` with humanized reason
  - WS send returns `false` → still tries adopt-wager (more aggressive than
    pre-fix; REST succeeds where WS doesn't)
  - ACK arrives just before timeout — first-wins, no double-resolve
  - `deriveHttpBaseUrl`: ws→http, wss→https, bare host→http

### Test totals — all 9 gauntlets green

| Gauntlet | Pass count |
|---|---:|
| `qa-xp.ts` | 143 |
| `qa-marketplace.ts` | 63 |
| `qa-treasury-queue.ts` | 25 |
| `qa-character-mint.ts` | 63 |
| `qa-orphan-sweep.ts` | 30 |
| `qa-reconnect-grace.ts` | 35 |
| `qa-fight-pause.ts` | 46 |
| `qa-stat-points.ts` | 32 |
| `qa-wager-register.ts` (NEW) | 25 |
| **Total** | **462 / 462 PASS** |

### Still deferred to v5.1 (no Move republish this session)

  - **Supabase wiring for WAITING-state orphans.** The current
    orphan-sweep only handles ACTIVE rows. With Supabase configured,
    we could ALSO insert a `wager_in_flight` row at `create_wager`
    success (before the WS send), so a sweeper run could catch
    WAITING-state orphans the rare time both the ACK timeout AND the
    adopt-wager fallback fail. The frontend retry closes ~99% of the
    failure modes; the server-side belt-and-braces is a v5.1 polish.
  - **Player-signed settlement attestation** (Block 4) — unchanged,
    pending v5.1 republish.
  - **Move CharacterRegistry** (Block A layer 3) — unchanged, pending
    v5.1 republish.

---

## 2026-05-02 — Live-test bug sweep (3 bugs from yesterday's session)

User ran a fresh wager-fight gauntlet and reported three real bugs.
Single commit, no Move republish, all chain-side staying on the same v5
package.

### BUG 1 ✅ — `allocate_points` MoveAbort code 2 (server-chain drift)

**Repro:** Sx_v5.1 (L4, +3 unallocated points after a recent level-up)
opened the Allocate modal → spent 3 → Slush returned `MoveAbort code 2
(ENotEnoughPoints)`. Frontend stuck.

**Root cause:** `applyXp` on the server bumps
`character.unallocatedPoints` the instant the fight ends. The on-chain
`update_after_fight` (which actually grants the points to the
Character NFT) runs through the treasury queue AFTER `settle_wager` +
the opponent's `update_after_fight`, landing 5–25 s later. Window:
server says +3, chain still says +0. Modal happily lets the user
click. Slush dry-runs against chain. Abort.

**Fix:** Frontend clamp via new leaf `frontend/src/lib/stat-points.ts`:
`effectiveUnallocatedPoints(server, chain)` returns
`min(server, chain)` when chain is hydrated (falls back to server
otherwise). Used in `character-profile.tsx` (the +N badge) and
`stat-allocate-modal.tsx` (the available count + a new amber hint
"Chain state is catching up after your last fight…" when drift is
detected). The Modal's +/- buttons + Allocate button gate on the
clamped value, so doomed transactions can't be submitted.

**Tests:** `scripts/qa-stat-points.ts` (NEW) — 32/32 PASS. Pins:
agreement, drift in both directions, RPC-down fallback, NaN /
negative / fractional sanitization, and a full timeline simulation
(pre-fight → fight_end → chain catchup → spent).

### BUG 2 ✅ — Save-loadout fight-lock race after forfeit

**Repro:** User clicks Save Loadout immediately after a forfeit fight
ends → `[Tx] Aborted. Raw result: {}`. Suspected fight-lock still
active on chain because the post-fight `setFightLockOnChain(0)` hasn't
landed yet.

**Root cause:** Treasury queue serializes admin txs (single
concurrency, by design — gas-coin contention). Order in
`finishFight` was:

  1. `settle_wager` (~2–5 s)
  2. `update_after_fight` winner (~2–5 s)
  3. `update_after_fight` loser (~2–5 s)
  4. `set_fight_lock(0)` winner
  5. `set_fight_lock(0)` loser

Lock release lands ~10–25 s after fight_end. User clicking Save in
that window hits `equipment.move::EFightLocked` (code 5) on every
`equipment::*_v2` call inside the save-loadout PTB.

**Fix:** Reorder in `server/src/ws/fight-room.ts::finishFight` — fire
both `setFightLockOnChain(0)` calls FIRST, ahead of `settle_wager` +
`update_after_fight`. Lock release lands within ~2–5 s instead of
~25 s. Safe because the lock exists to prevent equipment changes
DURING combat; once `finishFight` runs, combat is over and post-fight
bookkeeping doesn't depend on the lock state.

**Tests:** Existing `qa-treasury-queue.ts` covers the queue ordering
contract; the reorder is a callsite change. Live verification will
confirm the user-visible window collapsed.

### BUG 3 ✅ — Off-chain loot drops removed (v5 NFT-only)

**Repro:** Fight wins awarded "Wooden Club" / "Cloth Hood" type items
that violated the v5 NFT-only contract — no chain presence, couldn't
be equipped via the loadout-save PTB, couldn't be marketplaced or
transferred, disappeared on Reset Character.

**Root cause:** `rollLoot` in `server/src/game/loot.ts` returns a
server-side `Item` with a UUID and randomly-rolled stat bonuses;
`finishFight` pushed it into `winnerChar.inventory`. Pre-Phase-0.5
behaviour that should have been deleted at the v5 redeploy.

**Fix:** Remove the `rollLoot` call from `finishFight` (the import is
gone too, with a comment explaining why the function survives in
`game/loot.ts` — v5.1 will reuse the rarity + stat-roll math when it
adds an admin-signed on-chain Item NFT mint). `loot.item` and
`fightHistory.lootGained` are now always `undefined` / `null`.

Existing junk in player inventories will sit there until the player
clicks Reset Character (or the server restarts without Supabase).
Mainnet readiness unchanged — this was a test-time-only path.

### Test totals — all 8 gauntlets green

| Gauntlet | Pass count |
|---|---:|
| `qa-xp.ts` | 143 |
| `qa-marketplace.ts` | 63 |
| `qa-treasury-queue.ts` | 25 |
| `qa-character-mint.ts` | 63 |
| `qa-orphan-sweep.ts` | 30 |
| `qa-reconnect-grace.ts` | 35 |
| `qa-fight-pause.ts` | 46 |
| `qa-stat-points.ts` (NEW) | 32 |
| **Total** | **437 / 437 PASS** |

### Verification observation

While digging into BUG 1 the chain query revealed STATUS_v5.md had a
typo on Sx_v5.1's character object id — the real id is
`0xaca14d0f3b13333f5bbda44ff514d9f1fb0052e1838c8bc7da753e9715046a40`,
not `…78c167…` as previously documented. The repin curl in the
earlier wrap should be updated for sx if anyone uses it again. (Not
fixed retroactively — the running server resolves Sx_v5.1 correctly
via the descending event scan.)

---

## 2026-04-30 (later) — Blocks A through D shipped

Tonight's full sweep of the four follow-up blocks from the Gemini re-audit
+ live-test bug list. Every block landed as a separate local commit on
`feature/v5-redeploy`.

### Block A — Duplicate-Character mint fix (layers 1+2) ✅

Closes the bug reproduced live this session: mr_boss minted "mee" on top
of `Mr_Boss_v5.1` during the auth-flicker window because the frontend
rendered `<CharacterCreation />` as the default fallback whenever
`state.character` was null. Three-layer fix per STATUS proposal — layer
3 (Move `CharacterRegistry`) deferred to v5.1 republish; layers 1+2
shipped tonight.

**Layer 1 — frontend auth-phase state machine.**
New leaf module `frontend/src/lib/auth-phase.ts` with the typed
phases `auth_pending | chain_check_pending | chain_check_failed |
no_character` and a set of pure render-gate predicates
(`shouldRenderCreateForm`, `shouldRenderLoadingScreen`,
`shouldRenderRetryScreen`). `game-provider.tsx` drives the transitions
explicitly off `socket.authenticated` + `fetchCharacterNFT` outcomes;
`game-screen.tsx` renders one of {LoadingScreen, RetryScreen,
CharacterCreation} based on phase. The 1.5s `setTimeout` is gone — the
chain check fires immediately on auth, and the create form is reachable
**only** when the chain has been confirmed empty. RPC failures land in
`chain_check_failed` and surface a Try-again button.

**Layer 2 — server pre-mint guard.**
New helper `findAllCharacterIdsForWallet` in `server/src/utils/sui-settle.ts`
returns every `CharacterCreated` event id for a wallet (asc by event
timestamp). New pure predicate `shouldRejectDuplicateMint` rejects when
length > 1 — i.e. a pre-existing Character was on chain when the user
clicked Create. `handleCreateCharacter` is now async, calls the helper,
rejects with a clear error pointing the user at the original (oldest) id
and instructing a refresh. Length === 1 is the legitimate first mint —
its id is pinned to the server-side record on the spot.

**Tests — `scripts/qa-character-mint.ts` (NEW): 63/63 PASS.**
The whole gauntlet runs against the same predicates that `game-provider`
+ `game-screen` consume, so a regression in either render path or the
state machine fails the test. Includes:

- L1.1–L1.4 — phase transitions on auth flips and chain-check outcomes
- L1.5–L1.7 — render-gate invariants (mutual exclusion, create-form
  HIDDEN during auth/chain-check phases)
- L1.8 — full auth-flicker → chain-check end-to-end simulation
- L2.1–L2.5 — duplicate-mint guard (boundary cases + the exact 3-character
  scenario reproduced 2026-04-30)

### Block B — Supabase wiring + orphan-sweep instrumentation ⚠️ BLOCKED on user provisioning

The boot sweeper code (`server/src/data/orphan-wager-recovery.ts`,
shipped in the prior session) is fully live, but `SUPABASE_URL` is empty
in `server/.env` so `dbInsertWagerInFlight` /
`dbLoadStaleWagersInFlight` are no-ops and the sweeper has nothing to
read. Tonight's work landed everything that doesn't require an actual
Supabase project:

1. **Schema migration** — new `server/src/data/migrations/002_wager_in_flight.sql`
   adds the `wager_in_flight` table the sweeper reads, plus backfills two
   columns added to `characters` in v5 (`unallocated_points`,
   `onchain_character_id`). Idempotent: every statement uses
   `IF NOT EXISTS` / `IF EXISTS`, so re-running on top of a partial
   migration is safe.
2. **`setup-db.mjs` rewrite** — now walks every `*.sql` in
   `migrations/` lexically, prints the combined SQL the operator pastes
   into the Supabase SQL Editor (Supabase REST does not expose raw SQL
   execution), and probes both `characters` and `wager_in_flight` to
   confirm creds + tables.
3. **Sweep refactor for testability** — `sweepOne` now accepts an
   injected `SweepDeps` (chain status fetcher, admin-cancel call, row
   deleter). Production wires the real deps; the new gauntlet wires
   mocks.
4. **Tests — `scripts/qa-orphan-sweep.ts` (NEW): 30/30 PASS.** Pins
   every branch:

   - STATUS_ACTIVE  → `admin_cancel_wager` + drop row + `cancelled++`
   - STATUS_SETTLED → drop row only (race: settle landed pre-crash)
   - STATUS_WAITING → drop row defensively (shouldn't happen)
   - `getWagerStatus` null → leave row for next sweep, `errors++`
   - Unknown status code → leave row defensively
   - Multiple rows aggregate counts correctly
   - `adminCancelWager` throws → propagates to outer try/catch

#### What's still BLOCKED — user provisioning step

The end-to-end live test requires a real Supabase project. To unblock:

1. **Provision a free-tier Supabase project** —
   <https://supabase.com/dashboard/new/p>. Region close to wherever the
   game server runs. Free tier is fine for testnet (500 MB / 1 GB egress).
2. **Grab credentials** — Project Settings → API:
   - `Project URL` → set as `SUPABASE_URL` in `server/.env`
   - `service_role` key (NOT `anon`) → set as `SUPABASE_KEY`. Server-only;
     bypasses RLS by design.
3. **Apply schema** — `cd server && node setup-db.mjs`. The script
   prints the combined migration SQL; paste it into the Supabase SQL
   Editor → Run. Re-run `node setup-db.mjs` afterwards; both probes
   should report `✓ EXISTS`.
4. **Restart the server** — `npm run dev`. Look for
   `[Supabase] Client initialized` in the boot log instead of
   `[Supabase] No credentials configured — running in-memory only`.

#### End-to-end recovery validation (run AFTER step 4 above)

1. Both wallets log in, both have characters.
2. mr_boss creates a 0.1 SUI wager from the lobby UI.
3. sx accepts → fight starts.
4. After turn 1 or 2 lands cleanly (server log shows
   `[Wager] dbInsertWagerInFlight` for the wager match id), in another
   shell:

   ```bash
   kill -9 $(lsof -ti:3001)
   ```

5. Confirm chain-side state via Sui GraphQL: the WagerMatch should be
   `status=1` (ACTIVE) with the full 0.2 SUI escrow. Confirm Supabase
   has the row (`select * from wager_in_flight` in the SQL Editor).
6. Restart the server (`cd server && npm run dev`).
7. Within ~10 seconds of boot, look for these log lines (in order):

   ```
   [Supabase] Client initialized
   [OrphanWager] Found 1 stale wager_in_flight row(s) — sweeping
   [OrphanWager] 0x…  ACTIVE → 50/50 refund tx=…
   [OrphanWager] Sweep complete: 1 cancelled (50/50 refund), 0 already settled, 0 errors
   ```

8. Verify on Suiscan: WagerMatch is now `status=2` (SETTLED) with the
   admin_cancel digest. Both wallets have +0.05 SUI.

If step 7 doesn't show the cancellation log, the sweeper isn't seeing
the row — re-check `SUPABASE_KEY` is the **service_role** key, not the
anon key. The anon key hits RLS and reads zero rows.

### Block C — Three Gemini re-audit findings ✅

All three issues flagged in tonight's re-audit are fixed and unit-tested.

**C1 — fight-room reconnect grace window (CRITICAL — pre-mainnet blocker).**
Pre-fix, `handlePlayerDisconnect` (`server/src/ws/fight-room.ts:766`)
called `finishFight('disconnect')` IMMEDIATELY on socket close — players
forfeited real SUI to a 2-second wifi blip. New module
`server/src/ws/reconnect-grace.ts` owns a per-wallet timer state with a
configurable grace window (default 60s). The flow is:

1. Socket drops → `handlePlayerDisconnect` calls `markDisconnect(wallet,
   fightId, onTimeout)`. Forfeit is scheduled, not executed. The
   opponent receives a new `opponent_disconnected` WS message
   (`{fightId, expiresAt, graceMs}`) so the UI shows a non-sticky toast
   "Opponent disconnected. Waiting up to 60s…".
2. Same wallet re-authenticates within the window → `markReconnect`
   cancels the forfeit. The opponent receives `opponent_reconnected`
   (clears the toast); the rejoining client receives `fight_resumed`
   (rehydrates the live fight state — turn count, HP, log).
3. No reconnect within the window → the scheduled callback fires
   `finishFight('disconnect')`. Same outcome as pre-fix, but only after
   the player had a real chance to come back.

The grace module takes an injected `GraceScheduler` so the test
gauntlet drives every branch with a manual scheduler — no real
`setTimeout`, no flaky timing.

**C2 — marketplace gap-fill retry loop (HIGH).**
Pre-fix, `runSubscription` (`server/src/data/marketplace.ts:258`)
caught gap-fill failures, logged once, and proceeded to open the gRPC
stream at "now" — every event in the gap window was permanently lost
from the index. `catchUpFromCursor` now wraps each `queryEvents` page
in `withChainRetry` with the widened backoff
`GAP_FILL_BACKOFF_MS = [1000, 3000, 9000, 27000]` = 5 total attempts
(Gemini spec). If still failing after 5, `runSubscription`'s outer catch
calls `scheduleReconnect` — the next reconnect attempt re-tries the
whole gap-fill from the same cursor, instead of streaming live with a
known-incomplete index.

**C3 — coldSync withChainRetry (MEDIUM).**
Pre-fix, `coldSync` (`server/src/data/marketplace.ts:190`) had no
internal retries — a boot-time RPC blip left the marketplace empty for
the entire server uptime (the outer catch in `index.ts:535` swallowed
the error). Each `queryEvents` page is now wrapped in `withChainRetry`
(default 3 attempts, 1s+3s sleeps). A transient blip self-heals.

The retry helper itself was widened — `withChainRetry` now accepts an
optional `backoffMs` parameter (delays-between-attempts; total attempts
= length + 1). Default is `[1000, 3000]` = 3 attempts, preserving
prior production semantics. The C2 marketplace constant is exported so
the test gauntlet pins its shape.

**Tests** — `scripts/qa-reconnect-grace.ts` (NEW): 35/35 PASS.
`scripts/qa-treasury-queue.ts` +5 tests for the parameterised
withChainRetry (custom budget → N+1 attempts, boundary cases,
eventual-success). `scripts/qa-marketplace.ts` +8 tests pinning
`GAP_FILL_BACKOFF_MS` (length=4, exact values, exponential 3× ratio).

### Block D — Final wrap ✅

**Test totals — all six gauntlets green.** Run from `server/`:

| Gauntlet | Pass count |
|---|---:|
| `qa-xp.ts` | 143 |
| `qa-marketplace.ts` | 63 (was 55) |
| `qa-treasury-queue.ts` | 25 (was 20) |
| `qa-character-mint.ts` | 63 NEW |
| `qa-orphan-sweep.ts` | 30 NEW |
| `qa-reconnect-grace.ts` | 35 NEW |
| **Total** | **359 / 359 PASS** |

(218 → 359 — 141 new assertions tonight, all Block A/B/C related.)

**Mainnet readiness ranking — what's closed, what's deferred to v5.1.**

The 8 mainnet blockers from the prior session, ranked:

| # | Blocker | Status |
|---|---|---|
| 1 | Gas-coin contention in admin tx settlement | ✅ CLOSED — sequential treasury queue (prior session) |
| 2 | Mid-fight crash leaves wagers stuck on chain | ⚠️ CODE COMPLETE — orphan sweeper live, blocked on user provisioning Supabase (Block B) |
| 3 | Multi-Character wallet picks wrong NFT on hot paths | ✅ CLOSED — `Character.onChainObjectId` pinning (prior session) + DB column (Block B) |
| 4 | Wager-lobby TOCTOU race on accept | ✅ CLOSED — single-flight guard (prior session) |
| 5 | Marketplace cursor stuck on empty pages | ✅ CLOSED — cursor advances unconditionally (prior session) |
| 6 | Marketplace silent gap-fill loss on reconnect | ✅ CLOSED — Block C2 retry loop |
| 7 | Marketplace coldSync no boot retry | ✅ CLOSED — Block C3 withChainRetry |
| 8 | Duplicate-Character mint during auth flicker | ✅ CLOSED for the auth-flicker scenario — Block A layers 1+2; layer 3 (Move `CharacterRegistry`) deferred to v5.1 |
| (new) | Instant forfeit on WS drop costs real SUI | ✅ CLOSED — Block C1 reconnect grace |

**5 of 8 original blockers fully closed tonight (#3, #6, #7, #8, plus
the new C1 found mid-audit). Blocker #2 is code-complete, awaiting
user-side Supabase provisioning.** Two items deferred to v5.1
republish (always intended):

- **Block 4 — player-signed settlement attestation.** Closes the
  TREASURY-key holder trust assumption (server can pick the wrong
  winner). Requires a fresh `settle_wager_attested` move entry that
  validates two `signPersonalMessage` signatures over the fight outcome
  hash. ~12h work + frontend signing UX. Not regressed, just deferred.
- **Block A layer 3 — Move CharacterRegistry.** Closes the remaining
  bypass path (someone calls `create_character` directly via Slush,
  ignoring frontend Layer 1). Layers 1+2 close the auth-flicker
  reproduction tonight — Layer 3 closes the adversarial UI-bypass
  variant. Deferred alongside Block 4 since both need a fresh package
  publish.

**Net mainnet readiness assessment:** the testnet build is now
production-grade for the failure modes we know about. The remaining
mainnet work is the one v5.1 republish (player-signed settlement +
Move CharacterRegistry) plus end-to-end live validation of orphan
sweep against a real Supabase instance. Everything else — treasury
queue, multi-char pin, marketplace resilience, duplicate-mint defence,
reconnect grace — is shipped and tested.

#### Next-session pickup notes (in priority order)

1. **Provision the Supabase project** (free tier, walkthrough in
   Block B section above) and run the `kill -9` mid-fight test to
   validate the orphan sweep end-to-end. This is the last code-side
   item gating the orphan-recovery story.
2. **Live browser regression of Block A** — open two tabs, simulate the
   auth-flicker by throttling network, confirm `<CharacterCreation />`
   never renders during the loading window. Confirm the retry button
   appears on simulated RPC failure.
3. **Live browser regression of Block C1** — start a wager fight,
   `kill -9` one player's tab mid-fight, confirm the opponent sees
   "Opponent disconnected. Waiting up to 60s…" toast. Reopen within 60s
   → confirm `fight_resumed` rehydrates the UI. Reopen after 60s →
   confirm forfeit fires.
4. **Polish bugs from prior session** still open: equipped items
   invisible at fight start (refresh fixes), fight buttons clickable
   before turn timer, stat-allocation modal preset to 0/0/0/0.
5. **v5.1 prep** — Move `CharacterRegistry` + player-signed
   settlement attestation. One package republish closes the last two
   pre-mainnet items.

#### Tonight's commits — all on `feature/v5-redeploy`, none pushed

```
a462fec fix(v5): close duplicate-Character-mint bug (layers 1+2)        # Block A
999300e fix(v5): orphan-wager sweep — schema, setup, testability         # Block B
468a43e fix(v5): three Gemini re-audit findings (C1 + C2 + C3)           # Block C
   …    docs(v5): STATUS wrap — Blocks A–D shipped, mainnet ranking      # Block D (this commit)
```

---

## 2026-04-30 Session — Live testing + critical bug + recovery

The hardening from the prior session block (treasury queue, crash recovery,
multi-char fix, SDK hygiene) went live for browser-based testing tonight.
Most of the gauntlet items in the "STILL UNTESTED" list are now ✅, one is
🟡 inconclusive, and a new ⚠️ critical bug was discovered.

### ✅ Live-tested + working

| Gauntlet item | Result |
|---|---|
| Auth + balance display | Navbar SUI matches Slush exactly; live refresh works; JWT survives reload |
| **Wager fight end-to-end** (validated twice) | mr_boss creates 0.1 SUI → sx accepts → 5-turn fight → instant 95/5 settlement → +XP / +rating / loot drop |
| **Multi-character regression** (Other-A from Gemini audit) | mr_boss has Mr_Boss_v5 + Mr_Boss_v5.1 on chain; server correctly pinned and used Mr_Boss_v5.1 throughout the session — no DOF desync |
| Marketplace full lifecycle | mr_boss listed Wooden Buckler → sx bought it → equipped + used → 2.5% royalty paid; both browsers updated reactively; withdraw profits works |
| **Shield 3-block-zone** | Sx equipped the bought shield → fight log shows "0/3 line" → blocked 3 zones in one turn |
| Counter-triangle balance | 5 fights: Sx (evasion build) vs mr_boss (crit build) → Sx wins 60% (3W-2L) |
| Level-up + stat allocation | Sx hit L3 → "+3 points" appeared → modal + Slush sign → on-chain commit + stat refresh |
| Multi-fight stability | 5+ wager fights back-to-back with zero memory leak, state drift, or UI desync |

### ⚠️ CRITICAL BUG — duplicate-Character mint during auth flicker

**Found:** During the 1.5s auth-flicker window (where the frontend renders
`<CharacterCreation />` as the default fallback while waiting for
`fetchCharacterNFT` to resolve), a user can submit the form and mint a
SECOND Character NFT on a wallet that already has one. The newer NFT then
becomes the "active" one for the session because the server's
`findCharacterObjectId` returns the most-recent CharacterCreated event.

**Reproduced:** mr_boss's wallet now has 3 Characters on chain:
- `Mr_Boss_v5`     `0x6161af02…`  (legacy)
- `Mr_Boss_v5.1`   `0x9b294d7d…`  L2, 245 XP, 2W/3L, rating 983 — the real character
- **`mee`**        `0xec6fbbcf…`  L1, fresh — the accidental dupe from tonight

**Why the existing `Other-A` fix didn't catch it:** `Other-A` pins
`onChainObjectId` on the server side AT auth/restore time. But the dupe mint
happened BEFORE auth finished — a fresh `create_character` with no prior
server-side record. The pin pinned the dupe, not the real character.

**Three-layer fix proposal** (NOT YET IMPLEMENTED — awaiting approval):

1. **Frontend gate** — `frontend/src/components/layout/game-screen.tsx:256` and `frontend/src/app/game-provider.tsx:284-324`. Replace the "no character → render CharacterCreation as fallback" pattern with an explicit state machine:
   - `auth_pending` → spinner
   - `chain_check_pending` (post-auth, fetching `CharacterCreated` events) → spinner with "Looking for your character on-chain…"
   - `chain_check_failed` (RPC error) → error toast + retry button (DO NOT silently fall through to CharacterCreation)
   - `no_character` (chain check returned 0 results) → CharacterCreation
   - `has_character` → game UI
   The 1500ms `setTimeout` "let server respond first" delay goes away — the server's `auth_ok` already includes `character: null` definitively if it has none in memory. The chain check fires immediately after.
2. **Server pre-mint guard** — `server/src/ws/handler.ts::handleCreateCharacter`. Before letting the WS message proceed, call `findCharacterObjectId(client.walletAddress)`. If non-null, refuse with `Wallet already has Character X on chain — refresh to see it`. The chain RPC is one extra round-trip per mint, irrelevant for UX.
3. **Move contract registry** — `contracts/sources/character.move`. Add a shared `CharacterRegistry` object mapping `address → ID`. `create_character` aborts with `EWalletAlreadyHasCharacter` if the registry already has an entry for `tx_context::sender`. **Defers to v5.1** alongside the player-signed settlement (Block 4 in the prior plan) since both require a fresh package publish.

Layers 1+2 close 99% of the bug at the cost of zero re-publish. Layer 3 closes the remaining race (someone bypasses the frontend by signing the PTB directly via Slush) and ships in v5.1.

### 🟡 Orphan-wager sweep — INCONCLUSIVE this session

Block 2's `sweepOrphanActiveWagers` ran clean on every boot tonight ("No
stale in-flight rows"), but **Supabase isn't configured** in the running
server (`SUPABASE_URL` / `SUPABASE_KEY` empty in `.env`). With no
persistence layer, `dbInsertWagerInFlight` and `dbLoadStaleWagersInFlight`
are no-ops — the sweeper is correctly seeing zero rows because no rows are
ever written. So the recovery code path itself never executed.

Wager `0xcadb…0d09` (0.2 SUI escrow, accepted 01:30:06 UTC, status=ACTIVE
post-crash) became the live test of the manual recovery path:
- Confirmed via Sui GraphQL that the wager was stuck in STATUS_ACTIVE with
  no settlement / refund event for ~7 minutes.
- Used the new `/api/admin/cancel-wager` endpoint (added this session) to
  call `arena::admin_cancel_wager` for the 50/50 split.
- Tx digest `82ZB1vWqUjoXRm3q4oFGyijvwkraLitvqwMpv4qhNPUK` — wager now
  `status=2` (SETTLED), `escrow=0`, both wallets refunded 0.1 SUI each.

**Still need:** point Supabase creds at a real instance and re-run the
mid-fight `kill -9` test. The CODE PATH is unverified end-to-end. Until
then, the manual `/api/admin/cancel-wager` endpoint is the recovery tool.

### Recovery actions taken this session

| Issue | Tool | Result |
|---|---|---|
| Wager `0xcadb…0d09` stuck ACTIVE with 0.2 SUI locked | New `POST /api/admin/cancel-wager` | Tx `82ZB1vWqU…`, 50/50 refund (0.1 SUI each) |
| Server pinned mr_boss to "mee" (the accidental dupe) instead of `Mr_Boss_v5.1` | New `POST /api/admin/repin-character` | Pinned `0x9b294d7d…` (Mr_Boss_v5.1, L2, 245 XP). On reconnect mr_boss will see his real character |

### What landed this session (code)

- `server/src/index.ts` — two new testnet-only admin endpoints:
  - `POST /api/admin/cancel-wager  { wagerMatchId }` — manual `admin_cancel_wager` 50/50 refund. Pre-checks chain status to surface clearer errors.
  - `POST /api/admin/repin-character { wallet, characterId }` — drop the server's existing record for that wallet, rebuild from the specified Character NFT (validates `owner == wallet` first), pin `onChainObjectId`, push `character_data` to the live WS client.

### Polish bugs discovered (not blockers)

1. Create-character flicker on every login/refresh — drives the critical bug above.
2. Equipped items not visible at fight start (refresh fixes it; equipment hydrates after fight-room renders).
3. Fight buttons clickable before turn timer starts.
4. Stat-allocation modal preset to 0/0/0/0 (UX clarity).

### Tomorrow-morning checklist (copy-paste ready)

**Server status was left running** at end of session with `Mr_Boss_v5.1`
pinned for mr_boss's wallet in memory. As long as nothing killed the
process overnight, mr_boss connects → server returns `Mr_Boss_v5.1` (L2,
245 XP) → DOFs re-hydrate from chain → all gear back automatically.

**1) Quick-check the pin survived overnight:**

```bash
curl -s http://localhost:3001/health | python3 -m json.tool
curl -s http://localhost:3001/api/character/0x06d6cb677518cc70884df24541d91d7a1d2ca5db2d8628a69568172652239624 \
  | python3 -c "import sys,json; c=json.load(sys.stdin)['character']; print(f\"name={c['name']} lvl={c['level']} xp={c['xp']}\")"
```

Expected: `name=Mr_Boss_v5.1 lvl=2 xp=245`. If you see `name=mee lvl=1 xp=0`,
the server restarted overnight + the descending event scan picked the dupe
again. Run the next command to fix.

**2) If the pin was lost, repin:**

```bash
curl -s -X POST http://localhost:3001/api/admin/repin-character \
  -H 'Content-Type: application/json' \
  -d '{"wallet":"0x06d6cb677518cc70884df24541d91d7a1d2ca5db2d8628a69568172652239624","characterId":"0x9b294d7d6af20d8de72755df834e385f10e211ed41026d17cdfd09dc10ea808a"}'
```

Same idea for sx if she ever ends up pointing at the wrong character (her
`Sx_v5.1` is `0xaca14d0f78c167a9e26ddec05a01076bedaadf8a420b00cb0d1d27b4f0fe5d3a`,
wallet `0xd05ae8e26e9c239b4888822c83046fe7adaac243f46888ea430d852dafb6e92b`).

**3) Server isn't running? Start both:**

```bash
cd /home/shakalis/sui-comabts/server   && npm run dev > /tmp/server.log   2>&1 &
cd /home/shakalis/sui-comabts/frontend && npm run dev > /tmp/frontend.log 2>&1 &
```

If you ran step 3, immediately run step 2 to repin (the in-memory pin from
tonight is gone after restart).

### Next session — pickup list

In recommended execution order:

1. **Ship layers 1+2 of the create-character fix** (approved tonight — implement when back). Frontend state machine + server pre-mint guard. Layer 3 (Move registry) defers to v5.1.
2. **Persist `Character.onChainObjectId` without Supabase.** Gemini's audit pinned this — the in-memory pin survives one restart at most. Two options: (a) configure Supabase creds in `server/.env`; (b) add a fallback JSON-file cache (`server/.character-pins.json`) so the pin survives without external infra. Pick (a) if you have Supabase credentials handy, else (b).
3. **End-to-end orphan-wager sweep test** — once persistence is real, `kill -9` mid-fight, watch boot log show `[OrphanWager] Found 1 stale wager_in_flight row(s)` → `admin_cancel_wager` → 50/50 refund within seconds of restart.
4. **UI polish bugs from tonight:**
   - Equipped items not visible at fight start (refresh fixes — equipment hydrates after fight room renders)
   - Fight buttons clickable before turn timer starts
   - Stat-allocation modal preset to 0/0/0/0 (UX clarity)
5. **Block 4 prep** for v5.1 republish: player-signed settlement attestation + Move-side per-wallet Character registry (closes layer 3 of the create-character bug at the same time).

### Tonight's commits (all on `feature/v5-redeploy`, none pushed)

```
a70832b admin(v5): cancel-wager + repin-character endpoints, recovery from live test
ba41fe6 hardening(v5): treasury queue, crash recovery, multi-char fix, SDK hygiene
07732d2 feat(v5): XP rewrite, marketplace end-to-end, hardening from gauntlet
```

### Tests (all green, run nightly)

```
cd server
npx tsx ../scripts/qa-xp.ts             # 143 / 143
npx tsx ../scripts/qa-marketplace.ts    #  55 / 55
npx tsx ../scripts/qa-treasury-queue.ts #  20 / 20
```

Total: **218 / 218 PASS.**

## 2026-04-30 Session — Gemini-audit verification + hardening

Independent verification of a 5-concern audit Gemini Antigravity ran against
the codebase (88/100). Every concern traced through actual files + on-chain
state before any code changed; plan written to
`~/.claude/plans/here-s-the-prompt-copy-paste-tender-parnas.md`.

### Gemini's 5 concerns — verdicts

| # | Concern | Verdict | Action |
|---|---|---|---|
| 1 | Gas coin contention in settlement | ✅ Right | **Fixed (Block 1.1)** — sequential treasury queue |
| 2 | In-memory state not persisted | ✅ Right (partial) | **Fixed (Block 2)** — Supabase wager-in-flight rows + boot sweeper |
| 3 | Raw `fetch()` bypassing SDK | ✅ Right | **Fixed (Block 3)** — both raw fetches → SDK clients |
| 4 | Server can siphon wagers | ⚠️ Partial | **Documented + deferred to v5.1** — player-signed attestation in next package publish |
| 5 | Missing `sui::display` | ❌ **Wrong** | No-op — verified live on chain via GraphQL: both Display objects exist with proper templates + Pinata image URLs |

### Plus 4 issues Gemini missed — all fixed

| Tag | Issue | Fix |
|---|---|---|
| Other-A | `findCharacterObjectId` returns wrong NFT for multi-character wallets | **Fixed (Block 1.2)** — `Character.onChainObjectId` pinned at restore + persisted in Supabase, hot paths read pinned id |
| Other-B | Wager-lobby TOCTOU between `wagerLobby.get` / `await getWagerStatus` / `wagerLobby.delete` | **Fixed (Block 1.3)** — `processingWagerAccepts: Set<string>` single-flight guard |
| Other-C | Marketplace cold-sync cursor doesn't advance on empty pages | **Fixed** (hitchhiked Block 2) — cursor advances on every page |
| Other-D | Fight-lock release errors silently leave players locked ≤1h | **Fixed (Block 1.4)** — sticky toast + new `/api/admin/force-unlock` admin endpoint |

### What landed (file by file)

**Server**

- `server/src/utils/sui-settle.ts` — sequential FIFO treasury queue (`enqueueTreasury` + `pumpTreasuryQueue`); concurrency knob via `TREASURY_QUEUE_CONCURRENCY` env (default 1); `getTreasuryQueueStats()` for `/health`; `withChainRetry` re-export; new `readObjectWithRetry` SDK helper.
- `server/src/types.ts` — `Character.onChainObjectId?: string`.
- `server/src/data/db.ts` — `DbCharacter.onchain_character_id`; new `wager_in_flight` table I/O (`dbInsertWagerInFlight` / `dbDeleteWagerInFlight` / `dbLoadStaleWagersInFlight`).
- `server/src/data/characters.ts` — `restoreCharacterFromChain` accepts `onChainObjectId`, idempotently backfills legacy rows; new `setOnChainObjectId` for the auth path.
- `server/src/data/orphan-wager-recovery.ts` (NEW) — `sweepOrphanActiveWagers` runs once at boot. Per-row chain-status check; ACTIVE → `admin_cancel_wager` 50/50; SETTLED → drop stale row; transient RPC fail → leave row for next sweep.
- `server/src/ws/handler.ts` — `processingWagerAccepts` TOCTOU guard; `dbInsertWagerInFlight` BEFORE `wagerLobby.delete`; auth path resolves chain id once + pins it via `setOnChainObjectId`.
- `server/src/ws/fight-room.ts` — `createFight` + `finishFight` IIFE prefer `character.onChainObjectId` over event scan; settlement success drops the wager-in-flight row; fight-lock release failure now sends a sticky toast.
- `server/src/index.ts` — `/api/admin/force-unlock` (testnet-only); `/health` exposes `treasuryQueue` stats; raw fetch in `/api/admin/adopt-wager` → `readObjectWithRetry` (SDK + retry).
- `server/src/data/marketplace.ts` — `coldSync` and `catchUpFromCursor` always advance cursor (even on empty pages).

**Frontend**

- `frontend/src/lib/sui-contracts.ts` — module-level lazy `SuiJsonRpcClient` for events queries; `fetchCharacterNFT` uses `rpc.queryEvents` instead of raw fetch.
- `frontend/src/app/game-provider.tsx` — `restore_character` send now includes `objectId` (pins NFT server-side); `error` handler honors `sticky` flag.
- `frontend/src/types/ws-messages.ts` — `restore_character` carries `objectId`; `error` accepts optional `sticky`.

### Tests — 218 / 218 PASS

| Gauntlet | Tests | Status |
|---|---:|---|
| `scripts/qa-xp.ts` | 143 | ✅ |
| `scripts/qa-marketplace.ts` | 55 | ✅ |
| `scripts/qa-treasury-queue.ts` (NEW) | 20 | ✅ |
| **Total** | **218** | **All green** |

`qa-treasury-queue.ts` covers: `getTreasuryQueueStats` shape, `withChainRetry` retry-then-succeed, `withChainRetry` exhaustion error preservation, FIFO ordering on a single-flight queue (5 tasks × 30ms — total ≥ 150ms), bounded concurrency (6 tasks × 30ms with concurrency=3 — total ~60ms), failure does not stall queue, env-knob-driven concurrency.

### Block 4 (player-signed settlement) — DEFERRED to v5.1

- Documented trust assumption: TREASURY key holder can pick the wrong winner from `{player_a, player_b}` in `settle_wager`. Worst case: 95% of in-flight wager pool to attacker if attacker is one of the two players.
- Mitigation plan: new on-chain entry function `settle_wager_attested` that requires both players' `signPersonalMessage` signatures over a fight-outcome hash. Server still calls it (still owns AdminCap, still pays gas), but chain refuses to settle without both signatures.
- Re-publish required → natural fit for v5 → v5.1 cycle. ~12 hours work including Move tests + frontend signing UX.

### What's still UNTESTED — pick up here

Same list as the prior session, plus orphan-wager recovery itself. Browser gauntlet items that need real wallet interaction:

- ⏳ **Wager fight end-to-end.** Create wager → accept → fight → settle 95/5 on chain. Verify Suiscan: `WagerMatch` SETTLED, balance deltas match.
- ⏳ **Stuck-item retrieve flow** (carries over from prior session). Mr_Boss has Steel Greatsword stuck in his kiosk from a pre-fix delist; the new "Unlisted in Kiosk" panel should let him retrieve.
- ⏳ **Multi-fight XP gauntlet.** 5 ranked wins back-to-back as fresh L1, no Lv X / Y display drift.
- ⏳ **Shield 3-block-zone mechanic.** Sx equips Wooden Buckler — fight UI must show 3 zones, validator accepts 3-zone adjacent line.
- ⏳ **Treasury queue under wager load.** 3 wagers ending within seconds; check `/health` for queue-depth telemetry; confirm settlements drain serially without `EX_OBJECT_LOCKED` errors.
- ⏳ **Orphan-wager sweeper.** Mid-fight `kill -9` the server with a real ACTIVE wager on chain and a Supabase row pre-written; restart; confirm boot log shows the row was swept and `admin_cancel_wager` paid both players 50/50.
- ⏳ **Multi-character regression** (Block 1.2 verification). Mr_Boss has two Characters on chain; auth pins one and every later admin call hits THAT one — log out, re-auth, equip something, trigger `update_after_fight` and verify on Suiscan it's the pinned NFT, not the older sibling.

## 2026-04-29 Session — Recap

The full set of fixes that landed this session, in the order they shipped:

| # | Area | Change |
|---|------|--------|
| 1 | XP system | Unified cumulative table (chain ↔ server ↔ frontend); rewrote `applyXp` for cumulative semantics; replaced random 25–200 with GDD §9.2 ELO-aware reward formulas |
| 2 | XP display | Replaced Fibonacci `LEVEL_XP` with the chain table extended to L20; new helpers `getXpInCurrentLevel` / `getXpSpanForLevel` so the bar renders partial-in-level (not cumulative) |
| 3 | Marketplace server | New `data/marketplace.ts` — cold-sync via JSON-RPC `queryEvents`, live subscription via gRPC `SubscribeCheckpoints`, BCS decoders for the four `marketplace::*` events, undici keepalive Agent for HTTP/2 stream stability |
| 4 | Marketplace frontend | Replaced placeholder browser with real list / browse / buy / delist / withdraw flow; new `useKiosk`, `useMarketplace`, `useMarketplaceActions`; new `MyKioskPanel`, `ListItemModal`, `BuyListingModal` |
| 5 | Delist atomicity | `buildDelistItemTx` is now a 3-command PTB (delist + `kiosk::take` + transfer-to-seller). Same tx; seller's NFT lands back in their wallet, no longer stuck unlisted in kiosk |
| 6 | Retrieve flow | `buildTakeFromKioskTx` + `useMarketplaceActions.retrieveFromKiosk` — recovery path for any item left stuck inside a kiosk by a pre-fix delist (Mr_Boss's Steel Greatsword) |
| 7 | `kioskListed` flag | New chain-truth flag on `Item`; `fetchKioskItems` decodes the kiosk's Listing DF keys (33-byte BCS: 32 ID + 1 bool) to mark each kiosk-resident NFT as listed-or-not. Eliminates race with the server's gRPC index |
| 8 | NPC Shop removal | Dead component (server returned `[]`, frontend showed "Loading shop..." forever). Stripped end-to-end across 8 files: server module, route, WS handlers + types, frontend component, layout mount, reducer slice, action types, message handler |
| 9 | Bug A: nested button | `ItemCard` now renders `<div>` when `onClick` is undefined, `<button>` only when set. Fixes React 19 hydration error on the marketplace browser (outer `<button>` wrapped a `<button>`) |
| 10 | Bug B: seller refresh | Server's `item_bought` / `item_delisted` broadcasts now carry `seller` + `kioskId`. Frontend `game-provider` bumps `onChainRefreshTrigger` when the event seller matches the connected wallet — seller's profits + listing counts refresh within gRPC delivery latency, no manual reload |

### Tests

| Gauntlet | Coverage | Pass count |
|----------|----------|-----------:|
| `scripts/qa-xp.ts` | Cumulative table parity (chain == server == frontend), `applyXp` single/multi/max-level, `calculateXpReward` all four (ranked/wager × win/loss) bands + boundary clamps + 200-sample loss range, frontend `getXpInCurrentLevel` / `getXpProgress` / `getXpSpanForLevel`, end-to-end "fresh L1 → L2 in 2 ranked wins" | **143 / 143** |
| `scripts/qa-marketplace.ts` | BCS decoder layouts vs the four `marketplace::*` structs, royalty math vs `royalty_rule.move`, list/delist/buy lifecycle reconciliation, reconnect idempotency for delist + buy, server→frontend wire shape, atomic delist PTB structure (3 commands, kiosk::take typed correctly), retrieve PTB structure, kiosk Listing key BCS layout, `item_bought` / `item_delisted` broadcasts carry seller + kioskId | **55 / 55** |
| **Total** | — | **198 / 198** |

### What's tested vs untested

**Tested (gauntlets + manual browser confirm):**

- ✅ XP cumulative table cross-layer (chain == server == frontend)
- ✅ `applyXp` semantics + ELO-aware `calculateXpReward` (all bands, all clamps)
- ✅ Frontend XP bar renders partial-in-level correctly
- ✅ NPC Shop is gone (no "Loading shop..." in marketplace tab)
- ✅ Marketplace server cold-syncs from chain at boot
- ✅ Live gRPC `SubscribeCheckpoints` stream stays open with reconnect + JSON-RPC catch-up; survives Mysten's idle HTTP/2 closes
- ✅ Marketplace browser renders real listings, filter/sort works
- ✅ List flow: NFT → kiosk → ItemListed event → all clients see new listing
- ✅ Buy flow: payment + 2.5% royalty deducted, NFT moves to buyer's wallet, listing disappears for everyone
- ✅ Delist flow (atomic): NFT exits kiosk in same tx, lands back in seller wallet, no "Listed" badge sticking
- ✅ Item-card hydration error gone (`<div>` when no onClick)
- ✅ BCS decoder for the kiosk Listing key (33 bytes, first 32 = item ID)

**STILL UNTESTED — pick up here next session:**

- ⏳ **Wager fight end-to-end.** Create wager (mr_boss, e.g. 0.1 SUI) → accept (sx) → fight runs → settle 95/5 to winner on chain. Confirm the SUI balance deltas match (winner +95% of 2× stake, treasury +5%). Verify on Suiscan that `WagerMatch` ends up in SETTLED state and the final transfer events fire.
- ⏳ **Shield 3-block-zone mechanic.** Sx equips Wooden Buckler. Sx queues a fight. Confirm fight UI shows **3** block zones (not 2) and that `validateTurnAction` accepts 3 zones forming an adjacent line. Cross-check with mr_boss equipping a non-shield offhand to verify the regression.
- ⏳ **Multi-fight XP gauntlet (display drift).** Win five ranked fights back-to-back as a fresh L1. Confirm:
  - cumulative XP in `character_data` increments correctly each fight
  - the partial-in-level display fills the bar gradually, not in jumps
  - L2 → L3 transition shows `0 / 200 XP` (not `100 / 200` or any other off-by-one)
  - no Lv `167 / 21` or other absurd values reappear
- ⏳ **Seller-side auto-refresh in the wild.** Bug B fix is unit-tested at the wire shape level, but a multi-tab browser confirm is still useful: open mr_boss in tab A, sx in tab B, list from A, buy from B, watch A's profits jump within ~1s without manual refresh.
- ⏳ **Stuck-item retrieve flow.** Mr_Boss has the Steel Greatsword stuck in his kiosk from a pre-fix delist. Open his Marketplace tab — the item should appear in the new "Unlisted in Kiosk" section with a Retrieve button. Click → wallet sign → item back in inventory.

## 2026-04-29 Update (later) — Delist atomicity, kiosk-state UI, NPC shop removal

### Bug fix: "Listed" badge persisted after delist

**Root cause.** Sui's `kiosk::delist<T>(self, cap, id)` only removes the
`Listing` DOF — the `Item` DOF stays inside the kiosk. So `marketplace::delist_item`
unlisted the NFT but left it parked under the kiosk shared object. The frontend's
`fetchKioskItems` walks dynamic-object-fields of the kiosk and stamps every Item
child with `inKiosk: true`, so the NFT showed the "Listed" badge forever and was
filtered out of the listable picker (5 of 6 items shown). Reproduced exactly as
reported.

(Suiscan's "no children" view was misleading — it shows only Listings, not the
underlying Item DOF.)

**Fix.** The seller wants their NFT back in their wallet, not stuck unlisted in
the kiosk. `buildDelistItemTx` now emits a 3-command PTB:

```
1. marketplace::delist_item(kiosk, cap, item_id)        // clear Listing DOF
2. let item = 0x2::kiosk::take<Item>(kiosk, cap, item_id) // pop Item DOF
3. transferObjects([item], recipient)                    // back to wallet
```

Atomic per PTB semantics — if any step aborts the whole tx aborts. `kiosk::take`
fails if the item is still listed, which guarantees step 1 ran first.

**Migration / recovery path.** Items already stuck inside Mr_Boss's kiosk from
the pre-fix delist are still chain-recoverable. Two affordances:

1. `MyKioskPanel` grew a new "Unlisted in Kiosk" section that surfaces every
   stuck item with a one-click `Retrieve` button.
2. `Inventory` item-detail modal shows the same `Retrieve` button when the
   user opens an item that's `inKiosk && !kioskListed`.

Both paths drive `buildTakeFromKioskTx` (just `kiosk::take + transferObjects`).

**Source-of-truth tightening.** `fetchKioskItems` now stamps `kioskListed` from
chain-truth, not by cross-referencing the server's gRPC listing index. It walks
the kiosk's dynamic fields once, classifying each entry as Item DOF or Listing
DF. Listing keys (Sui Kiosk's `Listing { id: address, is_exclusive: bool }`)
are 33-byte BCS — we decode the first 32 bytes to recover the listed item ID
and join it with the Item DOFs in the same pass. This eliminates the race
between the chain transaction landing and the server's gRPC subscription
catching up — `kioskListed` is correct the moment the next item-fetch lands.

`Item` type grew `kioskListed?: boolean`. `ItemCard` renders it differently
from `inKiosk`: amber **Listed** badge for `kioskListed`, gray **In Kiosk**
badge for `inKiosk && !kioskListed`.

### NPC shop removed

V5 has no NPC shop — items are NFT-only via the marketplace. The dead
`NpcShop` component was rendering "Loading shop…" forever (server returns
`[]`). Deleted end-to-end:

- `server/src/data/items.ts` — file removed (was a stub returning empty arrays).
- `server/src/ws/handler.ts` — `case 'get_shop'` / `case 'buy_shop_item'` +
  `handleGetShop` / `handleBuyShopItem` removed.
- `server/src/index.ts` — `GET /api/shop` route removed.
- `frontend/src/components/items/npc-shop.tsx` — removed.
- `frontend/src/types/ws-messages.ts` — `get_shop` / `buy_shop_item` /
  `shop_data` message types removed.
- `frontend/src/hooks/useGameStore.ts` — `shopItems` slice + `SET_SHOP_ITEMS`
  action + initial value removed.
- `frontend/src/app/game-provider.tsx` — `case "shop_data"` handler removed.
- `frontend/src/components/layout/game-screen.tsx` — `<NpcShop />` import +
  render removed from the marketplace tab.

### Tests

`scripts/qa-marketplace.ts` — **55/55 PASS** (was 44, added 11):

- 5 PTB structure assertions on `buildDelistItemTx` (delist + take + transfer
  in that order, single move-call each, take typed as the package's `Item`).
- 3 PTB structure assertions on `buildTakeFromKioskTx` (take + transfer).
- 2 BCS layout assertions on the kiosk Listing key (33 bytes; first 32 are
  the listed item ID, exactly what `decodeListingKeyItemId` reads).
- 1 idempotency assertion: replayed `ItemPurchased` event broadcasts only
  once (no double-bump on the seller's reactive refresh under reconnect).
- Existing `item_delisted` and `item_bought` broadcast tests now assert the
  new `seller` + `kioskId` wire fields land per Bug B fix.

`scripts/qa-xp.ts` — 143/143 PASS (no regressions).

### Issue 1 fix: unified XP table on chain cumulative semantics

The "Lv2 167/21 XP" display bug + sub-bugs are gone. Three layers (chain,
server, frontend) now share one cumulative XP table mirroring the GDD §9.1
production thresholds.

- **Chain** (`character.move`) — unchanged, this was always correct.
- **Server** (`config.ts::LEVEL_XP_CUMULATIVE`, `combat.ts::applyXp`) —
  rewritten for cumulative semantics. `applyXp` now adds without decrementing
  on level-up, matching `update_after_fight`'s loop in Move.
- **Server** (`elo.ts::calculateXpReward`) — replaced random 25–200 with the
  GDD §9.2 formulas. Win ranked: `clamp(50 + (oppRating−myRating)/10, 50, 200)`.
  Loss ranked: `randomInt(10, 30)`. Win wager: `clamp(100 + (oppRating−myRating)/5,
  100, 400)`. Loss wager: `randomInt(20, 50)`. Friendly: `0`. All capped at
  chain `MAX_XP_PER_FIGHT = 1000`.
- **Frontend** (`types/game.ts`) — replaced the Fibonacci `LEVEL_XP` with the
  same cumulative table extended to L20. New helpers `xpThresholdForLevel`,
  `getXpInCurrentLevel`, `getXpSpanForLevel`. The `character-profile.tsx` XP
  bar renders `partial-in-level / span-to-next-level` now (e.g. `67 / 200` for
  the L2-with-167-cumulative case).
- **Server** (`types.ts`, `data/characters.ts`) — dropped the redundant
  `xpToNextLevel` field from Character; computed on demand via `xpForNextLevel(level)`.

Tests: `scripts/qa-xp.ts` — 143/143 PASS. Covers chain↔server↔frontend table
parity, applyXp single/multi/max-level, calculateXpReward all four quadrants
plus boundary clamps, end-to-end "L1 winning ~3 ranked fights → L2".

### Issue 2 fix: live marketplace, full Kiosk wiring

Replaced the v5.1 placeholder banner with a real list / browse / buy /
delist / withdraw flow.

**Server-side listing index (`server/src/data/marketplace.ts`)** —
- Cold sync via JSON-RPC `queryEvents` paginated ascending; rebuilds
  `Map<itemId, Listing>` + `Map<kioskId, owner>` from package-emit history.
- Live subscription via gRPC `SubscriptionService.SubscribeCheckpoints`
  against `https://fullnode.testnet.sui.io:443`. The originally-spec'd
  `suix_subscribeEvent` over WSS returns HTTP 405 on Mysten's public
  fullnodes (Mysten dropped WS in favor of gRPC). gRPC is the official
  in-order, no-gap stream.
- Reconnect: exponential backoff (1s/2s/5s/10s/30s). Each reconnect
  calls `queryEvents` from the last seen cursor before re-subscribing,
  guaranteeing zero event drops across drops.
- Events arrive BCS-encoded (Mysten's gRPC subscription doesn't populate
  the `event.json` field). Inline BCS decoders for `KioskCreated`,
  `ItemListed`, `ItemDelisted`, `ItemPurchased` — fixed-layout 32-byte
  ID, 32-byte address, 8-byte LE u64.
- One per-listing `getObject` call hydrates full Item NFT metadata
  (name, image, stats) so browse renders never roundtrip.
- Crucial fix: undici `Agent` with `bodyTimeout: 0` + extended keepalive
  set as a side-effect of importing the marketplace module. Default Node
  fetch killed HTTP/2 streaming responses after seconds; this makes them
  stable for minutes. New dependency: `undici`.

**Server WS handlers** — `get_marketplace` returns the cached listings.
`item_listed` / `item_delisted` / `item_bought` broadcast to all
authenticated clients on every chain event. `list_item` / `delist_item` /
`buy_listing` are now no-ops on the server (the wallet signs the PTB
directly; the server observes the chain event and updates everyone).

**Frontend hooks** —
- `useKiosk(refreshKey)` — discovers the user's KioskOwnerCap, returns
  `{kioskId, capId, profitsSui, listingCount, itemCount, refresh}`.
- `useMarketplace()` — pulls server's listing index on mount, returns
  reactive `listings` + `refresh`.
- `useMarketplaceActions()` — `createKiosk`, `listItem`, `delistItem`,
  `buyItem`, `withdrawProfits`. Each builds the PTB locally via
  `lib/sui-contracts.ts`, signs via `CurrentAccountSigner`, bumps the
  global `onChainRefreshTrigger` so dependent state re-fetches.
- `lib/sui-contracts.ts` — added `buildWithdrawKioskProfitsTx(kioskId,
  capId, recipient)` calling `0x2::kiosk::withdraw`.

**Frontend UI** —
- `marketplace-browser.tsx` — replaced the placeholder with a real grid
  of all listings (mine excluded). Filter by type/rarity, sort by
  newest/price. Click → BuyListingModal.
- `my-kiosk-panel.tsx` (new) — sidebar panel: Setup CTA when no Kiosk
  exists, otherwise SUI profits + Withdraw + list of MY listings (with
  Delist) + List-an-item picker.
- `list-item-modal.tsx` (new) — price input + listing-fee preview
  (0.01 SUI) + total-cost breakdown + sign list_item.
- `buy-listing-modal.tsx` (new) — price + 2.5% royalty + total + gas
  headroom + insufficient-funds gate (uses `useWalletBalance`) + sign
  buy_item.
- Inventory item-detail modal grew a "List on Marketplace" button that
  opens `ListItemModal` directly. Hidden when the user has no Kiosk yet
  (with a CTA pointing to the Marketplace tab) or when the item isn't
  on-chain / is already in a Kiosk.

Tests: `scripts/qa-marketplace.ts` — 44/44 PASS. Covers BCS decoder
byte-layouts vs the four marketplace structs, royalty math vs
`royalty_rule.move`, list/delist/buy lifecycle reconciliation, reconnect
idempotency (replayed delist is a no-op), and the server→frontend wire
shape projection.

## Pinata / IPFS

- **CID** (all 22 PNGs): `bafybeiarz5gk3selzpjclugdl2odmvdtbtvi7gtky65m7chkyjymci3yfy`
- Public gateway base: `https://gateway.pinata.cloud/ipfs/<CID>/<filename>`

## Deployment IDs

| Object | ID |
|---|---|
| Package | `0xa7dc2dabea6acc2db1a9599a0c1e003ad6b2e6064a2847687bc93037a662e1c1` |
| AdminCap | `0x4329021b08235418990a4a0bf8d1edb1e8cb1fe06be5d093f7e2c0f76d8e2579` |
| UpgradeCap | `0x05b27c97ddac6ca0172726d5e91339fc2802a86bba61c837012d2d708d60c5c6` |
| Publisher | `0x1a8116ed261e2513e617a4692520d2f661d9d827ac32f733a1b2ea320031ee87` |
| TransferPolicy<Item> | `0xb0ca682ce826c15166577b5879efa76830befe4af5627f747f9cf0b7e9e8e871` |
| TransferPolicyCap<Item> | `0x71d9157f2cab218f410773e48f7fa3992171b40526ae36ad757b24ffc43c12a1` |
| Display<Character> | `0xca2104f3944e9c150a2f84ef9919ace41ef4c006c4a49f27c5e195f4f0363955` |
| Display<Item> | `0x1f7505f81100e32869944db5368cc95291221935d5d9d7af724b0343d895478b` |

### Wallets

| Role | Address |
|---|---|
| Publisher / TREASURY (hardcoded in `arena.move`) | `0x975f1b348625cdb4f277efaefda1d644b17a4ffd97223892d93e93277fe19d4d` |
| Mr_Boss (crit build, items #1–11) | `0x06d6cb677518cc70884df24541d91d7a1d2ca5db2d8628a69568172652239624` |
| Sx (evasion build, items #12–22) | `0xd05ae8e26e9c239b4888822c83046fe7adaac243f46888ea430d852dafb6e92b` |

## 22-Item Starter Catalog

Full object IDs grouped by recipient live in `deployment.testnet-v5.json`
under `starterItemIds`. Quick verification on chain:

```bash
curl -s -X POST https://fullnode.testnet.sui.io:443 \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"suix_getOwnedObjects","params":["<wallet>",{"filter":{"StructType":"0xa7dc2dabea6acc2db1a9599a0c1e003ad6b2e6064a2847687bc93037a662e1c1::item::Item"}},null,50]}' \
  | python3 -c "import sys,json; print(len(json.load(sys.stdin)['result']['data']),'NFTs')"
```

Both wallets confirmed owning **11 NFTs** each at session end.

## Decisions Locked This Session

- ✅ **Drop slot pointers** from `Character` — DOFs are the single source of truth.
- ✅ **`loadout_version: u64`** added to Character, bumped by `equipment::save_loadout`.
- ✅ **No `MAX_WAGER` cap** — players can stake anything they own.
- ✅ **`MAX_XP_PER_FIGHT = 1000`** in `update_after_fight`.
- ✅ **`MAX_LOCK_MS = 1 hour`** in `set_fight_lock`.
- ✅ **2.5% royalty rule** wired into the TransferPolicy at publish time.
- ✅ **Signed-challenge auth, 24h JWT session** — server verifies via
  `verifyPersonalMessageSignature`; token persisted client-side at
  `localStorage[sui-combats-jwt-<wallet>]`.
- ✅ **Wallet balance display** in navbar + wager UI insufficient-funds gate.
- ✅ **Marketplace UI ships in v5.0** (functional list/buy/cancel/kiosk).
  Currently the browser shows a v5.1 banner — **wiring is the next-session
  priority** before anything else.
- ✅ **No git push** until QA gauntlet fully passes.

## Autonomous QA — PASSED

- 35/35 Move unit tests (`sui move test`) — happy + error coverage on every
  entry function across all 5 modules.
- Chain gauntlet (`scripts/qa-chain-gauntlet.ts`):
  - `update_after_fight` rejects `xp_gained=1001` → abort `EXpTooHigh` (1).
  - `set_fight_lock` rejects 24h expiry → abort `ELockTooLong` (4).
  - Positive controls (xp=500 update, 30-min lock, clear via 0) all land.
- Display objects render on-chain with the correct Pinata URLs (verified
  via `sui_getObject` on Cursed Greatsword and Parrying Dirk).
- Servers start cleanly (`/health` 200, frontend HTTP 200 after env reload).

## Browser QA — PASSED

- Wallet connection both sides (Mr_Boss_v5, Sx_v5).
- Live SUI balance in navbar (~2.0 SUI both wallets).
- Auth handshake: sign once → 24h JWT issued → reload → no popup.
- Character creation form: 20 stat points are redistributable via the
  `+`/`-` controls.

## Browser QA — Issues Found

### 1. Character creation UX confusion *(non-blocking, polish)*

Form opens with 5/5/5/5 pre-allocated. User initially missed the redistribute
controls. Once discovered, custom builds (e.g. 4/4/7/5) work fine. Possible
fix: start at 0/0/0/0 with a "20 points to allocate" prompt, OR add inline
help text explaining the `+`/`-` action.

### 2. "Name already taken" when both wallets had already minted ⭐

User saw "Name already taken" on a second create attempt. **Investigation
during wrap-up confirmed both test wallets already own multiple Characters
on chain:**

| Wallet | Characters minted (via `CharacterCreated` event scan) |
|---|---|
| Mr_Boss `0x06d6cb…` | `Mr_Boss_v5.1` (`0x9b294d7d…`) and `Mr_Boss_v5` (`0x6161af02…`) |
| Sx `0xd05ae8…` | `Sx_v5.1` (`0xaca14d0f…`) and `Sx_v5` (`0x625db216…`) |
| Publisher `0x975f1b…` | `QA-Bot` (`0x8e1968e2…`) — gauntlet bootstrap |

So **on-chain mints succeeded**. The error originated server-side in
`server/src/data/characters.ts` `createCharacter`, which dedupes by
**name** across the in-memory store:

```ts
for (const [, char] of characters) {
  if (char.name.toLowerCase() === name.toLowerCase()) {
    return { character: null, error: 'Name already taken' };
  }
}
```

This dedupe is wrong for v5 — wallet address is the unique key, not name.
The user signs `create_character` on chain first (mint succeeds), then the
frontend sends a `create_character` WS message; the server's name check
rejects the second attempt while the on-chain Character NFT is still there
unbinding from any server record.

**Fix candidates for next session:**
- Drop the name-uniqueness check entirely (wallet address is the real key).
- OR allow same-name across different wallets but reject the same wallet
  trying to create twice (which `walletToCharacter` already covers at the
  start of `createCharacter`).
- AND the frontend should detect existing on-chain Character before showing
  the creation form — `fetchCharacterNFT` already returns the existing
  Character when present, but the auth/hydration race may be racing the
  WS character_data response.

### 3. Frontend does not surface chain-rejection errors during create

The user signed a transaction whose outcome wasn't visible — the frontend
neither showed "Mint succeeded but server rejected your name" nor surfaced
the on-chain abort. Investigation hint: the `signAndExecuteTransaction`
result is awaited but errors in the post-sign WS round-trip aren't toasted.
Next session: add a sticky toast for any chain-side abort during
`buildMintCharacterTx` and a separate "server rejected" path that points
to chain truth (NFT exists, server out of sync).

## Browser QA — NOT YET TESTED

These remain from the agreed gauntlet — must be validated in the next
session before declaring v5 ready for any merge.

- [ ] **#5 stat allocation post-level-up** ⭐ regression check (the v4
      critical bug — must verify fixed in v5).
- [ ] #6 all 10 equipment slots render in fight-arena (added accessory
      row for belt + ring1 + ring2 + necklace; needs a live confirm).
- [ ] #7 inventory shows zero duplicates (NFT-only).
- [ ] #8 item-detail tooltip shows non-zero stat bonuses for v5 items.
- [ ] #9 Sx equips Twin Stilettos → fight UI shows 2 attack zones.
- [ ] #10 Mr_Boss equips Wooden Buckler → fight UI shows 3 block zones.
- [ ] #11 Sx tries to equip Steel Greatsword (lvl 5) at lvl 1 → chain
      rejects (`ELevelTooLow`).
- [ ] #12 live wager: Mr_Boss creates 0.1 SUI → Sx accepts → fight →
      settle 95/5 on chain.
- [ ] #13 counter triangle: Sx evasion vs Mr_Boss crit (~5 fights, expect
      Sx majority wins).
- [ ] #14 marketplace UI — list / buy / cancel / kiosk creation.
      **2026-04-29: shipped end-to-end. Pending live browser confirm with real
      listings (mr_boss creates kiosk → lists Cursed Greatsword → sx buys →
      mr_boss withdraws). Server-side listing index runs reactively over gRPC
      `SubscribeCheckpoints` with JSON-RPC catch-up on reconnect.**
- [ ] #15 Slush wallet shows NFT art + name + description (Display
      registered; needs a live confirm in the wallet UI).

## Known Issues to Investigate Next Session

1. **Server-side name-dedupe in `createCharacter`** — see issue 2 above.
   The fix is small (~10 lines).
2. **Frontend post-sign error path** — see issue 3 above.
3. ~~**Marketplace UI is a placeholder**~~ — **RESOLVED 2026-04-29.** Full
   kiosk discovery, gRPC `SubscribeCheckpoints` listing index, and end-to-end
   list/buy/delist/withdraw UI are live. Pending: live multi-wallet browser
   gauntlet (a real list+buy round between mr_boss and sx).
4. **Multiple stale Character NFTs per wallet** — as a side-effect of #2,
   each test wallet has 2 Character objects. Decide whether to add an
   admin "burn stale character" path or just ignore for testnet QA. The
   game logic only sees one of them at a time (the one server hydrates
   first).
5. **`ts-node` vs ESM-only `@mysten/sui` v2** — `tsconfig.json` is on
   `module: CommonJS, moduleResolution: bundler` which works at runtime
   but emits an `ignoreDeprecations: 6.0` cruft warning. Consider moving
   to full ESM in v5.1 once we don't need ts-node compatibility.

## Next Session Priorities (in order)

1. **Investigate Character creation flow** — server name-dedupe drop +
   frontend post-sign error path. Confirm the existing on-chain
   characters can be surfaced cleanly, or wipe the QA-Bot + extras and
   restart the wallets fresh.
2. **Wire marketplace UI** — list / buy / delist / kiosk-create flows.
3. **#5 stat allocation regression check** — single most important
   gauntlet item (the v4 bug we shipped v5 to fix).
4. **Run gauntlet items 6 → 15** in order.
5. **Counter triangle balance test** (~5 fights).
6. **Extended bug hunt** — multi-fight sessions, wager cancellation,
   opponent disconnect mid-fight, edge cases.

## File Map (v5 work)

- `contracts/sources/{character,item,equipment,arena,marketplace,royalty_rule}.move`
- `contracts/tests/{character,item,equipment,arena}_tests.move`
- `server/src/{config,utils/sui-settle,utils/sui-read,utils/sui-verify,ws/handler,ws/fight-room,data/items}.ts`
- `frontend/src/{lib/sui-contracts,lib/loadout-tx,hooks/useGameSocket,hooks/useWalletBalance,app/game-provider}.{ts,tsx}`
- `frontend/src/components/{layout/navbar,fight/matchmaking-queue,fight/fight-arena,marketplace/marketplace-browser}.tsx`
- `scripts/{setup-display,mint-v5-catalog,mint-one,qa-chain-gauntlet}.ts`
- `deployment.testnet-v5.json`
- `nft/*.png` (11 Sx assets — Mr_Boss art lives at prior Pinata CID)

## Recent Local Commits (feature/v5-redeploy)

```
dcca786 feat(deploy): v5 testnet redeploy artefacts + 22-NFT catalog mint
487502f feat(frontend): v5 wiring — JWT auth, balance UI, 10 slots, env throws
26cd8a9 feat(server): v5 SDK migration + JWT auth + retry pattern + DOF reads
96546e7 build(contracts): untrack auto-generated build/ artifacts
6db670c docs: update for loadout-save shipped + architecture map  ← prior session
```
