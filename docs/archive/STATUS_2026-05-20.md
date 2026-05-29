# SUI Combats — Project Status

> **Superseded — see [`HANDOVER_2026-05-20.md`](./HANDOVER_2026-05-20.md)
> for the latest session wrap. Canonical longer-form state still lives
> in [`STATE_OF_PROJECT_2026-05-17.md`](./STATE_OF_PROJECT_2026-05-17.md).**
>
> Canonical state lives in dated `HANDOVER_<YYYY-MM-DD>.md` /
> `STATE_OF_PROJECT_<YYYY-MM-DD>.md` snapshots; this file is a one-line
> pointer kept for git-history continuity and bookmarks.
>
> Bucket pointer: Phase 2 visual-QA + polish track open on
> `feature/phase-2-design`. **Tonight (2026-05-20): Market gauntlet
> full pass — phantom-empty-kiosk bug closed via `9441d2c`,
> live-verified end-to-end including aggregate withdraw across orphan
> kiosks and dup-create block.** Phase A Sui-latest integration shipped
> 2026-05-17 — Enoki zkLogin (Google + Twitch) live in the wallet
> connect modal, Bug A wager-accept pre-flight balance check shipped,
> Bug B `FailedTransaction` branching shipped across every
> wallet-popup site via the new shared `frontend/src/lib/tx-result.ts`
> helper, Slush web wallet confirmed live via dApp Kit's built-in
> initializer. Track 4 (server gRPC migration) deferred to a focused
> session — the gRPC API is not signature-compatible with the
> JSON-RPC read methods we currently use. Apple OAuth provider
> deferred pending Enoki SDK support (its `AuthProvider` union does
> not yet include `'apple'`). Phase 3 v5.1 contract republish
> (Track B) still next, on its own branch when the user opens it —
> now bundles **KioskRegistry + `create_or_get_player_kiosk`** as
> the proper Move-side fix for the dup-kiosk invariant
> (`MAINNET_PREP.md` §C Contract layer).
>
> ## Polish backlog (logged 2026-05-20 — not bugs)
> - **A.** Empty primary kiosk after full withdraw — aggregation has no
>   tiebreaker once every kiosk goes to zero. Cosmetic; funds always
>   recoverable. Fix shape: prefer most-recently-minted cap, or hide
>   empty secondary kiosks behind a "N kiosks (1 active)" hint. ~30 min.
> - **B.** "Create my Kiosk" CTA doesn't auto-hide after successful
>   create. Dup-create pre-flight catches the second click on-chain,
>   so no harm — just a flash. Fix shape: local `creating` flag held
>   until `kiosk.loaded && kiosk.kiosks.length > 0`. ~10 min.
> - **C.** Mid-session zkLogin re-auth popup (saw "Signing you in…"
>   flicker during MrBoss buy). Not a market bug — session lifecycle.
>   Fix shape: instrument Enoki JWT expiry, proactive refresh
>   ≤2 min before expiry, optionally a `withZkLoginRefresh(...)`
>   wrapper symmetric to the `withTimeout(...)` pattern.
>
> For day-by-day change history see [`CHANGELOG.md`](./CHANGELOG.md).
