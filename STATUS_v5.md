# SUI Combats — v5 Status

> Snapshot at end of the v5 redeploy session. Sui testnet only. Branch
> `feature/v5-redeploy` — every change committed locally; nothing pushed
> to GitHub yet (per standing user rule).

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

### Next session — pickup list

1. **Implement the 3-layer create-character fix** (frontend gate + server guard, defer Move registry to v5.1) — proposal documented above; waiting approval.
2. **Configure Supabase** so the orphan-wager sweeper has real persistence to read.
3. **End-to-end orphan-sweep test** with real `kill -9` mid-fight + Supabase row → boot sweeper → `admin_cancel_wager` → players refunded within seconds of restart.
4. **Polish bugs** (4 items above).
5. **Block 4 prep** (v5.1 republish): player-signed settlement attestation + Move-side per-wallet Character registry, in one new package.

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
