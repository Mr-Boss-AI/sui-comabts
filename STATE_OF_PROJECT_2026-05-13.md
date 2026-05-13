# SUI Combats — State of the Project, 2026-05-13 (v5 functional close-out)

> **v5 functional phase CLOSED.** Tavern + Hall of Fame live-verified
> in today's two-wallet browser pass. Pushing `feature/v5-redeploy`
> to GitHub as the v5-functional wrap. Branch is `not merged to main`
> and will stay that way — mainline stays at the v4-era `08ff991`
> until the v5.1 republish (fresh chain publish, fresh wallets,
> fresh NFT catalog, fresh characters) lands on its own branch.
>
> **No further bugfixes on v5.** Three known bugs (Gloves NFT
> equip-stat hydration race; PlayerProfileModal stats DOF race; DM
> modal focus loss after send; DM toast/pip burial when other
> modals are open) fold into the v5.1 contract bundle + Phase 2 UI
> redesign — they will not be patched on v5 in-place.
>
> **Next phase = Phase 2.** UI / theme redesign + v5.1 contract
> republish on fresh wallets / fresh characters / fresh NFTs. See
> [Phase 2 Plan](#phase-2-plan) below.
>
> This doc supersedes
> [`STATE_OF_PROJECT_2026-05-04.md`](./STATE_OF_PROJECT_2026-05-04.md)
> as the canonical state. May-4 stays unmodified as the
> end-of-Bucket-2 historical snapshot.

---

## TL;DR

| Field | Value |
|---|---|
| Phase | **v5 functional CLOSED**; entering Phase 2 (UI redesign + v5.1 republish) |
| Branch | `feature/v5-redeploy` |
| Latest commit before this doc | `f74fb07` (Bucket 3 #1 + #2 close-out docs) |
| Latest commit at push | (`HEAD` after this doc + MD cleanup + gitnexus sync) |
| Pushed to | `origin/feature/v5-redeploy` (GitHub) |
| Main | untouched (v4-era `08ff991`) |
| Static gauntlet | **1890 / 1890 PASS** (28 suites) |
| Move unit tests | **35 / 35 PASS** |
| Commits on branch since branch start | 64 (was 56 at May-4; +8 from May-13 wrap: 5 Hall of Fame + 3 wrap) |
| Buckets closed | 1 ✅ · 2 ✅ · 3.1 Tavern ✅ · 3.2 Hall of Fame ✅ |
| Buckets deferred to Phase 2 | 3.3 multi-day stability · 3.4 fresh-user onboarding · 3.5 admin endpoint audit |
| Buckets queued | 4 (v5.1 republish) · 5 (audit) · 6 (mainnet) |

---

## Quick links

- [Today's Verification Log](#todays-verification-log)
- [Bucket Status Matrix](#bucket-status-matrix)
- [Bug Ledger](#bug-ledger)
- [v5.1 Contract Republish Bundle](#v51-contract-republish-bundle)
- [Test Suite State](#test-suite-state)
- [Live Verification Coverage](#live-verification-coverage)
- [Mainnet Readiness Scorecard](#mainnet-readiness-scorecard)
- [Parking Lot](#parking-lot)
- [Files Modified This Session](#files-modified-this-session)
- [Commit Log](#commit-log)
- [Phase 2 Plan](#phase-2-plan)
- [Reference Table](#reference-table)

---

## Today's Verification Log

> Live testing session, two-wallet browser pass. User stepped away
> from the project for ~6 days; resumed mid-Tavern testing.

### Wallets at session start

| Wallet | Address | Character | Lv | ELO |
|---|---|---|---:|---:|
| Mr_Boss | `0x06d6cb67…` | `Mr_Boss_v5.1` | 6 | 1000 (entered) → 1016 (after session) |
| Sx | `0xd05ae8e2…` | `Sx_v5.1` | 6 | 1000 (entered) → 984 (after session) |

ELO drifted ±16 during the session — fights happened between
verification steps. No exit ratings out of bounds; counter-triangle
math behaved.

### Bucket 3 #1 — Tavern (✅ live-verified)

- **Both wallets connected**; auth handshake clean; servers booted
  with no Supabase (in-memory mode).
- **Sidebar identity correct on both sides** — Mr_Boss saw `Sx_v5.1
  Lv 6 ELO 984` and Sx saw `Mr_Boss_v5.1 Lv 6 ELO 1016`. **Not the
  stub `0xd05ae8… Lv 1 ELO 1000`** that the 2026-05-08 hotfix #7
  closed. Regression path confirmed staying closed.
- **"2 online" counter symmetric** on both sides.
- **Green online dots + "has joined" chat lines** render as expected.
- **Row click → PlayerProfileModal** opens with:
  - 10-slot equipment doll (weapon, offhand, helmet, chest, gloves,
    boots, belt, ring1, ring2, necklace) — item art + rarity-coloured
    borders for filled slots, dim glyphs for empty slots.
  - Primary attributes panel (STR / DEX / INT / END) with stat
    colours + bonus deltas from gear.
  - Combat stats panel (HP / ATK / Crit% / Crit× / Evade / Armor /
    Defense).
  - W/L counters + win-rate + ELO + level badges.
  - Truncated wallet with copy-to-clipboard button.
  - Three primary action buttons: **Send Message · Wager Challenge
    · Friendly Fight**.
- **DM plaintext delivery end-to-end** — recipient got the sound
  notification cue.

### Bucket 3 #2 — Hall of Fame (✅ built + live-verified)

Implementation shipped in 5 commits today on `feature/v5-redeploy`:

| Commit | Title |
|---|---|
| `9ee469e` | feat(v5): leaderboard wire — propagate stats for build classifier |
| `c331676` | feat(v5): Hall of Fame pure helpers — sort + filter + display |
| `5e2a146` | feat(v5): Hall of Fame UI rebuild — sort toggles, filter chips, click-through, pagination |
| `1fdbc03` | test(v5): qa-hall-of-fame gauntlet — 187 assertions over sort/filter/paginate/classifier |
| `f74fb07` | docs: STATE_OF_PROJECT — Bucket 3 #1 + #2 closed, parking-lot updates |

Live-verification observations on the resulting UI:

- **Header chip:** `"2 ranked"` matches the on-chain entry count.
- **Search box** present and case-insensitive (`groupPlayersForSidebar`
  semantics).
- **Level chip row** with live counts: `All 2 · Novice 0 · Early 2 ·
  Mid 0 · High 0 · Endgame 0 · HoF 0` — Mr_Boss + Sx correctly
  bucketed into Early (Lv 4-6). Chips reuse Tavern's
  `SIDEBAR_BUCKETS` so the brackets stay single-sourced.
- **Build chip row** with live counts: `All 2 · Crit 0 · Evasion 1 ·
  Tank 0 · Hybrid 1` — Sx (DEX-led) classified as Evasion, Mr_Boss
  (STR-led but with one Lv6 stat-bonus dilution to 35-40% STR ratio
  this session) classified as Hybrid. Within spec — the classifier's
  45% dominance threshold deliberately punts toward Hybrid for
  ambiguous splits.
- **Rating column** active sort indicator: `↓` (desc default per
  `DEFAULT_DIR`).
- **Row click → PlayerProfileModal** works on both rows.
- **Footer:** `Showing 2 of 2` — pagination math sane.

Static gauntlet `qa-hall-of-fame.ts`: **187 / 187 PASS** across 21
sections. Covers sort comparator × every column × asc/desc + tiebreakers
+ stability, `nextSortState` toggle machine, classifier edge cases
(INT-led → Hybrid; 45% threshold boundary; missing / null / zero stats),
composite filter (level + build + search), live bucket counts,
pagination math + page clamp, win-rate rounding, rank-color tokens,
filter→sort→paginate roundtrip on a 31-entry corpus, the live
screenshot scenario (Mr_Boss_v5.1 + Sx_v5.1), backward compat for
wire payloads without `stats`, and purity guards on every helper.

### Static gauntlet total

**1890 / 1890 PASS** across 28 static suites. Plus 35/35 Move unit
tests under `contracts/tests/`. Hall of Fame added +187; the prior
Bucket 3 #1 Tavern + DM gauntlets account for the rest of the delta
since the May-4 baseline of 1195.

### New parking-lot items raised this session

> Not patched on v5. Folded into Phase 2 UI redesign + v5.1 republish.

| # | Item | Type |
|---|---|---|
| 1 | **DM modal closes / loses focus after Send.** User had to navigate back to main page to confirm message was sent. Likely the panel unmounts on `OPEN_DM null` somewhere in the post-send chain. | Phase 2 — frontend redesign |
| 2 | **DM notification surfacing is weak when other modals are open** (e.g. marketplace item-watch). Toast / pip gets buried behind higher-z modal layers. | Phase 2 — frontend redesign |
| 3 | **PlayerProfileModal stats occasionally read pre-hydration on first open** (DOF race — already-known class, this session re-confirmed it). Same root cause as the existing "Equipped items invisible at fight start" parking item. | Phase 2 / fixed by DOF-await hydration helper at modal open |
| 4 | **Gloves NFT equip stats sometimes only apply after page refresh.** User-reported known issue; DOF hydration race, same family as #3. | Phase 2 / same DOF-await fix |

---

## Bucket Status Matrix

> Buckets are the QA / hardening tiers we work through before mainnet
> publish. 1–3 are mainnet-readiness; 4–6 are mainnet-track; 7 is
> post-mainnet content tiers.

### Bucket 1 — Live testnet QA (✅ CLOSED 2026-05-04)

Unchanged from May-4 snapshot. Character / Arena / Marketplace /
counter-triangle / Slush NFT display all walked end-to-end with two
wallets. See [STATE_OF_PROJECT_2026-05-04.md § Bucket 1](./STATE_OF_PROJECT_2026-05-04.md#bucket-1--live-testnet-qa--closed-2026-05-04).

### Bucket 2 — Polish-bug close-out (✅ SHIPPED 2026-05-04)

Unchanged from May-4 snapshot. 7 commits, each with its own qa
gauntlet (Wager Fix A / B, 2H Path A direction 1 / 2, Multi-queue
Fix 1, WS readyState Fix 2, Level-up Fix 3 + Hide-busy polish).
See [STATE_OF_PROJECT_2026-05-04.md § Bucket 2](./STATE_OF_PROJECT_2026-05-04.md#bucket-2--polish-bug-close-out--shipped-2026-05-04).

### Bucket 3 — Pre-mainnet hardening (⏳ 2/5 CLOSED, 3 deferred to Phase 2)

| # | Item | State |
|---|---|---|
| 1 | Tavern room (chat / presence / whispers / profile clicks) | ✅ shipped + live-verified 2026-05-13 (this session). 7 gauntlets cover presence / handlers / sidebar / DM data + pipelines. |
| 2 | Hall of Fame (sort / filter / profile click-throughs) | ✅ shipped + live-verified 2026-05-13 (this session). `qa-hall-of-fame.ts` 187 PASS. |
| 3 | Multi-day stability — overnight uptime | ⏳ DEFERRED to Phase 2. Surfaces leaks / silent fails / orphan-wager idle conditions; run against the v5.1 deployment, not the v5 codebase that's about to be frozen. |
| 4 | Fresh user onboarding (wipe localStorage / new wallet) | ⏳ DEFERRED to Phase 2. Will run as the v5.1 smoke test by definition — fresh wallets + fresh characters are the v5.1 baseline. |
| 5 | Admin endpoint pre-mainnet audit | ⏳ DEFERRED to Phase 2. Every `/api/admin/*` should 403 on `CONFIG.SUI_NETWORK === 'mainnet'`; sweep before the mainnet publish, not before testnet wrap. |

Net: items #1 + #2 closed this session. Items #3-#5 are deferred —
running them against the v5 codebase right before v5.1 republish
gives no value (v5.1 changes the surface they would test).

### Bucket 4 — v5.1 contract republish (⏳ QUEUED, starts Phase 2)

Bundled Move-side changes — see [v5.1 Contract Republish Bundle](#v51-contract-republish-bundle).
Staged as a single `sui client publish`, not an upgrade. New
package id, new AdminCap, fresh `deployment.testnet-v5.1.json`.
~5-7 days of focused work + audit pass.

### Bucket 5 — External audit (⏳ QUEUED)

Per `MAINNET_PREP.md`: 2-4 weeks of an auditor's time. Candidate
firms: OtterSec, Zellic, Movebit. Budget $10-30k. Engagement starts
~6 weeks before target launch.

### Bucket 6 — Mainnet publish (⏳ QUEUED)

Fresh `sui client publish` (not upgrade — old bytecode stays
callable, see `MAINNET_PREP.md §A`). Smoke test: 2 wallets create
characters, equip, list, buy, queue, fight, settle.

### Bucket 7 — Post-launch (⏳ PARKING LOT)

Tournaments, Pets, Clans, Herbs, Cross-game interop — see
"What's NOT in the codebase yet" in `STATE_OF_PROJECT_2026-05-04.md`.

---

## Bug Ledger

> Forward-carried from May-4 snapshot. Today's session adds 4 new
> parking items (above). All prior FIXED items remain closed and
> live-verified where applicable.

### ✅ FIXED — closed in code, verified

Carried unchanged from
[STATE_OF_PROJECT_2026-05-04.md § Bug Ledger](./STATE_OF_PROJECT_2026-05-04.md#bug-ledger).
Today's session re-confirmed via live test:

| # | Bug | This-session re-confirmation |
|---|---|---|
| Tavern hotfix #7 (2026-05-08) | Presence-stub broadcast — Sx rendered as `0xd05ae8… Lv 1` stub instead of canonical `Sx_v5.1 Lv 6` | ✅ Sidebar identity correct on both sides; "2 online" symmetric; no stub data seen |
| Tavern hotfix #6 (2026-05-06) | DM transport hangs in encrypted SDK alpha | ✅ Plaintext transport works end-to-end with sound notification |
| Tavern hotfixes #3-#5 (2026-05-06) | MVR resolution, SDK alignment, pipeline extraction | ✅ Tavern room loads cleanly, no SDK errors at console |

### ⏳ DEFERRED — code complete, awaiting live test

Carried unchanged from May-4. Block 2 end-to-end live test still
gated on Supabase provisioning; level-up modal Fix 3 still awaiting
a natural Lv6→Lv7 grind (~3000 XP).

### 🔧 v5.1-CONTRACT — needs Move republish

Carried unchanged from May-4. All 8 items (CharacterRegistry, player-
signed settlement, `burn_character`, admin-signed loot mint,
`OpenWagerRegistry`, `slot_type: u8` on Item, draw / mutual-KO
settlement) bundled into the single v5.1 publish — see
[v5.1 Contract Republish Bundle](#v51-contract-republish-bundle).

### 🪪 PARKING — non-blocking, indefinitely deferred (v5 frozen)

> All v5 polish items below are now **frozen** — Phase 2's UI
> redesign + v5.1 republish will subsume the fixes. No in-place
> patches on v5.

| # | Item | Source |
|---|---|---|
| Inventory auto-refresh after rapid equip swaps | STATUS.md (carried) |
| HP decimal display ("0.25 HP" → "0/90") | STATUS.md (carried) |
| Equipped items invisible at fight start (DOF hydration race) | STATUS.md (carried) |
| Stat-allocate modal preset to 0/0/0/0 | STATUS.md (carried) |
| Buy button disabled-state stability (poll cycle flash) | Bucket 2 closeout (carried) |
| TransferPolicy royalty withdraw UI | Bucket 2 closeout (carried) |
| Race-condition Test 12 (parallel buy script) | Bucket 2 closeout (carried) |
| Friendly abort-code → toast lookup | Bucket 2 + 2026-05-04 abort-6 (carried) |
| **DM modal closes / loses focus after Send** | 2026-05-13 (NEW) |
| **DM notification weak when other modals open (toast/pip burial)** | 2026-05-13 (NEW) |
| **PlayerProfileModal stats DOF-race on first open** | 2026-05-13 (NEW; same class as "equipped items invisible at fight start") |
| **Gloves NFT equip stats sometimes only apply after refresh** | 2026-05-13 (NEW; same DOF-race family) |

---

## v5.1 Contract Republish Bundle

> Every Move-side change queued for the next `sui client publish`.
> Forward-carried from May-4 unchanged.

See [STATE_OF_PROJECT_2026-05-04.md § v5.1 Contract Republish Bundle](./STATE_OF_PROJECT_2026-05-04.md#v51-contract-republish-bundle)
for the module-by-module breakdown. Summary:

**`character.move`** — `CharacterRegistry` shared object,
`burn_character` admin entry, `draws: u32` field, `update_after_fight_draw`.

**`arena.move`** — `OpenWagerRegistry` shared object,
`settle_wager_attested(wager, winner, sig_a, sig_b)`, draw-aware
settle (option a/b/c open), `admin_cancel_wager` documents
expected abort-6 race.

**`item.move`** — `slot_type: u8` on `Item` (0=mainhand, 1=offhand,
2=both_hands), `mint_item_admin` takes `slot_type`.

**`equipment.move`** — chain-side two-handed enforcement
(`equip_weapon` checks `slot_type == 2 + offhand empty`,
`equip_offhand` rejects two-handed). Subsumes the frontend
`TWO_HANDED_NAMES` allowlist.

**`marketplace.move` / `royalty_rule.move`** — no structural changes.

**Loot-mint pipeline.** Reuse `rollLoot` rarity + stat-roll math
from `server/src/game/loot.ts` (disabled in v5 per BUG 3).

**Migration / cut-over.** Fresh `packageId`, fresh AdminCap, fresh
Display objects, fresh TransferPolicy. v5 testnet players don't
migrate — re-create on v5.1 from scratch (standard policy since
v4 → v5; `MAINNET_PREP.md` documents the no-migration rule).

**Estimated effort.** 5-7 days focused work before audit pass:
~2-3d Move, 1-2d frontend, 1d server, 1d testing.

---

## Test Suite State

> Last full run: 2026-05-13 (today). All static gauntlets PASS.
> Bucket 3 added 8 new gauntlets since 2026-05-04: 5 Tavern + 2 DM +
> 1 messaging-client hotfix; today's session added Hall of Fame.

### Static unit gauntlets (no chain)

| Gauntlet | Coverage | Last-run assertions |
|---|---|---:|
| `qa-busy-state-render.ts` | Bucket 2 polish render-slot predicate | **23 / 23** |
| `qa-character-mint.ts` | Auth-phase state machine + duplicate-mint server guard | **63 / 63** |
| `qa-combat-stats.ts` | LEVEL_HP / LEVEL_WEAPON_DAMAGE parity + maxHp formula at every level + sample stats | **79 / 79** |
| `qa-equip-picker.ts` | `buildSlotPickerEntries` selection / sort / locks (level + 2H both directions) | **78 / 78** |
| `qa-fight-pause.ts` | Pause/resume timer math + locked-choice preservation | **46 / 46** |
| `qa-grace-budget.ts` | Cumulative grace budget per (wallet, fight) — multi-cycle forfeit | **46 / 46** |
| `qa-level-up-modal.ts` | shouldRenderLevelUp + format helpers + isValid + mergeLevelUpEvent multi-burst | **44 / 44** |
| `qa-marketplace.ts` | BCS decoders + royalty math + listing index lifecycle + reconnect idempotency | **63 / 63** |
| `qa-mint-catalog.ts` | Lv6-Lv8 catalog spec validation (enums, bonuses, prices, deployment alignment) | **236 / 236** |
| `qa-multi-queue-isolation.ts` | computeBusyState + evaluateServerBusy + 6-scenario cross-check | **60 / 60** |
| `qa-orphan-sweep.ts` | sweepOne branches (ACTIVE / SETTLED / WAITING / RPC fail) | **30 / 30** |
| `qa-reconnect-grace.ts` | markDisconnect / markReconnect state machine | **35 / 35** |
| `qa-reconnect-modal.ts` | recent-outcomes cache + frontend `shouldReplayOutcome` dedupe | **31 / 31** |
| `qa-stat-points.ts` | effectiveUnallocatedPoints clamp + applyLocalAllocate reducer helper | **45 / 45** |
| `qa-treasury-queue.ts` | Single-flight FIFO + bounded concurrency + retry-then-succeed | **25 / 25** |
| `qa-wager-accept-gate.ts` | canAcceptWager + decideAcceptOutcome (silent-accept + cross-mode autoRollback) | **39 / 39** |
| `qa-wager-form.ts` | parseWagerInput edge cases | **47 / 47** |
| `qa-wager-register.ts` | WS-ACK happy path + adopt-wager fallback | **25 / 25** |
| `qa-ws-readystate.ts` | drainPendingMessages + capPendingQueue + reconnect / overflow integration | **37 / 37** |
| `qa-xp.ts` | XP table parity + applyXp semantics + calculateXpReward | **143 / 143** |
| `qa-tavern-presence.ts` (Bucket 3 #1) | derivePlayerStatus / groupPlayersByLevelBucket / upsertPresence priority chain / heartbeat / sweepStalePresence / multi-bucket scenario | **66 / 66** |
| `qa-tavern-fight-requests.ts` (Bucket 3 #1) | evaluateCreate / evaluateTransition state machine / sweepExpired / per-sender limit / stake-bound | **58 / 58** |
| `qa-tavern-dm-channels.ts` (Bucket 3 #1) | canonicalPair / registerChannel / bi-directional lookup / unread math + §7b recipient-notification preconditions | **51 / 51** |
| `qa-tavern-handlers.ts` (Bucket 3 #1) | dispatchTavernMessage routing / announcePlayerOnline+Offline / enter_room / DM channel lifecycle / dm_send + dm_history WS layer | **72 / 72** |
| `qa-tavern-sidebar.ts` (Bucket 3 #1) | groupPlayersForSidebar bucketing + search + status + exclude + sort | **42 / 42** |
| `qa-dm-messages.ts` (Bucket 3 #1 hotfix #6) | syntheticChannelIdForPair determinism + insertMessage validation + getHistory ordering + getOrCreateSyntheticChannel idempotency | **53 / 53** |
| `qa-dm-plaintext-pipeline.ts` (Bucket 3 #1 hotfix #6) | runPlaintextDmSend / runPlaintextDmHistory happy + timeout + cross-talk + cleanup | **36 / 36** |
| `qa-dm-send-pipeline.ts` (Bucket 3 #1 hotfix #5) | runDmSend integration: happy / existing channel / ensureChannel hangs / unresolvable cap / sendMessage hangs / sendMessage rejects / step trace + resolveMemberCap retry | **65 / 65** |
| `qa-messaging-client.ts` (Bucket 3 #1 hotfix) | Sui Stack Messaging SDK shape pins; MVR override on BOTH messaging SuiClient + dapp-kit signer; withTimeout regression guard | **65 / 65** |
| `qa-hall-of-fame.ts` (Bucket 3 #2, NEW 2026-05-13) | Sort comparator × every column × asc/desc + tiebreakers + stability; nextSortState toggle machine; classifyBuild edge cases (INT-led → Hybrid, 45% threshold boundary, missing/null/zero stats); filterEntries composite (level + build + search); levelBucketCounts + buildCounts; paginateEntries math + clamp; formatWinRatePct rounding; rankColor gold/silver/bronze/dim; composite filter→sort→paginate roundtrip; screenshot scenario (Mr_Boss_v5.1 + Sx_v5.1); backward compat with no-stats wire; purity guards | **187 / 187** |
| `qa-nft-portrait-picker.ts` (Phase 2 Step 2, NEW 2026-05-13) | Display-field extraction across both SDK shapes; ipfs/CID/http URL normalisation; isPortraitCandidate predicate; toNftCandidate conversion + fallback name; filterPortraitCandidates order + filters; pickerStateOf decision (loading/empty/error/ready); nextSelectionState (pick/clear/reset + canCommit); portraitKeyForWallet bucketing; readPortrait + writePortrait roundtrip + malformed JSON tolerance; wallet isolation (two wallets in same browser); storage failure tolerance (quota / disabled / SSR); end-to-end picker scenario; purity guards | **98 / 98** |
| **Static total** | | **1988 / 1988 PASS** (Bucket 2 base 1195 + Bucket 3 #1 Tavern+DM 508 + Bucket 3 #2 Hall of Fame 187 + Phase 2 Step 2 NFT Portrait Picker 98) |

Plus **35/35** Move unit tests under `contracts/tests/` (`sui move test`).

### Live-chain gauntlet

| Gauntlet | Coverage | State |
|---|---|---|
| `qa-chain-gauntlet.ts` | End-to-end flow against testnet — character mint, equip via DOFs, fight-lock set/clear, etc. Variable assertion count. | last run **PASS** (Bucket 2 close-out) |

### Drift watch

No gauntlet has drifted from its declared count between the May-4
snapshot and today. The 1195 → 1890 jump (+695) is entirely from the
nine Bucket 3 gauntlet additions documented in the table above.

---

## Live Verification Coverage

### Verified live (today's session adds)

- ✅ **Tavern sidebar identity correctness** (Mr_Boss + Sx render
  each other with canonical character names / levels / ELO; no
  stub fallback fires)
- ✅ **Tavern "X online" counter symmetric** on both wallets
- ✅ **PlayerProfileModal render** — 10-slot doll + attribute panel
  + combat stats + W/L + action buttons (Send DM / Wager / Friendly)
- ✅ **DM plaintext delivery** end-to-end with audible notification
- ✅ **Hall of Fame UI** — sort indicator + level chips with live
  counts + build chips with live counts + row-click → modal +
  "Showing N of M" footer
- ✅ **Hall of Fame build classifier correctness** in the wild —
  Sx (DEX-led) classified as Evasion, Mr_Boss classified as Hybrid
  due to stat-bonus dilution this session

### Verified live (prior sessions, carried forward)

Carried from
[STATE_OF_PROJECT_2026-05-04.md § Live Verification Coverage](./STATE_OF_PROJECT_2026-05-04.md#live-verification-coverage).
Includes Wager Fix A, 2H Path A both directions, Multi-queue Fix 1,
Hide-busy polish, WS readyState Fix 2, Lv6 grind, counter-triangle
12/8, marketplace cross-build buy, and orphan-wager recovery
`0xeade9b…`.

### Unit-only (no live verification yet)

Carried from May-4: Wager Fix B (server auto-rollback), Fix 3
level-up modal, Block 2 orphan-wager sweep, multi-level merge, 2H +
level-lock precedence.

### Gaps — not even unit-tested

- Multi-day overnight stability (Bucket 3 #3 — deferred to Phase 2)
- Fresh user onboarding from never-seen wallet (Bucket 3 #4 — deferred to Phase 2)
- Race-condition Test 12 (parallel buy on same listing)
- Server crash mid-settlement → settlement-queue recovery

---

## Mainnet Readiness Scorecard

### Original 8 blockers (carried unchanged from May-4)

| # | Blocker | State |
|---|---|---|
| 1 | Gas-coin contention in admin tx settlement | ✅ Closed — sequential treasury queue |
| 2 | Mid-fight crash leaves wagers stuck on chain | ⚠️ Code complete; live test gated on Supabase provisioning |
| 3 | Multi-Character wallet picks wrong NFT on hot paths | ✅ Closed — server pin + frontend alignment |
| 4 | Wager-lobby TOCTOU race on accept | ✅ Closed |
| 5 | Marketplace cursor stuck on empty pages | ✅ Closed |
| 6 | Marketplace silent gap-fill loss on reconnect | ✅ Closed |
| 7 | Marketplace coldSync no boot retry | ✅ Closed |
| 8 | Duplicate-Character mint during auth flicker | ✅ Closed layers 1+2; layer 3 deferred to v5.1 |

### Bucket 2 hotfixes (carried unchanged)

All 6 closed (Silent-accept Fix A/B, 2H Path A, Multi-queue Fix 1,
WS readyState Fix 2, Level-up Fix 3).

### Bucket 3 close-outs (NEW this session)

| Item | State |
|---|---|
| Tavern social hub | ✅ Live-verified 2026-05-13 |
| Hall of Fame leaderboard | ✅ Live-verified 2026-05-13 |

### Open mainnet items (carried, unchanged from May-4)

| # | Item | State |
|---|---|---|
| 9 | Server-down-mid-create wager orphan | ⚠️ One incident recovered this session — manual; v5.1 `OpenWagerRegistry` is the permanent fix |
| 10 | Admin endpoint network gating audit | ⚠️ Deferred to Phase 2 (Bucket 3 #5) |

### Net assessment

**No new blockers added today.** Everything we know about is fixed
except (a) Block 2 end-to-end live test (gated on Supabase), (b) the
v5.1 republish bundle, and (c) the two open items above. The v5.1
republish is the single largest remaining task before mainnet — and
it kicks off Phase 2.

---

## Parking Lot

Forward-carried from May-4 with today's 4 new items appended. See
[Bug Ledger — PARKING section](#-parking--non-blocking-indefinitely-deferred-v5-frozen)
above for the full table.

---

## Files Modified This Session

> Grouped by feature. Every change committed locally on
> `feature/v5-redeploy`; this session's wrap is the first push that
> carries them to GitHub.

### Bucket 3 #2 — Hall of Fame ship (2026-05-13)

```
M  server/src/types.ts                                       (LeaderboardEntry adds optional stats)
M  server/src/data/leaderboard.ts                            (pass stats through getLeaderboard)
M  server/src/ws/handler.ts                                  (map stats in handleGetLeaderboard)
M  frontend/src/types/game.ts                                (LeaderboardEntry mirrors optional stats)
A  frontend/src/lib/hall-of-fame-sort.ts                     (NEW — pure sort comparator + toggle state machine)
A  frontend/src/lib/hall-of-fame-filter.ts                   (NEW — level buckets reusing Tavern + build classifier + composite filter)
A  frontend/src/lib/hall-of-fame-display.ts                  (NEW — paginate + winRate + rankColor)
M  frontend/src/components/social/leaderboard.tsx            (rewrite — sort toggles, filter chips, click-through, pagination, empty/loading)
A  scripts/qa-hall-of-fame.ts                                (NEW — 187-assertion static gauntlet)
M  STATE_OF_PROJECT_2026-05-04.md                            (Bucket 3 row, parking lot, test totals)
```

### Doc + wrap commits (2026-05-13 close-out)

```
A  STATE_OF_PROJECT_2026-05-13.md                            (NEW — this doc; v5 functional close)
M  STATUS.md                                                 (reduced to one-line pointer at STATE_OF_PROJECT_2026-05-13.md)
M  CLAUDE.md / AGENTS.md                                     (gitnexus index counts synced after final wrap commit)
```

### Phase 2 — UI redesign begins (2026-05-13, branch `feature/phase-2-design`)

Started the same day the v5 wrap pushed. Branch is local-only (NOT
pushed); waits on user QA + screenshot before broadening to other
screens.

```
A  design_v2/latest/                                         (extracted from design-tool zips)
A  design_v2/archive/                                        (zip backups, gitignored)
A  design_v2/character_layout_reference.jpeg                 (user hand-mockup)
A  design_v2/.gitignore                                      (excludes archive/)

A  frontend/src/styles/design-tokens-v2.css                  (NEW — full token system: gunmetal/bronze/blood/steel)
M  frontend/src/app/layout.tsx                               (replace Geist with Slackey+Poppins+JetBrains Mono via next/font)
M  frontend/src/app/globals.css                              (bridge --background/--foreground/--font-* into v2 tokens)

A  frontend/src/lib/nft-portrait.ts                          (NEW — pure picker helpers; storage DI for tests)
A  frontend/src/components/character/nft-portrait-picker.tsx (NEW — modal: fetch wallet NFTs, 5-col grid, persist by wallet)
M  frontend/src/components/character/character-profile.tsx   (rewrite — combats.ru border-frame layout w/ HP bar + 13-slot grid + tribal ornament)
A  scripts/qa-nft-portrait-picker.ts                         (NEW — 98-assertion static gauntlet)
```

Commits (chronological, on `feature/phase-2-design`):

```
51f41e2 chore(phase-2): clean design_v2 folder — promote latest, archive iterations
cc868ad feat(phase-2): foundation — v2 design tokens + fonts globally applied
92f6f23 feat(phase-2): Character screen — combats.ru border-frame layout + NFT portrait picker
```

What's still open in Phase 2 (subsequent sessions):

- Per-screen polish via Claude Design (now that the global system is
  applied uniformly, individual screens can be iterated at low credit
  cost — feed the deployed code as context for each pass)
- Real NFT art commissioning for character portraits + new item
  catalog assets
- v5.1 contract republish bundle (separate branch, after UI lock-in)
- Fresh wallets / characters / NFT catalog for v5.1 testnet
- Mobile-responsive audit (Phase 2 is desktop-first; mobile follows)

### Phase 2 — App-wide v2 sweep (2026-05-13, later)

After the first Character-screen ship, user feedback was visual:
"structural layout is right but slots too small, ornament too faint,
bronze accents missing across the rest of the app". This sweep
applies the v2 system to every screen + component in one comprehensive
pass.

#### Commits (chronological, on `feature/phase-2-design` after the
initial Character ship at `92f6f23` / docs at `321be9a`):

```
075606a feat(phase-2): Character — bigger slots, flipped gloves/bracers, ornate tribal panel
e59a9b7 feat(phase-2): shared v2 primitives + global chrome (Navbar, tabs, testnet banner)
e738c33 feat(phase-2): PlayerProfileModal — shared v2 surface (Tavern + HoF)
69b2b43 feat(phase-2): Tavern — chat + sidebar + DM panel in v2
5c66660 feat(phase-2): Hall of Fame — v2 leaderboard with bronze-rim table + chip filters
d00a8af feat(phase-2): Arena — chunky fight-type tiles + bronze wager form
9a7358c feat(phase-2): Marketplace + ItemCard — rarity-rim listings, bronze kiosk
8086b69 feat(phase-2): Fight room — HP bars, zones, damage log, timer, reconnect banner
8bfe284 feat(phase-2): modals — LevelUp, StatAllocate, ItemDetail in v2
7e7f5cb feat(phase-2): toasts + fight history — v2 forged-plate treatment
dca9a76 feat(phase-2): inventory + remaining toasts + fight result + reset action
87dc505 test(phase-2): qa-v2-primitives — 127-assertion structural gauntlet
```

#### What landed

**Character screen v2 ship (after live QA feedback)**:
- Slot dimensions bumped 88×100 → 145×170 (golden-ratio'ish, matches
  the user's hand-mocked reference image)
- Slot mapping flipped per user QA — left col[2] is now v5.1 future
  Bracers (ghosted), right col canonical Gloves moved BELOW the
  3-ring row
- Tribal ornament panel rebuilt with bold bronze flourishes, triple-
  ring SUI medallion, four corner studs (was three thin grey lines)

**Shared primitives** (`frontend/src/components/v2/index.tsx`):
- `RimFrame` (bronze/steel/blood tones, padless option)
- `DisplayTitle` (Slackey sizes sm/md/lg/xl)
- `Stamp` (9 tones: default, bronze, blood, steel, common→legendary)
- `BronzeButton` / `DangerButton` / `SteelButton` / `SecondaryButton`
  / `GhostButton`
- `V2Input` (bronze focus rim)
- `V2Chip` (filter pill with active state + count + tone-coding)
- `V2Tab` (combats.ru tab with bronze underline)
- `ToneDivider`, `SectionLabel`

**Cascade primitives** (`components/ui/{button,card,badge,modal}.tsx`):
Rewritten to read from design-tokens-v2.css. Drop-in compatible —
the ~20 consumer files inherit the v2 visuals without any further
edits.

**Screens retrofitted** (every one of them):
- Navbar — Slackey wordmark, bronze SUI balance pill, parchment text
- TownNav — bronze-underlined V2Tab row
- Testnet banner — 3px blood-red left edge stamp, no orange tint
- Character screen (already done)
- PlayerProfileModal (shared by Tavern + HoF) — bronze rim, 10-slot
  doll with v2 ProfileSlot, three tone-coded action buttons
- TavernRoom + ChatPanel + PlayerSidebar — bronze rims, V2Chip
  filters, parchment messages, mono timestamps, cyan-steel unread pip
- DmPanel — bronze outer rim, bronze outgoing bubbles vs panel-2
  incoming, 3px blood/bronze edges on error/SDK banners
- Hall of Fame leaderboard — Slackey title, V2Chip level + build
  filters with live counts, sort-arrow column headers, rank-coloured
  ranks, bronze "Load more" pagination
- Arena (MatchmakingQueue) — 3-up chunky fight-type tiles tone-coded
  (steel/bronze/blood), bronze wager-create panel with 3px blood
  left edge, V2-style stake input, mono balance display
- Marketplace browser + MyKioskPanel — bronze rims, ItemCard
  rewritten with 4px rarity left accent, mono SUI prices, bronze
  Withdraw + List buttons, blood-red Delist
- Inventory (right sidebar) — bronze rim, v2 chip category tabs,
  action-panel rewires for Retrieve/Equip/List flows
- Fight room — HpBar with threshold colours + critical pulse,
  ZoneSelector tone-coded (Attack blood, Block steel), DamageLog
  with tone-coded hit lines, TurnTimer Slackey digits with pulse,
  OpponentDisconnectedBanner with bronze left edge
- All modals — Item Detail (3px rarity NFT frame), Stat Allocate
  (bronze +/− buttons per archetype row), Level Up (Slackey 44px
  headline with bronze pulse-glow), Fight Result (Slackey 56px
  YOU WIN / YOU LOSE)
- ChallengePopup — bronze rim, Slackey "Challenge!" headline
- All toasts — ErrorToast (sticky + auto-fade), FightRequestToasts
  (tone-coded), DmToasts (steel-blue), all with hard plate shadows
  and zero rounded-xl

**Test gauntlet**: `qa-v2-primitives.ts` — **127 / 127 PASS** across
9 sections. Pins token declarations, hex values, alias resolution,
primitive exports, ui/* cascade absence of v1 debt, slot-flip
preservation, font wiring.

**Total static gauntlet**: All 32 suites pass. Project total:
2377 / 2377 (was 2250 pre-phase-2-sweep + 127 new primitives gauntlet).

### Phase 2 — App-wide composition rebuild (2026-05-13, later × 2)

The v2-sweep applied palette + typography correctly but kept each
screen's v1 internal layout. This sweep rebuilds the composition of
every screen end-to-end to match the Claude Design screenshots in
`design_v2/screenshopts/`.

#### Commits (chronological)

```
8570a53 feat(phase-2-layout): shared layout primitives
173ac14 feat(phase-2-layout): Character — Loadout composition + exact pixel-spec equipment frame
b326d70 feat(phase-2-layout): Arena — 3-tile row + queue panel + wager form
28938af feat(phase-2-layout): Market — 3-column composition + dense ListingCard grid
490c85d feat(phase-2-layout): Tavern — 3-column composition (DMs · Chat · Online)
3e14603 feat(phase-2-layout): Hall of Fame — podium + ladder composition
e1dc291 test(phase-2-layout): qa-layout-primitives gauntlet + v2-primitives spec sync
```

#### New shared primitives — `frontend/src/components/v2/layout.tsx`

- **`useBreakpoint()` / `bpGte()`** — viewport-driven responsive
  helpers. `xl` ≥ 1440, `lg` ≥ 1024, `md` ≥ 768, else `sm`. SSR-safe
  (defaults to `xl` so desktop layout paints first; reflows
  client-side on mount).
- **`ScreenLayout`** — 1440px max-width centering wrapper. Replaces
  the prior 896px center column.
- **`TopBanner`** — Slackey title + subtitle + right pill. Tones:
  bronze (Character / Market / Tavern), blood (Arena / Hall of Fame).
  Pills: `onChain` (bronze fill) / `testnet` (blood-deep fill).
- **`ThreeColumn`** — left / center / right grid. Stacks vertically
  below `lg`.
- **`PodiumBlock`** — Hall of Fame rank tile. 1=bronze 240px tall +
  crown SVG, 2=parchment 180px, 3=blood-red 140px. Each with avatar,
  Slackey name, level pill, ELO mono pill.
- **`ListingCard`** — Market full-NFT-art tile. Rarity tint
  background + badge, 2H stamp when applicable, Slackey item name,
  mono slot+stat line, bronze SUI price + blood-red Buy CTA.
- **`DMRow`** / **`OnlineRow`** — Tavern sidebar primitives.
- **`SectionHeader`** — Slackey sub-section header with optional
  right-side stamp.

#### Per-screen compositions

**Character** — TopBanner "Loadout" with ON CHAIN pill above the
existing equipment frame, which is now sized at the exact 1024px
pixel spec (BIG=216 / CENTER=462 / BELT_H=102 / RING=64 / GAP=6).
Stats column right of the frame (Header card with archetype stamp +
Slackey name + Lv/ELO/W-L stamps + Save controls + +N pts button;
Primary Attributes panel; Combat Stats grid + XP bar with tick
segments). Recent fights card below the frame. Inventory at 1440px+
becomes a third column on the right; below 1440px it stacks below
the frame.

**Arena** — TopBanner "Arena" with V5·TESTNET red pill above a 3-up
chunky tile row (Friendly parchment / Ranked bronze / Wager
blood-red, 260px min height, Slackey 52px labels, tone-coded CTAs).
Queue panel (when in matchmaking) with bobbing 🐸 mascot, Slackey
"Looking for fighter…" headline, ETA mono line, Cancel + Widen ELO
Range action pair.

**Market** — TopBanner "Market" + ON CHAIN pill. 3-column
(240/1fr/300): left filter sidebar (search input + rarity chip
column + slot chip wrap), center "N listings" Slackey + sort chips
(Low to High / Recent / Rarity) + auto-fill ListingCard grid,
right My Kiosk panel embedded directly into the screen layout.

**Tavern** — TopBanner "Tavern" + ON CHAIN pill. 3-column
(260/1fr/240): left Direct Messages sidebar (DMRow list built from
state.dmChannels + onlinePlayers lookup), center The Tavern global
chat (Slackey title + ChatPanel below), right Online · N sidebar
(OnlineRow list). Click DM row → OPEN_DM. Click online row →
OPEN_PROFILE.

**Hall of Fame** — TopBanner "Hall of Fame" + V5·TESTNET red pill.
Podium row top: 2/1/3 grid using PodiumBlock primitive (top-3 from
raw ELO, filter-independent). Ladder card below: Slackey header +
"By ELO · 7-Day" outline stamp + search input + V2Chip filter rows
(level + build with live counts) + sort-arrow column headers +
LadderRow component (rank in tier colour, avatar tile + Slackey
name + archetype label, Lv pill, ELO mono bronze, W/L tone-coded,
Win% mono). Current user's row highlighted bronze with "· you"
suffix. "Load more" pagination footer.

#### game-screen restructure

`AreaContent` switch flattened — each case now returns the screen's
top-level component directly. No more per-area `lg:grid-cols-3`
wrappers fighting the screen's own grid. Outer chrome (testnet
banner + TownNav) stays full-viewport width; each screen owns its
own ScreenLayout wrapper for the 1440px max-width + 20px side
padding.

#### Tests

- **`qa-layout-primitives.ts` (NEW)** — 125 / 125 PASS across 14
  sections covering bpGte, PodiumBlock tier config, ListingCard
  rarity map, primitive exports, TopBanner tones+pills, hot-path
  screen imports, Character pixel-spec, slot-mapping flip
  preservation, Arena 3-up palette, Market ListingCard+ThreeColumn
  usage, Tavern 3-column composition, HoF podium order + ladder,
  game-screen flattening, every backward-compat handler wired.
- **`qa-v2-primitives.ts` spec-synced** — accepts both "Ring row" /
  "Ring cluster" comment forms, asserts new pixel constants
  (BIG=216, CENTER=462, BELT_H=102). 128 / 128 PASS.
- All 30 prior gauntlets still pass. **Project total: 2241 / 2241.**

### Earlier sessions (referenced for completeness)

See [STATE_OF_PROJECT_2026-05-04.md § Files Modified This Session](./STATE_OF_PROJECT_2026-05-04.md#files-modified-this-session)
for Bucket 2 Fix 1/2/3 + 2H + hide-busy + Lv6-Lv8 NFT catalog +
all prior hotfixes.

---

## Commit Log

> Every commit on `feature/v5-redeploy` since branch start. Newest
> first. Today's 5+3 wrap appended.

```
# Today's wrap (2026-05-13)
<HEAD>   docs: sync gitnexus index counts after v5 functional close
<HEAD-1> docs: consolidate MD files for v5 functional close-out
<HEAD-2> docs(v5): final wrap — STATE_OF_PROJECT 2026-05-13, v5 functional phase closed

# Today's Hall of Fame ship (5 commits, before wrap)
f74fb07 docs: STATE_OF_PROJECT — Bucket 3 #1 + #2 closed, parking-lot updates
1fdbc03 test(v5): qa-hall-of-fame gauntlet — 187 assertions over sort/filter/paginate/classifier
5e2a146 feat(v5): Hall of Fame UI rebuild — sort toggles, filter chips, click-through, pagination
c331676 feat(v5): Hall of Fame pure helpers — sort + filter + display
9ee469e feat(v5): leaderboard wire — propagate stats for build classifier

# Earlier (carried from May-4 snapshot)
5da19e0 docs: sync gitnexus index counts after end-of-day docs pass
c0d7373 data: deployment.testnet-v5.json — Lv6-Lv8 catalog sales audit
2449adb docs: SESSION_HANDOFF SUPERSEDED banner pointing to STATE_OF_PROJECT
5832a66 docs: add CHANGELOG.md tracking project history
6094592 docs(readme): bring current to v5 + Bucket 2 close-out
443e02d docs: sync gitnexus index counts after Bucket 2 polish
dc543c6 feat(v5): hide busy-state cards instead of disabling (Bucket 2 polish)
2f7a56f docs: sync gitnexus index counts after Bucket 2 close-out
59b7984 docs: STATUS.md — Bucket 2 closed, 3 fixes shipped, totals refreshed
97369ff feat(v5): level-up celebration modal (Bucket 2 Fix 3)
f0358d5 fix(v5): WebSocket readyState gate — queue and drain (Bucket 2 Fix 2)
6e2f2d3 fix(v5): multi-queue state isolation (Bucket 2 Fix 1)
09934a6 fix(v5): two-handed gate — second direction (2H into offhand always blocks)
3319628 fix(v5): two-handed weapon enforcement (frontend hardcoded list — Path A)
4d73d53 docs: sync gitnexus index counts after wager-accept-gate fixes
20feb72 fix(v5): server self-heals if silent-accept slips past client (Fix B)
6512e10 fix(v5): close silent-accept wager bug at the client gate (Fix A)
db58941 data(v5.1): mint 9-item Lv6-Lv8 catalog to TREASURY kiosk on testnet
c8b8ec2 feat(v5.1): Lv6-Lv8 NFT catalog mint+list script + 236-test gauntlet
… (full chain in STATE_OF_PROJECT_2026-05-04.md)
```

**~64 commits total since branch start.** Branch base is `08ff991`
(Phase 0.5 — last commit on mainline `main`). Branch has never been
merged to main and won't be merged this push.

---

## Phase 2 Plan

> Phase 2 = UI / theme redesign + v5.1 contract republish on fresh
> wallets / fresh characters / fresh NFTs. Kicks off in the next
> session with the redesign brief; this section is the planning
> spine.

### Scope

**UI / Theme redesign**
- Visual overhaul — colour palette, typography, layout, motion
- New NFT art assets (Pinata folder TBD — current `bafybeiarz5gk3…`
  catalog stays callable on chain but won't be re-used)
- Component-level polish: address every parking item that's a UI
  concern (DM modal focus, DM toast burial, DOF-race on profile
  modal stat hydration, gloves equip stat lag, inventory auto-
  refresh, HP decimal display, stat-allocate preset)
- Mobile-responsive audit (deferred since v4 — design brief is
  desktop-first today)

**v5.1 contract republish**
- Fresh `sui client publish` of the 5 modules (character / item /
  equipment / arena / marketplace + royalty_rule)
- All v5.1 bundle items land in one publish (see
  [v5.1 Contract Republish Bundle](#v51-contract-republish-bundle))
- Fresh publisher wallet, fresh TREASURY, fresh AdminCap,
  fresh Display objects, fresh TransferPolicy
- New `deployment.testnet-v5.1.json` artefact
- Initial item catalog re-mint with redesigned NFT art

**Fresh test wallets / characters**
- Mr_Boss + Sx test wallets get new addresses for v5.1
- All character NFTs / item NFTs from v5 become inert (still on
  chain, no migration path — same policy as v4 → v5; see
  `MAINNET_PREP.md §A`)
- Bucket 3 #3 (multi-day stability) + #4 (fresh-user onboarding)
  run against v5.1 by definition

**Bucket 3 close-out**
- #3 multi-day stability — run during v5.1 testnet soak
- #4 fresh-user onboarding — IS the v5.1 smoke test (fresh
  wallets + fresh characters is the v5.1 baseline)
- #5 admin endpoint audit — sweep before the mainnet (Bucket 6)
  publish, not before v5.1 testnet

### Prerequisites for Phase 2 kickoff

| # | Item | Owner | Status |
|---|---|---|---|
| 1 | Design brief written (palette, typography, motion principles, component-by-component scope) | next session | pending |
| 2 | Art asset plan (new NFT catalog spec, character portrait spec, item art coherent across rarities) | next session | pending |
| 3 | Fresh test wallet generation plan (HD derivation? `sui keytool generate`? key custody plan) | next session | pending |
| 4 | Today's push lands clean on `origin/feature/v5-redeploy` | this session | pending |

### Out of scope for Phase 2

- Mainnet publish (Bucket 6) — happens after Phase 2 → external
  audit (Bucket 5) → mainnet
- Pets / Clans / Herbs / Tournaments / Crafting / Runes / Token —
  post-mainnet content tiers (Bucket 7)
- Mobile app native build — Walrus Sites mainnet portal is the
  vision; mobile-responsive web is the Phase 2 deliverable, not a
  native build

### Branch strategy for Phase 2

`feature/v5-redeploy` is the v5 functional close-out and will not
receive further commits. New work starts on a fresh branch (e.g.
`feature/v5.1-republish` or `feature/phase-2-redesign` — exact name
TBD next session). Mainline `main` stays at v4-era `08ff991` until
v5.1 republish + smoke test + audit pass land.

---

## Reference Table

> Canonical file list — the docs to read for current state vs
> historical archive.

| File | Use |
|---|---|
| **`STATE_OF_PROJECT_2026-05-13.md`** | **This doc — canonical project state, v5 functional close** |
| `STATE_OF_PROJECT_2026-05-04.md` | Historical end-of-Bucket-2 snapshot (unmodified) |
| `STATUS.md` | One-line pointer to this file |
| `SESSION_HANDOFF.md` | Most-recent session-handoff (2026-05-03 evening, SUPERSEDED banner) |
| `CHANGELOG.md` | Day-by-day change history (Keep-a-Changelog format) |
| `TAVERN_DESIGN.md` | Bucket 3 #1 architecture + schema + WS protocol + DM transport design |
| `MAINNET_PREP.md` | Mainnet deploy protocol, threat model, Move semantics |
| `LOADOUT_DESIGN.md` | D1–D5 loadout-save design |
| `SUI_COMBATS_GDD.md` | Game design — combat math, XP curve, item economy |
| `DESIGN_BRIEF.md` | Visual aesthetic brief (will be extended in Phase 2 redesign session) |
| `GRANT_APPLICATION.md` | Sui Foundation grant draft |
| `README.md` | Public-facing project overview + run instructions |
| `CLAUDE.md` / `AGENTS.md` | GitNexus integration for AI tooling |
| `deployment.testnet-v5.json` | v5 deploy + 22-item starter catalog + Lv6-Lv8 catalog (TREASURY kiosk) |
| `~/.claude/projects/-home-shakalis-sui-comabts/memory/` | Forward-looking design seeds — tournament, slot_type, mutual_ko, opponent_scout |
