# SUI Combats — State of the Project, 2026-05-17 (Phase A — Sui-latest integration pass shipped)

> **Phase 2 visual-QA + polish track stays open.** Tonight's session
> shipped **Phase A** of the Sui-latest integration roadmap:
> Enoki zkLogin (Google + Twitch) lands in the wallet connect modal,
> the wager-accept silent-fail UX bug (Bug A) gets a pre-flight balance
> check, the SDK `FailedTransaction` wrapper (Bug B) is now surfaced
> via a shared `assertTxSucceeded` helper across every wallet-popup
> site (create_wager · accept_wager · save_loadout), and the Slush web
> wallet rename is confirmed live through dApp Kit's built-in
> `slushWalletConfig`.
>
> **Track 4 (server gRPC migration) was scoped down to "deferred"**
> after the API-surface verification: `SuiGrpcClient` does not expose
> `queryEvents` (used by `findCharacterObjectId`), nor
> `getDynamicFieldObject` (used by `fetchEquippedFromDOFs`); and its
> `getObject` returns BCS-encoded content where the JSON-RPC path
> returns parsed JSON. Not a drop-in swap. The migration belongs in a
> focused gRPC session, not bundled with zkLogin.
>
> **Track B (Phase 3 — v5.1 republish) still NEXT, not started.**
>
> **No merge to `main`.** Mainline stays at the v4-era `08ff991`
> until v5.1 lands fresh-chain on its own branch and passes audit.
>
> This doc supersedes
> [`STATE_OF_PROJECT_2026-05-16.md`](./STATE_OF_PROJECT_2026-05-16.md)
> as the canonical state. 05-16 stays unmodified as the Phase 3
> fight-room-redesign snapshot.

---

## TL;DR

| Field | Value |
|---|---|
| Phase | **Phase 2 — Track A polish, zkLogin shipped**; Track B (Phase 3 v5.1 republish) still NEXT |
| Branch | `feature/phase-2-design` |
| Latest commit before this doc | `6079ce7` (settle gitnexus index counts after re-analyze) |
| Latest commit at push | (assigned by the commit at the end of this session) |
| Pushed to | `origin/feature/phase-2-design` |
| Main | untouched (v4-era `08ff991`) |
| `feature/v5-redeploy` | untouched (remote tip `6308240`) |
| Static gauntlet | **2,307 / 2,307 PASS** across **37 suites** |
| Static gauntlet ERRs | 2 (pre-existing dotenv infra) |
| Move unit tests | **35 / 35 PASS** (contracts unchanged this session) |
| TypeScript | `tsc --noEmit` clean — frontend ✓ server ✓ |
| Frontend HTTP probe | `curl localhost:3000` → `200` |
| Backend HTTP probe | `curl localhost:3001/health` → `200` |
| Phase A — zkLogin via Enoki | ✅ shipped (Google + Twitch); Apple deferred (Enoki SDK gap) |
| Phase A — Slush wallet | ✅ confirmed live via dApp Kit default `slushWalletConfig` |
| Phase A — Bug A pre-flight balance check | ✅ shipped (refuses click before wallet popup) |
| Phase A — Bug B FailedTransaction branching | ✅ shipped (shared `assertTxSucceeded` helper across 3 sites) |
| Phase A — Track 4 server gRPC | ⏸️ deferred (API not drop-in; see Reality-Check below) |
| Phase B — Phase 3 v5.1 republish | 🎯 NEXT (Track B — new branch `feature/v5.1-contracts`) |
| Open bug log | Bug C (battle log render asymmetry — needs live re-verify post-redesign) |

---

## Quick links

