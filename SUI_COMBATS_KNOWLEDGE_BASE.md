# SUI Combats — Knowledge Base

> Living reference for current project state. Updated April 15, 2026.

---

## Deployment

| Item | Value |
|------|-------|
| **Network** | Sui Testnet |
| **Package ID** | `0x50a536845980969dfa54c274f437f9da426e58b1ea5f1f38fe79ff29e8a684fd` |
| **Previous Package** | `0x7fd54c4d9294269f88e24a6e5912477910d024b3b7efbba16b18876d072f2303` |
| **UpgradeCap** | `0xd3d9ae865a17dc13f1bab9d88123ebd0f9ff99b7cad0f4d82a82ac6ee7ace87a` |
| **Publisher** | `0xd91b5d2477d842f027643a5fa6862cedb970bb624250b5f576d1de98688b7246` |
| **Upgrade Date** | 2026-04-15 (v2 — TREASURY fix) |
| **Walrus Site** | Object `0xb8a80a92296751dc45aa3401b2042c18b050a039f2add33e5fd9387e2135b7e3` |
| **GitHub** | [github.com/Mr-Boss-AI/sui-comabts](https://github.com/Mr-Boss-AI/sui-comabts) (public) |

## Wallets

| Role | Address |
|------|---------|
| **Publisher / Player Test** | `0x3606cd88b355a0b45a859646d093ffb4a821fe2c955a99bd1936ebaa2c04e501` |
| **Dev / Treasury (5% fee)** | `0xdbd3acbd6db16bdba55cf084ea36131bd97366e399859758689ab2dd686bcd60` |

The dev wallet receives 5% platform fee from wager settlements. Its private key is in the local sui keystore (not committed to git).

## Move Contract Modules

| Module | Purpose | Status |
|--------|---------|--------|
| `character` | Soulbound character NFTs (key only, no store) | Deployed, tested |
| `item` | Tradeable item NFTs (key + store) with `image_url` field | Deployed, tested |
| `equipment` | Equip/unequip via dynamic object fields (10 slots) | Deployed, tested |
| `arena` | Wager escrow (create, accept, cancel, settle) — 5% fee to treasury | **Integrated into game flow** |
| `marketplace` | Kiosk creation, item listing, TransferPolicy | Deployed, tested |

All 13/13 end-to-end tests passed on testnet (2026-04-14). Contract upgraded 2026-04-15 to fix TREASURY address.

## Wager Escrow (arena.move) — Integrated

Real SUI is now locked on-chain for wager fights:

1. **Player A** selects wager amount (min 0.1 SUI) → wallet popup → `create_wager` locks SUI in shared `WagerMatch` object
2. **Matchmaking** pairs Player A with Player B on server
3. **Player B** receives accept prompt → wallet popup → `accept_wager` locks matching SUI
4. **Fight** plays out on server (zone-based PvP, same as ranked)
5. **Settlement** — server calls `settle_wager` → winner gets 95%, dev wallet gets 5%
6. **Timeout/Cancel** — 30s accept timeout; `cancel_wager` refunds Player A if unmatched

| Parameter | Value |
|-----------|-------|
| Minimum wager | 0.1 SUI (100,000,000 MIST) |
| Platform fee | 5% (500 BPS) |
| Treasury | `0xdbd3acbd6db16bdba55cf084ea36131bd97366e399859758689ab2dd686bcd60` |
| Accept timeout | 30 seconds |
| Settlement | Server calls via `sui client call` CLI |

## Minted Items

| Item | Object ID | Rarity | Owner |
|------|-----------|--------|-------|
| Iron Sword | `0x9349e5989adf594cd61bb90a02bf96c91f68f3849822c3e39123c762e317ec6a` | Common | Admin |
| Cursed Greatsword | `0x7304487409441df6e0596ee40e5f28fa725d0aa9ba8565e89f726901cba2adee` | Epic | Player (0x3606...) |

## Architecture

```
Browser (Next.js 16) ──WebSocket──→ Game Server (Express + ws, port 3001)
  │                                      │
  │ @mysten/dapp-kit-react               │ Supabase persistence
  │ Wallet signing for wagers + NFTs     │ Fight resolution, matchmaking, chat
  │                                      │ settle_wager via sui CLI
  └── Sui Testnet (gRPC) ───────────────→ On-chain NFTs, wager escrow
  │
  └── Walrus Sites (testnet) ──────────→ Decentralized frontend hosting
```

## What's On-Chain vs Server-Side

| On-Chain (persists) | Server-Side (Supabase + in-memory) |
|---------------------|-------------------------------|
| Character NFTs (soulbound) | Character game state (gold, XP) |
| Item NFTs (tradeable) | Equipment assignment |
| Wager escrow (real SUI) | Fight resolution |
| Kiosk marketplace | Chat, matchmaking, presence |
| — | Leaderboards, fight history |

## Frontend Integration Points

- **Character creation** → mints soulbound NFT on Sui, then creates on server
- **Login** → checks wallet for existing Character NFT, auto-restores on server; server verifies on-chain item ownership
- **Inventory** → merges server items + on-chain Item NFTs from wallet (deduped by ID, on-chain preferred)
- **Equip** → on-chain items handled client-side; server items via WebSocket
- **Wager fights** → `create_wager` wallet popup before queuing; `accept_wager` popup for opponent; `settle_wager` called by server after fight
- **Item display** → shows `imageUrl` from on-chain data in cards and equipment slots

## Fixed Issues

- **Leaderboard not loading** — Fixed, rankings display correctly
- **Equip fails with on-chain items** — Fixed, on-chain items now equip locally via reducer
- **Stats not updating on equip** — Fixed, merges `onChainEquipped` into equipment for stat calc
- **Item images not showing in slots** — Fixed, `EquipSlot` renders `imageUrl` when available
- **Character lost on server restart** — Fixed, frontend restores from on-chain Character NFT
- **Infinite render loop** — Fixed, memoized `useGameSocket` return value
- **Chat join spam** — Fixed, `handleDisconnect` skips teardown for replaced sessions
- **Duplicate item keys** — Fixed, dedup by ID preferring on-chain version
- **Ghost items after transfer** — Fixed, server verifies on-chain ownership on login

## Known Limitations

- Wager fights untested end-to-end with real wallets (need two browser tabs)
- Fight arena doesn't show opponent's equipped items visually during combat
- No Display object registered — NFTs don't show metadata in Sui wallets
- Marketplace not connected to Kiosk contracts yet
- Walrus testnet portal requires self-hosting (no public portal)
- Game state (gold, XP) partially persisted via Supabase but resets on fresh deploy

## Grant Application

- **File:** `GRANT_APPLICATION.md`
- **Target:** Sui Foundation — Hydropower Accelerator / Direct Strategic Investment
- **Ask:** $50,000 across 4 phases (16 weeks)
- **Status:** Draft complete, ready to submit

## Config Files

| File | Purpose |
|------|---------|
| `frontend/.env.local` | `NEXT_PUBLIC_SUI_PACKAGE_ID`, `NEXT_PUBLIC_WS_URL` |
| `server/.env` | `SUI_PACKAGE_ID`, `PLATFORM_TREASURY`, `PORT`, Supabase creds |
| `server/.env.example` | Template (no secrets) |
| `deployment.json` | Contract addresses, test mints |
| `contracts/Published.toml` | Move package publish metadata |
