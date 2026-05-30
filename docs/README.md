# SUI Combats — `docs/` index

Curated entry point for project documentation. Top-level files at the
repo root are the canonical session pointers; everything reference-grade
lives in `docs/`; historical session journals + superseded checklists
live in `docs/archive/` and are kept for trace-back, not for current
guidance.

## Canonical — start here

| File | What it is |
|---|---|
| [`../SESSION_HANDOFF_2026-05-29.md`](../SESSION_HANDOFF_2026-05-29.md) | **Live session handoff (EOD)** — single-page entry point for the next session. Always edit/replace in place so the canonical path stays stable. |
| [`../STATE_OF_PROJECT_2026-05-29.md`](../STATE_OF_PROJECT_2026-05-29.md) | **Project state snapshot (EOD)** — branch, package IDs, what's live, what's pending, mainnet readiness scorecard. |
| [`../README.md`](../README.md) | Project README (build, run, deploy). |
| [`../CLAUDE.md`](../CLAUDE.md) | Agent guidance — GitNexus block auto-rewritten by the post-commit hook; the v5.1 testnet block below it is hand-maintained. |
| [`../MAINNET_PREP.md`](../MAINNET_PREP.md) | Mainnet deploy protocol + threat model + change ledger. |

## Game design + product specs (top-level, reference-grade)

| File | What it is |
|---|---|
| [`../SUI_COMBATS_GDD.md`](../SUI_COMBATS_GDD.md) | Game Design Document — combat math, trinity, progression, the GDD §6 weapon trinity that v5.1's `slot_type` enforces. |
| [`../DESIGN_BRIEF.md`](../DESIGN_BRIEF.md) | Visual + UX direction (forged-metal v2). |
| [`../LOADOUT_DESIGN.md`](../LOADOUT_DESIGN.md) | Loadout staging spec — D1 PTB-of-primitives, D3 strict, D4 pending-inactive-during-fight. Referenced by `useEquipmentActions`. |
| [`../TAVERN_DESIGN.md`](../TAVERN_DESIGN.md) | Tavern + DM transport spec. |
| [`../GRANT_APPLICATION.md`](../GRANT_APPLICATION.md) | Sui grant application materials. |
| [`../CHANGELOG.md`](../CHANGELOG.md) | Repo changelog. |

## v5.1 reference docs (this folder)

| File | What it is |
|---|---|
| [`V5_QA_AUDIT_AND_V5.1_SCOPE_2026-05-28.md`](V5_QA_AUDIT_AND_V5.1_SCOPE_2026-05-28.md) | **Primary v5.1 spec source.** Audit of v5.0 gaps + v5.1 scope decisions. Read this before touching the v5.1 contracts. |
| [`V5.1_RELEASE_NOTES_2026-05-28.md`](V5.1_RELEASE_NOTES_2026-05-28.md) | v5.1 release notes — cut-over protocol, what changed, deployment IDs. |
| [`V5.1_TWO_HANDED_FLOW.md`](V5.1_TWO_HANDED_FLOW.md) | End-to-end two-handed weapon flow (chain `slot_type` → server → frontend layers → educational modal). Closes the deleted `TWO_HANDED_NAMES` allowlist; pinned by 5 QA gauntlets. |
| [`V5.2_WAGER_FAIRNESS_SPEC.md`](V5.2_WAGER_FAIRNESS_SPEC.md) | **v5.2 spec + the Move contract has been BUILT** (2026-05-29 EOD). Contract-only redesign of `accept_wager`: ±1 level bracket + creator-approval handshake via new `STATUS_PENDING_APPROVAL` state, abort codes 12-17. Fresh `sui client publish` scheduled for 2026-05-30. |

## Archive (`docs/archive/`)

Historical session handoffs, dated state-of-project snapshots, and
superseded session checklists. Kept for trace-back; **not** current
guidance. The most recent canonical handoff + state always live at the
repo root, the previous day's version is moved here at end-of-day.

Naming convention: dated suffixes (`_YYYY-MM-DD.md`). The handful of
pre-convention files (`SESSION_HANDOFF.md`, `STATUS.md`) were renamed
on archive to add their date for clarity.

| File | Notes |
|---|---|
| `SESSION_HANDOFF_2026-05-19.md` … `_2026-05-28.md` | Dated session handoffs prior to 2026-05-29 EOD |
| `HANDOVER_2026-05-19.md`, `_2026-05-20.md` | Older "handover" doc style (pre-handoff convention) |
| `STATE_OF_PROJECT_2026-05-04.md` … `_2026-05-28.md` | Project-state snapshots prior to today |
| `STATUS_2026-05-20.md` | Short status note from 2026-05-20 (pre-state-of-project) |
| `V5.1_OVERNIGHT_LOG_2026-05-28.md` | Per-phase journal of the 2026-05-28 v5.1 republish session |
| `V5.1_13SLOT_QA_CHECKLIST_2026-05-28.md` | 13-slot republish QA checklist — feature shipped 2026-05-28 |
| `sui_latest_2026-05-16.md` | Sui SDK reference snapshot from 2026-05-16 |

## Conventions

- **Canonical handoff path** stays at the repo root as
  `SESSION_HANDOFF_<latest-date>.md`. At EOD, the previous day's handoff
  moves to `docs/archive/` and the new day's file becomes canonical.
- **State-of-project** follows the same rolling convention.
- **Reference docs** that aren't session-bound (release notes, design
  specs, the GDD, this flow doc) live in `docs/` and stay put — they're
  updated in place, not duplicated by date.
- **Never delete an archived file** — git history would still show it,
  but a flat `docs/archive/` directory is the fastest way to grep
  cross-session for "when did we last decide X?".
