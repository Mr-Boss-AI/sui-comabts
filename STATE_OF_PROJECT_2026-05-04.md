# SUI Combats — State of the Project, 2026-05-04 (end of Bucket 2)

> Comprehensive end-of-session snapshot. Compiled the evening Bucket 2
> wrapped: Fix 1 + Fix 1 polish + Fix 2 verified live; Fix 3 (level-up
> modal) shipped + unit-tested only. Branch `feature/v5-redeploy` at
> commit `443e02d`, **not pushed**, mainline `main` still at the
> v4-era `08ff991`. This doc consolidates STATUS.md + SESSION_HANDOFF
> + MAINNET_PREP + memory seeds + commit history + GDD scope into a
> single artifact you can hand to a fresh session and know exactly
> where everything stands.

---

## Quick links

- [Bucket Status Matrix](#bucket-status-matrix)
- [Bug Ledger](#bug-ledger)
- [v5.1 Contract Republish Bundle](#v51-contract-republish-bundle)
- [Test Suite State](#test-suite-state)
- [Live Verification Coverage](#live-verification-coverage)
- [Mainnet Readiness Scorecard](#mainnet-readiness-scorecard)
- [Parking Lot](#parking-lot)
- [Files Modified This Session](#files-modified-this-session)
- [Commit Log — feature/v5-redeploy since branch start](#commit-log)
- [What's NOT in the codebase yet](#whats-not-in-the-codebase-yet)
- [Recovery — orphan wager 0xeade9b…](#recovery--orphan-wager-recovered)

---

## Recovery — orphan wager recovered

User reported a stuck 0.1 SUI wager created during a server-down window
mid-session: `0xeade9baafda8ccb61aaf26d98c55c8bc4528f682b622476628e68f7970b16432`
(corrected — the original report missed one hex char; the on-chain id
has `…ccb61…`, not `…cc61…`).

**Recovery executed this wrap.** `POST /api/admin/cancel-wager` →
chain status was 0 (WAITING) with 0.1 SUI in escrow → admin-cancel
succeeded → 0.1 SUI refunded to Mr_Boss.

```
tx digest:  EQVSgRaymDz3Xj71RenMxFZDKsbH5AhqWhaJhUPPYLYE
preStatus:  0 (WAITING)
result:     ok
```

**Abort-6 mystery solved (separate event).** The server-log retry
failures were on a *different* wager: `0xb27892…`. Chain truth shows
that wager was already in `status=2 (SETTLED), escrow=0` — successfully
cancelled via player-signed `cancel_wager` ~76 s after creation. The
server's defense-in-depth `adminCancelWagerOnChain` then raced and
correctly aborted with `EMatchAlreadySettled (6)` because the chain
was already settled. **Benign — SUI was refunded, abort is the chain
refusing double-cancel.** Logged as a v5.1 polish item alongside
"friendly abort-code → toast lookup" (silence the noise; the existing
post-cancel admin call is redundant when the player's own cancel
already lands).

---

## Bucket Status Matrix

> Buckets are the QA / hardening tiers we work through before mainnet
> publish. 1–3 are mainnet-readiness; 4–7 are post-mainnet content tiers.

### Bucket 1 — Live testnet QA (✅ CLOSED 2026-05-04)

| Area | State | Notes |
|---|---|---|
| Character room | ✅ | Equip / unequip / slot picker / save loadout / stat allocate / fight history all walked end-to-end |
| Arena room | ✅ | 12-test wager gauntlet 2026-05-03; Lv5 vs Lv5 (0.4 SUI) verified, dual-wield + shield combo did not crash |
| Marketplace | ✅ | 12-test browser pass + 9-item Lv6-Lv8 catalog minted to TREASURY kiosk; cross-build buy verified (Sx evasion buys Shadowstep Wraps); royalty math verified on Suiscan |
| V4 stat-allocation regression | ✅ | 4 clean Slush approvals across 2 wallets, 3 level-ups (Mr_Boss L3→L4, L4→L5, L5→L6; Sx L5, L5→L6) |
| Counter-triangle live test | ✅ | Lv6 Crit vs Lv6 Evasion, 12/8 over 20 fights with Bug 2 (2H stacking) active. Closer to 50/50 expected post Path A. Mechanically distinct fight feel verified (crit burst 1-3 turns, evasion attrition 5-7 turns). |
| Slush wallet NFT display | ✅ | Display objects render Pinata art in wallet extension |

### Bucket 2 — Polish-bug close-out (✅ SHIPPED 2026-05-04)

7 commits, each with its own qa gauntlet:

| # | Commit | Title | Live | Tests |
|---|---|---|---|---|
| 1 | `6512e10` | Wager Fix A — frontend silent-accept gate | ✅ verified | qa-wager-accept-gate (12 fe) |
| 2 | `20feb72` | Wager Fix B — server auto-rollback | unit only | qa-wager-accept-gate (28 PASS, then extended to 39) |
| 3 | `3319628` | 2H Path A — first direction | ✅ verified | qa-equip-picker +16 |
| 4 | `09934a6` | 2H Path A — second direction | ✅ verified | qa-equip-picker +9 (78 total) |
| 5 | `6e2f2d3` | Multi-queue isolation (Fix 1) | ✅ verified | qa-multi-queue-isolation (60 PASS) |
| 6 | `f0358d5` | WS readyState gate (Fix 2) | ✅ verified live (server kill, no DROPPED errors, app recovered) | qa-ws-readystate (37 PASS) |
| 7 | `97369ff` | Level-up modal (Fix 3) | unit only — XP grind too long for one session | qa-level-up-modal (44 PASS) |
| 7p | `dc543c6` | Polish: hide busy cards | ✅ verified live | qa-busy-state-render (23 PASS) |

### Bucket 3 — Pre-mainnet hardening (⏳ PENDING)

| Item | State | Blocker |
|---|---|---|
| Tavern room (chat / presence / whispers / profile clicks) | not started | Currently a black box live-wise; no gauntlet covers chat |
| Hall of Fame (sort / filter / profile click-throughs) | not started | Minimal prior verification |
| Multi-day stability — overnight uptime | not started | Surfaces leaks / silent fails / orphan-wager idle conditions |
| Fresh user onboarding (wipe localStorage / new wallet) | not started | Tests Block A duplicate-mint guard + auth_phase state machine end-to-end |
| Admin endpoint pre-mainnet audit | not started | Every `/api/admin/*` endpoint should be testnet-network-gated; verify before flip |

### Bucket 4 — v5.1 contract republish (⏳ QUEUED)

Bundled Move-side changes — see [v5.1 Contract Republish Bundle](#v51-contract-republish-bundle) for the full list. Staged as a single `sui client publish`, not an upgrade. New package id, new AdminCap, fresh `deployment.testnet-v5.1.json`. ~3-5 days of work + audit pass.

### Bucket 5 — External audit (⏳ QUEUED)

Per `MAINNET_PREP.md`: 2-4 weeks of an auditor's time. Candidate firms for Sui Move: OtterSec, Zellic, Movebit. Engagement starts ~6 weeks before target launch. Budget $10-30k.

### Bucket 6 — Mainnet publish (⏳ QUEUED)

Fresh `sui client publish` (NOT upgrade — `MAINNET_PREP.md` §A explains why old bytecode stays callable). New publisher wallet, new TREASURY, new AdminCap, new Display objects, new TransferPolicy. Initial item catalog mint via spec'd script. Smoke test: 2 wallets create characters, equip, list, buy, queue, fight, settle.

### Bucket 7 — Post-launch (⏳ PARKING LOT)

Tournaments, Pets, Clans, Herbs, Cross-game item interop — see [What's NOT in the codebase yet](#whats-not-in-the-codebase-yet).

---

## Bug Ledger

> Every bug ever found on this project, with current status. Grouped
> by status; v5.1-CONTRACT items are also re-listed in the
> [v5.1 Contract Republish Bundle](#v51-contract-republish-bundle).

### ✅ FIXED — closed in code, verified

| # | Bug | Fix | Verified |
|---|---|---|---|
| BUG B (2026-05-02) | "Not authenticated" toast after allocate due to WS error during reconnect | Local stat update + WS error suppression | live |
| BUG C (2026-05-02) | Naked-stats gap on chain-restore | DOF hydration before character_created | live |
| BUG D (2026-05-02) | auth_ok character payload ignored | game-provider dispatches SET_CHARACTER on receipt | live |
| BUG E (2026-05-02) | Frontend reading wrong Character NFT for multi-char wallets | Server pin in wire payload (`onChainObjectId`) | live |
| BUG 1 (2026-05-02) | `allocate_points` MoveAbort code 2 (server XP ahead of chain) | `effectiveUnallocatedPoints` clamp | 4× live verifications |
| BUG 2 (2026-05-02) | Save-loadout fight-lock race after fight | Reorder: `set_fight_lock(0)` first | live |
| BUG 3 (2026-05-02) | Off-chain "fake loot" violated NFT-only contract | Removed `rollLoot` call from finishFight | code |
| Bug 1 (2026-05-03) | Reconnect grace timer abuse — fresh 60s every cycle | Per-fight cumulative budget | live (3-cycle 60s→14s→9s forfeit) |
| Bug 2 (2026-05-03) | Wager stake input snapped to 0.1 on every keystroke | String-bound input + submit-time validation | live |
| Bug 3 (2026-05-03) | Outcome modal silent for player who reconnects after settle | Server caches per-wallet outcome; replays via `recent_fight_settled` | live (Mr_Boss/Sx mirror) |
| Block A (2026-04-30) | Duplicate Character mint during auth-flicker | Auth-phase state machine (Layer 1) + server pre-mint guard (Layer 2). Layer 3 `CharacterRegistry` deferred to v5.1 | live |
| Block B (2026-04-30) | Mid-fight crash leaves wagers stuck | Supabase `wager_in_flight` table + boot orphan sweeper | code (live test gated on Supabase provisioning) |
| Block C1 (2026-04-30) | Instant forfeit on WS drop costs real SUI | 60s reconnect grace + timer pause + persistent banner | live |
| Block C2 (2026-04-30) | Marketplace silent gap-fill loss on reconnect | 5-attempt retry loop, schedules full reconnect on exhaustion | live |
| Block C3 (2026-04-30) | Marketplace coldSync no boot retry | `withChainRetry` per page | live |
| Block 4 (2026-04-30) | Wager-lobby TOCTOU race on accept | `processingWagerAccepts` single-flight guard | code |
| Block 5 (2026-04-30) | Marketplace cursor stuck on empty pages | Cursor advances unconditionally | code |
| Silent-WS-loss orphan (2026-05-02) | `socket.send` returns true while TCP drops the bytes — wager stranded on chain | New `wager-register.ts`: WS-send-then-ACK with REST fallback to `/api/admin/adopt-wager` | live |
| Silent-accept Fix A (2026-05-04) | Player with own open wager could click Accept on another's; chain accept silently succeeded → both wagers stuck ACTIVE | Frontend `canAcceptWager` predicate disables button + early-returns before signing | live |
| Silent-accept Fix B (2026-05-04) | If chain accept slipped past Fix A, server's late-firing check just returned a toast and left chain stuck ACTIVE | `decideAcceptOutcome` predicate's autoRollback path admin-cancels both wagers | unit (28-test gauntlet) |
| Two-handed dual-wield (2026-05-04) | Could equip Maul + Greatsword for stacked damage | Frontend `TWO_HANDED_NAMES` set + `evaluateTwoHandedConflict`; both directions covered | live |
| Multi-queue isolation Fix 1 (2026-05-04) | Player could be in own wager AND ranked queue simultaneously, stranding SUI | `computeBusyState` predicate (frontend) + `evaluateServerBusy` (server) gate every queue/wager entry | live |
| WS readyState (Fix 2, 2026-05-04) | Polling effects fired during reconnect window printed `[WS] DROPPED outbound` errors | `useGameSocket.send()` queues messages when `readyState !== OPEN`; drains on reconnect; stale (>30 s) entries discarded; cap 200 | live (server-kill scenario) |
| Hide-busy polish (2026-05-04) | Greyed-out cards + banner felt cluttered | Hide irrelevant cards entirely; `decideMatchmakingRender` predicate | live |
| Orphan wager 0xeade9b… (2026-05-04) | Server-down mid-create — 0.1 SUI stranded with no lobby entry | Recovered via `/api/admin/cancel-wager`, tx `EQVSgRaymDz…` | live |

### ⏳ DEFERRED — code complete, awaiting live test

| # | Bug | Why deferred |
|---|---|---|
| Block 2 end-to-end live test | Code complete (orphan sweeper + WS ACK fallback). Requires Supabase provisioning to test the boot-time sweep path with a real persisted row. |
| Fix 3 — level-up modal (this session) | 44/44 unit tests PASS; Lv6→Lv7 takes ~3000 XP grind, too long for one test session. Will fire automatically next time a fight crosses a threshold. |

### 🔧 v5.1-CONTRACT — needs Move republish

| # | Item | Note |
|---|---|---|
| Block A Layer 3 | Move `CharacterRegistry` mapping `address → ID`. Closes the 1-in-N edge case where a hand-crafted PTB bypasses both UI gates and signs `create_character` directly. |
| Player-signed settlement | Today TREASURY can pick any winner from `{player_a, player_b}` in `settle_wager`. v5.1 adds `settle_wager_attested(wager, winner, sig_a, sig_b)` requiring both players' `signPersonalMessage` over the fight-outcome hash. |
| `burn_character` | Admin-gated entry to retire Character objects. Cleans up legacy `Mr_Boss_v5` / `Sx_v5` / "mee" residue. |
| Admin-signed loot mint | Reuse `rollLoot` rarity + stat-roll math from `server/src/game/loot.ts`; mint a real chain Item NFT to the winner via `mint_item_admin`. |
| `OpenWagerRegistry` | Closes both **dual-accept silent corruption** (Fix A's chain-side cousin) AND **server-down-mid-create orphan** (this session's `0xeade9b…` recovery). Shared object mapping `address → Option<wager_id>`; `create_wager` and `accept_wager` abort if the caller has an entry. |
| `slot_type: u8` on Item | `0=mainhand, 1=offhand, 2=both_hands`. Replaces the frontend hardcoded `TWO_HANDED_NAMES` allowlist (Path A). Subsumes the dagger-merge / two-handed-weapon-class design seeds (`project_slot_type_seed.md`). |
| Draw / mutual-KO settlement | `settle_wager` requires a single `winner`. v5.1 adds either a draw-aware `settle_wager(winner: Option<address>)` or a separate `settle_draw(wager)` entry. SUI handling option open (a/b/c — see `project_mutual_ko_seed.md`). The `draws` counter on `Character` requires a struct change either way. |

### 🪪 PARKING — non-blocking, indefinitely deferred

| # | Item | Notes |
|---|---|---|
| Inventory auto-refresh after rapid equip swaps | Minor sync lag between doll panel and inventory list. Hard refresh fixes. Likely a missing `dispatch` after optimistic local update. |
| HP decimal display | "0.25 HP" renders as "0/90" when actual_hp > 0. Round display up to 1 when actual is non-zero. |
| Equipped items invisible at fight start | Race between fight-room render and DOF hydration. Refresh fixes. Hold render behind hydration promise. |
| Stat-allocate modal preset to 0/0/0/0 | Pre-populate with current allocations so the player only nudges deltas. |
| Buy button disabled-state stability | Flashes green ~0.1 s during balance poll cycle (~10 s interval). Spam-click guard already in place. Cosmetic. |
| Friendly abort-code → toast lookup | Map `(module, code)` → human string. Wrap `signAndExecuteTransaction` error path. Includes silencing the abort-6 noise from the post-cancel admin race (this session). |
| TransferPolicy royalty withdraw UI | Currently 0.14+ SUI accumulated in the policy object; needs `TransferPolicyCap` holder to call `transfer_policy::withdraw`. CLI for now. |
| Race-condition Test 12 (parallel buy) | Two wallets clicking Buy on the same listing at the exact same instant. Needs a ts-node script firing both PTBs in parallel via SDK. Low priority. |

---

## v5.1 Contract Republish Bundle

> Every Move-side change queued for the next `sui client publish`.
> Bundled because Sui upgrades don't retire bytecode (see
> `MAINNET_PREP.md §A`); a fresh publish gives a clean break.

### Module-by-module

**`character.move`**
- Add `CharacterRegistry` shared object: `Table<address, ID>` mapping wallet → Character object id. Updated by `create_character` (insert) and `burn_character` (remove).
- `create_character` aborts with `EWalletAlreadyHasCharacter` if registry has an entry. Closes Block A Layer 3.
- New `burn_character(admin: &AdminCap, character: Character, registry: &mut CharacterRegistry)` — admin-gated; consumes the Character object, removes registry entry. Cleans up legacy mr_boss/sx residue.
- Add `draws: u32` field to `Character` struct. Required for the draw counter in the mutual-KO modal feature.
- New `update_after_fight_draw(admin, character, xp, clock)` — increments `draws` instead of wins/losses, applies XP only.

**`arena.move`**
- New `OpenWagerRegistry` shared object: `Table<address, ID>` mapping creator → wager id. Updated by `create_wager` (insert), `accept_wager` (read player_b — no insert since they don't become a creator), `cancel_wager`, `settle_wager`, `admin_cancel_wager`, `cancel_expired_wager` (all remove).
- `create_wager` aborts with `EAlreadyHasOpenWager` if caller is in registry. Closes the server-down-mid-create orphan family.
- `accept_wager` aborts with `EAlreadyHasOpenWager` if caller is in registry. Chain-side defense for the silent-accept bug (Fix A + Fix B's autoRollback become belt-and-braces, no longer the only line of defense).
- New `settle_wager_attested(wager, winner, sig_a, sig_b, clock, ctx)` — verifies both players' `signPersonalMessage` over the canonical fight-outcome hash before paying out. Closes the TREASURY-trust assumption ("server can pick wrong winner").
- New `settle_draw(wager, clock, ctx)` OR `settle_wager` widened to accept `winner: Option<address>` — handles mutual-KO. SUI option (a/b/c) deferred to spec time.
- `admin_cancel_wager` semantically unchanged but logs that abort-6 (`EMatchAlreadySettled`) is the expected race when player-cancel beats server defense-in-depth — caller should treat as success.

**`item.move`**
- Add `slot_type: u8` to `Item` struct: `0=mainhand, 1=offhand, 2=both_hands`. Defaults to `0` for backward compat with existing v5 items if migration is desired (see "Migration" below).
- `mint_item_admin` takes `slot_type` param.

**`equipment.move`**
- `equip_weapon` aborts with `EOffhandOccupied` if `slot_type == 2 (both_hands)` and offhand is non-null.
- `equip_offhand` aborts with `EWeaponIsTwoHanded` if pending.weapon's slot_type == 2.
- `equip_offhand` aborts with `EItemNotOffhand` if `slot_type == 2 (both_hands)`.
- Replaces frontend hardcoded `TWO_HANDED_NAMES` allowlist with chain-side enforcement.

**`marketplace.move`**
- No structural changes anticipated. Royalty rule + listing fee + atomic delist all working as designed.

**`royalty_rule.move`**
- No changes. Optional polish: add a `withdraw` helper that's clearer than `transfer_policy::withdraw` for the UI to call, but not required.

### Loot-mint pipeline

- Reuse `rollLoot` rarity + stat-roll math from `server/src/game/loot.ts` (currently disabled per BUG 3 fix).
- Server's post-fight handler calls `mint_item_admin` via the treasury queue with rolled values; the resulting Item NFT is `transfer::public_transfer`'d to the winner.
- Frontend handles the new `loot_minted` WS event by adding the Item to inventory (it'll arrive on the next chain refresh anyway, but a dedicated event lets us pop a "You got X!" toast).

### Migration / cut-over

- v5.1 is a fresh publish, not an upgrade. New `packageId`, new AdminCap, new Display objects, new TransferPolicy.
- v5 testnet players don't migrate — they re-create characters on v5.1. Standard since v4→v5; `MAINNET_PREP.md` already documents the no-migration policy.
- Server's `deployment.testnet-v5.1.json` mirrors v5's structure; the env-update step is `SUI_PACKAGE_ID` / `ADMIN_CAP_ID` / `TRANSFER_POLICY_ID` / `PUBLISHER_OBJECT_ID` swap.
- Existing v5 starter items (22 + 9 v5.1 catalog = 31 NFTs) become unusable post-republish — that's expected.

### Estimated effort

- Move work: 2-3 days (the registries are straightforward; `settle_wager_attested` is the only non-trivial piece due to BCS-encoded hash + dual `verify_personal_message`).
- Frontend wiring: 1-2 days (settle_wager_attested signing UX, slot_type-aware picker that drops the hardcoded list, draw-aware fight-end flow).
- Server: 1 day (treasury-queue calls swap to attested settle; loot-mint pipeline re-enabled; CharacterRegistry pre-mint guard now redundant but kept as defense-in-depth).
- Testing: 1 day (extend existing gauntlets, add new ones for `settle_wager_attested` round-trip, slot_type combinations).
- Total: **5-7 days of focused work** before the audit pass.

---

## Test Suite State

> Last full run: 2026-05-04 evening. All static gauntlets PASS.
> qa-chain-gauntlet runs against live testnet so its assertion count
> varies by run — last successful run is reported here.

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
| **Static total** | | **1195 / 1195 PASS** |

Plus **35/35** Move unit tests under `contracts/tests/` (`sui move test`).

### Live-chain gauntlet

| Gauntlet | Coverage | State |
|---|---|---|
| `qa-chain-gauntlet.ts` | End-to-end flow against testnet — character mint, equip via DOFs, fight-lock set/clear, etc. Leaves a test character on chain (per its closing log). Variable assertion count. | last run **PASS** (Bucket 2 close-out) |

### Drift watch

No gauntlet has drifted from its declared count. The 19→20 increase
in `qa-equip-picker` came from the documented 2H-second-direction
extension (commit `09934a6`); 28→39 in `qa-wager-accept-gate` came
from the multi-queue cross-mode extension (commit `6e2f2d3`). Both
deltas are documented in commit messages.

---

## Live Verification Coverage

> "Live" = walked in a browser with two real wallets on Sui testnet.
> "Unit" = predicates / math / state machines under static gauntlet.
> "Chain-truth" = chain queries via Suiscan or RPC.

### Verified live (this session and before)

- Wager Fix A — silent-accept gate (browser, gate refused click as expected; chain confirmed M_W stayed WAITING)
- 2H Path A direction 1 — picker greyed out 2H mainhand candidates with red badge
- 2H Path A direction 2 — picker greyed out 2H offhand candidates with reason
- Multi-queue isolation Fix 1 — created wager → Friendly/Ranked cards correctly hid (post-polish); reverse: in queue → Wager-create hides
- Hide-busy polish — Mr_Boss with open wager sees only "OPEN WAGERS" + Cancel; Sx (idle) sees full 3-card menu
- WS readyState gate Fix 2 — server killed mid-session, user kept clicking, server restarted, reconnected cleanly, no `[WS] DROPPED outbound` errors in console, app fully recovered. Then created + cancelled a fresh wager with no issues.
- Lv6 grind — Mr_Boss + Sx both reached Lv6, allocate_points clean (no MoveAbort)
- Counter-triangle — Crit vs Evasion 12/8 (60/40) over 20 fights
- Marketplace mint+list pass — 9 items minted to TREASURY kiosk; cross-build buy verified
- Orphan wager recovery — `0xeade9b…` cancelled via admin endpoint, tx `EQVSgRaymDz…`

### Unit-only (no live verification yet)

- Wager Fix B — server auto-rollback (28 PASS, then 39 with cross-mode extension). Hard to reproduce live without a hand-crafted PTB bypass; v5.1 `OpenWagerRegistry` will subsume.
- Fix 3 — level-up modal (44 PASS). Will fire on next natural level-up; ~3000 XP for Lv6→Lv7.
- Block 2 — orphan-wager sweep (30 PASS). Code path requires Supabase provisioning to exercise the boot-time row scan.
- Multi-level merge in `mergeLevelUpEvent` — needs back-to-back level-ups before modal dismissal, rare in practice.
- 2H + level-lock precedence (level reason wins when both apply) — only fires for low-level players; not yet seen live.

### Gaps — not even unit-tested

- Tavern chat / presence / whispers (Bucket 3 #1)
- Hall of Fame sort / filter (Bucket 3 #2)
- Multi-day overnight stability (Bucket 3 #3)
- Fresh user onboarding from never-seen wallet (Bucket 3 #4)
- Race-condition Test 12 (parallel buy on same listing)
- Server crash mid-settlement → settlement-queue recovery (code path exists, no scripted test)

---

## Mainnet Readiness Scorecard

### Original 8 blockers (entered v5 hardening pass)

| # | Blocker | State |
|---|---|---|
| 1 | Gas-coin contention in admin tx settlement | ✅ Closed — sequential treasury queue |
| 2 | Mid-fight crash leaves wagers stuck on chain | ⚠️ Code complete — orphan sweeper live + frontend ACK fallback. End-to-end live test gated on Supabase provisioning |
| 3 | Multi-Character wallet picks wrong NFT on hot paths | ✅ Closed — server pin (`Character.onChainObjectId`) + frontend alignment via wire payload (BUG E fix) |
| 4 | Wager-lobby TOCTOU race on accept | ✅ Closed — `processingWagerAccepts` single-flight guard |
| 5 | Marketplace cursor stuck on empty pages | ✅ Closed — cursor advances unconditionally |
| 6 | Marketplace silent gap-fill loss on reconnect | ✅ Closed — 5-attempt retry, schedules full reconnect on exhaustion |
| 7 | Marketplace coldSync no boot retry | ✅ Closed — `withChainRetry` per page |
| 8 | Duplicate-Character mint during auth flicker | ✅ Closed for layers 1+2; layer 3 deferred to v5.1 republish |

### Bucket 2 hotfixes added during the live testing pass

| Tag | Issue | State |
|---|---|---|
| Silent-accept Fix A | Frontend gap | ✅ Closed (verified live) |
| Silent-accept Fix B | Server gap | ✅ Closed (unit) — chain-side defense in v5.1 |
| Two-handed Path A | UI gap | ✅ Closed (verified live) |
| Multi-queue Fix 1 | Frontend + server | ✅ Closed (verified live) |
| WS readyState Fix 2 | Reconnect noise | ✅ Closed (verified live) |
| Level-up modal Fix 3 | Silent level-up | ✅ Closed (unit) — live verification deferred |

### New blockers / questions raised this session

| # | Item | State |
|---|---|---|
| 9 | Server-down-mid-create wager orphan | ⚠️ One incident recovered manually this session via admin endpoint. v5.1 `OpenWagerRegistry` is the permanent fix (chain-side guard prevents the orphan from being created in the first place). Until then: any incident requires a `POST /api/admin/cancel-wager` curl. |
| 10 | Admin endpoint network gating audit | ⚠️ Each `/api/admin/*` endpoint is supposed to 403 on `CONFIG.SUI_NETWORK === 'mainnet'`. Need a sweep to confirm no endpoint slipped through. Bucket 3 work item. |

### Net assessment

**Everything we know about is fixed except (a) Block 2's end-to-end
live test (gated on Supabase), (b) the v5.1 republish bundle, and
(c) the 2 new blockers above.** The v5.1 republish is the single
biggest remaining task before mainnet.

---

## Parking Lot

> Every "v5.1 polish" / "deferred" / "future" item across all docs,
> deduplicated, source noted. The contract bundle items above
> aren't repeated here.

| Item | Source | Type |
|---|---|---|
| Inventory auto-refresh after rapid equip swaps | STATUS.md polish backlog | Frontend polish |
| HP decimal display ("0.25 HP" → "0/90") | STATUS.md polish backlog | Frontend polish |
| Equipped items invisible at fight start (DOF hydration race) | STATUS.md polish backlog | Frontend polish |
| Stat-allocate modal preset to 0/0/0/0 | STATUS.md polish backlog | Frontend polish |
| Buy button disabled-state stability (poll cycle flash) | Bucket 2 closeout (carried) | Frontend polish |
| TransferPolicy royalty withdraw UI | Bucket 2 closeout (carried) | Frontend feature |
| Race-condition Test 12 (parallel buy script) | Bucket 2 closeout | Test infra |
| Friendly abort-code → toast lookup | Bucket 2 closeout + this session abort-6 | Frontend polish |
| Tournament feature (pot-funded, ticket NFT, fist-fight) | `project_tournament_seed.md` | Feature design |
| Item slot_type primitive (subsumes 2H Path B + dagger-merge) | `project_slot_type_seed.md` | v5.1 contract bundle |
| Mutual KO / Draw modal + chain settlement (3 SUI options open) | `project_mutual_ko_seed.md` | v5.1 contract bundle (counter table) + frontend modal |
| Multi-queue isolation v5.1 chain-side guard | `project_multi_queue_isolation.md` | v5.1 contract bundle (`OpenWagerRegistry`) |
| Opponent preview / scout system (W/L, gear, recent fights) | `project_opponent_scout_seed.md` | Post-mainnet feature; database-only |
| Game balance — armor/HP scaling pass at higher levels | STATUS.md game-balance | Content tuning |
| Equipment runes / enchanting | GDD §11 | Future feature |
| Clan wars | GDD §11 | Future feature |
| Crafting (combine items into higher rarity) | GDD §5.5 | Future feature |
| Seasonal tournament prizes | GDD §8 | Future feature |
| COMBAT governance/reward token | GDD §8 | Future / optional |
| Cross-game item interop standard | Grant App Phase 4 | Post-mainnet |
| Mobile-responsive UI | Grant App Phase 4 | Post-mainnet |
| Walrus Sites mainnet portal | Grant App Phase 4 | Post-mainnet |

---

## Files Modified This Session

> Grouped by feature. Every change committed locally; nothing pushed.

### Bucket 2 Fix 1 — Multi-queue isolation (commit `6e2f2d3`)

```
A  frontend/src/lib/busy-state.ts                            (NEW, ~115 lines)
A  server/src/ws/busy-state.ts                               (NEW, ~75 lines)
M  server/src/ws/wager-accept-gate.ts                        (extended)
M  server/src/ws/handler.ts                                  (gate at top of handleQueueFight, cross-cleanup in handleWagerAccepted)
M  frontend/src/components/fight/matchmaking-queue.tsx       (banner, button gating, defense-in-depth gate)
A  scripts/qa-multi-queue-isolation.ts                       (NEW, 60-test gauntlet)
M  scripts/qa-wager-accept-gate.ts                           (28→39, +11 cross-mode cases)
```

### Bucket 2 Fix 2 — WS readyState (commit `f0358d5`)

```
A  frontend/src/lib/ws-pending-queue.ts                      (NEW, pure drain/cap helpers)
M  frontend/src/hooks/useGameSocket.ts                       (queue + drain on reconnect)
A  scripts/qa-ws-readystate.ts                               (NEW, 37-test gauntlet)
```

### Bucket 2 Fix 3 — Level-up modal (commit `97369ff`)

```
M  server/src/ws/fight-room.ts                               (broadcast character_leveled_up after chain confirms)
M  frontend/src/types/ws-messages.ts                         (new ServerMessage variant)
A  frontend/src/lib/level-up-display.ts                      (NEW, predicate + formatters + merge)
A  frontend/src/components/character/level-up-modal.tsx      (NEW, celebration UI)
M  frontend/src/hooks/useGameStore.ts                        (levelUpEvent state, 3 actions, pendingStatAllocate bridge)
M  frontend/src/app/game-provider.tsx                        (WS listener + sound)
M  frontend/src/components/layout/game-screen.tsx            (modal mount)
M  frontend/src/components/character/character-profile.tsx   (pendingStatAllocate consumer)
A  scripts/qa-level-up-modal.ts                              (NEW, 44-test gauntlet)
```

### Bucket 2 polish — Hide busy cards (commit `dc543c6`)

```
M  frontend/src/lib/busy-state.ts                            (decideMatchmakingRender added)
M  frontend/src/components/fight/matchmaking-queue.tsx       (slot-driven JSX, banner removed)
A  scripts/qa-busy-state-render.ts                           (NEW, 23-test gauntlet)
```

### Doc commits (`59b7984`, `2f7a56f`, `4d73d53`, `443e02d`)

```
M  STATUS.md                                                 (Bucket 2 close-out section)
M  AGENTS.md                                                 (gitnexus index counts)
M  CLAUDE.md                                                 (gitnexus index counts)
```

### Earlier this session (referenced for completeness)

| Commit | Files |
|---|---|
| `c8b8ec2` (mint script) | `scripts/mint-lv6-8-catalog.ts` (NEW), `scripts/qa-mint-catalog.ts` (NEW) |
| `db58941` (data) | `deployment.testnet-v5.json` (modified), `nft/nft-5.1/*.png` (8 NEW) |
| `6512e10` (Fix A) | `frontend/src/lib/wager-accept-gate.ts` (NEW), matchmaking-queue.tsx |
| `20feb72` (Fix B) | `server/src/ws/wager-accept-gate.ts` (NEW), `server/src/ws/handler.ts`, `scripts/qa-wager-accept-gate.ts` (NEW) |
| `3319628` + `09934a6` (2H) | `frontend/src/lib/two-handed-weapons.ts` (NEW), equipment-picker.ts, character-profile.tsx, useEquipmentActions.ts, qa-equip-picker.ts |

---

## Commit log

> Every commit on `feature/v5-redeploy` since branch start. Newest first.

```
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
89c989f docs: sync gitnexus index counts after evening QA commit
452cc65 docs: 2026-05-03 evening QA pass — Bucket 2 closed, Lv5 verified
9d7dd19 fix(v5): grace timer is a cumulative per-fight budget, not per-cycle (Bug 1)
20f3750 fix(v5): replay outcome modal on reconnect after settle-while-offline (Bug 3)
a26535e fix(v5): wager stake input is clearable, validates on submit (Bug 2)
fe9c883 fix(v5): character page consistency — HP/ATK table parity + stat bar Tailwind v4
fd56b4a fix(v5): slot picker keeps locked items, dimmed with Lv N badge
08340ea docs: sync gitnexus index counts after cleanup
88a4288 v5 testnet hardening + repo cleanup
dc28eff fix(v5): publish server-pinned chain id to frontend (BUG E)
413593e fix(v5): post-allocate UX + naked-stats gap + auth_ok wiring (Bug 1 retest)
6871df0 fix(v5): close silent-WS-loss orphan-wager class
b39202d fix(v5): three live-test bugs — stat drift, fight-lock race, fake loot
bd631c9 fix(v5): C1 reconnect grace — banner, timer pause, choice acceptance
3d2c6a4 docs(v5): STATUS wrap — Blocks A–D shipped, mainnet readiness ranking
468a43e fix(v5): three Gemini re-audit findings (C1 + C2 + C3)
999300e fix(v5): orphan-wager sweep — schema, setup, testability
a462fec fix(v5): close duplicate-Character-mint bug (layers 1+2)
3b54108 docs(v5): session-end wrap with tomorrow-morning checklist
a70832b admin(v5): cancel-wager + repin-character endpoints, recovery from live test
ba41fe6 hardening(v5): treasury queue, crash recovery, multi-char fix, SDK hygiene
07732d2 feat(v5): XP rewrite, marketplace end-to-end, hardening from gauntlet
5508df5 docs: STATUS_v5.md — session wrap-up + next-session investigation list
dcca786 feat(deploy): v5 testnet redeploy artefacts + 22-NFT catalog mint
487502f feat(frontend): v5 wiring — JWT auth, balance UI, 10 slots, env throws
26cd8a9 feat(server): v5 SDK migration + JWT auth + retry pattern + DOF reads
96546e7 build(contracts): untrack auto-generated build/ artifacts
6db670c docs: update for loadout-save shipped + architecture map
b7b8eac feat: loadout-save flow — staged equipment + atomic PTB save
d61f8dc fix: combat correctness pass — timer, manual lock-in diagnostics, hp display, shield slots, fight-end logging
ba3f57f feat: on-chain DTC equipment + wager settlement working end-to-end
6a33bc1 docs: loadout-save design doc (D1=PTB, D2=skip, D3=strict, D4=confirmed, D5=keep)
08ff991 Phase 0.5: on-chain DTC equipment + fight-lock + listing fee
9b3196e Fix WS reconnect loop on session replacement
c4c8a96 Living character NFTs, wager lobby hardening, Character tab redesign
e4283a4 Integrate on-chain wager escrow + document April 15 progress
d5aa294 Add README and MIT license for public release
e95bc34 Security hardening: remove secrets before making repo public
316cf81 Add Sui Foundation grant application document
91a83a7 Add Walrus Sites deployment support
1d2ac7c Add root package.json with vercel-build script
213557e Initial commit: SUI Combats full project
```

**56 commits total since branch start.** This session added 14 commits
(c8b8ec2 → 443e02d).

---

## What's NOT in the codebase yet

> Features mentioned in design docs (`SUI_COMBATS_GDD.md`, `DESIGN_BRIEF.md`,
> `GRANT_APPLICATION.md`) that have **zero implementation**. Reality
> check on scope vs documented intent.

### Documented but not built — gameplay

| Feature | Source | Note |
|---|---|---|
| Pets | (No mention found in docs — included in user's prompt as common-RPG content) | No structs, no UI, not in roadmap. Future content tier. |
| Clans / Guilds | GDD §11 ("Clan wars" listed under "Future feature") | Zero scaffolding. |
| Herbs / consumables | (No mention found — included in user's prompt as common-RPG content) | Not in current item taxonomy (`item.move` has 9 item types: weapon/shield/helmet/chest/gloves/boots/belt/ring/necklace). |
| Tournaments | GDD §8 + Grant App Phase 4 ("Seasonal tournament prizes", "tournament system with prize pools") | Memory-seeded as `project_tournament_seed.md` (pot-funded, ticket NFT, fist-fight format). Zero scaffolding in code. |
| Equipment runes / enchanting | GDD §11 | Zero scaffolding. |
| Crafting (combine lower items into higher rarity) | GDD §5.5 | Zero scaffolding. |
| Pet-system hooks | (Not present) | — |

### Documented but not built — economy / token

| Feature | Source | Note |
|---|---|---|
| COMBAT governance / reward token | GDD §8 ("Future: COMBAT token") | Not on roadmap. |
| Cross-game item interoperability standard | Grant App Phase 4 | Aspirational. |

### Documented but not built — UX / surfaces

| Feature | Source | Note |
|---|---|---|
| Mobile-responsive UI | Grant App Phase 4 | Desktop-only today. Tailwind utility classes are mostly responsive but no mobile-first audit pass. |
| Tavern (chat / presence / whispers / profile clicks) | GDD §7.1 + STATUS Bucket 3 | UI surface exists; Bucket 3 will validate live. Treated as "scaffolded but not verified." |
| Hall of Fame leaderboard | GDD §7.2 + STATUS Bucket 3 | UI surface exists; needs deeper sort/filter/profile-click audit. |
| Spectate fights | Implemented (FightArena `<SpectateView />`) | Code exists; not heavily exercised in QA. |
| Friend system / whispers | Partial — chat exists, whispers untested | Bucket 3. |
| Mainnet portal on Walrus Sites | Grant App Phase 4 | Testnet only today. |

### Implemented but undocumented (or under-documented)

- Lv6-Lv8 NFT catalog v5.1 (9 items in TREASURY kiosk) — minted but the design rationale isn't in the GDD's item economy section. Worth a paragraph in v5.1 docs.
- Treasury queue concurrency knob (`TREASURY_QUEUE_CONCURRENCY`) — code-only, mentioned in commit messages but not in the public README.

---

## Reference

| File | Use |
|---|---|
| `STATUS.md` | Canonical project state — points here for the comprehensive snapshot |
| `STATE_OF_PROJECT_2026-05-04.md` | This file — comprehensive end-of-Bucket-2 snapshot |
| `SESSION_HANDOFF.md` | Most-recent session wrap (2026-05-03 evening) |
| `MAINNET_PREP.md` | Mainnet deploy protocol, threat model, Move semantics |
| `LOADOUT_DESIGN.md` | D1–D5 loadout-save design |
| `SUI_COMBATS_GDD.md` | Game design — combat math, XP curve, item economy |
| `DESIGN_BRIEF.md` | Visual aesthetic brief |
| `GRANT_APPLICATION.md` | Sui Foundation grant draft |
| `CLAUDE.md` / `AGENTS.md` | GitNexus integration for AI tooling |
| `deployment.testnet-v5.json` | v5 deploy + 22-item starter catalog + nft_catalog_v5_1 (Lv6-Lv8 in TREASURY kiosk) |
| `~/.claude/projects/-home-shakalis-sui-comabts/memory/` | Forward-looking design seeds — tournament, slot_type, mutual_ko, opponent_scout, multi_queue (now closed) |
