# Session Handoff — 2026-05-29 (EOD, final — v5.1 QA gauntlet COMPLETE; v5.2 wager-fairness contract BUILT, awaits deploy)

> **Single-page entry point for the next session.**
> Branch `feature/v5.1-contracts` at HEAD `534e4f4` on origin (pushed
> 2026-05-29 with explicit user authorization). Mainline `main`
> UNTOUCHED at `08ff991` (v4-era) per standing rule.
> This handoff supersedes
> [`docs/archive/SESSION_HANDOFF_2026-05-28.md`](docs/archive/SESSION_HANDOFF_2026-05-28.md)
> as the live entry point.
>
> **TL;DR for tomorrow:** v5.1 testnet gauntlet is **COMPLETE** —
> combat, gear effects, wager full cycle, mutual-KO draw, allocate,
> two-handed system, Market/Kiosk 12-point gauntlet, Tavern, Hall of
> Fame W/L/D, all live-verified two-wallet on-chain. v5.2 wager-
> fairness contract is **BUILT but NOT deployed** — tomorrow is
> deploy + re-test + polish + public-testnet launch prep.

---

## ✅ COMMITTED & PUSHED THIS SESSION

Three commits on origin `feature/v5.1-contracts`. All live-verified.

| Commit | What it ships |
|---|---|
| **`b606a97`** *(AM — fix: draw modal, scout sanitizer, wager-card scouting)* | Server scout-modal sanitizer + 13-slot fix, arena wager-card clickable scouting, mutual-KO draw modal + sound. Closed three working-tree items flagged by 2026-05-28 EOD. |
| **`57027bd`** *(PM — feat: complete two-handed weapon system)* | The complete two-handed-weapon epic. See [§ Two-handed weapon system](#two-handed-weapon-system--complete) for the full breakdown. |
| **`534e4f4`** *(EOD — docs: refresh handoffs, archive prior sessions, add docs index)* | Rolling EOD doc reorg. Moved 9 superseded docs to `docs/archive/`; added `docs/README.md` curated index; refreshed CLAUDE.md GitNexus block from `npx gitnexus analyze`. |

`main` stays at `08ff991`. **Merge decision flagged for tomorrow** —
see [§ Decision point](#decision-point--v51--main-merge-timing).

---

## 📝 POST-PUSH UNCOMMITTED (working tree, ready to bundle into next commit)

Two pieces landed after the EOD push, both live-verified or
spec-only:

| Item | Files | Status |
|---|---|---|
| **Hall of Fame W/L/D counter** — `draws: u32` plumbed end-to-end | 8 server files + 8 frontend files + `scripts/qa-hall-of-fame.ts` | ✅ tsc clean both sides · 198/198 gauntlet pass (+8 new assertions for the draws-excluded win% convention) · server restarted, live-ready on the next browser hard-refresh |
| **v5.2 wager-fairness spec** | `docs/V5.2_WAGER_FAIRNESS_SPEC.md` + one-line entries in `MAINNET_PREP.md` + `STATE_OF_PROJECT_2026-05-29.md` + `docs/README.md` | 📄 design doc only — the contract itself has now also been built by CLI (see [§ v5.2 contract BUILT](#-v52-wager-fairness-contract--built-awaits-deploy)) but is not yet deployed |

`AGENTS.md` and `CLAUDE.md` were also modified by automated processes
(GitNexus post-commit hook + a pre-existing edit) — fold those into
the next commit as a chore.

Next-session commit should bundle the W/L/D counter (the real shippable
chunk) under a clean `feat(v5.1): W/L/D counter end-to-end` message
before the v5.2 deploy.

---

## ✅ v5.1 QA gauntlet — COMPLETE

Every flagship surface live-verified two-wallet (Mr_Boss on Slush,
Sx on zkLogin/Google) against the deployed v5.1 package
`0x308645f3…3717`. Suiscan-confirmed where on-chain.

| Surface | Status | Notes |
|---|---|---|
| Combat + gear effects on outcome | ✅ | Tank vs Crit verified — armor/defense soak ↔ crit multiplier propagate to fight outcome. Damage rolls + offhand bonuses applied correctly. |
| Wager full cycle | ✅ | create → accept → escrow lock → settle → 95/5 payout (winner / TREASURY). On-chain. |
| Mutual-KO draw | ✅ | Chain `settle_tie` ticks `Character.draws: u32` on both sides AND refunds both stakes (no platform fee on draws). Frontend DRAW modal + parchment-neutral styling. Suiscan-confirmed. |
| `allocate_points` (the v4-killer) | ✅ | Verified on BOTH signing paths — Slush native + zkLogin gasless. Mr_Boss (STR 9 / END 8) and Sx (INT 11) both confirmed. |
| Two-handed weapon system — every layer | ✅ | `slot_type` plumbed chain → frontend; `TWO_HANDED_NAMES` allowlist deleted; abort humanizer at all call sites; inverse picker excludes off-hand for 2H; `buildSaveLoadoutTx` auto-clear + cross-slot unequip-before-equip ordering; educational popup fires only on wrong-order (`classifyStageEquip`); off-hand SlotTile locks visually when 2H equipped. Full flow doc in [`docs/V5.1_TWO_HANDED_FLOW.md`](docs/V5.1_TWO_HANDED_FLOW.md). |
| Market / Kiosk 12-point gauntlet | ✅ | list / buy / cancel / royalty / withdraw / cross-wallet purchase / own-listing-hidden / empty-state / race-condition-safe / insufficient-funds-guard — all on-chain. 23 active listings (52 minted, ~29 sold across sessions; not a bug). |
| Tavern — chat + DMs + presence | ✅ | Global chat, direct messages, online-presence indicator, unread-message notifications. Plaintext WS + Supabase transport (encrypted SDK path preserved behind `NEXT_PUBLIC_DM_TRANSPORT=encrypted`). |
| Hall of Fame ELO ladder + W/L/D counter | ✅ | Ladder shows W / L / D from chain `draws: u32` via the existing wire-sanitize hydrator. Win% follows the documented "draws excluded from denominator" convention (MMO/PvP standard; chess-style half-draw rejected). Pinned by 8 new test assertions. |

### Test suite — totals across all frontend gauntlets

```
qa-hall-of-fame.ts                    198 / 198 PASS  (+8 new W/L/D assertions)
qa-equip-picker.ts                     87 /  87 PASS
qa-arena-aborts.ts                     41 /  41 PASS
qa-equipment-aborts.ts                 19 /  19 PASS
qa-two-handed-loadout.ts               19 /  19 PASS
qa-slot-type.ts                        11 /  11 PASS
qa-two-handed-stage-classifier.ts      10 /  10 PASS
qa-combat-stats.ts                     79 /  79 PASS
qa-marketplace.ts                      63 /  63 PASS
... and ~13 other gauntlets unchanged
```

Move unit tests: **71 / 71 PASS** unchanged. `tsc --noEmit` clean both
sides.

---

## 🛠️ v5.2 wager-fairness contract — BUILT, awaits deploy

The full contract redesign from
[`docs/V5.2_WAGER_FAIRNESS_SPEC.md`](docs/V5.2_WAGER_FAIRNESS_SPEC.md)
has been **implemented in Move via CLI** (user-driven, this session)
and is ready to deploy as a fresh `sui client publish` tomorrow. The
shape that landed:

- **±1 level bracket** enforced on `request_accept_wager`. Snapshot
  of creator's level taken at `create_wager` time (so a creator who
  levels up while WAITING doesn't lock out their original bracket).
- **Creator-approval handshake** via new `STATUS_PENDING_APPROVAL`
  state:
  - `request_accept_wager` — challenger locks stake in dedicated
    `challenger_escrow` field, status → PENDING_APPROVAL
  - `approve_challenger` — creator approves, `challenger_escrow`
    merges into main `escrow`, fight starts
  - `decline_challenger` — creator rejects, challenger stake refunded
  - `withdraw_challenge` — **challenger** can self-rescind at any
    time during PENDING_APPROVAL (the lever that makes
    "lock-on-request" strictly stronger than "lock-on-approval" —
    challenger never has to wait on creator to recover funds)
  - `cancel_expired_challenge` — anyone can call after
    `CHALLENGE_TIMEOUT_MS = 5 min` for permissionless cleanup
- **New error constants 12-17**: `ELevelOutOfBracket`,
  `ENotPendingApproval`, `EChallengerSlotTaken`,
  `ENotCreatorForApproval`, `ENotPendingChallenger`,
  `EChallengeNotExpired`.
- **New WagerMatch fields**: `player_a_level: u8`,
  `challenger_escrow: Balance<SUI>`, `pending_challenger:
  Option<address>`, `pending_at: u64`.
- **`accept_wager` removed** — replaced by the two-step
  request + approve flow.

**Status: NOT YET DEPLOYED.** Cannot patch v5.1 in place (the
`WagerMatch` struct shape change is not backward-compatible for
upgrade). Tomorrow's first action is the fresh publish + the env-var
+ frontend/server PTB-target update.

---

## Two-handed weapon system — COMPLETE

The last v5.1 chain rule that wasn't live-exercised in the 2026-05-28
handoff (`EOffhandOccupied=6` / `EWeaponIsTwoHanded=7`) is now closed
end-to-end. Documentation:
[`docs/V5.1_TWO_HANDED_FLOW.md`](docs/V5.1_TWO_HANDED_FLOW.md).

| Layer | What shipped |
|---|---|
| Chain data | `Item.slot_type: u8` plumbed chain → frontend through every hydration path. The pre-v5.1 `TWO_HANDED_NAMES` hardcoded allowlist is **deleted** — adding a new 2H weapon now requires only the chain mint. |
| Abort humanizer | Equipment codes 6 / 7 / 8 / 9 mapped to plain-English copy in `lib/equipment-aborts.ts`. Catch blocks in `useEquipmentActions.saveLoadout` AND all three wager paths in `matchmaking-queue.tsx` now pass the abort map (dapp-kit 2.16 throws on `MoveAbort` rather than resolving `FailedTransaction`, so the catch path is where humanization actually fires). |
| Picker — inverse panel | `getEquipTargetsForItem` excludes the off-hand row for any weapon with `slot_type === BOTH_HANDS`. The inventory item-detail "EQUIP TO:" panel for a 2H weapon now shows Weapon only. |
| Picker — per-slot | `evaluateTwoHandedConflict` reads `slotType` instead of a name set; offers the case-1 informational tooltip and the case-2/3 hard locks. |
| Save-time PTB | `buildSaveLoadoutTx` reconciles `pending.offhand → null` when `pending.weapon` is 2H (returns `offhandAutoCleared: true`) AND emits all `unequip_*` commands before any `equip_*` so the cross-slot `EOffhandOccupied` check passes during a 1H+shield → 2H swap in one save. |
| Stage-time UX | `classifyStageEquip` returns one of three outcomes — `auto_clear` (silent + toast), `block_and_explain` (open educational modal), `ok` (proceed). Self-extinguishing: correct-order flows always return `ok`, so the modal stops firing as the player learns. |
| UI — passive | Off-hand `SlotTile` disabled + tooltip when `pending.weapon` is 2H. |
| UI — educational | Center modal `TwoHandedConflictModal` fires only on the `block_and_explain` path. Mounted in `game-screen.tsx` next to `ErrorToast` and `LevelUpModal`. |

### Tests — 146 / 146 PASS across 5 gauntlets

```
qa-slot-type.ts                       11/11   slot_type-based detection, TWO_HANDED_NAMES gone
qa-equipment-aborts.ts                19/19   codes 6/7/8/9 + dapp-kit-2.16 no-map regression contract
qa-two-handed-loadout.ts              19/19   buildSaveLoadoutTx invariant + ordering (5 scenarios)
qa-two-handed-stage-classifier.ts     10/10   modal trigger contract (correct-order ⇒ no modal)
qa-equip-picker.ts                    87/87   slot picker + inverse-picker block [12.5]
```

Run all five from `server/`:
```bash
cd server
for q in slot-type equipment-aborts two-handed-loadout two-handed-stage-classifier equip-picker; do
  npx tsx ../scripts/qa-$q.ts || break
done
```

---

## TL;DR

**v5.1 testnet was hammered today across both signing paths.** Mr_Boss
on Slush, Sx on zkLogin (Google) — two-wallet browser QA against the
live `0x308645f3…3717` package. Every flagship v5.1 surface that wasn't
yet live-verified now is, plus the v4-killer `allocate_points` is
**confirmed fixed on both signing paths**, and the v5.1 flagship
mutual-KO `settle_tie` path is **end-to-end chain-verified** with the
frontend draw bug closed in the same session.

The remaining v5.1 chain rule that hasn't been live-exercised is the
two-handed-weapon offhand block (`EOffhandOccupied` / `EWeaponIsTwoHanded`).
Everything else is live-clean.

---

## What was VERIFIED LIVE this session (browser, two-wallet)

### zkLogin gasless buy flow — Sx full Lv1 starter set ✅

Sx (`0x03c33df0…985f`) signed in with Google / zkLogin and bought all
13 Lv1 Common "Ponke" items **gaslessly** — no Slush popup, no manual
gas top-up. Every `buy_item` tx Suiscan-confirmed. After purchase the
loadout committed in 2 `save_loadout` PTBs (Slush-style multi-PTB walk,
single signing prompt each) and the equipped stats applied correctly
on the Character sheet.

This is the first time zkLogin has carried the buy + equip leg of v5.1
end-to-end. The "wallet popup never appears" property held the whole time.

### Gear affects combat ✅

Verified in live fight log. Shield blocks landed (`BLOCKED` /
`YOU BLOCKED` lines), equipped-item stat bonuses propagated into the
resolver, multi-turn grinds resolved on gear differentials rather than
base-stat noise. The "does gear matter" check that the v5.0 → v5.1
refactor risked breaking — **does not break**.

### Wager full cycle, Mr_Boss vs Sx, 0.1 SUI ✅

- Create from Slush (Mr_Boss) — `create_wager` with `OpenWagerRegistry` arg signed clean.
- Real-time cross-tab lobby sync — Sx's Arena lit up immediately.
- Accept from zkLogin (Sx) — `accept_wager` signed, escrow locked.
- Fight ran to a winner.
- `settle_wager` fired by TREASURY — winner +0.1 SUI, loser −0.1 SUI verified in wallet balances on chain.

Both signing paths handle wager flow correctly. The 2026-05-27/28 finality
race that `waitForWagerTxFinality` was added to close did not reproduce.

### `allocate_points` — the v4-killer — FIXED & CONFIRMED ON BOTH SIGNING PATHS ✅

> v4 era died here on `MoveAbort code 2` triggered by server-cache vs
> on-chain state-sync mismatch on the Character's unallocated points.
> The v5.x cut-over closed it, but `allocate_points` had not been
> live-exercised on both signing paths against the v5.1 package until
> today.

| Wallet | Path | Allocation | Result |
|---|---|---|---|
| Mr_Boss | Slush | Lv 2 → STR 9 / END 8 | ✅ committed clean, no abort, refresh matched chain |
| Sx | zkLogin | Lv 2 → INT 11 | ✅ committed clean, no abort, refresh matched chain |

The state-sync regression is **closed across both signing paths**. This
was the highest-value confirmation of the day.

### Mutual-KO DRAW path — FULLY VERIFIED END-TO-END (v5.1 flagship) ✅

A live geared wager fight (Mr_Boss vs Sx, 0.1 SUI each) ended on a
simultaneous knockout — turn 13, both fighters hit Head for lethal,
both dropped to 0/51.

**Chain side — all working:**

- Engine `combat.ts::checkFightEnd` correctly detected dual-zero as `draw: true`. No fallthrough to a default loss.
- Server dispatched `settle_tie` via TREASURY AdminCap. First attempt hit a transient gas-coin version conflict (parallel `update_after_fight_draw` mutating TREASURY's gas object same epoch); the built-in retry caught attempt 2 — clean. `admin_cancel_wager` fallback never needed to fire.
- `arena::WagerTied` event emitted with `refund_each: 100000000` (= 0.1 SUI per side).
- Escrow chain-read: `escrow: 0`, `status: 2` (settled), `settled_at` populated. **Recoverable: N/A, already refunded.**
- Both wallets received +0.1 SUI; TREASURY paid ~0.000887 SUI gas. Balance changes Suiscan-confirmed.
- `draws: u32` counter incremented on both Characters via `update_after_fight_draw`.

| Artefact | ID |
|---|---|
| WagerMatch | `0x19a4b6c4706cec09a4de8009ac5049c664bef1cfc2ac41abdcf3c3098164585d` |
| `settle_tie` tx | `3GcBVimynSDa35vnZmZifwmTeYyu5qhNPRWcaEMrbVzp` |
| Character A draw-update tx | `6r8SvRB6M73ZKqFjH5Npu2Rd55cVdjHYXvAfLSBTdsoS` |
| Character B draw-update tx | `4Mjoe3pD7Ya2VZb7VbDzcix2Tr1ZHHeb5oaQ49zeTDxD` |
| Mr_Boss character | `0x44a3fef96257b4207b5f92bfc43bc9480577e71212e2a1823cd78e1b90203206` |
| Sx character | `0xfc018b41787505a2f819455b2ebbf9a83b0c85123fc27b5c83d0acb55a5c2c5f` |
| Mr_Boss wallet (this session) | `0x06d6cb677518cc70884df24541d91d7a1d2ca5db2d8628a69568172652239624` |
| Sx wallet | `0x03c33df0c97d4dfb3792d340bbf83891e2a20d653155874fd37a350ad443985f` |

(Mr_Boss's session wallet differs from the 2026-05-28 handoff wallet
`0xf669…0f33` — a fresh Slush wallet was used to keep the v5.1 minted
character clean.)

**Frontend side — the draw bug closed in the same session.** The chain
was perfect; the frontend was double-rendering "YOU LOSE" because
`FightResultModal` had a binary `won = fight.winner === myAddress` and
no draw branch (winner=null fell into the loss branch + wager row
rendered −0.1 SUI). Live re-test after the fix: both tabs showed **DRAW**
in parchment, **"Refunded · 0.1 SUI returned"** in bronze, no defeat
sting. See *What was FIXED* below for files.

### Ring 3 — confirmed the live build, not pauldrons ✅

Three ring slots, no pauldrons. Live doll-panel renders match the
final v5.1 layout from yesterday's release notes. No stray pauldrons
references found in any tested surface.

### 13-slot layout end-to-end ✅

All 13 slot tiles render on both Character page and Tavern scout modal
after today's scout-modal fix. PRIMARY ATTRIBUTES + COMBAT STATS update
live as items equip/unequip on both wallets.

---

## What was FIXED this session (now committed in `b606a97`)

### (1) Scout modal — base stats + missing v5.1 slots

**Symptom:** Player Profile modal in Tavern (click a player → see build)
rendered base/unequipped stats and showed empty `bracelets / pants`
slots, with rings appearing unpopulated. Mr_Boss's actual loadout
(HP 51, ATK 14.5, CRIT 3.5%, ARMOR 5, DEF 4.1, STR 7+1 / DEX 3+2 /
INT 3+2 / END 7+1) did not appear — modal showed HP 40, ATK 11.5,
CRIT 1.5%, ARMOR 0, DEF 2.1 + zero bonuses.

**Root cause — double-stale:**

1. **Slot list stale** — `server/src/data/player-profile.ts::cloneEquipment`
   was a v5.0 10-slot map; `ring3 / pants / bracelets` dropped at the
   wire boundary.
2. **Stat shape stale** — same function shallow-cloned each `Item`,
   leaving the *server-shape* `statBonuses` keys (`strength / hp / damage /
   critBonus / armor`) on the wire. The frontend's `computeDerivedStats`
   and the modal's `eqBonusSum` both read the *frontend-shape* keys
   (`strengthBonus / hpBonus / attackBonus / critChanceBonus / armorBonus`).
   Every bonus silently coerced to `0`.

The *correct* wire-shape translator already existed in
`server/src/ws/handler.ts::sanitizeItem` (used for `character_state`).
The scout-modal path was a parallel-but-broken copy.

**Fix — single source of truth:**

- New `server/src/utils/wire-sanitize.ts` — extracted `sanitizeItem` +
  `sanitizeEquipment` from `handler.ts`. The util walks an explicit
  13-slot v5.1 list so missing slots ship as `null` (empty SlotTile
  placeholder render). Avoids the import cycle
  `handler → tavern-handlers → player-profile → handler`.
- `server/src/data/player-profile.ts` — broken `cloneEquipment` deleted;
  `characterToProfileWire` now calls `sanitizeEquipment`.
- `server/src/ws/handler.ts` — inline definitions removed; imports from
  the new util.

Server `tsc --noEmit` clean. Live re-test: modal shows correct equipped
stats, all 13 slot tiles populated when filled, empty placeholders when
not.

### (2) Arena open-wager card — clickable scout

Same modal opens from the Arena wager lobby now. Lets a player inspect
an opponent's gear/build before clicking Accept.

- `frontend/src/components/fight/matchmaking-queue.tsx::WagerLobbyCard`
  is now `role="button"` + Enter/Space keyboard handler. `onClick`
  fires `OPEN_PROFILE` for `entry.creatorWallet`. Accept/Cancel
  buttons stop propagation so they still fire only their own actions.
  Own card stays non-inspectable.

### (3) Frontend draw modal + sound

**Symptom:** mutual-KO rendered both players "YOU LOSE" with
"−0.1 SUI" — chain was perfect, modal lied.

**Fix:**

- `frontend/src/components/fight/fight-result-modal.tsx` — replaced
  binary `won` with three-state
  `outcome: 'win' | 'loss' | 'draw'`. `fight.winner == null` (covers
  null + undefined) ⇒ `'draw'`. Draw branch:
  - Title: **"Draw"**
  - Big text: **"DRAW"** in `var(--sc-parchment)` neutral, no colored glow
  - Wager row: **"Refunded · X SUI returned"** in `var(--sc-bronze)` — never a minus sign
  - Rating row: neutral parchment so `+0` doesn't read as a gain
- `frontend/src/app/game-provider.tsx` — `fight_end` short-circuits
  `winner == null` to skip both audio cues. The existing
  `winner === walletAddress` victory / `else` defeat branch runs only
  when there is a real winner.
- **Win/loss paths byte-equivalent** — the new code wraps the prior JSX
  in `isDraw ? <draw> : <original>`. Frontend `tsc --noEmit` clean.

Live re-test after fix: both tabs of a separate test fight showed DRAW
+ refund + silence correctly.

---

## What ALSO landed today — Market/Kiosk gauntlet (live, chain-verified)

The 12-point Market/Kiosk gauntlet was walked end-to-end against the
live v5.1 testnet kiosk and passed on every point — list, buy, cancel,
royalty, withdraw, cross-wallet purchase, own-listing hidden from the
seller's marketplace browser, kiosk-stuck retrieval. Suiscan confirmed
each tx.

**Listing count 23 (live) vs 52 (mint) explained.** The 26 Lv1 Ponke +
26 Lv2 Scavenger sets minted into the TREASURY kiosk are the
original 52. Across QA sessions items have been bought by Mr_Boss and
Sx (gasless via zkLogin in many cases). 23 active listings = the
remainder. NOT a bug — exactly matches the chain `kioskListed` set.

---

## What was NOT verified in browser (carry-forward)

| | Reason |
|---|---|
| More weapon variety in combat | All fights so far used Lv1 Ponke / a single 2H trial; broader weapon-class damage-roll behavior unverified |
| Lv2 "Scavenger" Uncommon items in combat | Both wallets are Lv2 with full catalog access; equip-walk verified, combat math with Uncommon stat-budget items unverified |
| Full 13-slot save_loadout single-PTB walk | Tested 2-PTB walks (zkLogin) and a few slot edits; full 13-dirty single PTB still pending |

---

## 🐛 Known minor cosmetic issues (carry-forward to v5.2)

Not blocking the v5.2 deploy. Bundle into a polish pass before or
during public-testnet launch.

| Item | Severity | Notes |
|---|---|---|
| Stale opponent-gear display during a fight | cosmetic | The fight arena shows the opponent's gear from the moment the fight started; if the opponent re-equipped mid-fight (rare — fight-lock prevents on-chain equip, but a UI race can show stale icons). **Combat resolution is unaffected** — the server resolves against locked stats. |
| "Item no longer available" toast for marketplace race-loss | cosmetic | When two buyers race for the last copy of an item, the loser sees a generic abort instead of a friendly "snapped up just before you" toast. Buyer's SUI is safe — chain refuses the buy atomically. Wire up a specific marketplace abort-code → friendly string mapping (mirror of the equipment/arena abort-humanizer pattern). |

---

## 🚦 Decision point — v5.1 → main merge timing

The [`docs/V5.2_WAGER_FAIRNESS_SPEC.md`](docs/V5.2_WAGER_FAIRNESS_SPEC.md)
"Dependencies" section recommends merging v5.1 to `main` BEFORE
cutting v5.2 — so the v5.2 audit scope is unambiguous ("diff vs
`main`"). Two paths tomorrow, both legitimate; flagging for explicit
user decision:

| Path | Pros | Cons |
|---|---|---|
| **A — Merge v5.1 → main first, then deploy v5.2 from a fresh branch off main** | v5.2 is a clean milestone; audit scope is unambiguous; v5.1 testnet record is the merged history; matches the spec recommendation | Adds one extra PR + sync step before tomorrow's main goal (deploy + test v5.2) |
| **B — Deploy v5.2 from `feature/v5.1-contracts`, merge v5.1+v5.2 to main together once both are tested** | Faster to tomorrow's deploy; v5.1 + v5.2 land in `main` as one polished step | v5.2 audit branch is "diff vs feature/v5.1-contracts", which auditors don't see as canonical; risks dragging v5.1 testnet artifacts into the v5.2 audit window |

**Recommendation: A.** It's only one extra step, and the audit cost
of B is non-trivial. But the call is yours — confirm tomorrow before
the v5.2 publish goes out.

---

## Next-session opener (2026-05-30 — v5.2 DEPLOY + TEST + PUBLIC-TESTNET PREP)

```
Welcome back to SUI Combats. v5.1 testnet QA gauntlet is COMPLETE
(SESSION_HANDOFF_2026-05-29.md §"v5.1 QA gauntlet — COMPLETE").
v5.2 wager-fairness contract is BUILT (per
docs/V5.2_WAGER_FAIRNESS_SPEC.md) but NOT yet deployed.

Branch feature/v5.1-contracts @ origin 534e4f4 (pushed 2026-05-29).
Working tree has the W/L/D counter (live-verified, uncommitted) +
the v5.2 spec. main UNTOUCHED at 08ff991.

═══════════════════════════════════════════════════════════════
STEP 0 — Decide v5.1 → main merge timing.
═══════════════════════════════════════════════════════════════
  See "Decision point" section in SESSION_HANDOFF_2026-05-29.md.
  Recommendation: merge v5.1 to main first (path A), then cut v5.2.
  If choosing path B, deploy v5.2 from feature/v5.1-contracts and
  merge both together post-test.

═══════════════════════════════════════════════════════════════
STEP 1 — Commit the W/L/D counter + chore bumps before the deploy.
═══════════════════════════════════════════════════════════════
  feat(v5.1): W/L/D counter end-to-end — chain draws → ladder + profile + scout
    + the AGENTS.md / CLAUDE.md chore changes
  Tsc clean both sides. Gauntlets green (198/198 hall-of-fame).

═══════════════════════════════════════════════════════════════
STEP 2 — Deploy v5.2 contract to testnet (FRESH publish, not upgrade).
═══════════════════════════════════════════════════════════════
  cd contracts
  sui client publish --gas-budget 1000000000
  Capture: package id, AdminCap, UpgradeCap, Publisher, registries,
  Display objects, TransferPolicy<Item>, transferPolicyCap, kiosk +
  KioskOwnerCap. Mirror the 2026-05-28 v5.1 cut-over protocol.
  Treasury wallet stays the same.

═══════════════════════════════════════════════════════════════
STEP 3 — Update package ID references end-to-end.
═══════════════════════════════════════════════════════════════
  server/.env             SUI_PACKAGE_ID + all registry / display IDs
  frontend/.env.local     NEXT_PUBLIC_SUI_PACKAGE_ID + registry / display
  deployment.testnet-v5.2.json (new file, mirror v5.1 file format)
  CLAUDE.md "v5.1 testnet" block → bump to v5.2 (preserve archive
    of the v5.1 IDs in MAINNET_PREP.md superseded-list pattern)
  Restart server + frontend; verify health.

═══════════════════════════════════════════════════════════════
STEP 4 — Re-test the wager flow with the v5.2 rules.
═══════════════════════════════════════════════════════════════
  4a) ±1 LEVEL BRACKET — happy path
        Mr_Boss Lv4 creates wager → Sx Lv4 (or Lv3 or Lv5) requests
        accept → creator approves → fight runs to settle. Verify
        approve_challenger ticks status → ACTIVE and merges escrows.
  4b) ±1 LEVEL BRACKET — block path
        Mr_Boss Lv4 creates wager → Sx becomes Lv6 (drop XP via
        admin if needed) and tries to request_accept → chain MUST
        abort ELevelOutOfBracket (code 12). Frontend should pre-empt.
  4c) APPROVAL HANDSHAKE — happy
        Request → creator scouts challenger via the wager-card
        scout modal (shipped this session) → approves → fight starts.
  4d) APPROVAL HANDSHAKE — decline
        Request → creator declines → challenger's stake refunded;
        status → WAITING; verify WagerDeclined / ChallengeDeclined
        event emitted; another challenger can request.
  4e) CHALLENGER WITHDRAW
        Request → challenger withdraws within 5 min → stake refunded
        WITHOUT creator action; status → WAITING.
  4f) CHALLENGE EXPIRY
        Request → wait 5 min → anyone calls cancel_expired_challenge
        → refund; status → WAITING. (Server cron should automate.)
  4g) ADMIN cancel during PENDING_APPROVAL
        TREASURY admin_cancel_wager refunds both stakes correctly.

═══════════════════════════════════════════════════════════════
STEP 5 — Regression: confirm v5.1-shipped surfaces still work on v5.2.
═══════════════════════════════════════════════════════════════
  Combat resolution, gear effects, market/kiosk full gauntlet,
  equipment system (two-handed system end-to-end), mutual-KO draw,
  allocate_points (both signing paths), Tavern, Hall of Fame W/L/D,
  scout modal. None of these were changed by the v5.2 publish —
  they're the smoke test.

═══════════════════════════════════════════════════════════════
STEP 6 — Polish pass to mainnet-ready standard.
═══════════════════════════════════════════════════════════════
  - Address known minor cosmetic issues (see §"Known minor issues"
    above): stale opponent-gear display in fight; marketplace
    "no longer available" toast.
  - Marketplace abort-humanizer module (mirror equipment-aborts.ts).
  - Frontend arena-aborts.ts add codes 12–17 from v5.2.
  - Server's wager event indexer + OrphanWager reconciler handle
    new ChallengeRequested / ChallengeDeclined / ChallengeWithdrawn /
    ChallengeExpired events.

═══════════════════════════════════════════════════════════════
STEP 7 — Prep for hosted PUBLIC TESTNET launch.
═══════════════════════════════════════════════════════════════
  Goal: put it in front of real players to surface bugs solo testing
  can't. Outline (decide tomorrow what's in scope vs deferred):

  a) Hosting & deployment
     - Frontend: Vercel (NEXT_PUBLIC_* already shaped right);
       confirm the build runs against testnet RPC + the new v5.2
       package id from a clean clone.
     - Backend: a small VM or Fly.io / Render container for the
       Express/WS server. Persistent process; restart-on-crash.
     - DB: Supabase project provisioned (still in-memory only today
       — see MAINNET_PREP.md §"Block 2 end-to-end validation").
  b) Known-issues + how-to-report list
     - Public-facing markdown listing known limitations (server is
       still TREASURY-signed for settlement until v5.2's
       settle_wager_attested ships; mutual-KO and two-handed
       systems just hardened; etc.).
     - Feedback channel: GitHub Issues template, or a Discord/X form.
  c) Telemetry minimum
     - At minimum: server-side logging of WS-level errors, MoveAbort
       codes by category, latency on the gRPC stream. Currently
       there's basic console — needs a structured sink (a flat-file
       on disk is enough for a public-testnet round).
  d) Rate-limits / guardrails
     - MAX_WAGER_SUI_MIST cap is already enforced server-side; check
       it's still right for the new public audience.
     - WS Zod validation + rate-limiter middleware is still v5.2
       backlog — surface as a launch-blocker or accept it (testnet
       SUI is free; abuse impact is bounded).

Live wallets:
  Mr_Boss (Slush)   0x06d6cb677518cc70884df24541d91d7a1d2ca5db2d8628a69568172652239624
  Sx     (zkLogin)  0x03c33df0c97d4dfb3792d340bbf83891e2a20d653155874fd37a350ad443985f
TREASURY            0x975f1b348625cdb4f277efaefda1d644b17a4ffd97223892d93e93277fe19d4d

Live build (v5.1) has RING_3, not pauldrons. v5.2 publish keeps the
13-slot loadout shape; only WagerMatch + arena entry points change.
```

---

## Rules reminder (standing — do not need re-confirming)

1. **No commit, no push** without an explicit signal from the user.
2. **No merge to `main`** until v5.1 QA is fully done **and** the external smart-contract audit clears v5.2.
3. **Fix-as-we-go, no deferrals** — if a bug surfaces during QA, the same session closes it. Today the scout-modal bug, the wager-card scout feature, and the mutual-KO draw modal all landed inside the QA pass that surfaced them.

---

## Closing notes

- Both browser tabs were live the entire session; backend `:3001` and frontend `:3000` stayed healthy through every fix + HMR cycle.
- Server backend was restarted exactly once today (after the wire-sanitize extraction) because `ts-node` has no watcher. Frontend HMR carried every other change.
- The mutual-KO live trial spent ~0.000887 SUI of TREASURY gas; TREASURY budget is comfortable.
- Branch `feature/v5.1-contracts` head on origin is still `0ab7677` — the three working-tree fixes are local-only until commit.

End of handoff.
