<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **sui-comabts** (2900 symbols, 7101 relationships, 238 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## When Debugging

1. `gitnexus_query({query: "<error or symptom>"})` — find execution flows related to the issue
2. `gitnexus_context({name: "<suspect function>"})` — see all callers, callees, and process participation
3. `READ gitnexus://repo/sui-comabts/process/{processName}` — trace the full execution flow step by step
4. For regressions: `gitnexus_detect_changes({scope: "compare", base_ref: "main"})` — see what your branch changed

## When Refactoring

- **Renaming**: MUST use `gitnexus_rename({symbol_name: "old", new_name: "new", dry_run: true})` first. Review the preview — graph edits are safe, text_search edits need manual review. Then run with `dry_run: false`.
- **Extracting/Splitting**: MUST run `gitnexus_context({name: "target"})` to see all incoming/outgoing refs, then `gitnexus_impact({target: "target", direction: "upstream"})` to find all external callers before moving code.
- After any refactor: run `gitnexus_detect_changes({scope: "all"})` to verify only expected files changed.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Tools Quick Reference

| Tool | When to use | Command |
|------|-------------|---------|
| `query` | Find code by concept | `gitnexus_query({query: "auth validation"})` |
| `context` | 360-degree view of one symbol | `gitnexus_context({name: "validateUser"})` |
| `impact` | Blast radius before editing | `gitnexus_impact({target: "X", direction: "upstream"})` |
| `detect_changes` | Pre-commit scope check | `gitnexus_detect_changes({scope: "staged"})` |
| `rename` | Safe multi-file rename | `gitnexus_rename({symbol_name: "old", new_name: "new", dry_run: true})` |
| `cypher` | Custom graph queries | `gitnexus_cypher({query: "MATCH ..."})` |

## Impact Risk Levels

| Depth | Meaning | Action |
|-------|---------|--------|
| d=1 | WILL BREAK — direct callers/importers | MUST update these |
| d=2 | LIKELY AFFECTED — indirect deps | Should test |
| d=3 | MAY NEED TESTING — transitive | Test if critical path |

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/sui-comabts/context` | Codebase overview, check index freshness |
| `gitnexus://repo/sui-comabts/clusters` | All functional areas |
| `gitnexus://repo/sui-comabts/processes` | All execution flows |
| `gitnexus://repo/sui-comabts/process/{name}` | Step-by-step execution trace |

## Self-Check Before Finishing

Before completing any code modification task, verify:
1. `gitnexus_impact` was run for all modified symbols
2. No HIGH/CRITICAL risk warnings were ignored
3. `gitnexus_detect_changes()` confirms changes match expected scope
4. All d=1 (WILL BREAK) dependents were updated

## Keeping the Index Fresh

After committing code changes, the GitNexus index becomes stale. Re-run analyze to update it:

```bash
npx gitnexus analyze
```

If the index previously included embeddings, preserve them by adding `--embeddings`:

```bash
npx gitnexus analyze --embeddings
```

To check whether embeddings exist, inspect `.gitnexus/meta.json` — the `stats.embeddings` field shows the count (0 means no embeddings). **Running analyze without `--embeddings` will delete any previously generated embeddings.**

> Claude Code users: A PostToolUse hook handles this automatically after `git commit` and `git merge`.

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->

---

# v5.1 testnet — current runtime (2026-05-28, post-session)

> Hand-maintained reference for the live testnet runtime. Updated end of
> session 2026-05-28. The GitNexus block above this line is auto-rewritten
> by the post-commit hook; everything below this header is preserved.

## Branch + commit

- Working branch: `feature/v5.1-contracts` (NOT yet merged to `main`)
- HEAD on origin: `0ab7677` (pushed 2026-05-28)
- `main` mainline stays at `08ff991` (v4-era) per standing rule — no
  merge until v5.2 + external audit

## v5.1 final deployment (testnet)

| Artefact | ID |
|---|---|
| Package | `0x308645f3d85ba6d7647f660610faba5dbdae2822819939bc917302a20cf33717` |
| AdminCap (→ TREASURY) | `0x2cbeef93fb0d167ccd87fd67f99542b7e2387601a0a3644bb19a600db3461c50` |
| UpgradeCap (→ TREASURY) | `0x7434a214aa346c5af0199bee519cc8203ce4d8633bcc8397fba08e281dbbb07a` |
| Publisher (→ TREASURY) | `0x2cb1d94c837bae772ce1122f8c17314bc2fdb0bbec4991540e1a38c4c28495b1` |
| TransferPolicy\<Item\> (shared) | `0x0483cd855318921a330ff2d8967fb925382d76c7360a29a5d2bbf676bd13f69f` |
| TransferPolicyCap (→ TREASURY) | `0xee5a808c9aa22daf8c57420fa06e9ae0073b0d6a22e55a8be7c84da3f6ed31c8` |
| CharacterRegistry (shared) | `0xad05d60e00149ab105ee60f8eaaec1542ec08d8c8795da53305f01bde4c9105f` |
| OpenWagerRegistry (shared) | `0xa3be188a6b636bdf12d1d7b79f866fc6d22f287c60daf7157f95b3c246908e20` |
| KioskRegistry (shared) | `0x05d355fdf844bc615d66bd621f1a8aa7f673784f70d1d991681e4c6a012d4860` |
| Display\<Character\> | `0x94a855326a01a91e247a8062d9c475eddf5770829f52d7dbfceef535a5fc0885` |
| Display\<Item\> | `0x32bdda84dd589ed21e804171b924cc5b3676f97b35b55dff2d064d035a5aa658` |
| TREASURY wallet | `0x975f1b348625cdb4f277efaefda1d644b17a4ffd97223892d93e93277fe19d4d` |
| TREASURY kiosk | `0x9a492e52f998a76c355d65b0aad2db3c35812837da36aed9666c7b2661dfdb36` |
| KioskOwnerCap | `0x668805a60262971d6044c1ad8c861dd6e0ce0d69bb93eda46690214d1820fed2` |

Two earlier v5.1 publishes (`0x78534...` 10-slot original; `0x95c23...`
13-slot with pauldrons) are SUPERSEDED — their bytecode lives on chain
per Sui semantics, but the running servers point at the final package.
The full chain is in `deployment.testnet-v5.1.json::supersedes`.

## Test wallets

- Mr_Boss `0xf669789c0e6d30627e8480b5886721d608d796277aab0664cfa84b2c04590f33` — v5.1 character minted, Tank build equipped
- Sx `0x03c33df0c97d4dfb3792d340bbf83891e2a20d653155874fd37a350ad443985f` — not yet on v5.1

## Pinata CIDs (operational catalog)

- Lv1 Common (Ponke set, 26 items): `bafybeib36hi7qupllhjymo2qnte2nghbiowkwxj2hb2fgbs5jly2ln3ida`
- Lv2 Uncommon (Scavenger set, 26 items): `bafybeidsjl6kihow5vzgssvoyjo2nvworbwhmk53f5vfe3wp56tqzzv4oq`

Both sets are minted into TREASURY and listed in the TREASURY kiosk —
52 active listings total as of session end.

## 13-slot loadout (live)

`weapon, offhand, helmet, chest, gloves, boots, belt, ring_1, ring_2,
ring_3, necklace, pants, bracelets`. **`ring_3`, NOT `pauldrons`** —
the slot decision changed mid-session; pauldrons were removed entirely
from contracts, server, and frontend before the final publish.

## Where the canonical session state lives

- `STATE_OF_PROJECT_2026-05-28.md` — repo-root canonical snapshot
- `SESSION_HANDOFF_2026-05-28.md` — single-page session handoff
- `docs/V5.1_RELEASE_NOTES_2026-05-28.md` — release notes (cut-over protocol)
- `docs/V5.1_OVERNIGHT_LOG_2026-05-28.md` — per-phase journal
- `docs/V5_QA_AUDIT_AND_V5.1_SCOPE_2026-05-28.md` — primary spec source
- `MAINNET_PREP.md` — deploy protocol + threat model + change log
