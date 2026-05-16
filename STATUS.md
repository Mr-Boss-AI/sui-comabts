# SUI Combats — Project Status

> **Superseded — see [`STATE_OF_PROJECT_2026-05-17.md`](./STATE_OF_PROJECT_2026-05-17.md) for canonical project state.**
>
> Canonical state lives in dated `STATE_OF_PROJECT_<YYYY-MM-DD>.md`
> snapshots; this file is now a one-line pointer kept for
> git-history continuity and the bookmarks people already have.
>
> Bucket pointer: Phase 2 visual-QA + polish track open on
> `feature/phase-2-design`. Phase A Sui-latest integration shipped
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
> (Track B) still next, on its own branch when the user opens it.
>
> For day-by-day change history see [`CHANGELOG.md`](./CHANGELOG.md).
