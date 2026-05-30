<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **sui-comabts** (6737 symbols, 11652 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/sui-comabts/context` | Codebase overview, check index freshness |
| `gitnexus://repo/sui-comabts/clusters` | All functional areas |
| `gitnexus://repo/sui-comabts/processes` | All execution flows |
| `gitnexus://repo/sui-comabts/process/{name}` | Step-by-step execution trace |

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

# v5.2 testnet — current runtime (2026-05-30, post-cut-over)

> Hand-maintained reference for the live testnet runtime. Updated 2026-05-30
> after the v5.2 wager-fairness app-code cut-over completed and is ready
> for live QA. The GitNexus block above this line is auto-rewritten by
> the post-commit hook; everything below this header is preserved.

## Branch + commit

- Working branch: `feature/v5.2-wager-fairness` (local only — NOT pushed, NOT merged to `main`)
- `main` at `6fdb18d` (v5.1 baseline, annotated tag `v5.1`) — untouched
- v5.1 package + v5.1 shared objects still live on chain; v5.2 is the
  parallel runtime the frontend + server are now pointed at

## v5.2 deployment (testnet, live)

| Artefact | ID |
|---|---|
| Package | `0x9c01ad55dd3aecafe671758fe4c9837b9fdfef1739793eb6bc094cc476f7d38f` |
| AdminCap (→ TREASURY) | `0x41475565a81cf769948ea1268d850fc144c7e995d91017d4115730dc5d617c44` |
| UpgradeCap (→ TREASURY) | `0xdb6d2be80538cc43a2b9aed8299a3e97f4804bba07f656c42baf604ca4a36212` |
| Publisher (→ TREASURY) | `0x4010478364ea545645200d43c6080c5f48218b45bbbc9b82d9a4748aece2bd9e` |
| TransferPolicy\<Item\> (shared) | `0x7d2aa5d31544d16b28998a7bfdce112c2bd02be79da7f9fbbd34e63d41de568d` |
| TransferPolicyCap (→ TREASURY) | `0x93efafa2f2038476b209af420efb00f1fd7c12054290249c2707c67639359f1d` |
| CharacterRegistry (shared) | `0x84c78a861f3ee2d2299fec507640605c71e313bfbea340bd490a19a04d8492ff` |
| OpenWagerRegistry (shared) | `0xabf10378c0b8a65f883098440cfcb68809f14f66fcdb1278106dbd88bf086e16` |
| KioskRegistry (shared) | `0xbc5f55674711b69ea830603d715853f50e40028702be9e837aaf8afd50bc3efe` |
| Display\<Character\> | `0x9c8fc218e52a7bab1a95aa2bbbfbf9199243523cc8cd94d7e5cecb1db2b07b8b` |
| Display\<Item\> | `0x8b75f8f6d90be38f41ddd4105b73e8f3857ad53d510e140b18bd46c1580fa88e` |
| TREASURY wallet | `0x975f1b348625cdb4f277efaefda1d644b17a4ffd97223892d93e93277fe19d4d` |
| TREASURY kiosk (v5.1 — unchanged) | `0x9a492e52f998a76c355d65b0aad2db3c35812837da36aed9666c7b2661dfdb36` |
| KioskOwnerCap (v5.1) | `0x668805a60262971d6044c1ad8c861dd6e0ce0d69bb93eda46690214d1820fed2` |

Royalty rule on v5.2 TransferPolicy: `amount_bp = 250` (2.5%), `min_amount = 1000` MIST. Matches v5.1 parity exactly.

v5.2 is a fresh publish — NOT an upgrade. The struct shape changed (WagerMatch added 4 fields). v5.1 package is superseded for new wagers but its bytecode + shared objects remain live for any v5.1-era settlement straggler. Supersede chain: `deployment.testnet-v5.2.json::supersedes`.

## v5.2 wager-fairness — what changed semantically

- `accept_wager` REMOVED. Replaced with the request → approve / decline / withdraw / cancel-expired-challenge handshake.
- New status `STATUS_PENDING_APPROVAL = 3` between WAITING and ACTIVE.
- ±1 level bracket enforced on `request_accept_wager` against the creator's snapshot at create time.
- `reclaim_stalled_wager` participant escape hatch (30-min `WAGER_RESOLUTION_TIMEOUT_MS`).
- Abort codes 12–23 added.

## Test wallets

- Mr_Boss `0xf669789c…0590f33` — v5.1 character minted (still usable; Character module unchanged in v5.2)
- Sx `0x03c33df0…443985f` — v5.1 character minted

## Pinata CIDs (catalog)

- Lv1 Common (Ponke set, 26 items): `bafybeib36hi7qupllhjymo2qnte2nghbiowkwxj2hb2fgbs5jly2ln3ida`
- Lv2 Uncommon (Scavenger set, 26 items): `bafybeidsjl6kihow5vzgssvoyjo2nvworbwhmk53f5vfe3wp56tqzzv4oq`

Both sets are minted under the v5.1 package's Item type. Player wallets can still HOLD them but they CANNOT be listed under the v5.2 TransferPolicy. A v5.2 catalog mint is a separate follow-up step.

## 13-slot loadout (unchanged from v5.1)

`weapon, offhand, helmet, chest, gloves, boots, belt, ring_1, ring_2, ring_3, necklace, pants, bracelets`. Same slots, same `slot_type` rules — v5.2 only touched arena.move.

## Where the canonical session state lives

- `STATE_OF_PROJECT_2026-05-30.md` — repo-root canonical snapshot (current)
- `STATE_OF_PROJECT_2026-05-29.md` — yesterday's snapshot (v5.1 QA complete; v5.2 spec drafted)
- `docs/V5.2_QA_GAUNTLET.md` — **live-testnet QA script for v5.2 — top-to-bottom run-list**
- `docs/V5.2_WAGER_FAIRNESS_SPEC.md` — v5.2 spec (with §14 implementation deviations)
- `deployment.testnet-v5.2.json` — v5.2 deploy record
- `deployment.testnet-v5.1.json` — v5.1 deploy record (kept for parity reference)
- `MAINNET_PREP.md` — deploy protocol + threat model + change log
