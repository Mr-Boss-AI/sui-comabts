# SUI Combats — State of the Project, 2026-05-16 (Phase 3 fight-room shipped)

> **Phase 2 visual-QA + polish track is still open.** Tonight closed
> the fight-room redesign in three iterations (v1 layout → v2 widened
> + real character doll → v3 row-paired zones + glow). Same branch.
> No contract change. No server change beyond the pre-existing DM /
> Tavern WIP files that have been parked for several sessions.
>
> The session also surfaced a wager-accept silent-fail UX bug
> (insufficient SUI for stake + gas) that is captured in the bug
> log below. Fix is queued, not shipped.
>
> **Track B (Phase 3 — v5.1 republish) is still NEXT, not started.**
>
> **No merge to `main`.** Mainline stays at the v4-era `08ff991`
> until v5.1 lands fresh-chain on its own branch and passes audit.
>
> This doc supersedes
> [`STATE_OF_PROJECT_2026-05-14.md`](./STATE_OF_PROJECT_2026-05-14.md)
> as the canonical state. 05-14 stays unmodified as the
> Phase 2 design-checkpoint snapshot.

---

## TL;DR

| Field | Value |
|---|---|
| Phase | **Phase 2 — Track A polish, fight-room redesign shipped**; Track B (Phase 3 v5.1 republish) still NEXT |
| Branch | `feature/phase-2-design` |
| Latest commit before this doc | `80a8d2f` (sync gitnexus index counts after Phase 2 checkpoint) |
| Latest commit at push | (assigned by the commit at the end of this session) |
| Pushed to | `origin/feature/phase-2-design` |
| Main | untouched (v4-era `08ff991`) |
| `feature/v5-redeploy` | untouched (remote tip `6308240`) |
| Static gauntlet | **2,235 / 2,235 PASS** across **36 suites** (+71 from new `qa-fight-arena-layout`) |
| Static gauntlet ERRs | 2 (pre-existing dotenv infra) |
| Move unit tests | **35 / 35 PASS** |
| TypeScript | `tsc --noEmit` clean — frontend ✓ server ✓ |
| Frontend HTTP probe | `curl localhost:3000` → `200` |
| Backend HTTP probe | `curl localhost:3001/health` → live (WS + marketplace gRPC active) |
| Phase 3 fight-room redesign | ✅ shipped (v1 → v2 → v3 same session) |
| Phase 3 v5.1 contract republish | 🎯 NEXT (Track B — new branch `feature/v5.1-contracts`) |
| Open bug log | Bug A (insufficient-SUI silent fail), Bug B (frontend ignores `FailedTransaction`), Bug C (battle log render — needs re-verify post-redesign) |

---

## Quick links

