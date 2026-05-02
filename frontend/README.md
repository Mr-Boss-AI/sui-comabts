# SUI Combats — Frontend

Next.js 16 (Turbopack) client. Connects to the game server over
WebSocket on port 3001 and signs on-chain transactions with the
connected Sui wallet via `@mysten/dapp-kit-react`.

> Project overview + deployment IDs + repo layout: see the [root
> README](../README.md). Canonical project state: [`STATUS.md`](../STATUS.md).

---

## Run

```bash
# One-time
cp .env.local.example .env.local   # fill in v5 ids
npm install

# Dev
npm run dev                        # starts on port 3000

# Production build
npm run build && npm start
```

Server (port 3001) must be running for the WebSocket handshake to
complete — `cd ../server && npm run dev`. See the root README for the
standard kill+start flow that brings up both at once.

---

## Required env vars

All `NEXT_PUBLIC_*` vars are read at module load. Missing values throw
on import — the app won't render. See `.env.local.example` for the
canonical list:

| Var | Purpose |
|---|---|
| `NEXT_PUBLIC_WS_URL` | WebSocket URL (default `ws://localhost:3001`). HTTP base derived automatically (ws:// → http://, wss:// → https://) for REST `adopt-wager` recovery. |
| `NEXT_PUBLIC_SUI_NETWORK` | `testnet` or `mainnet`. Used to select the JSON-RPC endpoint. |
| `NEXT_PUBLIC_SUI_PACKAGE_ID` | v5 package id. See root README. |
| `NEXT_PUBLIC_TREASURY_ADDRESS` | Wager-fee + listing-fee recipient. |
| `NEXT_PUBLIC_TRANSFER_POLICY_ID` | Required for the marketplace buy flow's royalty resolution. |

---

## Architecture (frontend-side)

- **`app/`** — App Router. `GameProvider` is the root context that
  owns the WS connection (`useGameSocket`), the reducer
  (`useGameStore`), and side-effects that read chain state
  (`fetchCharacterNFT`, `fetchOwnedItems`, `fetchKioskItems`).
- **`components/character/`** — character page, equipment doll, stat
  allocate modal, character creation form.
- **`components/fight/`** — fight arena, zone selector, HP bar, turn
  timer (with pause prop), opponent-disconnected banner, damage log,
  fight result modal.
- **`components/marketplace/`** — browser, my-kiosk panel,
  list/buy/delist modals.
- **`components/social/`** — chat panel, player list, leaderboard,
  challenge popup, fight history.
- **`components/items/`** — inventory, item card, item detail modal.
- **`components/layout/`** — game screen, navbar, town hub.
- **`components/ui/`** — buttons, cards, badges, error toast, modal,
  progress bar, stat bar.
- **`hooks/`** — `useGameSocket` (WS + auth), `useGameStore`
  (reducer + context), `useEquipmentActions` (PTB save-loadout +
  retrieve-from-kiosk + `humanizeChainError`), `useKiosk`,
  `useMarketplace`, `useMarketplaceActions`, `useWalletBalance`.
- **`lib/`** — `sui-contracts` (TX builders + `fetchCharacterNFT`
  with pinned-id fast-path), `loadout` + `loadout-tx`, `auth-phase`
  (state machine), `stat-points` (clamp + `applyLocalAllocate`),
  `wager-register` (WS ACK + REST fallback), `combat`,
  `sounds`.
- **`types/`** — `game` (Character, Item, Equipment, FightState),
  `ws-messages` (discriminated union of every server→client message).

The frontend never talks to the chain on mutation paths — every
state-changing tx is built locally as a PTB and signed by the user's
wallet. The server reads chain events to update its index. The
read-only chain queries (`fetchCharacterNFT`, etc.) use a lazy
`SuiJsonRpcClient` cached at module level.

---

## See also

- [`../STATUS.md`](../STATUS.md) — what works, what's deferred to v5.1
- [`../LOADOUT_DESIGN.md`](../LOADOUT_DESIGN.md) — D1–D5 loadout-save
  invariants (pending vs. committed, atomic PTB, chain-truth fight
  start)
- [`../DESIGN_BRIEF.md`](../DESIGN_BRIEF.md) — visual aesthetic brief
  for a future redesign (current UI is medieval-tavern; brief is
  meme-coin neon)
- [`../SUI_COMBATS_GDD.md`](../SUI_COMBATS_GDD.md) — combat math, XP
  curve, item economy

---

## Note about Next.js 16

This project is on Next.js 16 (Turbopack). APIs and conventions may
differ from older Next.js training data. See `AGENTS.md` /
`CLAUDE.md` for the contributor warning.
