# SUI Combats — State of the Project, 2026-05-14 (Phase 2 design checkpoint)

> **Phase 2 UI redesign is at a stable, testable checkpoint.** Pushing
> `feature/phase-2-design` to GitHub today as a clean rollback point
> before the user begins the full visual-QA walk, and before Phase 3
> (v5.1 Move contract republish) begins on its own branch.
>
> **Next phase = Phase 3 — v5.1 republish.** Phase 2 stays open for
> visual polish iterations on this same branch. Phase 3 opens on
> `feature/v5.1-contracts` next session.
>
> **No merge to `main`.** Mainline stays at the v4-era `08ff991`
> until v5.1 lands fresh-chain on its own branch and passes audit.
>
> This doc supersedes
> [`STATE_OF_PROJECT_2026-05-13.md`](./STATE_OF_PROJECT_2026-05-13.md)
> as the canonical state. May-13 stays unmodified as the v5
> functional close-out historical snapshot.

---

## TL;DR

| Field | Value |
|---|---|
| Phase | **Phase 2 design CHECKPOINT**; Track B opens — Phase 3 v5.1 republish |
| Branch | `feature/phase-2-design` |
| Latest commit before this doc | `0590a97` (Player Profile mini Character page) |
| Latest commit at push | (assigned by Step 7 commit sequence below) |
| Pushed to | `origin/feature/phase-2-design` (GitHub) — first push of this branch |
| Main | untouched (v4-era `08ff991`) |
| `feature/v5-redeploy` | untouched (remote tip `6308240`) |
| Static gauntlet | **2,164 / 2,164 PASS** across **35 suites** |
| Static gauntlet ERRs | 2 (pre-existing dotenv infra: `qa-chain-gauntlet`, `qa-mint-catalog`) |
| Move unit tests | **35 / 35 PASS** |
| TypeScript | `tsc --noEmit` clean — frontend ✓ server ✓ |
| Frontend HTTP probe | `curl localhost:3000` → `200` |
| Commits on branch since `feature/v5-redeploy` tip | **36** |
| Commits on branch since `08ff991` (v4-era main) | **98** |
| Files changed since `feature/v5-redeploy` | **138** (+19,230 / −1,324) |
| Phase 2 design redesign | ✅ checkpoint pushed — polish iterations on-going |
| Phase 3 v5.1 contract republish | 🎯 NEXT (Track B — new branch `feature/v5.1-contracts`) |
| Pipeline workflow | ✅ locked + documented in `design_v2/PIPELINE.md` |

---

## Quick links

