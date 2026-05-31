# SUI Combats — State of the Project, 2026-05-29 (EOD FINAL — v5.1 QA gauntlet COMPLETE; v5.2 wager-fairness contract BUILT, awaits deploy)

> **v5.1 testnet QA gauntlet is COMPLETE.** Every flagship surface
> live-verified two-wallet across 2026-05-28 / 2026-05-29 (Slush +
> zkLogin signing paths, on-chain Suiscan-confirmed).
> Branch `feature/v5.1-contracts` @ `534e4f4` on origin (pushed
> 2026-05-29).  v5.1 package `0x308645f3…3717` unchanged.
> **Mainline `main` stays at `08ff991` (v4-era) — merge timing
> decision flagged for 2026-05-30** (see [§ Decision point](#-decision-point--v51--main-merge-timing)).
>
> **v5.2 wager-fairness contract has been BUILT by CLI** per
> [`docs/V5.2_WAGER_FAIRNESS_SPEC.md`](docs/V5.2_WAGER_FAIRNESS_SPEC.md)
> and is staged for tomorrow's fresh testnet publish.
>
> This doc supersedes
> [`docs/archive/STATE_OF_PROJECT_2026-05-28.md`](docs/archive/STATE_OF_PROJECT_2026-05-28.md).

---

## ✅ COMMITTED & PUSHED THIS SESSION

| Commit | Scope |
|---|---|
| **`b606a97`** *(AM)* | Server scout-modal sanitizer + 13-slot fix, arena wager-card clickable scouting, mutual-KO draw modal + sound. Closed the three working-tree items flagged by 2026-05-28 EOD. |
| **`57027bd`** *(PM)* | Complete two-handed weapon system — `slot_type` plumbed chain→frontend (`TWO_HANDED_NAMES` allowlist deleted), abort humanizer at all call sites, inverse picker excludes off-hand for 2H, `buildSaveLoadoutTx` auto-clear + unequip-before-equip ordering, educational popup on wrong-order, slot lock + tooltip. 146/146 tests across 5 gauntlets. Docs: [`docs/V5.1_TWO_HANDED_FLOW.md`](docs/V5.1_TWO_HANDED_FLOW.md). |
| **`534e4f4`** *(EOD doc reorg)* | Rolling EOD archive — 9 docs moved to `docs/archive/`; new `docs/README.md` curated index; CLAUDE.md GitNexus block refreshed from `npx gitnexus analyze`. |

## 📝 POST-PUSH UNCOMMITTED (working tree at EOD, ready for next commit)

| Item | Files | Status |
|---|---|---|
| Hall of Fame W/L/D counter (`draws: u32` end-to-end) | 8 server + 8 frontend + `scripts/qa-hall-of-fame.ts` | ✅ live-verified, tsc clean, gauntlets green (198 hall-of-fame + 247 regression-passes across other gauntlets) |
| v5.2 wager-fairness spec | `docs/V5.2_WAGER_FAIRNESS_SPEC.md` + 4 one-line pointers (`MAINNET_PREP.md`, this doc, `docs/README.md`) | 📄 design doc; the Move contract has also been built by CLI but is not yet deployed |
| Automated chore changes | `AGENTS.md`, `CLAUDE.md` (GitNexus auto-rewrite), `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` | bundle into next commit |

Server `tsc --noEmit` clean. Frontend `tsc --noEmit` clean.

---

## TL;DR

| Field | Value |
|---|---|
| Phase | **v5.1 testnet COMPLETE — every chain rule live-exercised including the two-handed-weapon slot_type contract.** Next phase: v5.2 trust + content (`sui::random`, `respec`, `settle_wager_attested`) + external audit prep |
| Branch | `feature/v5.1-contracts` |
| HEAD on origin | **`57027bd`** *(pushed 2026-05-29 EOD with user authorization)* |
| Mainline | `main` untouched at `08ff991` (v4-era — standing rule, no merge until v5.2 + audit) |
| v5.1 package id | `0x308645f3d85ba6d7647f660610faba5dbdae2822819939bc917302a20cf33717` |
| Move tests | **71 / 71 PASS** (unchanged) |
| Frontend QA gauntlets | **146 / 146 PASS** across 5 two-handed gauntlets (slot-type, equipment-aborts, two-handed-loadout, stage-classifier, equip-picker) |
| Server `tsc --noEmit` | clean |
| Frontend `tsc --noEmit` | clean |
| Backend `:3001` `/health` | ok |
| Frontend `:3000` HTTP | 200 |
| Test wallets | Mr_Boss (Slush) `0x06d6cb67…9624` Lv2, geared Tank · Sx (zkLogin) `0x03c33df0…985f` Lv2, full Lv1 Ponke loadout |
| TREASURY | `0x975f1b34…19d4d` — comfortable; ~0.000887 SUI gas on mutual-KO settle |
| Marketplace | 52 originally minted (26 Lv1 Ponke + 26 Lv2 Scavenger); **23 active listings** = remainder after multi-session buys (chain-verified via `kioskListed` set, NOT a bug) |

---

## What changed vs 2026-05-28

**Chain state — unchanged.** Same v5.1 package, same registries, same
Display objects, same kiosk. No new contract publish, no migration.

**Server state — committed.** The `wire-sanitize.ts` extraction from
the AM session is on origin (commit `b606a97`). The PM two-handed work
added `Item.slotType` to the server type + every hydrator (`sui-read`
`parseItemFromContent`, `marketplace::fetchItemNft`,
`wire-sanitize::sanitizeItem`, `marketplace::listingToWire`). Server
must be restarted on deploy — `ts-node` doesn't watch (see
[`docs/V5.1_TWO_HANDED_FLOW.md`](docs/V5.1_TWO_HANDED_FLOW.md) for the
exact failure mode this caused live during development).

**Frontend state — committed.** Two-handed system shipped end-to-end:
new `lib/equipment-aborts.ts`, full rewrite of `lib/two-handed-weapons.ts`
(deletes `TWO_HANDED_NAMES`, adds `classifyStageEquip`), rewrite of
`lib/loadout-tx.ts` (cross-slot invariant + two-phase PTB), new
`getEquipTargetsForItem` in `equipment-picker.ts`, new
`TwoHandedConflictModal` mounted in `game-screen.tsx`, off-hand
`SlotTile` lock in `character-profile.tsx`, abort-map plumbed through
catch blocks in `useEquipmentActions` AND all three wager paths in
`matchmaking-queue.tsx`. New `slotType` field on the frontend `Item`
type + every chain hydrator (`fetchOwnedItems`, `fetchKioskItems`).

**Live-verified set — every v5.1 chain rule now ✅.** The 2026-05-28
handoff listed two-handed weapon blocking as the last unproven rule.
That box is now ticked: both `EOffhandOccupied (6)` and
`EWeaponIsTwoHanded (7)` paths fire as designed; the frontend
intercepts before the abort in 99% of cases via the layered picker +
slot-lock + classifier + auto-reconcile; the abort humanizer covers
the remaining 1%. Plus: Market/Kiosk 12-point gauntlet PASSED (live,
chain-verified); `allocate_points` confirmed fixed across both signing
paths; mutual-KO `settle_tie` chain-verified end-to-end.

---

## What's LIVE in v5.1 testnet (verified in browser this session)

### Two-wallet, dual-signing-path QA — Mr_Boss (Slush) + Sx (zkLogin)

| Path | Wallet | Live state |
|---|---|---|
| Slush (native Sui wallet) | Mr_Boss `0x06d6cb67…9624` | v5.1 character, Tank build, Lv2 (allocated STR 9 / END 8) |
| zkLogin (Google) | Sx `0x03c33df0…985f` | v5.1 character, full Lv1 Ponke loadout, Lv2 (allocated INT 11) |

The zkLogin path has now carried mint + buy + equip + create_wager +
accept_wager + allocate_points end-to-end, gaslessly, without a wallet
popup. This is the first session where the two signing paths were
hammered side-by-side against the v5.1 chain.

### Flagship paths live-verified ✅

| Path | Status |
|---|---|
| zkLogin gasless buy + equip walk (13 Lv1 items, 2 PTBs) | ✅ |
| Real-time wager-lobby sync across tabs | ✅ |
| Full wager cycle (create → accept → fight → `settle_wager` payout) — Slush + zkLogin | ✅ |
| Gear actually changes combat outcomes (shield blocks, equipped stats propagate) | ✅ |
| `allocate_points` (v4-killer — `MoveAbort 2` regression) on Slush + zkLogin | ✅ |
| Mutual-KO `settle_tie` end-to-end chain (event + escrow + refund + draws counter) | ✅ |
| 13-slot scout modal (after today's fix) | ✅ |
| Arena wager-card scout (new) | ✅ |
| Draw modal + refund line (after today's fix) | ✅ |

### Mutual-KO end-to-end — the flagship trial

A live geared 0.1 SUI wager (Mr_Boss vs Sx) ended on a simultaneous KO
turn 13.

- `combat.ts::checkFightEnd` correctly returned `draw: true`.
- `settle_tie` dispatched via TREASURY AdminCap; first attempt hit a
  transient gas-coin version conflict (parallel
  `update_after_fight_draw`), retry attempt 2 succeeded.
- `arena::WagerTied { match_id, player_a, player_b, refund_each: 100000000 }` emitted.
- WagerMatch `0x19a4b6c4…4585d` chain-read: `escrow: 0`, `status: 2`.
- Balance changes: Mr_Boss +0.1 SUI, Sx +0.1 SUI, TREASURY −~0.000887 SUI gas.
- `draws: u32` ticked on both Characters.

| Tx | Digest |
|---|---|
| `settle_tie` | `3GcBVimynSDa35vnZmZifwmTeYyu5qhNPRWcaEMrbVzp` |
| `update_after_fight_draw` (A) | `6r8SvRB6M73ZKqFjH5Npu2Rd55cVdjHYXvAfLSBTdsoS` |
| `update_after_fight_draw` (B) | `4Mjoe3pD7Ya2VZb7VbDzcix2Tr1ZHHeb5oaQ49zeTDxD` |

---

## Today's fixes (uncommitted in working tree)

### (1) Scout-modal stats + 13 slots — `wire-sanitize.ts` extraction

`data/player-profile.ts::cloneEquipment` was a v5.0 10-slot map that
also shallow-cloned items, leaving server-shape `statBonuses` keys
(`strength / hp / damage / critBonus / armor`) on the wire. The
frontend's `computeDerivedStats` and the modal's `eqBonusSum` both
read frontend-shape keys (`strengthBonus / hpBonus / attackBonus /
critChanceBonus / armorBonus`) → all bonuses coerced to `0`. Plus
`ring3 / pants / bracelets` dropped from the wire entirely.

The correct wire-shape translator already existed in
`ws/handler.ts::sanitizeItem` (used for `character_state`). The
scout-modal path was a parallel-but-broken copy. Extract:

- New `server/src/utils/wire-sanitize.ts` — single source of truth.
  Explicit 13-slot v5.1 list so missing slots ship as `null` (empty
  placeholder render). Avoids the cycle
  `handler → tavern-handlers → player-profile → handler`.
- `server/src/data/player-profile.ts` — `cloneEquipment` deleted;
  `characterToProfileWire` now calls `sanitizeEquipment`.
- `server/src/ws/handler.ts` — inline definitions removed; imports
  from the new util.

This also closes the v5.2-backlog "StatBonuses shape unification"
**at the wire boundary** for the scout-modal path. The internal
server-shape data structure is still server-shape (combat resolver,
DB persistence) — only the wire crossing converts. Full server-side
unification remains v5.2 backlog.

### (2) Arena wager-card scouting (new feature)

`frontend/src/components/fight/matchmaking-queue.tsx::WagerLobbyCard`
is now `role="button"` + Enter/Space keyboard. Clicking the card
fires `OPEN_PROFILE` for `entry.creatorWallet` → the Tavern scout
modal opens. Accept/Cancel buttons `stopPropagation` so they still
fire only their own actions. Own card stays non-inspectable.

This is part of the "Opponent scout system" v5.2 backlog item —
shipped early because the bug fix already had the modal-opening
plumbing in place.

### (3) Mutual-KO DRAW modal + sound

`FightResultModal` had a binary `won = fight.winner === myAddress`
and no draw branch (`winner=null` fell into the loss branch + the
wager row rendered `−0.1 SUI`). Closed:

- `fight-result-modal.tsx` — three-state
  `outcome: 'win' | 'loss' | 'draw'`. `fight.winner == null` (covers
  null + undefined) ⇒ `'draw'`. Title "Draw", big "DRAW" in
  `var(--sc-parchment)` (no colored glow), wager row
  "Refunded · X SUI returned" in bronze (never a minus sign), rating
  row neutral on draw. **Win/loss paths byte-equivalent.**
- `game-provider.tsx` — `fight_end` short-circuits `winner == null`
  to skip both audio cues.

Closes the v5.2-backlog "Frontend Draw modal + W/L/D counter" item
for the modal layer. W/L/D counter rendering across
navbar/profile/history is still a separate backlog item.

---

## What's NOT yet verified in browser

| | Reason |
|---|---|
| More weapon variety in combat math | Two-handed equip path is now closed end-to-end; broader weapon-class damage / offhand-bonus rolls in combat resolution still need a multi-class sweep |
| Lv2 Scavenger Uncommon combat math | Equip walk verified; combat math with budget≤40 stat-budget items still pending |
| Full 13-slot single-PTB `save_loadout` (all 13 dirty) | Tested with 2-PTB walks and a few slot edits; full-13-dirty single PTB still pending |
| W/L/D counter render across surfaces | ✅ closed 2026-05-29 PM — Hall of Fame ladder + character profile + scout modal all render W/L/D from the chain `draws: u32` field via the existing wire path |

---

## Test suite state

| | v5.0 baseline | 2026-05-29 EOD | Δ |
|---|---|---|---|
| Move unit tests | 35 | **71** PASS | +36 (unchanged from 2026-05-28) |
| Frontend gauntlets — two-handed | n/a | **146 / 146 PASS** across 5 gauntlets | +5 gauntlets, +146 assertions |
| Frontend gauntlets — other (pre-existing) | 2,307+ | unchanged | 0 |

The 5 new gauntlets shipped today (`qa-slot-type`,
`qa-equipment-aborts`, `qa-two-handed-loadout`,
`qa-two-handed-stage-classifier`, plus the extended `qa-equip-picker`
block [12.5]) pin every layer of the two-handed contract. Run all five
from `server/`:

```bash
cd server
for q in slot-type equipment-aborts two-handed-loadout two-handed-stage-classifier equip-picker; do
  npx tsx ../scripts/qa-$q.ts || break
done
```

Open hygiene items: draw-branch gauntlet and `sanitizeEquipment`
gauntlet still pending.

---

## Mainnet readiness scorecard

| Track | State (vs 2026-05-28) |
|---|---|
| Phase 2 — design redesign | ✅ shipped earlier |
| Phase A — Sui-latest integration | ✅ shipped (zkLogin Lv1 buy + equip + wager + allocate live today) |
| Phase 3 — v5.1 contracts | ✅ **shipped on testnet 2026-05-28** |
| Two-wallet wager live | ✅ closed 2026-05-29 AM |
| Mutual-KO `settle_tie` live | ✅ closed 2026-05-29 AM (chain-verified end-to-end) |
| Frontend draw modal | ✅ closed 2026-05-29 AM (was v5.2 backlog) |
| **Two-handed weapon block live** | ✅ **closed 2026-05-29 PM — full layered system shipped, 146/146 tests, live-verified** |
| **Market / Kiosk 12-point gauntlet (list/buy/cancel/royalty/withdraw/cross-wallet/own-listing-hidden)** | ✅ **closed 2026-05-29 — chain-verified** |
| **#1 mainnet blocker — settlement retry / journal** | ❌ DEFERRED to v5.2 |
| **#2 mainnet blocker — confirm-modal gate** | ❌ DEFERRED to v5.2 |
| **#3 mainnet blocker — `settle_wager_attested`** | ❌ DEFERRED to v5.2 |
| WS Zod validation + rate-limiter middleware | ❌ DEFERRED |
| `sui::random` for loot / fight RNG | ❌ DEFERRED to v5.2 |
| `respec_character` (5 SUI sink + 24h cooldown) | ❌ DEFERRED to v5.2 |
| Empty `catch {}` sweep | ❌ DEFERRED |
| StatBonuses shape unification (full server-internal) | ❌ DEFERRED — closed at wire boundary today |
| W/L/D counter render across surfaces | ❌ DEFERRED — modal-only closed today |
| External smart-contract audit | ⏳ engagement not started; ~2-4 weeks pre-mainnet |
| Production monitoring + alerting | ❌ NOT DONE |
| RPC failover / multi-fullnode | ❌ NOT DONE |
| Bug bounty | ❌ NOT POSTED |

v5.1 has now visibly closed ~55% of the audit's contract-layer items
once the working-tree fixes commit. The mainnet blockers (settlement
retry, confirm-modal gate, attested settlement) are unchanged — all
v5.2 server/frontend work, not contract work.

---

## Files touched on this branch (since 2026-05-28)

All committed on origin `feature/v5.1-contracts`. See
[`docs/archive/STATE_OF_PROJECT_2026-05-28.md`](docs/archive/STATE_OF_PROJECT_2026-05-28.md)
for files committed before 2026-05-29.

### 2026-05-29 AM commit `b606a97` (fix: draw modal, scout sanitizer, wager-card scouting)
```
server/src/utils/wire-sanitize.ts          — NEW (extract: sanitizeItem + sanitizeEquipment, 13-slot guaranteed)
server/src/ws/handler.ts                   — uses shared util
server/src/data/player-profile.ts          — broken cloneEquipment deleted; uses sanitizeEquipment
frontend/src/components/fight/matchmaking-queue.tsx
                                           — WagerLobbyCard clickable scout (role=button, kbd, stopPropagation)
frontend/src/components/fight/fight-result-modal.tsx
                                           — three-state outcome, DRAW branch, refund wager row
frontend/src/app/game-provider.tsx         — fight_end skips sound on winner == null
```

### 2026-05-29 PM commit `57027bd` (feat: complete two-handed weapon system)
```
contracts (unchanged — chain Item.slot_type was already shipped 2026-05-28)

server/src/types.ts                        — Item.slotType?: number
server/src/utils/sui-read.ts               — parseItemFromContent reads slot_type
server/src/data/marketplace.ts             — fetchItemNft + listingToWire carry slotType
server/src/utils/wire-sanitize.ts          — sanitizeItem carries slotType

frontend/src/types/game.ts                 — SLOT_TYPES constant + Item.slotType?: SlotType
frontend/src/lib/sui-contracts.ts          — fetchOwnedItems + fetchKioskItems read slot_type
frontend/src/lib/two-handed-weapons.ts     — REWRITTEN: slot_type-based; TWO_HANDED_NAMES deleted; classifyStageEquip helper
frontend/src/lib/equipment-aborts.ts       — NEW: EQUIPMENT_ABORT_CODES (codes 0..9 mapped)
frontend/src/lib/equipment-picker.ts       — getEquipTargetsForItem (inverse picker) added
frontend/src/lib/loadout-tx.ts             — REWRITTEN: cross-slot invariant + two-phase PTB
frontend/src/hooks/useEquipmentActions.ts  — classifyStageEquip wired; catch-block humanizer takes the map
frontend/src/hooks/useGameStore.ts         — twoHandedConflictModalOpen state + actions
frontend/src/components/character/character-profile.tsx
                                           — SlotTile.disabled prop; offhand locks when 2H equipped
frontend/src/components/character/two-handed-conflict-modal.tsx
                                           — NEW: educational center modal
frontend/src/components/items/inventory.tsx
                                           — uses getEquipTargetsForItem; SLOT_TO_ITEM_TYPE import dropped
frontend/src/components/fight/matchmaking-queue.tsx
                                           — wager catch blocks pass ARENA_ABORT_CODES to humanizer
frontend/src/components/layout/game-screen.tsx
                                           — TwoHandedConflictModal mounted next to ErrorToast / LevelUpModal

scripts/qa-slot-type.ts                    — NEW (11 assertions)
scripts/qa-equipment-aborts.ts             — NEW (19 assertions)
scripts/qa-two-handed-loadout.ts           — NEW (19 assertions)
scripts/qa-two-handed-stage-classifier.ts  — NEW (10 assertions)
scripts/qa-equip-picker.ts                 — fixtures updated to set slotType; block [12.5] added (+9 assertions)

docs/V5.1_TWO_HANDED_FLOW.md               — NEW: end-to-end flow doc
```

---

## Commit ladder on `feature/v5.1-contracts`

```
534e4f4  docs(v5.1): EOD 2026-05-29 — refresh handoffs, archive prior sessions, add docs index ← HEAD on origin (pushed 2026-05-29 EOD)
57027bd  feat(v5.1): complete two-handed weapon system (frontend) (2026-05-29 PM)
b606a97  fix(v5.1): draw modal, scout sanitizer, wager-card scouting (2026-05-29 AM)
536bb1f  docs(v5.1): patch SESSION_HANDOFF — add opponent inspector, prescriptive opener
a35a9ae  docs(v5.1): end-of-session handoff — STATE_OF_PROJECT, SESSION_HANDOFF, archive
0ab7677  fix(v5.1): live-reactive loadout stats + session-aware autoConnect
fb5cd8b  feat(v5.1-final): drop pauldrons, add ring_3; fresh republish + UX
b881d6b  fix(v5.1-13slot): render pants / bracelets / pauldrons in doll panels
a82933e  chore(v5.1-13slot): mint script + QA checklist for fresh cut-over
55583cf  feat(v5.1-13slot): add pants + bracelets + pauldrons, fresh republish
6403712  docs(v5.1): release notes + journal final + README + MAINNET_PREP (Phase 7)
2e6bb41  feat(v5.1): server wiring + mainnet hardening pass (Phase 3)
5a71e4c  deploy(v5.1-contracts): fresh publish to testnet (Phase 2)
5594f38  feat(v5.1-contracts): registries + settle_tie + slot_type + draws (Phase 1)
fe8bfe9  chore(v5.0): wager-accept finality fix + diagnostic logging + v5.1 backlog
                                                   ← branch point on `feature/phase-2-design`
```

---

## v5.2 backlog status delta

| Item | Status change today |
|---|---|
| Frontend Draw modal + W/L/D counter | ✅ **COMPLETE 2026-05-29** — modal closed AM; counter render landed PM (`draws` plumbed chain → server → wire → frontend; Hall of Fame ladder shows W/L/D; character profile + scout modal updated; win% draws-excluded convention pinned by 8 new test assertions in `qa-hall-of-fame.ts`) |
| Opponent inspector / scout system | ✅ **partial-shipped today** (Tavern modal + Arena wager-card entry point; pre-accept *preview* before signing still backlog) |
| StatBonuses shape unification | ✅ **closed at wire boundary** for the scout-modal path; full server-internal unification still backlog |
| **Wager fairness — level bracket + creator approval** | 🛠️ **spec drafted + Move contract BUILT by CLI** — [`docs/V5.2_WAGER_FAIRNESS_SPEC.md`](docs/V5.2_WAGER_FAIRNESS_SPEC.md). Contract redesign: ±1 level bracket on `request_accept_wager`, new `STATUS_PENDING_APPROVAL` with creator approve/decline + challenger self-withdraw + permissionless 5-min expiry, abort codes 12-17. **Not yet deployed — fresh `sui client publish` is tomorrow's STEP 2** (cannot patch v5.1 in place, struct shape changed) |
| Settlement retry / journal | ❌ unchanged — still #1 mainnet blocker |
| Confirm-modal gate | ❌ unchanged — still #2 mainnet blocker |
| `settle_wager_attested` | ❌ unchanged — still #3 mainnet blocker |
| `sui::random` for loot / fight RNG | ❌ unchanged |
| `respec_character` | ❌ unchanged |
| WS Zod validation + rate-limiter middleware | ❌ unchanged |
| Empty `catch {}` sweep | ❌ unchanged |
| Display V2 migration (July 31 2026) | ❌ unchanged |
| Tournament feature | ❌ unchanged — post-mainnet |
| Mobile-responsive UI | ❌ unchanged — post-mainnet |

---

## 🚦 Decision point — v5.1 → main merge timing

The v5.1 QA gauntlet is complete. Merge timing for `feature/v5.1-contracts`
→ `main` is the open question before tomorrow's v5.2 publish. Two
paths, both legitimate; pick one before STEP 2 of tomorrow:

| Path | Outline | Audit + cleanliness | Speed |
|---|---|---|---|
| **A (recommended)** — Merge v5.1 → main first | Tomorrow STEP 0: merge `feature/v5.1-contracts` into `main`. Cut a fresh `feature/v5.2-contracts` branch off `main`. Deploy v5.2 from there. | Auditor sees `main` (v5.1) vs v5.2 branch — unambiguous. Matches the [V5.2 spec dependency note](docs/V5.2_WAGER_FAIRNESS_SPEC.md#11-dependencies). | +1 step before deploy. |
| **B** — Deploy v5.2 from `feature/v5.1-contracts`, then merge v5.1+v5.2 together | Tomorrow STEP 2: deploy v5.2 from this branch. After re-test, merge both to `main` as one polished step. | Auditor sees "diff vs `feature/v5.1-contracts`" which isn't the canonical comparison; risks dragging v5.1 testnet artifacts into v5.2 audit scope. | No extra step. |

**Recommendation: A.** One extra PR is a small price for unambiguous
audit framing. Confirm tomorrow.

---

## 🐛 Known minor cosmetic issues (carry-forward, NOT v5.2-blocking)

Bundle into the polish pass before/during the public-testnet launch.

| Item | Severity | Notes |
|---|---|---|
| Stale opponent-gear display during fight | cosmetic | Fight arena shows opponent's gear from fight start; UI race can show stale icons. **Combat resolution is unaffected** — server resolves against locked stats. |
| Marketplace race-loss generic toast | cosmetic | Two buyers race for last copy → loser gets a generic abort instead of a friendly "snapped up just before you" toast. Buyer SUI safe — atomic chain refusal. Add a marketplace-specific abort-code → friendly string map (mirror `lib/equipment-aborts.ts` pattern). |

---

## 🌐 Public-testnet launch — open scope items (to decide during 2026-05-30 STEP 7)

Goal of the launch round: put it in front of real players to surface
bugs solo testing can't. Items to scope tomorrow:

| Item | Default position | Notes |
|---|---|---|
| Frontend hosting (Vercel) | should ship | `NEXT_PUBLIC_*` shape already correct. Verify clean-clone build hits testnet RPC + new v5.2 package id. |
| Backend hosting (Fly.io / Render / small VM) | should ship | Persistent process, restart-on-crash. Single instance is fine for the launch round. |
| Supabase DB provisioning | gated launch-blocker decision | Currently in-memory only. Mainnet needs it; testnet launch could ship without (state resets on restart). Probably ship WITH for realism. |
| Public-facing known-issues page | should ship | Lists current limitations (server-signed settlement until `settle_wager_attested`, etc.). |
| Feedback channel | should ship | GitHub Issues template + a Discord or X thread. |
| Structured logging sink | should ship | Currently console. A flat-file on disk is enough for the launch round (WS errors, abort codes, gRPC latency). |
| WS Zod validation + rate limiter | accept gap | Still v5.2 backlog. Testnet SUI is free; abuse impact bounded. |
| Telemetry dashboard | accept gap | Post-launch hardening. |

---

## Standing rules (do not need re-confirming)

1. **No commit, no push** without explicit user signal.
2. **No merge to `main`** until v5.1 QA fully done AND external audit clears v5.2.
3. **Fix-as-we-go, no deferrals.** This session's pattern.

---

## Reference

| Doc | Role |
|---|---|
| **`STATE_OF_PROJECT_2026-05-29.md`** | **This doc — new canonical state** |
| `STATE_OF_PROJECT_2026-05-28.md` | Yesterday's snapshot (kept as history) |
| `docs/archive/STATE_OF_PROJECT_2026-05-{04,13,14,16,17}.md` | Older snapshots |
| `SESSION_HANDOFF_2026-05-29.md` | Today's session handoff (single-page next-session opener) |
| `SESSION_HANDOFF_2026-05-28.md` | Yesterday's handoff (history) |
| `MAINNET_PREP.md` | Deploy protocol, threat model, change log |
| `docs/V5_QA_AUDIT_AND_V5.1_SCOPE_2026-05-28.md` | v5.0 audit + v5.1 scope (PRIMARY SPEC) |
| `docs/V5.1_OVERNIGHT_LOG_2026-05-28.md` | v5.1 per-phase journal |
| `docs/V5.1_RELEASE_NOTES_2026-05-28.md` | v5.1 release notes |
| `docs/V5.1_13SLOT_QA_CHECKLIST_2026-05-28.md` | Browser-QA walkthrough |
| `deployment.testnet-v5.1.json` | Machine-readable v5.1 deploy IDs |
| `CHANGELOG.md` | Day-by-day change history |
| `SUI_COMBATS_GDD.md` | Game design canonical |
| `CLAUDE.md` / `AGENTS.md` | GitNexus AI tooling integration |