- [Today's Wins (2026-05-16)](#todays-wins-2026-05-16)
- [Fight-Room Redesign — Three-Pass Detail](#fight-room-redesign--three-pass-detail)
- [Today's Bug Log](#todays-bug-log)
- [Files Touched This Session](#files-touched-this-session)
- [Test Suite State](#test-suite-state)
- [Mainnet Readiness Scorecard](#mainnet-readiness-scorecard)
- [Commit Log](#commit-log)
- [What's Next](#whats-next)
- [Reference Table](#reference-table)

---

## Today's Wins (2026-05-16)

The 2026-05-14 checkpoint left Phase 2 stable but with the fight-room
still on its pre-redesign Tailwind grid. Tonight the user walked the
remaining screen — fight-room — through the same pipeline as the
Character page: design mockup → CLI port → live two-wallet QA. Three
mockup iterations were absorbed in one continuous session.

1. **Header sizing + auto-flow polish** (navbar.tsx · wordmark.tsx).
   Header padding / font / avatar / nav-tab / SUI-balance-pill sizes
   bumped ~20% across the board. Wordmark "navbar" variant 32 → 38px.
   Outer row + left cluster + nav-tabs all switched to `flex-wrap:
   wrap` with `clamp()`-based padding, gaps, and font sizes so the
   right cluster (balance + connect button) drops to a new line on
   narrow viewports instead of overlapping the wordmark. Driven by
   the user's screenshot at ~960px wide showing the v5.1 character
   badge bleeding into "Hall of Fame". No new tokens.

2. **Local hygiene — bots disabled** (no code commit). User host had
   a cron `*/5 * * * * /home/shakalis/bots/watchdog.sh` plus a
   `sxai-telegram-bot.service` systemd unit that were reviving three
   unrelated node processes (`sui-bot`, `meme-sol-bot`, `ton-bot`) —
   `meme-sol-bot` was holding port 3001 and blocking the sui-combats
   backend at boot. Cron line commented, systemd unit stopped +
   disabled, all 11 bot processes killed. Cron backup at
   `/tmp/crontab.backup`. Re-enable: uncomment crontab + `systemctl
   --user enable --now sxai-telegram-bot.service`.

3. **Phase 3 fight-room redesign — shipped in three passes** in the
   same session. See [Fight-Room Redesign — Three-Pass
   Detail](#fight-room-redesign--three-pass-detail) for the full
   per-iteration walk. Headline:

   - **v1** — Three-row CSS grid (`1fr auto 1fr` HP row · `1fr 100px
     1fr` middle row · full-width battle log). New compact list-style
     ZoneSelector variant. New `qa-fight-arena-layout` gauntlet ships
     pinning the structural shape (60 assertions).
   - **v2** — Move column widened to 200px, placeholder
     `FighterPanel`/`SlotCell`/`DollSilhouette` ripped out, real
     `MiniEquipmentFrame` reused from the Player Profile modal. Added
     `hideHpBar?: boolean` to MiniEquipmentFrame (single non-invasive
     flag, no fork). Buttons restyled with the game-theme chunky
     chrome (`var(--r-sharp)` corners, `var(--sh-plate-sm)` plate
     shadow, `var(--ls-button)` letter-spacing, full ZONE_LABELS).
     Lock-in button matches the Arena fight-type CTAs (bronze fill on
     page-black text). Pin count → 57 (some v1 abbreviations removed
     from the gauntlet alongside their source).
   - **v3** — Move column widened again to 240px. Replaced the
     stacked "ATK column above BLK column" layout with a single
     row-paired grid: each body zone is one grid row of `ATK button ·
     bronze zone label · BLK button`, so the two buttons for the same
     body part are always horizontally aligned around the zone name.
     Compact icon-only buttons using inline Tabler-style outline SVGs
     (sword / shield / check). Selected state adds an oriented glow
     (`rgba(226,75,74,0.6)` red for ATK, `rgba(55,138,221,0.6)` blue
     for BLK) plus a 1.4s ease-in-out pulse keyframe (`zs-pulse-red`,
     `zs-pulse-blue`) and a corner ✓ badge. Pin count → 71.

   Block-pair / shield-line / dual-wield / shield-mode click logic
   untouched across all three passes. WS message surface
   (`fight_action { attackZones, blockZones }`) untouched. HP fill
   thresholds, opponent-disconnect banner, fight-result modal,
   fight-outcome-ack write — all pass-through.

### Pre-push verification (gates green)

| Gate | Result |
|---|---|
| Secrets scan (`origin/feature/phase-2-design..HEAD` diff + filenames) | **clean** — no private keys / `.env` / `.pem` / keystore content |
| Branch | `feature/phase-2-design` ✓ |
| Static gauntlet | **2,235 / 2,235 PASS** · 36 suites · 2 pre-existing dotenv infra ERRs (accepted) |
| `qa-fight-arena-layout` (NEW) | **71 / 71 PASS** |
| `qa-fight-pause` (no-regression) | **46 / 46 PASS** |
| `qa-layout-primitives` (no-regression) | **155 / 155 PASS** |
| `qa-mini-equipment-frame` (no-regression after `hideHpBar`) | **50 / 50 PASS** |
| Move unit tests | **35 / 35 PASS** |
| `tsc --noEmit` — frontend | exit 0 ✓ |
| Frontend dev server | hot-reloaded clean across all three passes |
| Main untouched (`08ff991`) | ✓ |
| `feature/v5-redeploy` untouched (`6308240`) | ✓ |

---

## Fight-Room Redesign — Three-Pass Detail

### v1 — Layout pass

**Goal:** match the user-supplied reference mockup
(`~/Downloads/fight_room_layout_v5_tall_dolls.html`). Three-row grid,
small move column between two doll panels, full-width battle log.

**Touched files:**

- `frontend/src/components/fight/fight-arena.tsx` (full rewrite)
- `frontend/src/components/fight/zone-selector.tsx`
  (added `variant: "body" | "list"`, exported `BLOCK_PAIRS` /
  `SHIELD_LINES`, added `ZONE_LABEL_SHORT`)
- `scripts/qa-fight-arena-layout.ts` (NEW — 60 assertions)

**Why the new file:** the existing SVG body-silhouette ZoneSelector
doesn't fit a 100-px-wide column. Variant flag keeps the body version
intact for any future caller (none currently) while letting the
fight-room mount the list version. Block-pair semantics stay inside
ZoneSelector; the parent just hands in `onAttackToggle` /
`onBlockPairSelect`.

### v2 — Polish pass

**Goal:** widen the move column, use the real character doll from the
Character page (not the placeholder slot-strip from v1), restyle
buttons in game chrome.

**Touched files:**

- `frontend/src/components/fight/fight-arena.tsx` (placeholder
  components deleted; `MiniEquipmentFrame` swapped in; local player's
  NFT portrait resolved from `readPortrait(window.localStorage,
  myAddress)`)
- `frontend/src/components/fight/zone-selector.tsx` (list-variant
  restyled — full ZONE_LABELS uppercased, chunky bronze border,
  `var(--r-sharp)` corners, `var(--sh-plate-sm)` plate shadow,
  hover-translate + press-translate transforms)
- `frontend/src/components/social/mini-equipment-frame.tsx` (added
  `hideHpBar?: boolean` prop — single conditional render guard, no
  fork)
- `scripts/qa-fight-arena-layout.ts` (pin count 60 → 57; v1
  abbreviations removed from the gauntlet alongside their source)

**Refactor not fork:** MiniEquipmentFrame already existed as the
read-only doll for the Player Profile modal. Adding `hideHpBar`
let the fight-room reuse it without duplicating the 10-slot doll
geometry. The opponent's portrait stays in the read-only empty state
because their cosmetic portrait is localStorage-only (per Phase 2
checkpoint — v5.1 will surface `portrait_nft_id: Option<address>` on
the `Character` Move struct and close this gap).

### v3 — Row-paired zones + glow

**Goal:** zones laid out horizontally so each body part shows ATK
and BLK buttons in one row around a bronze label. Selected state gets
a visible glow + pulse.

**Touched files:**

- `frontend/src/components/fight/zone-selector.tsx` (list variant
  restructured — single grid `1fr auto 1fr` × `auto repeat(5, auto)`,
  new `ZoneActionButton` per-cell component, new `IconSword` /
  `IconShield` / `IconCheck` inline outline SVGs, new `PULSE_CSS`
  keyframes `zs-pulse-red` / `zs-pulse-blue`)
- `frontend/src/components/fight/fight-arena.tsx` (middle grid
  `1fr 200px 1fr` → `1fr 240px 1fr`)
- `scripts/qa-fight-arena-layout.ts` (pin count 57 → 71 — grid
  templates, kinds, icon components, glow rgbas, pulse keyframes)

**Icons:** the spec called for Tabler outline icons "already loaded".
No Tabler / Lucide / similar package is actually in the
`frontend/package.json`. Three small inline SVGs were authored in
the Tabler stroke-2 line style instead — no npm dependency change.

**Glow tokens:** the user spec gave explicit RGB values
(`226, 75, 74` red and `55, 138, 221` blue) which are brighter than
the matte `--sc-blood` (#b53d2c) and `--sc-steel` (#6d8fa3) base
chrome. There is no `--sc-blood-hot` / `--sc-steel-hot` token in
`design-tokens-v2.css` — only `--sc-victory` (#5a8a3a) and
`--sc-blood-deep`/`--sc-steel-deep` (darker, not brighter). The
explicit glow rgbas were honoured rather than dimmed to fit the matte
palette.

---

## Today's Bug Log

### Bug A — Insufficient-SUI silent fail on `accept_wager`

**Symptom:** acceptor (Mr_Boss_v5.1 with 0.501 SUI on chain) clicks
ACCEPT on a 0.5 SUI wager. Wallet popup appears, user signs. Toast
appears: *"Wager not active on-chain (status: 0). Did the
accept_wager transaction succeed?"* No fight starts. Wager creator
(Sx_v5.1) sees their wager still open with a Cancel button.

**Root cause:** the chain `accept_wager` transaction fails because
the acceptor doesn't have headroom for the stake (0.5 SUI in escrow)
+ gas (~0.005-0.01 SUI). The `WagerMatch.status` on chain stays at
0 (WAITING). Server's WS `wager_accepted` handler probes chain via
`getWagerStatus`, sees status 0, and emits the correct rejection
through `decideAcceptOutcome` →
`server/src/ws/wager-accept-gate.ts:148`. The toast wording reflects
chain truth but doesn't tell the user what actually went wrong.

**Filed but not fixed.** Spec exists for a clearer pre-flight check:
fail the click on the frontend with "Insufficient SUI — need ~0.55
SUI for a 0.5 SUI wager + gas" before signing. Captured in user
memory for the next session.

### Bug B — Frontend doesn't branch on `FailedTransaction`

**Symptom:** see Bug A. The wallet tx visibly fails on chain, but the
frontend still sends `wager_accepted` over the WS so the server
explores Bug A's reject path instead of a clearer client-side message.

**Root cause:**
`frontend/src/components/fight/matchmaking-queue.tsx:398-407` —

```ts
const result = await signer.signAndExecuteTransaction({ transaction: tx });
const resultAny = result as any;
const txData = resultAny.Transaction || resultAny.FailedTransaction || resultAny;
const digest = txData.digest || txData.effects?.transactionDigest;
state.socket.send({ type: "wager_accepted", wagerMatchId: ..., txDigest: digest });
```

The Sui SDK signer returns either a `Transaction` (success) or a
`FailedTransaction` wrapper. The current code grabs the digest from
either branch and proceeds. A two-branch fix (throw on
`FailedTransaction`, surface the SDK error) is the right repair.

**Filed but not fixed.** Same memory entry as Bug A.

### Bug C — Battle log render asymmetry (suspected, needs re-verify)

**Symptom (pre-redesign):** battle log lines occasionally appeared on
one tab and not the other during two-wallet live fight tests.

**Status:** **untested against the Phase 3 fight-room redesign.** The
DamageLog component itself was a pass-through — `fight.log` is still
fed in unchanged, just rendered inside the new full-width bottom row
of the arena grid. The asymmetry, if it exists, is in the WS
broadcast of `fight_state` updates from `server/src/ws/fight-room.ts`,
not the renderer. Re-verify next two-wallet fight test:

```
1. Sign in two wallets in two browser tabs.
2. Start a fight (any mode).
3. Submit at least 3 actions per side.
4. Compare DamageLog content between tabs at the end of turn 3.
5. If asymmetric, capture both tabs' console + server log around
   the divergent turn.
```

No code action this session.

---

## Files Touched This Session

The commit at the end of this session is the **Phase 2 wrap commit**.
It bundles three categories of work — today's fight-room redesign,
the header polish, and the larger set of dangling Tavern / DM /
server-fight-room / wallet-provider WIPs that have been parked for
several sessions and that the user asked to roll into this single
commit.

### Today's fight-room redesign

```
frontend/src/components/fight/fight-arena.tsx                  M (full rewrite)
frontend/src/components/fight/zone-selector.tsx                M (variant=list + v3 row-paired grid)
frontend/src/components/social/mini-equipment-frame.tsx        M (hideHpBar)
scripts/qa-fight-arena-layout.ts                               NEW (71 assertions)
```

### Today's header polish

```
frontend/src/components/layout/navbar.tsx                      M (+20% sized · clamp() scaling · flex-wrap)
frontend/src/components/v2/wordmark.tsx                        M (navbar variant 32 → 38)
```

### Parked WIPs being landed alongside (pre-existing, multi-session)

```
CHANGELOG.md                                                   M (Phase 3 fight-room entry appended)
TAVERN_DESIGN.md                                               NEW
Gemini.md                                                      NEW
frontend/package.json                                          M
frontend/package-lock.json                                     M
frontend/tsconfig.json                                         M
frontend/src/app/game-provider.tsx                             M
frontend/src/config/dapp-kit.ts                                M
frontend/src/hooks/useGameStore.ts                             M
frontend/src/types/ws-messages.ts                              M
frontend/src/lib/dm-plaintext-pipeline.ts                      NEW
frontend/src/lib/dm-send-pipeline.ts                           NEW
frontend/src/lib/messaging.ts                                  NEW
frontend/src/lib/player-bucket.ts                              NEW
server/setup-db.mjs                                            M
server/src/index.ts                                            M
server/src/ws/fight-room.ts                                    M
server/src/ws/handler.ts                                       M
server/src/ws/tavern-handlers.ts                               NEW
server/src/data/dm-channels.ts                                 NEW
server/src/data/dm-messages.ts                                 NEW
server/src/data/fight-requests.ts                              NEW
server/src/data/player-profile.ts                              NEW
server/src/data/presence.ts                                    NEW
server/src/data/migrations/003_tavern.sql                      NEW
server/src/data/migrations/004_dm_messages.sql                 NEW
scripts/qa-dm-messages.ts                                      NEW
scripts/qa-dm-plaintext-pipeline.ts                            NEW
scripts/qa-dm-send-pipeline.ts                                 NEW
scripts/qa-messaging-client.ts                                 NEW
scripts/qa-tavern-dm-channels.ts                               NEW
scripts/qa-tavern-fight-requests.ts                            NEW
scripts/qa-tavern-handlers.ts                                  NEW
scripts/qa-tavern-presence.ts                                  NEW
scripts/qa-tavern-sidebar.ts                                   NEW
design_v2/character_layout_reference.jpeg                      D (moved into screenshopts/)
design_v2/screenshopts/character_layout_reference.jpeg         NEW (moved)
design_v2/screenshopts/sx_v51_current_state.png                NEW
design_v2/screenshopts/Screenshot from 2026-05-13 14-00-53.png NEW
design_v2/screenshopts/Screenshot from 2026-05-13 14-00-58.png NEW
design_v2/screenshopts/Screenshot from 2026-05-13 14-01-04.png NEW
design_v2/screenshopts/Screenshot from 2026-05-13 14-01-11.png NEW
design_v2/screenshopts/Screenshot from 2026-05-13 14-01-17.png NEW
```

### Doc files added/edited tonight

```
STATE_OF_PROJECT_2026-05-16.md                                 NEW (this file)
SESSION_HANDOFF.md                                             M (overwritten with 2026-05-16 session)
STATUS.md                                                      M (pointer updated to this snapshot)
AGENTS.md                                                      M (gitnexus counts refreshed via post-commit hook)
CLAUDE.md                                                      M (gitnexus counts refreshed via post-commit hook)
```

---

## Test Suite State

**Total: 2,235 / 2,235 PASS across 36 suites.** (+71 from the new
`qa-fight-arena-layout`.) Plus the 2 pre-existing dotenv infra ERRs
(`qa-chain-gauntlet`, `qa-mint-catalog`).

Delta from 2026-05-14:

| Suite | 05-14 → 05-16 | Note |
|---|---|---|
| `qa-fight-arena-layout` | — → **71** | NEW — Phase 3 fight-room redesign pin |
| `qa-fight-pause` | 46 → 46 | unchanged, regression guard |
| `qa-layout-primitives` | 155 → 155 | unchanged |
| `qa-mini-equipment-frame` | 50 → 50 | unchanged (hideHpBar didn't regress) |
| **TOTAL** | **2,164 → 2,235** | +71 |

All 35 other suites unchanged.

Move unit tests: `cd contracts && sui move test` → **35 / 35 PASS**.

---

## Mainnet Readiness Scorecard

| Track | Status | Blocker |
|---|---|---|
| Phase 2 — design redesign | ✅ all top-level screens shipped (landing · character · arena · marketplace · tavern · hall of fame · fight room) | none — polish iterations continue |
| Phase 3 — v5.1 contract republish | 🎯 next | needs dedicated branch `feature/v5.1-contracts` |
| Two-wallet live verification — fight room | ⏳ done for Phase 2 layout, **partial** for Phase 3 redesign | re-verify Bug C (battle log asymmetry) after redesign |
| Two-wallet live verification — wager flow | ⚠️ Bug A surfaced tonight | needs Bug A + Bug B fix |
| Test coverage | ✅ 2,235 static + 35 Move | none |
| Documentation | ✅ STATE_OF_PROJECT cadence current | none |
| Audit | queued | post v5.1 stability |
| Mainnet candidate | not started | every row above must clear |

---

## Commit Log

Newest-first, scoped to commits since [STATE_OF_PROJECT_2026-05-14.md](./STATE_OF_PROJECT_2026-05-14.md)
at `80a8d2f`:

```
(this session)  feat(phase-2): wrap — DM pipeline, tavern, fight-room redesign, header polish
80a8d2f        docs: sync gitnexus index counts after Phase 2 checkpoint
92bf075        docs: design pipeline workflow + status pointer update
1e9941c        docs(phase-2): Phase 2 design checkpoint — STATE_OF_PROJECT 2026-05-14
```

Full branch history (37 commits since `feature/v5-redeploy` tip)
is in `git log`.

---

## What's Next

### Track A — Visual QA + polish (this branch)

1. **Fix Bug A + Bug B** — pre-flight balance check on the frontend
   wager-accept path; branch on `FailedTransaction` in
   `handleAcceptWager`.
2. **Re-verify Bug C** — two-wallet live fight, check battle log
   symmetry after Phase 3 redesign.
3. **Visual QA walk** of every screen at 1440 px / 1280 px / mobile.
4. **Iterate any remaining deviations** via the locked pipeline
   (`design_v2/PIPELINE.md`).

### Track B — Phase 3: v5.1 contract republish (new branch)

Unchanged from the 05-14 plan. Spec lives at
[STATE_OF_PROJECT_2026-05-04.md](./STATE_OF_PROJECT_2026-05-04.md)
§v5.1. Branch `feature/v5.1-contracts` to be opened when the user
is ready.

---

## Reference Table

| Doc | Role |
|---|---|
| **`STATE_OF_PROJECT_2026-05-16.md`** | **NEW canonical state — this file** |
| `STATE_OF_PROJECT_2026-05-14.md` | Historical: Phase 2 design-checkpoint snapshot |
| `STATE_OF_PROJECT_2026-05-13.md` | Historical: v5 functional close-out snapshot |
| `STATE_OF_PROJECT_2026-05-04.md` | Historical: end-of-Bucket-2 snapshot |
| `SESSION_HANDOFF.md` | Single-page summary of the latest session (now 2026-05-16) |
| `STATUS.md` | One-line pointer to current canonical state |
| `CHANGELOG.md` | Day-by-day change history (Phase 3 fight-room entry appended tonight) |
| `CLAUDE.md` | Repo-rooted instructions for Claude Code (GitNexus directives, index counts refreshed post-commit) |
| `AGENTS.md` | Subagent / harness instructions (same gitnexus block) |
| `design_v2/PIPELINE.md` | 5-phase design → code pipeline reference |
| `design_v2/specs/character_v2_measurements.md` | 73-element Character page spec (overall page) |
| `design_v2/specs/character_equipment_frame_extracted.md` | Equipment-frame architecture spec (canonical for both EquipmentFrame and MiniEquipmentFrame, including the new fight-room reuse) |
| `scripts/qa-fight-arena-layout.ts` | NEW — 71-assertion structural pin for the Phase 3 fight-room layout |