- [Today's Wins (2026-05-14)](#todays-wins-2026-05-14)
- [Pipeline Workflow](#pipeline-workflow)
- [Branch State](#branch-state)
- [What's Next — Two Parallel Tracks](#whats-next--two-parallel-tracks)
- [Bucket Status Matrix](#bucket-status-matrix)
- [Test Suite State](#test-suite-state)
- [Files Modified This Session](#files-modified-this-session)
- [Commit Log](#commit-log)
- [Reference Table](#reference-table)

---

## Today's Wins (2026-05-14)

The 2026-05-13 close-out parked Phase 2 mid-sweep with Wordmark +
Landing + Character-page-proportions shipped. Today's work closed the
Character page on pixel-extracted measurements, polished Inventory,
and rebuilt the Player Profile modal:

1. **Character — NFT portrait 3:4 + edge-to-edge slot fit + row
   alignment** (`5457a4d`, 00:44). Last work item from the 05-13
   late-night session — portrait switches from square to vertical
   3:4 (462 × 616 canonical), equipped item images fill their tile
   edge-to-edge, side columns share a single 5×BIG-tall row template
   so left + right line up row-by-row.

2. **Character page — 73-element spec match from Claude Design**
   (`d22892e`). Authored an inspection report at
   `design_v2/specs/character_v2_measurements.md` (73 elements across
   6 sections), then ported the Character/Loadout page top-to-bottom
   to match — every colour, every font size, every padding. New
   tokens added: `--sc-grape #8a6abf` (INT/CRIT), `--sc-victory
   #5a8a3a` (WIN), `--sc-parchment-dim #c8c1b0` (secondary text),
   `--sc-muted #8a8474` (labels), `--sc-dim #5e5a52` (empty
   outlines). Navbar reflowed to a single bar (logo · 36×36 avatar ·
   inline nav tabs · bronze SUI balance pill 112×31). TopBanner
   switched to solid bronze fill with Poppins 48/800 heading.
   CenterInfoCard rewrites the stats column with semantic-coloured
   attribute bars (STR blood / DEX steel / INT grape / END bronze)
   and a 4×2 colour-coded combat-stats grid. Inventory heading
   bumped to Poppins 36/400 with a 2-col 84×84 tile grid. Recent
   fights row redrawn with WIN/LOSS pills + JetBrains-Mono scores.

3. **Character equipment frame — exact-match port from extracted
   Claude Design spec** (`0614cc4`). The user extracted the live
   React source via Claude Chrome extension; diagnostic flagged
   that the prior CLI port treated the center grid column as a
   fixed pixel width when the canonical source uses `1fr`. Port
   rebuilt against the extracted `App.jsx` `TWEAK_DEFAULTS`:
   `bigSlotW 96`, `bigSlotH 108`, `ringSlotSize 44`, `beltSlotH
   56`, `colGap 8`, `slotGap 6`, `framePad 12`. Grid template now
   `96px 8px 1fr 8px 96px` — center stays `1fr`. SlotTile shadow
   recipe pinned to the canonical chunky-inset look. PortraitFrame
   stretches via `flex: 1`. Pinned tests in `qa-layout-primitives`
   + `qa-v2-primitives` repointed to the new constants. Spec lives
   at `design_v2/specs/character_equipment_frame_extracted.md`.

4. **Inventory filter row — icon toggle buttons** (`4b7f8cd`). The
   "All / Weapons / Armor / Jewelry" text-chip row became a row of
   four 32 × 32 icon toggles (Lucide-style SVG paths inlined —
   `lucide-react` isn't a dependency). Stroke colour ties each
   filter to its stat family: Sword `--sc-blood`, Shield `--sc-steel`,
   Gem `--sc-grape`, Grid3x3 `--sc-bronze`. Layout is now a single
   header line: `Inventory (n) · 4 icons · All Rarities ▾`.
   `role="radiogroup"` + per-icon `aria-checked` + `aria-label`
   for accessibility. New `[9b]` block in `qa-layout-primitives`
   adds 20 fresh assertions covering the toggle state machine,
   colour routing, sizing, and a regression guard against the
   legacy text-chip layout.

5. **Player Profile modal — mini Character page with NFT portrait +
   equipment frame** (`0590a97`). The flat 10-slot doll became a
   scaled-down version of the main Character page. New component:
   `MiniEquipmentFrame` at ~80% of the extracted spec —
   `bigSlotW 76`, `bigSlotH 86`, `ringSlotSize 35`, `beltSlotH 44`,
   `colGap 6`, `slotGap 5`, `framePad 10`. Grid template
   `76px 6px 1fr 6px 76px` (center stays `1fr` — same regression
   guard as the main frame). Reuses `SlotTile`, `HpBar`,
   `PortraitFrame`, `TribalOrnament` from `character-profile.tsx`
   — primitives surfaced as exports, `PortraitFrame.onClick`
   made optional (renders as `<div>` when omitted) with new
   `emptyTitle / emptySubtitle / hidePlusIcon` props for read-only
   callers. Modal primitive grew `extraWide?: boolean` (maxWidth
   960). Right column adopts the same semantic-coloured attribute
   bars + 4×2 combat-stats grid as the main Character page. New
   gauntlet `scripts/qa-mini-equipment-frame.ts` ships 50
   assertions across 13 sections.

6. **Portrait NFT wire-up status — flagged as v5.1 one-prop hookup.**
   Today confirmed that the chosen NFT portrait is currently
   localStorage-only (see `lib/nft-portrait.ts:writePortrait`); it
   never round-trips through the server. `PlayerProfileWire`
   carries no `portraitNftId`. The mini frame renders the
   read-only "No portrait set" empty state today and exposes a
   `portraitImageUrl?` prop reserved for the future server-side
   hookup. Adding a `portraitNftId: Option<address>` field to the
   `Character` Move struct in v5.1 closes this with one prop
   change on the caller — no further refactor needed.

### Pre-push verification (gates green)

| Gate | Result |
|---|---|
| Secrets scan (`feature/v5-redeploy..HEAD` diff + filenames) | **clean** — no private keys / `.env` / `.pem` / keystore content |
| Branch | `feature/phase-2-design` ✓ |
| Static gauntlet | **2,164 / 2,164 PASS** · 35 suites · 2 pre-existing dotenv infra ERRs (accepted) |
| Move unit tests | **35 / 35 PASS** |
| `tsc --noEmit` — frontend | exit 0 ✓ |
| `tsc --noEmit` — server | exit 0 ✓ |
| `curl localhost:3000` | `200` ✓ |
| Main untouched (`08ff991`) | ✓ |
| `feature/v5-redeploy` untouched (`6308240`) | ✓ |

Working tree carries a set of parked pre-existing files (DM
plaintext + send pipelines, Tavern data modules, server migrations,
design screenshots) that predate this session and are deliberately
not part of the Phase 2 design checkpoint. They stay local — `git
push` will not carry them. Listed for transparency:

`AGENTS.md` · `CHANGELOG.md` · `CLAUDE.md` · `frontend/package*` ·
`frontend/src/app/game-provider.tsx` · `frontend/src/config/dapp-kit.ts`
· `frontend/src/hooks/useGameStore.ts` · `frontend/src/types/ws-messages.ts`
· `frontend/tsconfig.json` · `server/setup-db.mjs` · `server/src/index.ts`
· `server/src/ws/{fight-room,handler}.ts` · 9× new server data modules
· 9× new QA scripts for DM + Tavern + messaging · 5× design screenshots
· `TAVERN_DESIGN.md`. These will land in their own focused branches
when the user is ready.

---

## Pipeline Workflow

Locked + documented in [`design_v2/PIPELINE.md`](./design_v2/PIPELINE.md).
Short version:

1. **Design** — `claude.ai/design` Edit mode for visual mockups (free, no credit burn).
2. **Extraction** — Chrome extension + Sonnet pulls a structured spec from the live DOM + JSX.
3. **Orchestration** — `claude.ai` chat (Opus) writes a focused CLI prompt from the spec.
4. **Implementation** — Claude Code CLI ships real code + tests + commits.
5. **Visual QA** — screenshots return to the orchestrator chat; deviation loop closes the gap.

Each tool does what it's best at; no interpretation drift between
tools. Per-screen pipeline time: **40 – 90 minutes for a
pixel-perfect port.**

---

## Branch State

| Branch | Tip | Status | Purpose |
|---|---|---|---|
| `main` | `08ff991` (v4-era) | untouched | Mainline — stays here until v5.1 audit clears |
| `feature/v5-redeploy` | `6308240` (remote) | untouched, last push 2026-05-13 | v5 functional checkpoint |
| `feature/phase-2-design` | `0590a97` → (push tip after this doc) | **pushing today** | Phase 2 UI redesign |
| `feature/v5.1-contracts` | — | **to be created next session** | Phase 3 — v5.1 Move republish |

`feature/phase-2-design` is **36 commits ahead** of
`feature/v5-redeploy` and **98 commits ahead** of `main`.

---

## What's Next — Two Parallel Tracks

### Track A — Visual QA + polish (user-driven, on `feature/phase-2-design`)

1. Walk every screen at 1440 px viewport.
2. Screenshot every screen.
3. Spot deviations from Claude Design references.
4. Iterate per-screen via Claude Design (credits reset Tuesday
   2026-05-19) → Chrome ext extraction → CLI port via this same
   pipeline.
5. Push each polish round to `feature/phase-2-design`.

Visual QA target screens (every one must walk):

- Landing (connect-wallet entry)
- Character / Loadout
- Arena (3-tile fight type row, queue panel, wager form)
- Marketplace (3-column with kiosk panel)
- Tavern (DMs · Chat · Online row)
- Hall of Fame (podium + ladder)
- Fight room (live HP bars, damage log, timer)
- All modals — Player Profile, Item Detail, Stat Allocate, Level Up,
  NFT Portrait Picker, List on Marketplace, Buy Listing

### Track B — Phase 3: v5.1 contract republish (CLI-driven, on `feature/v5.1-contracts`)

Implement the full v5.1 contract bundle previously specced in
[`STATE_OF_PROJECT_2026-05-04.md`](./STATE_OF_PROJECT_2026-05-04.md)
§v5.1 plan:

- `CharacterRegistry` shared object for duplicate-mint Layer 3 fix
- `OpenWagerRegistry` for server-down-mid-create + silent-accept defense
- `slot_type: u8` on `Item` struct (0=mainhand · 1=offhand · 2=both_hands) — subsumes 2H Path A
- `settle_wager_attested` with dual player `signPersonalMessage` over outcome hash
- `settle_draw` / `winner: Option<address>` for mutual-KO support
- `burn_character` admin-gated cleanup
- `mint_item_admin` reintegration for on-chain loot drops
- **`portrait_nft_id: Option<address>` field on `Character` struct**
  (closes the Player Profile portrait wire-up gap surfaced today)
- `draws: u32` field on `Character` + `update_after_fight_draw`

Then:

- Fresh `sui client publish` (NOT upgrade — preserves no bytecode from v5)
- Fresh `deployment.testnet-v5.1.json` with all new IDs
- Server SDK migration to new package ID
- Frontend env-var swap
- Smoke test: 2 wallets create characters, equip, fight, settle, marketplace list/buy
- Full QA gauntlet replay against v5.1 contracts

Estimated: **5 – 7 days focused work + audit pass before mainnet candidate.**

---

## Bucket Status Matrix

| Bucket | Status | Notes |
|---|---|---|
| 1 — v5 core gameplay | ✅ closed | (See 05-04 snapshot.) |
| 2 — v5 marketplace + kiosk | ✅ closed | (See 05-04 snapshot.) |
| 3 #1 — Tavern | ✅ closed | Live-verified 05-13. |
| 3 #2 — Hall of Fame | ✅ closed | Live-verified 05-13. |
| 3 #3 — Multi-day stability | ⏳ deferred to v5.1 smoke test |
| 3 #4 — Fresh-user onboarding | ⏳ deferred to v5.1 smoke test |
| 3 #5 — Admin endpoint audit | ⏳ deferred to pre-mainnet sweep |
| Phase 2 — Design redesign | ✅ **checkpoint pushed today** — polish iterations ongoing |
| Bucket 4 — v5.1 contract republish | 🎯 **NEXT (Track B)** |
| Bucket 5 — External audit | queued (post v5.1 stability) |
| Bucket 6 — Mainnet publish | queued (post audit) |

---

## Test Suite State

**Total: 2,164 / 2,164 PASS across 35 suites.** Plus 2 pre-existing
infra-only ERRs (`qa-chain-gauntlet`, `qa-mint-catalog` both miss
`dotenv` in the repo's `node_modules` — not regressions from
today's work; confirmed by stashing every modification and
re-running).

| Suite | Count | Notes |
|---|---:|---|
| `qa-busy-state-render` | 23 / 23 | |
| `qa-character-mint` | 63 / 63 | |
| `qa-combat-stats` | 79 / 79 | |
| `qa-dm-messages` | 53 / 53 | |
| `qa-dm-plaintext-pipeline` | 36 / 36 | |
| `qa-dm-send-pipeline` | 65 / 65 | |
| `qa-equip-picker` | 78 / 78 | |
| `qa-fight-pause` | 46 / 46 | |
| `qa-grace-budget` | 46 / 46 | |
| `qa-hall-of-fame` | 187 / 187 | |
| **`qa-landing`** | **49 / 49** | added in Phase 2 |
| **`qa-layout-primitives`** | **155 / 155** | bumped from 135 by Phase 2-polish (icon-toggle pins); repinned 2026-05-14 to the extracted-spec architecture |
| `qa-level-up-modal` | 44 / 44 | |
| `qa-marketplace` | 63 / 63 | |
| `qa-messaging-client` | 65 / 65 | |
| **`qa-mini-equipment-frame`** | **50 / 50** | NEW today |
| `qa-multi-queue-isolation` | 60 / 60 | |
| `qa-nft-portrait-picker` | 98 / 98 | |
| `qa-orphan-sweep` | 30 / 30 | |
| `qa-reconnect-grace` | 35 / 35 | |
| `qa-reconnect-modal` | 31 / 31 | |
| `qa-stat-points` | 45 / 45 | |
| `qa-tavern-dm-channels` | 51 / 51 | |
| `qa-tavern-fight-requests` | 58 / 58 | |
| `qa-tavern-handlers` | 72 / 72 | |
| `qa-tavern-presence` | 66 / 66 | |
| `qa-tavern-sidebar` | 42 / 42 | |
| `qa-treasury-queue` | 25 / 25 | |
| **`qa-v2-primitives`** | **128 / 128** | repinned 2026-05-14 to the extracted-spec architecture |
| `qa-wager-accept-gate` | 39 / 39 | |
| `qa-wager-form` | 47 / 47 | |
| `qa-wager-register` | 25 / 25 | |
| **`qa-wordmark`** | **30 / 30** | added in Phase 2 |
| `qa-ws-readystate` | 37 / 37 | |
| `qa-xp` | 143 / 143 | |
| **TOTAL** | **2,164** | 35 suites |

Move unit tests: `cd contracts && sui move test` → **35 / 35 PASS** (16 suppressed linter warnings).

---

## Files Modified This Session

**Today's commits touch 15 files.** Aggregated across the 5 commits
since the 2026-05-13 close-out (`aeabfd5..HEAD`):

```
design_v2/specs/character_equipment_frame_extracted.md   NEW
design_v2/specs/character_v2_measurements.md             NEW
frontend/src/components/character/character-profile.tsx  M
frontend/src/components/items/inventory.tsx              M
frontend/src/components/layout/game-screen.tsx           M
frontend/src/components/layout/navbar.tsx                M
frontend/src/components/social/mini-equipment-frame.tsx  NEW
frontend/src/components/social/player-profile-modal.tsx  M
frontend/src/components/ui/modal.tsx                     M
frontend/src/components/v2/layout.tsx                    M
frontend/src/components/v2/wordmark.tsx                  M
frontend/src/styles/design-tokens-v2.css                 M
scripts/qa-layout-primitives.ts                          M
scripts/qa-mini-equipment-frame.ts                       NEW
scripts/qa-v2-primitives.ts                              M
```

Plus the three Step-7 commits adding this state doc,
`design_v2/PIPELINE.md`, the `STATUS.md` pointer update,
`CLAUDE.md` / `AGENTS.md` gitnexus count refresh, and `.gitnexus/`
index sync.

---

## Commit Log

Newest-first, scoped to today's commits (since
[STATE_OF_PROJECT_2026-05-13.md](./STATE_OF_PROJECT_2026-05-13.md)
at `aeabfd5`):

```
0590a97  feat(phase-2-polish): Player Profile modal — mini Character page with NFT portrait + equipment frame
4b7f8cd  feat(phase-2-polish): Inventory filter row — icon toggle buttons
0614cc4  feat(phase-2-fix):    Character equipment frame — exact-match port from extracted Claude Design spec
d22892e  feat(phase-2-fix):    Character page — 73-element spec match from Claude Design
5457a4d  feat(phase-2-fix):    Character — NFT portrait 3:4 ratio + edge-to-edge slot fit + row alignment
```

Full branch history (36 commits since `feature/v5-redeploy` tip,
98 commits since `main` at `08ff991`) is in `git log`.

---

## Reference Table

| Doc | Role |
|---|---|
| **`STATE_OF_PROJECT_2026-05-14.md`** | **NEW canonical state — this file** |
| `STATE_OF_PROJECT_2026-05-13.md` | Historical: v5 functional close-out snapshot |
| `STATE_OF_PROJECT_2026-05-04.md` | Historical: end-of-Bucket-2 snapshot |
| `STATUS.md` | One-line pointer to current canonical state |
| `CHANGELOG.md` | Day-by-day change history |
| `CLAUDE.md` | Repo-rooted instructions for Claude Code (GitNexus directives) |
| `AGENTS.md` | Subagent / harness instructions |
| `design_v2/PIPELINE.md` | 5-phase design → code pipeline reference |
| `design_v2/specs/character_v2_measurements.md` | 73-element Character page spec (overall page) |
| `design_v2/specs/character_equipment_frame_extracted.md` | Equipment-frame architecture spec (extracted from live React source) |
| `design_v2/screenshopts/character_loadout_target.png` | Visual reference — overall page |
| `design_v2/screenshopts/character_equipment_target.png` | Visual reference — equipment frame |
| `frontend/src/styles/design-tokens-v2.css` | Canonical CSS variable palette (incl. new tokens added 2026-05-14: `--sc-grape`, `--sc-victory`, `--sc-parchment-dim`, `--sc-muted`, `--sc-dim`) |
| `contracts/Move.toml` + `contracts/sources/` | Move package (still v5; v5.1 republish lands on `feature/v5.1-contracts`) |
