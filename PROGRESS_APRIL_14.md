# Progress — April 14, 2026

## What Was Done

### Contracts
- Redeployed all Move contracts with `image_url` field added to Item struct
- New Package ID: `0x7fd54c4d9294269f88e24a6e5912477910d024b3b7efbba16b18876d072f2303`
- 13/13 contract tests pass on testnet
- NFT admin wallet set up: `0xdbd3acbd6db16bdba55cf084ea36131bd97366e399859758689ab2dd686bcd60`

### On-Chain Items
- Minted Cursed Greatsword (Epic) with IPFS image — verified on Sui Explorer
- Items display in-game with image from IPFS
- On-chain items load into inventory on login
- Equip/unequip works with on-chain items, stats update correctly
- Item images show in equipment slots on character silhouette

### Character Persistence
- Character creation now mints soulbound NFT on Sui (wallet popup to sign)
- On login, frontend checks wallet for existing Character NFT
- Characters survive server restarts by loading from on-chain data

### Bugs Fixed
- Leaderboard loading — FIXED, shows rankings correctly
- Equip with on-chain items — FIXED, was only checking server inventory
- Stats not updating on equip — FIXED, merges on-chain equipped items
- Item image display in slots — FIXED, shows IPFS image in equipment slots

### What's Still Server-Side Only (NOT on-chain yet)
- Fight results (wins/losses/XP)
- Loot drops (like the Leather Jerkin)
- ELO rating changes
- Fight history

### Session 2 — April 14 (evening)

#### Character Persistence Fix
- Fixed infinite render loop that prevented on-chain character auto-restore after server restart
- Root cause: `useGameSocket` returned a new object reference every render, causing both useEffects in `game-provider.tsx` to re-run continuously — the 1500ms on-chain check timer was cleared and restarted on every render cycle and never fired
- Fix: memoized the `useGameSocket` return value with `useMemo` so the socket reference is stable

#### Chat & Join Message Fixes
- Fixed "has joined" spam — `handleDisconnect` now skips teardown for sessions already removed from `connectedClients` (replaced by a newer session), and `handleAuth` suppresses the join broadcast for reconnections
- Fixed chat messages not sending — the delayed close handler of old WebSocket sessions was calling `unregisterChatClient`, which wiped out the new session's chat registration. Same `handleDisconnect` guard fixes this.

#### On-Chain Item Equip/Unequip
- `EquipmentGrid` now merges `onChainEquipped` into the equipment display (was only reading server-side `character.equipment`)
- Equip/unequip in the grid properly routes on-chain items through `EQUIP_ONCHAIN_ITEM` / `UNEQUIP_ONCHAIN_ITEM` dispatches instead of always sending to server

#### Clickable Equipment Slots & Item Detail Modals
- New `ItemDetailModal` component — shows item image, name (rarity-colored), type, damage range, and all stat bonuses
- Character silhouette slots (`EquipSlot`) are now `<button>` elements with hover effects (brightness + scale for equipped, border highlight for empty)
- Clicking an equipped slot → opens `ItemDetailModal` with Unequip button
- Clicking an empty slot → opens modal listing compatible inventory items to equip
- Inventory items are now clickable → opens `ItemDetailModal` with equip slot choices (shows "Replaces: X" if slot occupied)
- All three interaction points (silhouette, equipment grid, inventory) work consistently for both on-chain and server items

#### Architecture Decision: Equip/Unequip Stays Off-Chain
- Equip/unequip operations are handled client-side (reducer dispatch) for on-chain items and server-side for server items — no wallet signature required
- Wallet approval popups are reserved for ownership/money changes only: buy/sell, stake SUI, mint NFTs, trade items
- This keeps gameplay fast and frictionless while ensuring real value transfers always require explicit user consent

### Remaining TODO
- Register Display object so NFTs show in Sui wallet
- Kiosk marketplace integration
- Real wager escrow with SUI
- Fight results on-chain
- Loot drops as NFT mints
- UI medieval theme redesign
- Deploy to production server
