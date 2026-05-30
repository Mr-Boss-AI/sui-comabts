# SUI Combats — Design → Code Pipeline

> Locked workflow for taking a visual idea from sketch to merged
> production code. Every Phase 2 polish round (and every Phase 3
> contract-adjacent UI change) goes through these five phases.
>
> First codified 2026-05-14 during the Phase 2 design checkpoint
> push; refined inline as the workflow runs.

---

## The 5 Phases

| # | Phase | Tool | Cost | Output |
|---|---|---|---|---|
| 1 | **Design** | `claude.ai/design` (Edit mode) | free — no credit burn | Visual mockup of the target screen |
| 2 | **Extraction** | Claude Chrome extension + Sonnet 4.6 | reads live DOM + JSX | Structured spec (Markdown) |
| 3 | **Orchestration** | `claude.ai` chat (Opus 4.7) | spec → CLI prompt | Focused CLI prompt with measurements, tokens, anti-patterns |
| 4 | **Implementation** | Claude Code CLI (Opus 4.7) | writes code in repo | Real code · tests · commits |
| 5 | **Visual QA** | Manual screenshots → Phase 3 orchestrator | one screenshot per screen | Deviation list → loop back to Phase 1 |

Each tool does what it is best at. No interpretation drift between
tools because the spec is the contract.

---

## Why It Works

- **Phase 1** is iterative + cheap, so the design can be wrong many
  times for free. Edit mode means no credit burn between revisions.
- **Phase 2** never lets visual intent become CLI's guesswork. The
  spec carries every measurement, every CSS variable, every shadow
  recipe, every grid template — verbatim from the React source the
  designer actually rendered.
- **Phase 3** keeps the CLI prompt focused. Opus chat reads the spec
  AND the standing rules (no merge to main, no test edits, etc.)
  and emits a single self-contained prompt.
- **Phase 4** is the only step that touches the production tree.
  Tests gate it. Gauntlets gate it. Commits gate it.
- **Phase 5** is the only place subjective judgment matters — and
  it is anchored against a real screenshot of the target.

---

## When To Use Each Tool

| Task | Tool |
|---|---|
| Generate a new visual | `claude.ai/design` (Phase 1) |
| Iterate visuals — try 6 variants for free | `claude.ai/design` Edit mode |
| Extract a precise spec from a chosen mockup | Chrome extension + Sonnet (Phase 2) |
| Plan implementation work, write CLI prompts | `claude.ai` chat with Opus (Phase 3) |
| Write code, run tests, commit | Claude Code CLI (Phase 4) |
| Catch deviations | Visual QA loop (Phase 5) |
| Investigate WHY a layout looks wrong | Phase 2 extraction over Phase 1 redesign — the diff between the live source and what shipped tells you everything (see the `1fr` vs fixed-pixel diagnosis on 2026-05-14) |

---

## Anti-Patterns

- ❌ **Skipping extraction.** CLI ships approximate measurements and
  the layout drifts.  Spec extraction is the only step that pins
  pixels.
- ❌ **Asking the design tool to write production code.** Design tool
  emits illustrative React; it doesn't know your tokens, your test
  pins, your component boundaries.
- ❌ **Big-bang prompts** ("fix all screens"). Half the screens land,
  half don't, gauntlets break in the middle.
- ❌ **No GitHub checkpoints.** Without push points, there is no
  rollback. Push after every coherent step.
- ❌ **Hardcoded hex literals in JSX.** Use `var(--sc-*)` tokens. If a
  token is missing, add it to `design-tokens-v2.css` first.
- ❌ **Patching tests to make broken code pass.** Update tests when
  the spec changes, not to paper over regressions.

---

## Per-Screen Pipeline Time

| Phase | Time |
|---|---|
| 1 — Design | 15 – 30 min |
| 2 — Extraction | 5 – 10 min |
| 3 — Orchestration | 5 – 10 min |
| 4 — Implementation | 10 – 30 min |
| 5 — Visual QA | 5 – 15 min |
| **Total per screen** | **40 – 90 min, pixel-perfect** |

A Character page port took ~60 minutes on 2026-05-14 (Phase 4 alone).
A Player Profile modal took ~45 minutes. Wordmark took 25.

---

## Folder Structure

```
design_v2/
├─ PIPELINE.md                        ← this file
├─ archive/                           ← old iterations (kept for diff)
├─ latest/                            ← canonical design-tool export
│  ├─ colors_and_type.css             ← (synthetic — actual lives in frontend/src/styles/design-tokens-v2.css)
│  └─ ui_kits/web_game/               ← React source from design tool
├─ screenshopts/                      ← reference mockups + target images
│  ├─ character_loadout_target.png
│  ├─ character_equipment_target.png
│  └─ landing_page_target.png
└─ specs/                             ← extracted measurement specs (Phase 2 output)
   ├─ character_v2_measurements.md           (73-element overall page spec)
   └─ character_equipment_frame_extracted.md (equipment-frame architecture spec)
```

---

## Standing Rules (applied to every Phase 4 CLI prompt)

- ❌ NO git push without explicit instruction
- ❌ NO merge to `main`
- ❌ NO force-push, NO branch deletion
- ❌ NO Move contract changes in design pipeline runs
- ❌ NO breaking equip / save loadout / stat allocate / NFT picker / WS plumbing
- ✅ Stay on `feature/phase-2-design` for design work
- ✅ Match the spec exactly — measurements, fonts, colours, paddings
- ✅ Use existing `--sc-*` tokens; add new ones to `design-tokens-v2.css` rather than hardcoding hex
- ✅ Reuse primitives — `SlotTile`, `HpBar`, `PortraitFrame`, `TribalOrnament`, etc — never spin up parallels
- ✅ Update test pins when the spec changes; never patch tests to mask regressions
- ✅ Run all gauntlets after each Phase 4 run; commit only when green
- ✅ Refresh `npx gitnexus analyze` after every commit (handled by `PostToolUse` hook)

---

## Worked Example — 2026-05-14 Character Page Port

| Phase | Artefact | Notes |
|---|---|---|
| 1 — Design | `design_v2/screenshopts/character_loadout_target.png` | Existing Claude Design mockup |
| 2 — Extraction (pass 1) | `design_v2/specs/character_v2_measurements.md` | 73-element overall-page report from inspector |
| 4a — Implementation | commit `d22892e` | 73-element port, new `--sc-*` tokens added |
| Visual QA | Screenshot from user | Equipment frame still misaligned |
| 2 — Extraction (pass 2) | `design_v2/specs/character_equipment_frame_extracted.md` | Sonnet extracted live React `TWEAK_DEFAULTS` + flagged `1fr` vs fixed-pixel root cause |
| 4b — Implementation | commit `0614cc4` | Exact-match port — frame snapped into place |
| 4c — Polish | commit `4b7f8cd` | Inventory filter row icon toggles |
| 4d — Polish | commit `0590a97` | Player Profile mini Character page |
| Checkpoint | this push | 36 commits since last push |

**Lesson learned:** when something looks "off" but doesn't have an
obvious failing test, run Phase 2 extraction again against the
live source — the diff between what shipped and what's canonical is
the answer.
