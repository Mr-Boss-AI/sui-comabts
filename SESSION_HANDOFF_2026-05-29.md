# Session Handoff — 2026-05-29 (EOD)

> **Single-page entry point for the next session.**
> Branch `feature/v5.1-contracts` — same head on origin as last session
> (`0ab7677`) **plus three working, locally-uncommitted fixes**. See the
> bright red callout below before doing anything else.
> Mainline `main` UNTOUCHED at `08ff991` (v4-era) per standing rule.
> This handoff supersedes [`SESSION_HANDOFF_2026-05-28.md`](SESSION_HANDOFF_2026-05-28.md) as the live entry point.

---

## 🚨 UNCOMMITTED — START NEXT SESSION HERE

Three fixes landed in the working tree today, were live-verified in
browser by the user, and are **NOT yet committed**. They are the first
action of the next session — commit them to `feature/v5.1-contracts`
(no merge to `main`).

| Fix | Files |
|---|---|
| (1) Scout-modal equipped stats + 13 slots | `server/src/utils/wire-sanitize.ts` (new), `server/src/ws/handler.ts`, `server/src/data/player-profile.ts` |
| (2) Arena wager-card scouting (clickable) | `frontend/src/components/fight/matchmaking-queue.tsx` |
| (3) Mutual-KO draw modal + sound | `frontend/src/components/fight/fight-result-modal.tsx`, `frontend/src/app/game-provider.tsx` |

Server `tsc --noEmit` clean. Frontend `tsc --noEmit` clean. Backend +
frontend re-tested live after each fix. Details: see *What was FIXED
this session* below.

**Rule reminder (re-state to self before acting):** no commit, no push,
no merge to `main` without explicit signal from the user. Fix-as-we-go,
no deferrals.

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

## What was FIXED this session (uncommitted)

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

## What was NOT verified in browser (carry-forward)

| | Reason |
|---|---|
| Two-handed weapon blocking | Hadn't equipped a two-handed weapon yet; Lv2 Scavenger Uncommon catalog has candidates (`Nail Plank` slot_type=2). Chain enforces `EOffhandOccupied (6)` / `EWeaponIsTwoHanded (7)` — the last v5.1 chain rule not yet live-exercised |
| More weapon variety in combat | All fights this session used the Lv1 Ponke starter set; broader weapon class behaviour (range, two-handed, etc.) unverified |
| Lv2 "Scavenger" Uncommon items | Now that both wallets are Lv2 these are equippable — level-gate flip + Uncommon rarity stat-budget rendering both pending |
| Full 13-slot save_loadout single-PTB walk | Tested 2-PTB walks (zkLogin) and a few slot edits; full 13-dirty single PTB still pending |

---

## Next-session opener

```
Welcome back to SUI Combats. v5.1 testnet still live, branch
feature/v5.1-contracts. THREE FIXES from 2026-05-29 are in the working
tree and NOT yet committed — commit them first to feature/v5.1-contracts
(no merge to main):

  (a) server/src/utils/wire-sanitize.ts (new)
      server/src/ws/handler.ts (uses shared util)
      server/src/data/player-profile.ts (uses shared util)
      → scout-modal stat + 13-slot fix

  (b) frontend/src/components/fight/matchmaking-queue.tsx
      → Arena wager-card clickable scout

  (c) frontend/src/components/fight/fight-result-modal.tsx
      frontend/src/app/game-provider.tsx
      → mutual-KO draw modal + sound

Server tsc and frontend tsc are both clean. All three were live-
verified in browser. After committing, bring runtime up (npm run dev in
server/ and frontend/) and run STEP 1-3:

STEP 1 — Two-handed weapon blocking (the last untested v5.1 chain rule)
    Equip Nail Plank (slot_type=2) — chain MUST abort with
    EOffhandOccupied (6) if offhand is already populated. Then equip
    a one-handed weapon + shield, then try Nail Plank — must abort
    EWeaponIsTwoHanded (7). This exercises the slot_type contract layer
    in production.

STEP 2 — Combat with more weapon variety
    Re-run a friendly/wager fight with each available weapon class
    (1H + shield, dual-wield, 2H). Confirm damage rolls + offhand
    bonuses propagate. Catch any resolver edge cases.

STEP 3 — Lv2 Scavenger Uncommon equip walk
    Both Mr_Boss and Sx are now Lv2. Equip one of each Uncommon item
    type. Confirm:
      - Level-gate flips correctly (was blocking at Lv1 last session)
      - Rarity stat-budget bars render the Uncommon tier (budget ≤40)
      - 13-slot doll panel still consistent

Live wallets:
  Mr_Boss (Slush)   0x06d6cb677518cc70884df24541d91d7a1d2ca5db2d8628a69568172652239624
  Sx     (zkLogin)  0x03c33df0c97d4dfb3792d340bbf83891e2a20d653155874fd37a350ad443985f
TREASURY            0x975f1b348625cdb4f277efaefda1d644b17a4ffd97223892d93e93277fe19d4d

Live build has RING_3, not pauldrons. Don't merge to main.
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