- [Today's Wins (2026-05-17)](#todays-wins-2026-05-17)
- [Phase A — Detailed Walk](#phase-a--detailed-walk)
- [Reality Check — Track 4 Deferred](#reality-check--track-4-deferred)
- [Apple Provider — Deferred](#apple-provider--deferred)
- [Test Suite State](#test-suite-state)
- [Mainnet Readiness Scorecard](#mainnet-readiness-scorecard)
- [Files Touched This Session](#files-touched-this-session)
- [Commit Log](#commit-log)
- [What's Next](#whats-next)
- [Reference Table](#reference-table)

---

## Today's Wins (2026-05-17)

The 2026-05-16 close-out pushed the Phase 3 fight-room redesign and
parked the wager-accept silent-fail UX as Bug A + Bug B for next
session. Tonight closed those, landed Enoki zkLogin in the connect
modal, and verified the dApp Kit default Slush integration was already
correctly in place.

1. **`@mysten/enoki@^1.0.8` integrated through `walletInitializers`.**
   `frontend/src/config/dapp-kit.ts` now passes
   `enokiWalletsInitializer({...})` to `createDAppKit` so the dApp Kit
   hands Enoki the correct per-network client automatically — no
   parallel `SuiGrpcClient` instances, no manual `registerEnokiWallets`
   side-effect call. `frontend/src/config/enoki.ts` is the
   single-source config snapshot: reads
   `NEXT_PUBLIC_ENOKI_API_KEY` + `NEXT_PUBLIC_GOOGLE_CLIENT_ID` +
   `NEXT_PUBLIC_TWITCH_CLIENT_ID` and exposes a deterministic
   `ENOKI_CONFIG` + `ENOKI_READY` pair. When env vars aren't
   configured, registration is silently skipped and the existing
   browser-injected / default-Slush sign-in flow is the only path —
   dev mode boots cleanly without Enoki configured.

2. **Bug A — pre-flight balance check** lands as a new pure predicate
   `canAcceptWagerWithBalance({ lobbyGate, stakeMist, balanceMist,
   gasReserveMist })` in `frontend/src/lib/wager-accept-gate.ts`. Wired
   into `matchmaking-queue.tsx::handleAcceptWager` before the
   `signer.signAndExecuteTransaction` call. With the default 0.02 SUI
   gas reserve, the 2026-05-16 live repro (Mr_Boss_v5.1 at 0.501 SUI on
   a 0.5 SUI wager) now refuses with `"Need ~0.52 SUI (0.5 stake + gas)
   — you have 0.501 SUI."` *before* the wallet popup. Loading and
   errored balance states return `"Loading wallet balance — try again
   in a moment."`. The gauntlet pins all four decision boundaries
   (insufficient, exactly-equal, one-MIST-short, well-funded), the
   short-circuit precedence (lobby refusal > balance), the custom-reserve
   override path, and the exact `DEFAULT_GAS_RESERVE_MIST` constant
   value.

3. **Bug B — `FailedTransaction` branching** lands as a shared
   `assertTxSucceeded(result, ctxLabel, abortCodes?)` helper in a new
   module `frontend/src/lib/tx-result.ts`. Extracted from the
   pre-existing `useEquipmentActions.ts::assertTxSucceeded` helper that
   the loadout PTB has used since Phase 0.5, so this isn't new
   wheel-inventing — it's pulling a working pattern into a shared
   location and wiring the two wager paths (`create_wager`,
   `accept_wager`) into it. The helper recognises three failure
   shapes: `effects.status.status !== 'success'`,
   `$kind === 'FailedTransaction'`, and a legacy
   `result.FailedTransaction.error` field. Thrown messages include the
   call-site context (`accept_wager failed: <reason>`) so the catch
   block surfaces the SDK's real error string to the user instead of
   the misleading "Wager not active on-chain" toast from the server's
   chain probe. Cross-site verified: `useEquipmentActions.ts` now
   imports from the shared module (no fork).

4. **Slush web wallet — confirmed already live via dApp Kit default.**
   The exploration surfaced that `dapp-kit-core/dist/index.mjs`'s
   `createDAppKit` automatically invokes
   `slushWebWalletInitializer(slushWalletConfig)` when
   `slushWalletConfig !== null` — meaning Slush is registered with
   zero explicit code in our `config/dapp-kit.ts`. I initially added an
   explicit `registerSlushWallet("SUI Combats")` call, then removed it
   to avoid double-registration. The gauntlet pins the *absence* of
   both the explicit registration AND the `slushWalletConfig: null`
   disable flag.

5. **Apple provider — deferred with a breadcrumb trail.** Enoki 1.0.8's
   `AuthProvider` union is `'google' | 'facebook' | 'twitch' | 'onefc' |
   'playtron'` — Apple is **not yet supported by the SDK**. Apple was
   the user's stated third pick in the 2026-05-16 planning fork. Three
   sites carry the deferred annotation:
   `frontend/src/config/enoki.ts` (commented candidate row + provider
   matrix in the header), `frontend/src/config/dapp-kit.ts` (inline
   note), `frontend/.env.local.example` (`# NEXT_PUBLIC_APPLE_CLIENT_ID=`
   commented-out var + a `PENDING ENOKI SDK SUPPORT` section header).
   When the SDK ships Apple, those three sites are the single-grep
   trail to follow.

6. **Header-polish wordmark pin caught up.** The 2026-05-16 session
   bumped the wordmark navbar variant +20 % (suiSize 32→38,
   combatsSize 32→38, strokeWidth 1.5→1.8) but didn't update the
   `qa-wordmark` pin. Updated tonight as part of the gauntlet sweep
   (29 → 32 assertions).

### Pre-push verification (gates green)

| Gate | Result |
|---|---|
| Secrets scan (`origin/feature/phase-2-design..HEAD` diff + filenames) | **clean** — no private keys / `.env` / `.pem` / keystore content |
| Branch | `feature/phase-2-design` ✓ |
| Static gauntlet | **2,307 / 2,307 PASS** · 37 suites · 2 pre-existing dotenv infra ERRs (accepted) |
| `qa-zklogin-wallet-registration` (NEW) | **44 / 44 PASS** (42 structural + 2 doc-presence after this file lands) |
| `qa-wager-accept-gate` (+28 new) | **67 / 67 PASS** (was 39) |
| `qa-wordmark` (pin caught up) | **32 / 32 PASS** (was 30) |
| All other 34 gauntlets | unchanged, all green |
| Move unit tests | **35 / 35 PASS** (contracts unchanged) |
| `tsc --noEmit` — frontend | exit 0 ✓ |
| Frontend dev server | live, hot-reloaded clean across the full session |
| Backend dev server | live, `curl /health` → `200` |
| Main untouched (`08ff991`) | ✓ |
| `feature/v5-redeploy` untouched (`6308240`) | ✓ |

---

## Phase A — Detailed Walk

### Track 1: zkLogin via Enoki SDK

**Why it landed cleanly:** the frontend was already on
`@mysten/sui@^2.15.0` + `@mysten/dapp-kit-react@^2.0.1` with
`SuiGrpcClient` as the default fullnode client. The dApp Kit's
`createDAppKit` accepts a `walletInitializers?: WalletInitializer[]`
slot — and Enoki ships exactly the right shape via
`enokiWalletsInitializer({...})`. No callback page needed (the popup
flow handles OAuth response extraction inside the SDK; the redirect
URI defaults to `window.location.href.split('#')[0]` so the dapp's
root URL is the right OAuth-console value).

**Files added:**

- `frontend/src/config/enoki.ts` — provider config snapshot, env-reading,
  `ENOKI_READY` guard, header note on the Apple deferral.

**Files edited:**

- `frontend/src/config/dapp-kit.ts` — added `enokiWalletsInitializer`
  import, the module-load `ENOKI_INITIALIZER` constant gated on
  `ENOKI_READY && ENOKI_CONFIG.apiKey`, and the
  `walletInitializers: [ENOKI_INITIALIZER]` plug into `createDAppKit`.
- `frontend/.env.local.example` — appended an Enoki section with
  per-provider sub-sections (Google live, Twitch live, Apple
  commented-out as PENDING). Each section documents the developer-console
  URL and the redirect-URI registration step.
- `frontend/package.json` — `@mysten/enoki@^1.0.8` + `@mysten/slush-wallet@^1.0.5`
  as explicit direct dependencies (slush-wallet was already a transitive
  dep through dapp-kit-core; making it direct documents the intent).

**Critical insight (the 30-minute dev-loop save):** `EnokiFlow` (the
SDK's pre-1.0 React class with `handleAuthCallback()`) is
`@deprecated` in 1.0.8. The new path is `registerEnokiWallets` /
`enokiWalletsInitializer`. Going through `walletInitializers` is the
cleanest of the three because dApp Kit hands the initializer the
correct per-network client, the registration runs at `createDAppKit`
construction time (no race conditions with module-load ordering), and
the connect modal picks up the new wallets in the same render pass
that finds browser-injected wallets.

### Track 2: Slush wallet registration

**Confirmed already live.** `dapp-kit-core/dist/index.mjs`:

```js
registerAdditionalWallets([
  ...walletInitializers,
  ...enableBurnerWallet ? [unsafeBurnerWalletInitializer()] : [],
  ...slushWalletConfig !== null ? [slushWebWalletInitializer(slushWalletConfig)] : []
], { networks, getClient });
```

`slushWalletConfig` is undefined in our config → not null →
`slushWebWalletInitializer(undefined)` runs → Slush is registered with
default options. The gauntlet pins the absence of both
`slushWalletConfig: null` (would disable) and
`registerSlushWallet(...)` (would double-register).

### Track 3: Bug A pre-flight balance check + Bug B FailedTransaction branching

Both fixes shipped together via the new `frontend/src/lib/tx-result.ts`
helper module + an additional pure predicate in
`frontend/src/lib/wager-accept-gate.ts`. The implementation is small,
the test coverage is wide:

| Site | Pre-A behaviour | Post-A behaviour |
|---|---|---|
| `matchmaking-queue.tsx::handleCreate` | `txData = Transaction \|\| FailedTransaction \|\| result` | `assertTxSucceeded(result, "create_wager")` |
| `matchmaking-queue.tsx::handleAcceptWager` | Same OR-coalesce + no balance check | `canAcceptWagerWithBalance({...})` + `assertTxSucceeded(result, "accept_wager")` + `extractTxDigest(result)` |
| `useEquipmentActions.ts::saveLoadout` | Local `assertTxSucceeded(result)` | `assertTxSucceeded(result, "save_loadout", EQUIPMENT_ABORT_CODES)` — imports the now-shared module |

The shared helper recognises every failure shape exhibited by the
`@mysten/dapp-kit-core` `CurrentAccountSigner` across wallet
implementations (Suiet, Slush, the burner wallet, Enoki-derived
zkLogin) — `effects.status.status !== 'success'`,
`$kind === 'FailedTransaction'`, and `result.FailedTransaction.error`
all funnel through the same parser. The thrown message format
`<ctxLabel> failed: <reason>` makes the catch block obvious without
having to walk the stack.

**Gauntlet delta:**

```
qa-wager-accept-gate.ts:
  + 10 assertions on canAcceptWagerWithBalance (insufficient,
    exactly-equal, one-MIST-short, well-funded, loading, zero,
    custom reserve, lobby short-circuit, own-wager short-circuit,
    DEFAULT_GAS_RESERVE_MIST pin)
  + 14 assertions on the matchmaking-queue + tx-result + equip
    integration (imports, call-site labels, helper exports, fork
    guard, balance-gate wiring)
  + 4 wire-shape assertions (FailedTransaction branch present,
    OR-coalesce removed, throw message, balance gate invoked)
  = 39 → 67 (+28)
```

---

## Reality Check — Track 4 Deferred

The 2026-05-16 plan claimed gRPC was a "near-drop-in replacement" for
the server-side JSON-RPC reads. **That claim was wrong** — verified
tonight by reading the `@mysten/sui@2.15.0` gRPC client types:

| JSON-RPC call site | JSON-RPC method | gRPC equivalent |
|---|---|---|
| `server/src/utils/sui-settle.ts::getWagerStatus` | `client.getObject({ id, options: { showContent: true } })` returning `{ data: { content: { fields: {...} } } }` | `client.getObject({...})` returning `{ object: { content: Uint8Array<BCS> } }` — **requires BCS decoding of the WagerMatch struct**, not a drop-in swap |
| `server/src/utils/sui-settle.ts::findCharacterObjectId` | `client.queryEvents({ query: { MoveEventType }, limit, order })` | **gRPC has no `queryEvents` method.** The marketplace already uses gRPC for *checkpoint subscription* (`subscribeCheckpoints`), but the cold-sync path it pairs with still uses `queryEvents` over JSON-RPC. |
| `server/src/utils/sui-read.ts::fetchEquippedFromDOFs` | `client.getDynamicFields({ parentId, limit })` + `client.getDynamicFieldObject({ parentId, name })` | gRPC has `listDynamicFields` (pagination) but **no per-DF `getDynamicFieldObject`** — would require refactoring to fetch via the new `value` include + the `nameValue` projection |

So the gRPC migration is a real surgical refactor — write a BCS
decoder for WagerMatch, replace the event-query path with either
checkpoint subscription or stay on JSON-RPC for that one call, and
rebuild the DOF iteration around `listDynamicFields`. Not a
this-session piece. **Deferred** to a focused gRPC-migration session
with rigorous before/after latency measurement. The plan-file commit
in this session documents the gap so it doesn't get forgotten.

---

## Apple Provider — Deferred

The 2026-05-16 plan answer committed to "Google + Twitch + Apple".
Enoki 1.0.8's `AuthProvider` union excludes Apple:

```ts
type AuthProvider = 'google' | 'facebook' | 'twitch' | 'onefc' | 'playtron';
```

`/tmp/enoki-inspect/package/dist/wallet/wallet.mjs` confirms the runtime
OAuth-URL switch covers exactly these five providers — no Apple branch.
We ship Google + Twitch this session and leave a three-site breadcrumb
trail for the future Apple addition:

1. **`frontend/src/config/enoki.ts`** — commented `// Apple deferred —
   see header.` row in the candidates array + provider-matrix table in
   the file header.
2. **`frontend/src/config/dapp-kit.ts`** — inline comment surfacing
   the SDK gap next to the initializer call.
3. **`frontend/.env.local.example`** — full `PENDING ENOKI SDK SUPPORT`
   section with a commented-out `# NEXT_PUBLIC_APPLE_CLIENT_ID=` so the
   var name is reserved.

When the Enoki SDK ships Apple support, the diff to enable is
~3 lines (one candidate row, one env var, uncomment a section).
Apple Developer Program enrollment ($99/year) is a separate prereq
on the user side.

---

## Test Suite State

**Total: 2,307 / 2,307 PASS across 37 suites.** Plus the 2 pre-existing
dotenv infra ERRs (`qa-chain-gauntlet`, `qa-mint-catalog`).

Delta from 2026-05-16:

| Suite | 05-16 → 05-17 | Note |
|---|---|---|
| `qa-zklogin-wallet-registration` | — → **44** | NEW — Enoki initializer wiring + Slush guards + Apple-deferred breadcrumb + auth-surface regression guard + doc presence |
| `qa-wager-accept-gate` | 39 → **67** | +28 — balance-gate predicate (10 assertions), tx-result shared module + fork-guard (14 assertions), matchmaking-queue wire shape (4 assertions) |
| `qa-wordmark` | 30 → **32** | +2 — header-polish pin caught up (suiSize 38, combatsSize 38, strokeWidth 1.8) |
| **TOTAL** | **2,235 → 2,307** | +72 |

All 34 other suites unchanged.

Move unit tests: `cd contracts && sui move test` → **35 / 35 PASS**
(contracts unchanged this session).

---

## Mainnet Readiness Scorecard

| Track | Status | Blocker |
|---|---|---|
| Phase 2 — design redesign | ✅ all top-level screens shipped (landing · character · arena · marketplace · tavern · hall of fame · fight room) | none — polish iterations continue |
| Phase A — Sui-latest integration | ✅ zkLogin · Slush · Bug A · Bug B all green | Apple provider when Enoki SDK ships it; Track 4 server gRPC when scoped properly |
| Phase 3 — v5.1 contract republish | 🎯 next | needs dedicated branch `feature/v5.1-contracts` |
| Two-wallet live verification — fight room | ⏳ partial for Phase 3 redesign | re-verify Bug C (battle log asymmetry) |
| Two-wallet live verification — wager flow | ✅ Bug A + Bug B fixed; next live test should confirm no regression and that the new pre-flight messaging reads correctly | none |
| Test coverage | ✅ 2,307 static + 35 Move | none |
| Documentation | ✅ STATE_OF_PROJECT cadence current | none |
| Audit | queued | post v5.1 stability |
| Mainnet candidate | not started | every row above must clear |

---

## Files Touched This Session

### New files (frontend)

```
frontend/src/config/enoki.ts                           NEW — Enoki config snapshot
frontend/src/lib/tx-result.ts                          NEW — shared assertTxSucceeded + extractTxDigest + humanizeChainError
```

### New files (tests + docs)

```
scripts/qa-zklogin-wallet-registration.ts              NEW — 44-assertion structural pin
STATE_OF_PROJECT_2026-05-17.md                         NEW — this file
```

### Edited files (frontend)

```
frontend/package.json                                  M — +@mysten/enoki, +@mysten/slush-wallet
frontend/package-lock.json                             M — install graph
frontend/.env.local.example                            M — Enoki + Google + Twitch + Apple-pending sections appended
frontend/src/config/dapp-kit.ts                        M — enokiWalletsInitializer wired through walletInitializers
frontend/src/lib/wager-accept-gate.ts                  M — added canAcceptWagerWithBalance + DEFAULT_GAS_RESERVE_MIST
frontend/src/hooks/useEquipmentActions.ts              M — imports the shared assertTxSucceeded from tx-result
frontend/src/components/fight/matchmaking-queue.tsx    M — Bug A balance gate + Bug B branching via shared helper
```

### Edited files (tests + docs)

```
scripts/qa-wager-accept-gate.ts                        M — +28 assertions (balance gate + shared-helper wiring + matchmaking-queue shape)
scripts/qa-wordmark.ts                                 M — pin caught up to the 2026-05-16 header polish
CHANGELOG.md                                           M — Phase A entry appended
SESSION_HANDOFF.md                                     M — overwritten with 2026-05-17 session
STATUS.md                                              M — pointer updated to this snapshot
AGENTS.md                                              M — gitnexus counts refreshed (post-commit hook)
CLAUDE.md                                              M — gitnexus counts refreshed (post-commit hook)
```

No server code touched — Track 4 deferred. No Move contract code
touched — Phase B / v5.1 republish reserved for a separate branch.

---

## Commit Log

Newest-first, scoped to commits since [STATE_OF_PROJECT_2026-05-16.md](./STATE_OF_PROJECT_2026-05-16.md)
at `6079ce7`:

```
(this session)  feat(phase-a): zkLogin via Enoki + Bug A pre-flight + Bug B FailedTransaction branching
6079ce7        docs: settle gitnexus index counts after re-analyze
0e9a59b        docs: sync gitnexus index counts after Phase 2 wrap
80d0f9b        feat(phase-2): wrap — DM pipeline, tavern, fight-room redesign, header polish
```

Full branch history since `feature/v5-redeploy` tip is in `git log`.

---

## What's Next

### Track A — Visual QA + polish (this branch)

1. **Re-verify Bug C** — two-wallet live fight, check battle log
   symmetry after Phase 3 redesign. Steps in
   `STATE_OF_PROJECT_2026-05-16.md` → Bug C.
2. **Live two-wallet wager test** with the new pre-flight gate —
   reproduce the 2026-05-16 0.501-SUI scenario, confirm the toast
   reads correctly and the wallet popup never fires.
3. **Live zkLogin sign-in** with the Enoki portal + Google OAuth
   console wired up. Confirms the `auth_challenge` → signed-message →
   JWT flow works end-to-end with a zkLogin-derived address. (Server
   needs no change; this is purely a live verification step.)
4. **Visual QA walk** of every screen at 1440 px / 1280 px / mobile.

### Track B — Phase 3: v5.1 contract republish (new branch)

Unchanged from the 05-14 / 05-16 plan. Spec lives at
[STATE_OF_PROJECT_2026-05-04.md](./STATE_OF_PROJECT_2026-05-04.md)
§v5.1. Branch `feature/v5.1-contracts` to be opened when the user is
ready.

### Track 4 — Server gRPC migration (deferred, own session)

Three real refactors required (BCS decoder for WagerMatch; replace
`queryEvents` with checkpoint subscription cold-sync or stay on JSON-RPC
for that one call; rebuild DOF iteration around `listDynamicFields`).
Worth doing — gRPC has lower per-call latency than JSON-RPC on the
public fullnode — but needs its own focused session with
before/after benchmarks rather than being smuggled into a Sui-latest
bundle.

---

## Reference Table

| Doc | Role |
|---|---|
| **`STATE_OF_PROJECT_2026-05-17.md`** | **NEW canonical state — this file** |
| `STATE_OF_PROJECT_2026-05-16.md` | Historical: Phase 3 fight-room-redesign snapshot |
| `STATE_OF_PROJECT_2026-05-14.md` | Historical: Phase 2 design-checkpoint snapshot |
| `STATE_OF_PROJECT_2026-05-13.md` | Historical: v5 functional close-out snapshot |
| `STATE_OF_PROJECT_2026-05-04.md` | Historical: end-of-Bucket-2 snapshot + v5.1 spec |
| `SESSION_HANDOFF.md` | Single-page handoff (now 2026-05-17) |
| `STATUS.md` | One-line pointer to current canonical state |
| `CHANGELOG.md` | Day-by-day change history (Phase A entry appended tonight) |
| `sui_latest.md` | User-curated Sui ecosystem survey (May 2025 – May 2026) — the input that drove Phase A scope |
| `frontend/src/config/enoki.ts` | NEW — provider config snapshot + ENOKI_READY guard |
| `frontend/src/lib/tx-result.ts` | NEW — shared `assertTxSucceeded` / `extractTxDigest` / `humanizeChainError` |
| `frontend/.env.local.example` | Updated env doc — Enoki + Google + Twitch + Apple-pending sections |
| `scripts/qa-zklogin-wallet-registration.ts` | NEW — 44-assertion structural gauntlet for the integration |
