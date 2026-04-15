# SUI Combats — Knowledge Base

> Living reference for current project state. Updated April 14, 2026.

---

## Deployment

| Item | Value |
|------|-------|
| **Network** | Sui Testnet |
| **Package ID** | `0x7fd54c4d9294269f88e24a6e5912477910d024b3b7efbba16b18876d072f2303` |
| **Previous Package** | `0x3759b50226587fdcbdb157a533203735e2d0244535315bd6770839df63418444` |
| **UpgradeCap** | `0xd3d9ae865a17dc13f1bab9d88123ebd0f9ff99b7cad0f4d82a82ac6ee7ace87a` |
| **Publisher** | `0xd91b5d2477d842f027643a5fa6862cedb970bb624250b5f576d1de98688b7246` |
| **Deploy Tx** | `91dYe241tXexqzvKMQr4tUbtkVXaHUVazo3hqBcjxgBr` |
| **Deploy Date** | 2026-04-14 |

## Wallets

| Role | Address |
|------|---------|
| **Publisher / Player Test** | `0x3606cd88b355a0b45a859646d093ffb4a821fe2c955a99bd1936ebaa2c04e501` |
| **NFT Admin (minting)** | `0xdbd3acbd6db16bdba55cf084ea36131bd97366e399859758689ab2dd686bcd60` |

The NFT admin wallet is used for minting items and managing the marketplace. Its private key is in the sui keystore (alias: priceless-turquois).

## Move Contract Modules

| Module | Purpose | Status |
|--------|---------|--------|
| `character` | Soulbound character NFTs (key only, no store) | Deployed, tested |
| `item` | Tradeable item NFTs (key + store) with `image_url` field | Deployed, tested |
| `equipment` | Equip/unequip via dynamic object fields (10 slots) | Deployed, tested |
| `arena` | Wager escrow (create, accept, cancel, settle) | Deployed, tested |
| `marketplace` | Kiosk creation, item listing, TransferPolicy | Deployed, tested |

All 13/13 end-to-end tests passed on testnet (2026-04-14).

## Minted Items

| Item | Object ID | Rarity | Owner |
|------|-----------|--------|-------|
| Iron Sword | `0x9349e5989adf594cd61bb90a02bf96c91f68f3849822c3e39123c762e317ec6a` | Common | Admin |
| Cursed Greatsword | `0x7304487409441df6e0596ee40e5f28fa725d0aa9ba8565e89f726901cba2adee` | Epic | Player (0x3606...) |

## Architecture

```
Browser (Next.js 16) ──WebSocket──→ Game Server (Express + ws, port 3001)
  │                                      │
  │ @mysten/dapp-kit-react               │ In-memory state (resets on restart)
  │ Wallet signing for NFT mints         │ Fight resolution, matchmaking, chat
  │                                      │
  └── Sui Testnet (gRPC) ───────────────→ On-chain NFTs, wager escrow
```

## What's On-Chain vs Server-Side

| On-Chain (persists) | Server-Side (in-memory, resets) |
|---------------------|-------------------------------|
| Character NFTs (soulbound) | Character game state (gold, XP) |
| Item NFTs (tradeable) | Equipment assignment |
| Wager escrow | Fight resolution |
| Kiosk marketplace | Chat, matchmaking, presence |
| — | Leaderboards, fight history |

## Frontend Integration Points

- **Character creation** → mints soulbound NFT on Sui, then creates on server
- **Login** → checks wallet for existing Character NFT, auto-restores on server
- **Inventory** → merges server items + on-chain Item NFTs from wallet
- **Equip** → on-chain items handled client-side; server items via WebSocket
- **Item display** → shows `imageUrl` from on-chain data in cards and equipment slots

## Fixed Issues

- **Leaderboard not loading** — Fixed, rankings display correctly
- **Equip fails with on-chain items** — Fixed, on-chain items now equip locally via reducer
- **Stats not updating on equip** — Fixed, merges `onChainEquipped` into equipment for stat calc
- **Item images not showing in slots** — Fixed, `EquipSlot` renders `imageUrl` when available
- **Character lost on server restart** — Fixed, frontend restores from on-chain Character NFT

## Known Limitations

- Game state (gold, XP, wins, fight history) is in-memory only — lost on server restart
- On-chain equipment state is client-side only — not persisted between sessions
- No Display object registered — NFTs don't show metadata in Sui wallets
- Marketplace not connected to Kiosk contracts yet
- Wager fights use server-side gold, not real SUI escrow

## Config Files

| File | Purpose |
|------|---------|
| `frontend/.env.local` | `NEXT_PUBLIC_SUI_PACKAGE_ID`, `NEXT_PUBLIC_WS_URL` |
| `server/.env` | `SUI_PACKAGE_ID`, `PLATFORM_TREASURY`, `PORT` |
| `deployment.json` | All contract addresses, wallet info, test mints |
| `contracts/Published.toml` | Move package publish metadata |
