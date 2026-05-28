# SUI Combats — v5.0 QA Audit + v5.1 Scope Definition

> **Date:** 2026-05-28
> **Branch:** `feature/phase-2-design` @ HEAD `80a13fd` (docs wip atop real fix `9441d2c`)
> **Mainline:** `main` still at v4-era `08ff991` — never merged
> **Standard applied:** "boil the ocean" — exhaustive, primary-source-driven, no padding, no hedging where the evidence is clear, explicit "I do not know" where it isn't.
> **Authoring posture:** I read the GDD, every state-of-project snapshot, MAINNET_PREP, every contract source, every server/frontend directory tree, every QA gauntlet name, every memory entry, plus this session's live evidence. Where this report says "✅ verified" that means a primary source (a session log, a live walk in a snapshot, or a passing gauntlet count) attests to it. Where it says "❌", no source attests.

---

## Table of Contents

- [PART 1 — Full v5.0 feature inventory](#part-1--full-v50-feature-inventory)
- [PART 2 — QA matrix](#part-2--qa-matrix)
- [PART 3 — Suggested additional testing before merge](#part-3--suggested-additional-testing-before-merge)
- [PART 4 — v5.1 scope & diff vs v5.0](#part-4--v51-scope--diff-vs-v50)
- [PART 5 — Gap analysis](#part-5--gap-analysis-am-i-missing-anything)
- [PART 6 — Honest recommendation](#part-6--honest-recommendation)
- [Appendix A — On-chain v5.0 deployment IDs](#appendix-a--on-chain-v50-deployment-ids)
- [Appendix B — QA gauntlet inventory](#appendix-b--qa-gauntlet-inventory)
- [Appendix C — Session-evidence index](#appendix-c--session-evidence-index)

---

# PART 1 — Full v5.0 feature inventory

Grouped by layer. Each row: feature, one-line description, primary source code locations. "Source" means the canonical implementation; not exhaustive call-sites.

## 1.1 Authentication & wallet connection

| # | Feature | Description | Source |
|---|---|---|---|
| 1.1.1 | Signed-challenge auth | Server issues `auth_challenge`, client signs personal message, server verifies via `verifyPersonalMessageSignature` (Ed25519 + zkLogin), issues JWT | `server/src/ws/handler.ts` (auth_* cases), `server/src/utils/sui-verify.ts::verifyAuthSignature` |
| 1.1.2 | JWT auth-resume across reconnects | Token refresh via `auth_token` message lets the WS re-bind to the prior wallet without re-signing | `server/src/ws/handler.ts` |
| 1.1.3 | dapp-kit wallet connect | Slush + Suiet + any browser-injected wallet via `@mysten/dapp-kit-react@^2.0.1` | `frontend/src/config/dapp-kit.ts` |
| 1.1.4 | Slush web wallet | Registered automatically by dapp-kit-core's default `slushWalletConfig` initializer — no explicit opt-in needed | dapp-kit default; pinned by `qa-zklogin-wallet-registration` |
| 1.1.5 | Enoki zkLogin (Google) | `enokiWalletsInitializer` wired through `walletInitializers`; Google OAuth → JWT → ZK proof → derived address | `frontend/src/config/enoki.ts`, `frontend/src/config/dapp-kit.ts` |
| 1.1.6 | Enoki zkLogin (Twitch) | Same path as Google; redirect URL pinned to `<origin>/auth/callback` | `frontend/src/app/auth/callback/page.tsx`, `frontend/src/config/enoki.ts` |
| 1.1.7 | Enoki redirect-callback page | Surfaces OAuth `error` / `error_description` if the popup lingers; prevents silent OAuth misconfig | `frontend/src/app/auth/callback/page.tsx` |
| 1.1.8 | Auth-phase state machine | Multi-stage `authPhase` (idle / challenge_pending / awaiting_sig / chain_check_pending / ok) prevents duplicate mint during auth-flicker (Block A Layer 1) | `frontend/src/lib/auth-phase.ts` |
| 1.1.9 | Server pre-mint guard | Second layer of duplicate-mint defence — server queries chain before accepting `create_character` from a wallet that may already have one (Block A Layer 2) | `server/src/ws/handler.ts` (handleCreateCharacter), `server/src/utils/sui-settle.ts::findCharacterObjectId` |
| 1.1.10 | Wallet-transition watcher | Clears 27 wallet-scoped state slices on connect-change via `RESET_WALLET_SCOPED` reducer (Bug 1) | `frontend/src/app/game-provider.tsx`, `frontend/src/hooks/useGameStore.ts` |
| 1.1.11 | Guest spectator mode | Unauthenticated WS path for landing's "Watch a Fight" CTA; server's `PRE_AUTH_TYPES` whitelist admits `spectate_fight` + `stop_spectating` | `frontend/src/components/spectate/`, `server/src/ws/pre-auth-types.ts` |

## 1.2 Character system

| # | Feature | Description | Source |
|---|---|---|---|
| 1.2.1 | Character NFT mint | Shared object; sender allocates 20 stat points across STR/DEX/INT/END | `contracts/sources/character.move::create_character` |
| 1.2.2 | Stat allocation | Owner-only; spends `unallocated_points` granted on level-up | `character.move::allocate_points` |
| 1.2.3 | Level-up & XP curve | `update_after_fight` auto-levels across thresholds (L1-L20, L20 = 1M XP) | `character.move::update_after_fight`, `xp_for_level` |
| 1.2.4 | Fight-lock DOF | Server sets `expires_at_ms` via `set_fight_lock`; equip/unequip aborts while locked. Caps to `MAX_LOCK_MS = 1h` | `character.move::set_fight_lock`, `is_fight_locked` |
| 1.2.5 | MAX_XP_PER_FIGHT bound | Caps admin-granted XP at 1000 per fight — bounds AdminCap-compromise blast radius | `character.move::MAX_XP_PER_FIGHT` |
| 1.2.6 | Loadout version counter | Bumped by `save_loadout`; indexer hint + replay-attack guard | `character.move::loadout_version`, `bump_loadout_version` |
| 1.2.7 | Level-up celebration modal | Server emits `character_leveled_up`; frontend pops modal with "Allocate Stat Points" CTA; multi-level merges into one modal | `server/src/ws/fight-room.ts`, `frontend/src/lib/level-up-display.ts`, `frontend/src/components/character/level-up-modal.tsx` |
| 1.2.8 | Stat-points clamp | `effectiveUnallocatedPoints` reconciles server XP ahead of chain (closes the original 2026-05-02 MoveAbort code 2 regression) | `frontend/src/lib/stat-points.ts` |
| 1.2.9 | Character restore on auth | Chain-queries owned `Character` NFT, pins canonical id to handle multi-character wallets | `server/src/ws/handler.ts` (restore_character), `Character.onChainObjectId` wire pin |
| 1.2.10 | DB-disk persistence fallback | Server saves character rows to JSON-on-disk in `server/.local-state/characters.json` when Supabase not configured — survives `pkill node` | `server/src/data/local-persistence.ts` |

## 1.3 Items & equipment

| # | Feature | Description | Source |
|---|---|---|---|
| 1.3.1 | Item NFT mint (admin) | TREASURY/AdminCap-gated `mint_item_admin` — 9 item types, 5 rarities, 13 stat-bonus fields, weapon damage range | `item.move::mint_item_admin` |
| 1.3.2 | MAX_BONUS hardening cap | Each stat bonus capped at 1000; level_req capped at 20 | `item.move::MAX_BONUS`, `MAX_LEVEL_REQ` |
| 1.3.3 | Dynamic-Object-Field equipment | 10 slots (weapon, offhand, helmet, chest, gloves, boots, belt, ring_1, ring_2, necklace); DOFs are single source of truth (no parallel Option<ID>) | `equipment.move::equip_*`, `unequip_*` |
| 1.3.4 | Equip / unequip primitives | Owner + fight-lock + type + level-req + slot-empty checks; transfers item back on unequip | `equipment.move` (10 equip × 10 unequip pairs) |
| 1.3.5 | save_loadout PTB | Final command in a stage-equip PTB; bumps `loadout_version`. One wallet popup per loadout change | `equipment.move::save_loadout`, `frontend/src/lib/loadout-tx.ts` |
| 1.3.6 | Two-handed weapon enforcement (Path A) | Frontend-only `TWO_HANDED_NAMES` allowlist + `evaluateTwoHandedConflict` both directions; chain enforcement deferred to v5.1 `slot_type` | `frontend/src/lib/two-handed-weapons.ts`, `frontend/src/lib/equipment-picker.ts` |
| 1.3.7 | Inventory sync | Server's `fetchEquippedFromDOFs` enumerates DOFs at auth + post-equip-tx polling | `server/src/utils/sui-read.ts::fetchEquippedFromDOFs` |
| 1.3.8 | Item display NFT | Sui Display object renders Pinata art in wallet extensions | `deployment.testnet-v5.json::Display<Item>` |
| 1.3.9 | NFT portrait picker | UI for selecting / showing item visuals across slots | `frontend/src/lib/nft-portrait.ts`, pinned by `qa-nft-portrait-picker` |

## 1.4 Combat

| # | Feature | Description | Source |
|---|---|---|---|
| 1.4.1 | Turn loop | 20s simultaneous-action turns; server resolves both attacks | `server/src/ws/fight-room.ts`, `server/src/game/combat.ts` |
| 1.4.2 | 5-zone attack/block | head / chest / stomach / belt / legs; attacker picks 1 zone (2 with dual-wield), defender picks 2 (3 with shield) | `server/src/game/combat.ts::resolveZones` |
| 1.4.3 | Damage roll | `[0.85, 1.0] × attack_power`, post-armor, post-defense (`2^(-defense/250)`), floor 1 | `combat.ts::computeDamage` |
| 1.4.4 | Crit + armor-pen | `crit_chance` from intuition; crit applies multiplier; 30% armor penetration on crits | `combat.ts` |
| 1.4.5 | Evasion | `evasion_chance` from dexterity; rolled before damage | `combat.ts` |
| 1.4.6 | Draw detection | Returns `{ finished: true, draw: true }` when `aDead && bDead` | `combat.ts:422` |
| 1.4.7 | Stat-derivation parity | Frontend `combat.ts` mirrors server math; pinned by `qa-combat-stats` (79 PASS) | `frontend/src/lib/combat.ts` vs server |
| 1.4.8 | Per-fight cumulative grace timer | Reconnect-grace budget is per-fight, not per-cycle — abusers run out, honest wifi blips get the full window | `server/src/ws/reconnect-grace.ts`, `qa-grace-budget` |
| 1.4.9 | Fight-pause on disconnect | Turn timer pauses while opponent is in grace window; resumes on reconnect | `server/src/ws/fight-pause.ts`, `qa-fight-pause` |
| 1.4.10 | Forfeit on grace timeout | Cumulative budget exhaustion ends the fight with the still-connected player as winner | `reconnect-grace.ts` |
| 1.4.11 | Spectate fight | `<SpectateView />` shows live zone picks + damage to non-participants | `frontend/src/components/spectate/`, server `spectate_fight` handler |
| 1.4.12 | ELO update on settle | Wager + ranked fights update `rating` via `calculateEloChange` | `server/src/utils/elo.ts`, `fight-room.ts:484` |
| 1.4.13 | XP reward by fight type | Different XP curves for friendly / ranked / wager; pinned by `qa-xp` (143 PASS) | `server/src/game/loot.ts::calculateXpReward` |
| 1.4.14 | Outcome modal replay-on-reconnect | Server caches per-wallet outcome (`recordRecentOutcome`); replays via `recent_fight_settled` for offline-at-settle players | `server/src/data/recent-outcomes.ts`, frontend `fight-outcome-ack.ts` |

## 1.5 Wager system (arena)

| # | Feature | Description | Source |
|---|---|---|---|
| 1.5.1 | `create_wager` | Player A deposits stake; emits `WagerCreated`; status WAITING | `arena.move::create_wager` |
| 1.5.2 | `accept_wager` | Player B deposits matching stake; status WAITING→ACTIVE; emits `WagerAccepted` | `arena.move::accept_wager` |
| 1.5.3 | `settle_wager` | TREASURY-only; 95% to winner, 5% platform fee; emits `WagerSettled` | `arena.move::settle_wager` |
| 1.5.4 | `cancel_wager` | Player A only; WAITING-only; full refund | `arena.move::cancel_wager` |
| 1.5.5 | `admin_cancel_wager` | TREASURY-only; WAITING → refund A; ACTIVE → 50/50 split (used for draws + orphan recovery) | `arena.move::admin_cancel_wager` |
| 1.5.6 | `cancel_expired_wager` | Anyone-callable; WAITING + 10min → refund A; ACTIVE + 10min → 50/50 | `arena.move::cancel_expired_wager` |
| 1.5.7 | Wager pre-flight simulation | Client simulates `accept_wager` before sign to surface "wager no longer WAITING" + balance gate | `frontend/src/lib/wager-preflight.ts`, `frontend/src/lib/wager-accept-gate.ts` |
| 1.5.8 | Balance gate | `canAcceptWagerWithBalance` refuses click before wallet popup when caller can't cover stake + estimated gas | `frontend/src/lib/wager-accept-gate.ts`, `DEFAULT_GAS_RESERVE_MIST` |
| 1.5.9 | Server-side wager-accept decision | `decideAcceptOutcome` — target-not-in-lobby / self-target / busy / status-not-active / proceed / autoRollback | `server/src/ws/wager-accept-gate.ts` |
| 1.5.10 | autoRollback (silent-accept defence) | If chain accept lands despite client gate AND caller is busy, admin-cancel both wagers + drop queue entry | `server/src/ws/handler.ts:1521` |
| 1.5.11 | Wager-accepted gate diagnostics | Every silent `sendError` now routes through `gateExit(reason)` with structured breadcrumb (Bug 7 from 2026-05-19) | `server/src/ws/handler.ts:1435` |
| 1.5.12 | Tx-digest finality wait (option c2, this session 2026-05-28) | `handleWagerAccepted` waits for `txDigest` to finalize on chain via `waitForTransaction` before probing wager status — closes the 2026-05-27/28 finality race | `server/src/utils/sui-settle.ts::waitForWagerTxFinality`, `server/src/ws/handler.ts:1505-1538` |
| 1.5.13 | `processingWagerAccepts` single-flight | Server-side set prevents duplicate `wager_accepted` notifications for the same wager from racing | `server/src/ws/handler.ts:1445` |
| 1.5.14 | Wager register WS-ACK | Frontend `wager-register.ts` confirms server got the lobby-add WS message via ACK; falls back to `/api/admin/adopt-wager` REST | `frontend/src/lib/wager-register.ts`, `qa-wager-register` |
| 1.5.15 | Orphan-wager recovery sweep | Boot-time scan of `wager_in_flight` table; auto-admin-cancels any stale rows (requires Supabase) | `server/src/data/orphan-wager-recovery.ts`, `qa-orphan-sweep` |
| 1.5.16 | Auto-cancel on disconnect | Server's WS disconnect handler admin-cancels open wagers for the leaving wallet | `server/src/ws/handler.ts` (disconnect path) — verified 2026-05-27 via session log |
| 1.5.17 | Treasury queue (single-flight) | Sequential FIFO for treasury-signed txs; prevents gas-coin contention | `server/src/utils/sui-settle.ts::treasuryQueue`, `qa-treasury-queue` |
| 1.5.18 | Wager stake input validation | String-bound input with submit-time parse; pinned by `qa-wager-form` (47 PASS) | `frontend/src/lib/wager-input.ts` |
| 1.5.19 | ARENA_ABORT_CODES humanizer | Maps Move abort codes 0-10 to user-friendly strings ("The wager is no longer waiting…") | `frontend/src/lib/arena-aborts.ts`, `qa-arena-aborts` |

## 1.6 Arena flows & matchmaking

| # | Feature | Description | Source |
|---|---|---|---|
| 1.6.1 | Friendly queue | No stakes, no rating change; XP reward only | `server/src/game/matchmaking.ts` |
| 1.6.2 | Ranked queue | ELO-paired matchmaking; rating + XP on settle | `matchmaking.ts`, `server/src/utils/elo.ts` |
| 1.6.3 | Wager lobby | Open-wager creation + accept-list UI | `frontend/src/components/fight/matchmaking-queue.tsx` |
| 1.6.4 | Multi-queue isolation gate (Fix 1) | Frontend `computeBusyState` + server `evaluateServerBusy` block "Enter Queue" when player has any active wager / queue / fight | `frontend/src/lib/busy-state.ts`, `server/src/ws/busy-state.ts`, `qa-multi-queue-isolation` (60 PASS) |
| 1.6.5 | Hide-busy render | `decideMatchmakingRender` hides irrelevant cards instead of greying them; pinned by `qa-busy-state-render` (23 PASS) | `frontend/src/lib/busy-state.ts` |

## 1.7 Marketplace / Kiosk

| # | Feature | Description | Source |
|---|---|---|---|
| 1.7.1 | `create_player_kiosk` | Mints shared Kiosk + transfers OwnerCap to sender | `marketplace.move::create_player_kiosk` |
| 1.7.2 | `list_item` | Charges flat 0.01 SUI listing fee to treasury; places + lists item at MIST price | `marketplace.move::list_item` |
| 1.7.3 | `delist_item` | Atomic delist + take + transfer back to seller (single PTB so item never stuck unlisted) | `marketplace.move::delist_item`, `frontend/src/hooks/useMarketplaceActions.ts` |
| 1.7.4 | `buy_item` | Buyer pays price + 2.5% royalty (separate Coin<SUI>); seller's kiosk collects price | `marketplace.move::buy_item` |
| 1.7.5 | 2.5% royalty via `royalty_rule` | Per-policy `Config { amount_bp, min_amount }`; floor 1000 MIST to prevent rounding-to-zero | `contracts/sources/royalty_rule.move` |
| 1.7.6 | TransferPolicy<Item> | Royalty rule attached at deploy; royalty balance accumulates in policy | `marketplace.move::setup_transfer_policy` |
| 1.7.7 | Cold-sync indexer | Server scans live wagers + listings on boot via gRPC `subscribeCheckpoints` + checkpoint cursor | `server/src/data/marketplace.ts` |
| 1.7.8 | Live marketplace stream | gRPC checkpoint subscription with auto-reconnect on stream terminate | `marketplace.ts` (logged via `[Marketplace]` lines in `/tmp/server.log`) |
| 1.7.9 | Multi-kiosk aggregation (2026-05-20 fix) | `useKiosk` enumerates every `KioskOwnerCap` the wallet owns; aggregates profits/listings/items across all kiosks; surfaces `capForKiosk(kioskId)` lookup | `frontend/src/hooks/useKiosk.ts`, `qa-kiosk-orphan` (46 PASS) |
| 1.7.10 | `buildWithdrawAllKioskProfitsTx` | Single PTB sweeps every kiosk's profits + batches every `Coin<SUI>` into one `transferObjects` | `frontend/src/hooks/useMarketplaceActions.ts` |
| 1.7.11 | createKiosk dup-create JS pre-flight | Queries owned `KioskOwnerCap` count before signing; refuses second-click with toast (chain-side fix deferred to v5.1 KioskRegistry) | `frontend/src/hooks/useMarketplaceActions.ts::createKiosk` |
| 1.7.12 | Per-item kiosk routing | `Item.kioskId` stamped by `fetchKioskItems`; delist/retrieve look up cap via `kiosk.capForKiosk(listing.kioskId)` | `frontend/src/hooks/useKiosk.ts` |
| 1.7.13 | Marketplace browser | Filter / sort / paginate listings; click to buy | `frontend/src/components/marketplace/marketplace-browser.tsx` |
| 1.7.14 | Buy modal | Royalty math visible, single-click buy | `frontend/src/components/marketplace/buy-listing-modal.tsx` |
| 1.7.15 | My-kiosk panel | Lists owned listings; withdraw / delist / retrieve actions | `frontend/src/components/marketplace/my-kiosk-panel.tsx` |
| 1.7.16 | Boot-retry + reconnect retry | `withChainRetry` per page; 5-attempt retry on silent gap-fill loss + full reconnect on exhaustion | `marketplace.ts`, `qa-marketplace` (63 PASS) |
| 1.7.17 | 22-item starter catalog | v5 Lv1-Lv5 starter items minted to mr_boss + sx kiosks | `deployment.testnet-v5.json` |
| 1.7.18 | 9-item Lv6-Lv8 catalog | v5.1 catalog minted to TREASURY kiosk for cross-build buy testing | `deployment.testnet-v5.json::nft_catalog_v5_1`, `qa-mint-catalog` (236 PASS) |

## 1.8 Tavern (social hub)

| # | Feature | Description | Source |
|---|---|---|---|
| 1.8.1 | Global chat | Room-based broadcast; pinned by `qa-tavern-handlers` (72 PASS) | `server/src/ws/chat.ts`, `server/src/ws/tavern-handlers.ts` |
| 1.8.2 | Presence with level-bucket sidebar | Player list grouped Novice/Early/Mid/High/Endgame/Hall-of-Fame; search + status filter | `server/src/data/presence.ts`, `frontend/src/components/social/player-sidebar.tsx`, `qa-tavern-sidebar` (42 PASS) |
| 1.8.3 | Player profile modal | 10-slot equipment doll + stats + W/L + ELO + recent fights | `frontend/src/components/social/player-profile-modal.tsx`, `frontend/src/components/social/mini-equipment-frame.tsx`, `qa-mini-equipment-frame` |
| 1.8.4 | DM channels | Canonical-pair channel IDs; bi-directional lookup; unread counter | `server/src/data/dm-channels.ts`, `qa-tavern-dm-channels` (51 PASS) |
| 1.8.5 | DM message persistence | Synthetic channel IDs; getHistory ordering; `qa-dm-messages` (53 PASS) | `server/src/data/dm-messages.ts` |
| 1.8.6 | DM send pipeline | Step-traced send with ensure-channel + cap retry + sendMessage timeout, plaintext variant | `frontend/src/lib/dm-send-pipeline.ts`, `frontend/src/lib/dm-plaintext-pipeline.ts`, `qa-dm-send-pipeline` (65 PASS), `qa-dm-plaintext-pipeline` (36 PASS) |
| 1.8.7 | Fight request (challenge) | Tavern → click player → challenge to fight; per-sender limit, stake-bound; pinned by `qa-tavern-fight-requests` (58 PASS) | `server/src/data/fight-requests.ts` |
| 1.8.8 | Presence tavern-presence gauntlet | `derivePlayerStatus` / `groupPlayersByLevelBucket` / `sweepStalePresence` (66 PASS) | `qa-tavern-presence` |
| 1.8.9 | Sui Stack Messaging SDK integration | Underlies the DM plaintext pipeline; alpha SDK with `withTimeout(...)` regression guards (per memory `feedback_alpha_sdk_timeouts.md`) | `frontend/src/lib/messaging.ts`, `qa-messaging-client` (65 PASS) |

## 1.9 Hall of Fame (leaderboard)

| # | Feature | Description | Source |
|---|---|---|---|
| 1.9.1 | Leaderboard data wire | `LeaderboardEntry` carries optional stats for build classifier | `server/src/data/leaderboard.ts`, `server/src/types.ts` |
| 1.9.2 | Sort comparator + tiebreakers | Pure comparator; toggle state machine for column clicks | `frontend/src/lib/hall-of-fame-sort.ts` |
| 1.9.3 | Composite filter | Level buckets (reused from Tavern) + build chips (Crit/Tank/Evasion/Hybrid via stat dominance) + name search | `frontend/src/lib/hall-of-fame-filter.ts` |
| 1.9.4 | Pagination + display | `paginateEntries`, `formatWinRatePct`, `rankColor` (gold/silver/bronze) | `frontend/src/lib/hall-of-fame-display.ts` |
| 1.9.5 | Click-through to profile | Row click opens `<PlayerProfileModal />`; full integration pinned by `qa-hall-of-fame` (187 PASS) | `frontend/src/components/social/leaderboard.tsx` |

## 1.10 Server infrastructure

| # | Feature | Description | Source |
|---|---|---|---|
| 1.10.1 | WebSocket router | Single `handler.ts` switch dispatching ~30 message types | `server/src/ws/handler.ts` |
| 1.10.2 | Pre-auth message whitelist | Defined in `pre-auth-types.ts`; restricts unauthenticated traffic to `spectate_fight` + `stop_spectating` + auth handshake | `server/src/ws/pre-auth-types.ts` |
| 1.10.3 | Reconnect-grace state machine | `markDisconnect` / `markReconnect` with cumulative budget per (wallet, fight); pinned by `qa-reconnect-grace` (35 PASS) | `server/src/ws/reconnect-grace.ts` |
| 1.10.4 | Recent-outcomes cache | Per-wallet last-settled fight cached; replayed on auth handshake; pinned by `qa-reconnect-modal` (31 PASS) | `server/src/data/recent-outcomes.ts` |
| 1.10.5 | Treasury queue with retry | Single-flight FIFO + bounded concurrency + retry-then-succeed; pinned by `qa-treasury-queue` (25 PASS) | `server/src/utils/sui-settle.ts` |
| 1.10.6 | Object-version retry | `Character.setFightLock` and `updateAfterFight` auto-retry on stale-version errors | `sui-settle.ts` |
| 1.10.7 | Optional Supabase persistence | Falls back to in-memory + JSON-on-disk when not configured | `server/src/data/supabase.ts`, `local-persistence.ts` |
| 1.10.8 | Unhandled-rejection safety nets | `unhandledRejection` + `uncaughtException` handlers in `index.ts` (Bug 7 from 2026-05-19) | `server/src/index.ts` |
| 1.10.9 | Admin REST endpoints | `/api/admin/cancel-wager`, `/grant-xp`, `/force-unlock`, `/repin-character`, `/adopt-wager` — testnet-only via `CONFIG.SUI_NETWORK !== 'mainnet'` guard | `server/src/index.ts:86-456` |
| 1.10.10 | `/health` + `/api/leaderboard` + `/api/character/:wallet` + `/api/fights/:fightId` | Read endpoints | `server/src/index.ts` |

## 1.11 Frontend infrastructure

| # | Feature | Description | Source |
|---|---|---|---|
| 1.11.1 | Game-provider context | Reducer + WS listener + level-up sound + outcome-modal coordinator | `frontend/src/app/game-provider.tsx` |
| 1.11.2 | useGameSocket | WS connection + JWT refresh + readyState gate + pending queue | `frontend/src/hooks/useGameSocket.ts` |
| 1.11.3 | Pending-send queue | Buffers sends while socket disconnected; drains on reconnect; >30s stale discard; cap 200 | `frontend/src/lib/ws-pending-queue.ts`, `qa-ws-readystate` (37 PASS) |
| 1.11.4 | useGameStore reducer | ~40 actions; `RESET_WALLET_SCOPED`, `SET_FIGHT`, `BEGIN_SERVER_REHYDRATE`, etc. | `frontend/src/hooks/useGameStore.ts` |
| 1.11.5 | useWalletBalance | Polled balance with loading/error states | `frontend/src/hooks/useWalletBalance.ts` |
| 1.11.6 | useEquipmentActions | Save-loadout, equip/unequip primitives, shared `assertTxSucceeded` | `frontend/src/hooks/useEquipmentActions.ts` |
| 1.11.7 | useMarketplaceActions / useMarketplace / useKiosk | List/buy/delist + browse + multi-kiosk aggregate | `frontend/src/hooks/useMarketplace*.ts`, `useKiosk.ts` |
| 1.11.8 | Shared `assertTxSucceeded` | Recognises Transaction / FailedTransaction / effects.status shapes; humanizes Move aborts | `frontend/src/lib/tx-result.ts` |
| 1.11.9 | Sound system | victory / defeat / level-up SFX | `frontend/src/lib/sounds.ts` |
| 1.11.10 | Visual redesign (Phase 2/3) | Fight room v1→v2→v3 layout iterations; navbar; wordmark; landing | `frontend/src/components/v2/`, `qa-fight-arena-layout`, `qa-layout-primitives`, `qa-v2-primitives`, `qa-wordmark` |
| 1.11.11 | Wallet-disconnect reset (Bug 1 fix) | `RESET_WALLET_SCOPED` clears 27 wallet-scoped slices | `frontend/src/hooks/useGameStore.ts`, `qa-wallet-disconnect-reset` (51 PASS) |
| 1.11.12 | Guest spectator landing | `<SpectatorLanding />` with unauthenticated WS; pinned by `qa-spectator-guest-flow` (29 PASS) | `frontend/src/components/landing/`, `qa-landing` (51 PASS) |
| 1.11.13 | Character presence check | `verifyServerHasCharacter` before every signing path (Bug 6 defence-in-depth) | `frontend/src/lib/character-presence-check.ts` |

## 1.12 On-chain (Move contracts)

| # | Feature | Description | Source |
|---|---|---|---|
| 1.12.1 | Five-module package | `character` / `item` / `equipment` / `arena` / `marketplace` / `royalty_rule` | `contracts/sources/*.move` |
| 1.12.2 | AdminCap | Single per-deploy capability minted to publisher; controls `update_after_fight`, `set_fight_lock`, `mint_item_admin`, `settle_wager`, `admin_cancel_wager` | `character.move::AdminCap`, `item.move::mint_item_admin` |
| 1.12.3 | One-time-witness Publisher | Item `ITEM` OTW for Display setup | `item.move::ITEM` |
| 1.12.4 | 37 Move unit tests (current) | character/item/equipment/arena test modules; last known passing 37/37 (HANDOVER 2026-05-20 ledger; STATE 05-17 cited 35/35 before the wager-race adds) | `contracts/tests/*.move` |
| 1.12.5 | Hardening caps already on chain | `MAX_XP_PER_FIGHT=1000`, `MAX_LOCK_MS=1h`, `MAX_BONUS=1000`, `MAX_LEVEL_REQ=20`, royalty floor `ROYALTY_MIN_MIST=1000`, listing fee `10_000_000 MIST` (0.01 SUI), wager fee `500 BPS` (5%) | All in `*.move` |

## 1.13 Cross-cutting safety nets

| # | Feature | Description | Source |
|---|---|---|---|
| 1.13.1 | Wager finality wait (this session) | `waitForTransaction` before `getWagerStatus` probe in `handleWagerAccepted` | `server/src/utils/sui-settle.ts::waitForWagerTxFinality` |
| 1.13.2 | gateExit breadcrumbs (Bug 7 fix) | Every silent `sendError` exit in `handleWagerAccepted` now emits structured log | `handler.ts:1435` |
| 1.13.3 | txDigest logging in WS payload | Frontend sends `txDigest` after sign; server logs it on every gateExit + probe | This session |
| 1.13.4 | Preflight raw-result dump | `simulateWagerTx` logs raw shape for finality / SDK-shape debugging | `frontend/src/lib/wager-preflight.ts` |

---

# PART 2 — QA matrix

Legend:
- ✅ **Tested + passing** — verified live (two-wallet browser walk) or by a passing static gauntlet that pins the behaviour
- ⚠️ **Tested + known issue** — known bug, with current status
- 🤔 **Partially tested** — gauntlet exists OR live-walked once but a meaningful path is unproven
- ❌ **Not tested** — no live walk AND no gauntlet pinning the meaningful surface

Cross-reference where the evidence comes from: gauntlet counts come from `STATE_OF_PROJECT_2026-05-17.md` + `HANDOVER_2026-05-20.md`; live walks from session handovers; this session's evidence from `/tmp/server.log`.

## 2.1 Authentication & wallet

| # | Feature | Status | Evidence |
|---|---|---|---|
| 1.1.1 | Signed-challenge auth | ✅ | Used in every session boot; pinned by `qa-character-mint` auth-phase tests |
| 1.1.2 | JWT auth-resume across reconnects | ✅ | Used live every session; verified `[WS] Client connected … auth_token` flows |
| 1.1.3 | dapp-kit wallet connect | ✅ | Slush / browser-wallet used live |
| 1.1.4 | Slush web wallet | ✅ | Live-verified 2026-05-17 (Phase A); `qa-zklogin-wallet-registration` (44 PASS) |
| 1.1.5 | Enoki zkLogin (Google) | ✅ | Live-verified 2026-05-17 (ShakaLiX minted on `0x03c33df0…` via Google OAuth) |
| 1.1.6 | Enoki zkLogin (Twitch) | 🤔 | Wiring pinned by gauntlet; **no live walk** per STATE_OF_PROJECT_2026-05-17 |
| 1.1.7 | Enoki redirect-callback page | ✅ | Live-tested during 05-17 fix patches |
| 1.1.8 | Auth-phase state machine | ✅ | `qa-character-mint` (63 PASS) + live boot every session |
| 1.1.9 | Server pre-mint guard | ✅ | `qa-character-mint` |
| 1.1.10 | Wallet-transition watcher | ✅ | `qa-wallet-disconnect-reset` (51 PASS) + 2026-05-18 live |
| 1.1.11 | Guest spectator mode | ✅ | `qa-spectator-guest-flow` (29 PASS) + 2026-05-18 live |

## 2.2 Character system

| # | Feature | Status | Evidence |
|---|---|---|---|
| 1.2.1 | Character NFT mint | ✅ | Move test `character_tests` + live every session |
| 1.2.2 | Stat allocation | ✅ | 4 live verifications across 2 wallets (STATE_OF_PROJECT_2026-05-04) |
| 1.2.3 | Level-up & XP curve | ✅ | `qa-xp` (143 PASS) + live Mr_Boss/Sx L3→L4→L5→L6 progression |
| 1.2.4 | Fight-lock DOF | ✅ | Move test `character_tests::set_fight_lock` + live during every wager fight |
| 1.2.5 | MAX_XP_PER_FIGHT bound | ✅ | Move test `character_tests::xp_too_high_aborts` |
| 1.2.6 | Loadout version counter | ✅ | Move test `equipment_tests::save_loadout_bumps_version` |
| 1.2.7 | Level-up celebration modal | 🤔 | `qa-level-up-modal` (44 PASS); **NOT live-verified** — too long an XP grind to repro in one session per STATE 05-04 |
| 1.2.8 | Stat-points clamp | ✅ | `qa-stat-points` (45 PASS) + closed the 2026-05-02 MoveAbort regression live |
| 1.2.9 | Character restore on auth | ✅ | Boot every session: `[DB] Restored character "MrBoss" for 0xf669789c…` |
| 1.2.10 | DB-disk persistence fallback | ✅ | Bug 6 fix 2026-05-19; live-verified restart-recovery; `qa-server-restart-recovery` (20 PASS) |

## 2.3 Items & equipment

| # | Feature | Status | Evidence |
|---|---|---|---|
| 1.3.1 | Item NFT mint (admin) | ✅ | 22 starter + 9 v5.1 catalog minted; Move tests `item_tests::mint_item_admin*` |
| 1.3.2 | MAX_BONUS hardening cap | ✅ | Move test `item_tests::bonus_too_high_aborts` |
| 1.3.3 | DOF equipment | ✅ | Move tests `equipment_tests::*` (8 tests) + live every loadout-save session |
| 1.3.4 | Equip / unequip primitives | ✅ | Move tests `equipment_tests` + live |
| 1.3.5 | save_loadout PTB | ✅ | Move test + live every save; `LOADOUT_DESIGN.md` D3 = "strict" path verified |
| 1.3.6 | Two-handed weapon enforcement (Path A) | ⚠️ | Frontend-only; **chain-side enforcement DEFERRED to v5.1 `slot_type`.** `qa-equip-picker` (78 PASS) + live both directions 2026-05-04. **Safety net: chain accepts dual-mainhand stacking; only frontend prevents it.** |
| 1.3.7 | Inventory sync | ✅ | Used live every session; pinned by `qa-equip-picker` |
| 1.3.8 | Item display NFT | ✅ | Live: Pinata art renders in Slush wallet extension |
| 1.3.9 | NFT portrait picker | ✅ | `qa-nft-portrait-picker` |

## 2.4 Combat

| # | Feature | Status | Evidence |
|---|---|---|---|
| 1.4.1 | Turn loop | ✅ | Live every fight |
| 1.4.2 | 5-zone attack/block | ✅ | Live; pinned by combat resolver tests |
| 1.4.3 | Damage roll | ✅ | `qa-combat-stats` (79 PASS) + counter-triangle live test 2026-05-03/04 |
| 1.4.4 | Crit + armor-pen | ✅ | Counter-triangle live (Crit vs Evasion 12-8 / 60-40 over 20 fights) |
| 1.4.5 | Evasion | ✅ | Counter-triangle live |
| 1.4.6 | Draw detection | ⚠️ | Detection works; **chain settlement broken + UI mis-renders ("You Lose" both sides).** Live-reproduced 2026-05-28 (wager `0xf2f3982266…`, fight `87ce91b9`, refunded via `admin_cancel_wager` tx `9YPY7K9yNWeNbdvryhHyJAXVoyH3bTJtpsQ56sz5E37x`). **DEFERRED to v5.1 — has safety net (manual admin refund).** |
| 1.4.7 | Stat-derivation parity | ✅ | `qa-combat-stats` pins server↔frontend parity |
| 1.4.8 | Per-fight cumulative grace timer | ✅ | `qa-grace-budget` (46 PASS) + 3-cycle live verification (60s→14s→9s forfeit) 2026-05-03 |
| 1.4.9 | Fight-pause on disconnect | ✅ | `qa-fight-pause` (46 PASS) + live |
| 1.4.10 | Forfeit on grace timeout | ✅ | Live |
| 1.4.11 | Spectate fight | 🤔 | Code exists; `qa-spectator-guest-flow` covers guest path. **Authenticated-user spectator path not heavily exercised in QA** per STATE 05-04 |
| 1.4.12 | ELO update on settle | ✅ | Live every wager/ranked settle |
| 1.4.13 | XP reward by fight type | ✅ | `qa-xp` (143 PASS) |
| 1.4.14 | Outcome modal replay-on-reconnect | ✅ | `qa-reconnect-modal` (31 PASS) + 2026-05-03 live (Mr_Boss/Sx mirror) |

## 2.5 Wager system

| # | Feature | Status | Evidence |
|---|---|---|---|
| 1.5.1 | `create_wager` | ✅ | Move tests `arena_tests` + live many sessions |
| 1.5.2 | `accept_wager` | ✅ | Move tests + live |
| 1.5.3 | `settle_wager` | ✅ | Move tests + live every winning wager (`6GXYErCehm6yUtYc…` settled this session prior to draw bug) |
| 1.5.4 | `cancel_wager` (player) | ✅ | Move tests + live (Sx 2026-05-27 `0x76df194bd5…`) |
| 1.5.5 | `admin_cancel_wager` | ✅ | Live: refunded `0xf3aae8c5468e`, `0x0c24213f9f59`, `0xf2f3982266…` this week + `0xeade9b…` 2026-05-04 + ACTIVE 50/50 split working as designed |
| 1.5.6 | `cancel_expired_wager` | 🤔 | Move test `arena_tests::test_cancel_expired_after_timeout`. **No live walk** — testnet QA sessions cancel via admin endpoint before the 10-min timeout fires |
| 1.5.7 | Wager pre-flight simulation | ✅ | `qa-wager-accept-race`, `qa-arena-aborts` + live (2026-05-18 EMatchNotWaiting race closed; 2026-05-28 SDK-shape post-mortem) |
| 1.5.8 | Balance gate | ✅ | `qa-wager-accept-gate` (67 PASS) + live the 0.501 SUI scenario 2026-05-17 |
| 1.5.9 | Server-side wager-accept decision | ✅ | `qa-wager-accept-gate` |
| 1.5.10 | autoRollback | 🤔 | Unit-only (`qa-wager-accept-gate`). **No live repro** — needs hand-crafted PTB bypass; v5.1 `OpenWagerRegistry` will subsume |
| 1.5.11 | Wager-accepted gate diagnostics (Bug 7) | ✅ | `qa-wager-accepted-diagnostics` (19 PASS) + this session's logs confirm breadcrumbs fire |
| 1.5.12 | Tx-digest finality wait (option c2) | ✅ | Live-verified this session (2026-05-28): wager `0xf2f3982266cf` log shows `tx-finality confirmed digest=GujWTN9coWjBKB … proceeding to status probe` followed by `chain probe ok … status=1` and proceed-complete |
| 1.5.13 | `processingWagerAccepts` single-flight | ✅ | Pinned by `qa-wager-accept-gate` + live during 2026-05-19 Bug 7 work |
| 1.5.14 | Wager register WS-ACK | ✅ | `qa-wager-register` (25 PASS); recovered the 2026-05-04 silent-WS-loss orphan live |
| 1.5.15 | Orphan-wager recovery sweep | 🤔 | `qa-orphan-sweep` (30 PASS). **Live test gated on Supabase provisioning** — boot-time row-scan path requires the persisted table |
| 1.5.16 | Auto-cancel on disconnect | ✅ | Live-verified 2026-05-27: Mr_Boss tab-close → `[Wager] Admin-cancelling 0xf3aae8c5468e…` → refund |
| 1.5.17 | Treasury queue (single-flight) | ✅ | `qa-treasury-queue` (25 PASS) + live every settle |
| 1.5.18 | Wager stake input validation | ✅ | `qa-wager-form` (47 PASS) + 2026-05-03 live "clearable input" fix |
| 1.5.19 | ARENA_ABORT_CODES humanizer | ✅ | `qa-arena-aborts` |

## 2.6 Arena flows

| # | Feature | Status | Evidence |
|---|---|---|---|
| 1.6.1 | Friendly queue | 🤔 | Live-walked at least once in early v5 sessions, but **not heavily QA'd recently**. Same code path as ranked minus ELO/XP weighting. |
| 1.6.2 | Ranked queue | 🤔 | Same caveat — live-walked but not in recent matrices. |
| 1.6.3 | Wager lobby | ✅ | Heavily exercised in every session |
| 1.6.4 | Multi-queue isolation gate (Fix 1) | ✅ | `qa-multi-queue-isolation` (60 PASS) + 2026-05-04 live |
| 1.6.5 | Hide-busy render | ✅ | `qa-busy-state-render` (23 PASS) + 2026-05-04 live (Mr_Boss/Sx mirror) |

## 2.7 Marketplace

| # | Feature | Status | Evidence |
|---|---|---|---|
| 1.7.1 | `create_player_kiosk` | ✅ | Live + 2026-05-20 dup-create JS gate live-verified |
| 1.7.2 | `list_item` | ✅ | Live 12-test gauntlet (STATE 05-04 Bucket 1) |
| 1.7.3 | `delist_item` | ✅ | Atomic delist live-verified 2026-05-20 (Skullsplitter re-list / delist cycle) |
| 1.7.4 | `buy_item` | ✅ | Live cross-build buys (Sx evasion buys Shadowstep Wraps + Pendant of Wrath + Skullsplitter; Mr_Boss buys Skullsplitter from Sx) |
| 1.7.5 | 2.5% royalty | ✅ | Live + 2026-05-20 royalty math audit (additive, buyer pays price + royalty) |
| 1.7.6 | TransferPolicy<Item> | ✅ | Deploy artefact + live royalty flow |
| 1.7.7 | Cold-sync indexer | ✅ | Live every boot |
| 1.7.8 | Live marketplace stream | ✅ | `[Marketplace] Live stream active` in every session log |
| 1.7.9 | Multi-kiosk aggregation | ✅ | `qa-kiosk-orphan` (46 PASS) + 2026-05-20 live phantom-empty-kiosk verification |
| 1.7.10 | `buildWithdrawAllKioskProfitsTx` | ✅ | Live: ShakaLiX withdrew 0.2 + 0.1 SUI in single signature on 2026-05-20 |
| 1.7.11 | createKiosk dup-create JS pre-flight | ✅ | Live: 2nd "Create my Kiosk" click → "You already own a Kiosk — refresh" |
| 1.7.12 | Per-item kiosk routing | ✅ | `qa-kiosk-orphan` (46 PASS) |
| 1.7.13 | Marketplace browser | ✅ | Live |
| 1.7.14 | Buy modal | ✅ | Live |
| 1.7.15 | My-kiosk panel | ✅ | Live |
| 1.7.16 | Boot-retry + reconnect retry | ✅ | `qa-marketplace` (63 PASS) |
| 1.7.17 | 22-item starter catalog | ✅ | Live on chain since 2026-04-27 |
| 1.7.18 | 9-item Lv6-Lv8 catalog | ✅ | `qa-mint-catalog` (236 PASS) + cross-build live |

**Bucket 1 Marketplace 12-test gauntlet (HANDOVER_2026-05-20 §3): 10/12 ✅, 2 DEFERRED**
- DEFERRED: Buy-own-listing (Sui Kiosk likely blocks at chain level; low value)
- DEFERRED: TransferPolicy royalty withdraw UI (no UI yet, backlog item)
- DEFERRED: Empty-state listings UI (cosmetic)

## 2.8 Tavern

| # | Feature | Status | Evidence |
|---|---|---|---|
| 1.8.1 | Global chat | ✅ | `qa-tavern-handlers` (72 PASS) + 2026-05-13 live |
| 1.8.2 | Presence sidebar | ✅ | `qa-tavern-presence` (66 PASS) + `qa-tavern-sidebar` (42 PASS) + 2026-05-13 live (2-online counter symmetric) |
| 1.8.3 | Player profile modal | ⚠️ | `qa-mini-equipment-frame` + 2026-05-13 live; **stat-DOF hydration race confirmed** — stats read pre-hydration, refresh fixes. Same class as "equipped items invisible at fight start". DEFERRED polish. |
| 1.8.4 | DM channels | ✅ | `qa-tavern-dm-channels` (51 PASS) + 2026-05-13 live |
| 1.8.5 | DM message persistence | ✅ | `qa-dm-messages` (53 PASS) + 2026-05-13 live (plaintext delivery end-to-end) |
| 1.8.6 | DM send pipeline | ⚠️ | `qa-dm-send-pipeline` (65 PASS) + `qa-dm-plaintext-pipeline` (36 PASS). **Two known UX issues** per STATE 05-04 carry: (a) DM modal closes/loses focus after Send; (b) DM notification surfacing weak when other modals open |
| 1.8.7 | Fight request | 🤔 | `qa-tavern-fight-requests` (58 PASS). **Live exercise unclear** — not in recent live-walk inventories |
| 1.8.8 | Tavern presence sweep | ✅ | `qa-tavern-presence` |
| 1.8.9 | Sui Stack Messaging SDK | ✅ | `qa-messaging-client` (65 PASS) + memory-pinned `withTimeout(...)` regression guard |

## 2.9 Hall of Fame

| # | Feature | Status | Evidence |
|---|---|---|---|
| 1.9.1 | Leaderboard data wire | ✅ | `qa-hall-of-fame` (187 PASS) |
| 1.9.2 | Sort comparator + tiebreakers | ✅ | `qa-hall-of-fame` |
| 1.9.3 | Composite filter | ✅ | `qa-hall-of-fame` |
| 1.9.4 | Pagination + display | ✅ | `qa-hall-of-fame` |
| 1.9.5 | Click-through to profile | 🤔 | Pinned by gauntlet; **live UI verification deferred** per STATE 05-13 (only 2 entries on the live board) |

## 2.10 Server infrastructure

| # | Feature | Status | Evidence |
|---|---|---|---|
| 1.10.1 | WebSocket router | ✅ | Used every session |
| 1.10.2 | Pre-auth message whitelist | ✅ | `qa-spectator-guest-flow` (29 PASS) + 2026-05-18 live |
| 1.10.3 | Reconnect-grace state machine | ✅ | `qa-reconnect-grace` (35 PASS) |
| 1.10.4 | Recent-outcomes cache | ✅ | `qa-reconnect-modal` (31 PASS) |
| 1.10.5 | Treasury queue with retry | ✅ | `qa-treasury-queue` (25 PASS) |
| 1.10.6 | Object-version retry | ✅ | Live: this session's log shows `version unavailable for consumption … retry attempt 2 succeeded` |
| 1.10.7 | Optional Supabase persistence | 🤔 | Server runs in-memory live; **Supabase boot-sweep path code-complete, untested live** (no Supabase provisioned) |
| 1.10.8 | Unhandled-rejection safety nets | ✅ | Bug 7 fix verified 2026-05-19 |
| 1.10.9 | Admin REST endpoints | 🤔 | All exist and respond on testnet. **No audit confirming each one 403s on mainnet** — STATE 05-04 Blocker #10 |
| 1.10.10 | Read endpoints | ✅ | Used live |

## 2.11 Frontend infrastructure

| # | Feature | Status | Evidence |
|---|---|---|---|
| 1.11.1 | Game-provider | ✅ | Used live |
| 1.11.2 | useGameSocket | ✅ | Used live; pinned by `qa-ws-readystate` |
| 1.11.3 | Pending-send queue | ✅ | `qa-ws-readystate` (37 PASS) + 2026-05-04 server-kill live verification |
| 1.11.4 | useGameStore | ✅ | Used live every session |
| 1.11.5 | useWalletBalance | ✅ | Used live; balance gate pins it |
| 1.11.6 | useEquipmentActions | ✅ | Used live |
| 1.11.7 | useMarketplace / useKiosk | ✅ | `qa-kiosk-orphan` (46 PASS) + live |
| 1.11.8 | Shared `assertTxSucceeded` | ⚠️ | Works due to `$kind: "Transaction"` short-circuit but reads wrong field path post SDK 2.16 — see this session's findings. **Latent foot-gun; v5.1 hardening item.** |
| 1.11.9 | Sound system | ✅ | Heard live |
| 1.11.10 | Visual redesign | ✅ | `qa-wordmark` (32 PASS), `qa-fight-arena-layout`, `qa-v2-primitives`, `qa-layout-primitives` |
| 1.11.11 | Wallet-disconnect reset | ✅ | `qa-wallet-disconnect-reset` (51 PASS) |
| 1.11.12 | Guest spectator landing | ✅ | `qa-landing` (51 PASS) + 2026-05-18 live |
| 1.11.13 | Character presence check | ✅ | 2026-05-19 Bug 6 live verification |

## 2.12 On-chain

| # | Feature | Status | Evidence |
|---|---|---|---|
| 1.12.1 | Five-module package | ✅ | Live on testnet since 2026-04-27 |
| 1.12.2 | AdminCap | ✅ | Used by server for every admin call |
| 1.12.3 | OTW Publisher | ✅ | Display objects created at deploy |
| 1.12.4 | Move unit tests | ✅ | 35-37 / 35-37 PASS (count drifted with 05-18 wager-race additions) |
| 1.12.5 | Hardening caps | ✅ | All present in source; Move tests pin abort behaviour |

## 2.13 Cross-cutting safety nets (this session)

| # | Feature | Status | Evidence |
|---|---|---|---|
| 1.13.1 | Wager finality wait | ✅ | This session 2026-05-28; live-verified next fast-accept cycle |
| 1.13.2 | gateExit breadcrumbs | ✅ | Bug 7 fix 2026-05-19 |
| 1.13.3 | txDigest logging | ✅ | This session 2026-05-27 |
| 1.13.4 | Preflight raw-result dump | ✅ | This session 2026-05-27 |

---

# PART 3 — Suggested additional testing before merge

I treat "merge" here as the question "should this branch (`feature/phase-2-design`) merge into another testnet integration branch, or into `main`?" — the standing rule (per every state-of-project + STATE_OF_PROJECT_2026-05-17 §Branch state) is **no merge to `main` until v5.1 republish lands**. So the actionable question is: **what should we live-walk before declaring `feature/phase-2-design` "v5.0 testnet complete" and opening the `feature/v5.1-contracts` branch?**

For every ⚠️ and ❌/🤔 in Part 2:

## 3.1 Mandatory-to-test before declaring v5.0 done

### A. Twitch zkLogin live (1.1.6 — 🤔)
- **Why now:** the only un-walked auth path. Phase A wrap shipped both Google + Twitch, but only Google has a live receipt.
- **Repro:**
  1. Open `/auth/callback` redirect URI on the Twitch app dashboard
  2. From a fresh browser profile (no Slush session) click "Sign in with Twitch" in the connect modal
  3. Confirm OAuth → JWT → ZK proof → derived address surfaces in the navbar
  4. Mint a character; equip + fight one ranked match; confirm `update_after_fight` lands
- **Expected:** identical flow to Google. If it works, ship; if it doesn't, the wiring is identical so failures here likely indicate a redirect-URI registration gap.

### B. Level-up modal live verification (1.2.7 — 🤔)
- **Why now:** unit tests pass but the modal has never been seen in a live fight. ~3000 XP for L6→L7 — feasible in one focused session.
- **Repro:**
  1. Mr_Boss at L6 (~10000 XP); Sx at L6 (~10000 XP)
  2. Run 6-8 ranked or wager fights at 0.05 SUI stakes — should cross L7 threshold
  3. Confirm: modal pops with celebration animation, "Allocate Stat Points" CTA, sound plays
  4. Confirm multi-level merge case: if a single fight crosses two thresholds (rare; would need ~15000 XP gap), modal reads "Level Up x2!"
- **Expected:** unit-test math is solid; this is a UX-pacing confirmation.

### C. Friendly queue + Ranked queue live re-walk (1.6.1, 1.6.2 — 🤔)
- **Why now:** the v5 work has focused on wager flow for months; the simpler queues haven't had a recent matrix entry. Pre-mainnet they should each get the same `12-test gauntlet` treatment as marketplace.
- **Repro (compressed to ~5 tests each):**
  1. Mr_Boss enters Friendly queue, Sx enters Friendly queue — match found within timer
  2. Fight resolves; both XP recorded; no rating change
  3. Same flow for Ranked — rating delta correctly applied; ELO formula sanity check
  4. Mr_Boss queues Ranked while a wager is open — Multi-queue gate refuses (this is already pinned but worth confirming live since the polish makes it visible)
  5. Mr_Boss in Ranked queue while Sx tries to challenge via Tavern — busy gate refuses
- **Expected:** ELO + XP wiring is sound from gauntlets; the question is whether matchmaking finds the pair correctly and the UI handles the timer / countdown / pairing transition cleanly.

### D. Cancel_expired_wager live walk (1.5.6 — 🤔)
- **Why now:** the only `arena.move` public function that's never been walked live. Anyone-callable, so this is also a public-griefing surface check.
- **Repro:**
  1. Mr_Boss creates wager 0.05 SUI; do NOT accept
  2. Wait 10 minutes
  3. From a third wallet (or from Sx) call `cancel_expired_wager(wager_id, &Clock, ctx)` via PTB
  4. Confirm Mr_Boss receives 0.05 SUI back; status SETTLED; event `WagerCancelled` (WAITING path) or `WagerRefunded` (ACTIVE path)
- **Expected:** Move test covers this; live walk confirms PTB-against-shared-object works for any caller.

### E. Authenticated-user spectator (1.4.11 — 🤔)
- **Why now:** guest spectator is live-verified; authenticated spectator path is the more common case (Tavern player clicks "Watch fight"). Code exists, light QA exercise.
- **Repro:**
  1. Mr_Boss + Sx start a wager fight
  2. From a third wallet (or Sx logged out then back in as guest), click into Tavern → see Mr_Boss is in a fight → click "Watch"
  3. Confirm zone picks + damage stream in spectator view
  4. Disconnect spectator mid-fight; reconnect; confirm state catches up
- **Expected:** WS event multicast works; refresh state is straightforward.

### F. Fight request via Tavern (1.8.7 — 🤔)
- **Why now:** unit-pinned (`qa-tavern-fight-requests`, 58 PASS) but not in recent live-walk inventories — meanwhile this is one of the GDD's headline social actions ("click a player → challenge to fight").
- **Repro:**
  1. Mr_Boss opens Tavern → clicks Sx → "Challenge to Friendly Fight"
  2. Sx sees toast / banner; accepts
  3. Both transition to fight room
  4. Cancel path: Mr_Boss issues challenge, then cancels before Sx accepts
  5. Decline path: Mr_Boss issues, Sx declines, both return to lobby
- **Expected:** unit gauntlet is comprehensive; live walks UX framing.

### G. Hall of Fame click-through live (1.9.5 — 🤔)
- **Why now:** UI live-walk deferred per STATE 05-13 "only 2 entries on the live board". By now there are more characters with stats — re-walk should confirm sort/filter/profile-click chain across ≥5 entries.
- **Repro:**
  1. Open Hall of Fame
  2. Click each column header twice (asc → desc)
  3. Apply level-bucket chip + build chip + name search
  4. Click a row → PlayerProfileModal opens with correct stats / gear / W/L
  5. Click "Load more" if >20 entries
- **Expected:** sort + filter math pinned; live confirms render perf + click-target accuracy.

### H. Recent regression suite — wager finality fix (1.5.12 — ✅, but light evidence)
- **Why now:** the fix landed this session and live-verified one fast-accept cycle. Real confidence comes from 5-10 consecutive fast accepts without seeing the old reject.
- **Repro:**
  1. Mr_Boss + Sx cycle 10 wager fights (0.05 SUI) clicking accept as fast as humanly possible
  2. Watch `/tmp/server.log` for any `tx-finality timeout` or `status: 0` reject
  3. Confirm `proceed-complete` fires every time

## 3.2 Important-to-test but can defer to v5.1

### I. Orphan-wager sweep live (1.5.15 — 🤔)
- **Why defer:** requires Supabase provisioning. Code is gauntlet-pinned (`qa-orphan-sweep`, 30 PASS) and the on-chain leg has been live-tested via the manual admin-cancel path multiple times this week. The unique surface — boot-time scan of a persisted row — is a one-line difference.
- **When to test:** when Supabase gets provisioned for mainnet smoke test.

### J. Mainnet endpoint network-gating audit (1.10.9 — 🤔)
- **Why defer:** mainnet-only concern. Each `/api/admin/*` is supposed to 403 when `CONFIG.SUI_NETWORK === 'mainnet'`. Bucket 3 Item #5 explicitly tracks this.
- **When to test:** before mainnet smoke test; run a grep + manual test on each endpoint with `SUI_NETWORK=mainnet` set.

### K. Spectate-fight-via-Tavern UX (light surface in 1.4.11)
- **Why defer:** core functionality works; the polish surface ("who's watching" counter, spectator chat, etc.) is post-mainnet content per GDD §7.3.

### L. autoRollback live (1.5.10 — 🤔)
- **Why defer:** requires hand-crafted PTB to bypass the client gate. v5.1 `OpenWagerRegistry` subsumes the bug — the chain-side guard prevents the orphan from being created in the first place, making the autoRollback redundant.

## 3.3 Bug-class items needing decision before mainnet, not testing

These three known states aren't a "test it more" — they need an explicit decision:

### M. Draw bug (1.4.6 — ⚠️)
- **Status:** DEFERRED to v5.1 per 2026-05-28 decision (memory + MAINNET_PREP)
- **Safety net:** manual `admin_cancel_wager` (works, but admin-only)
- **Verify before mainnet:** v5.1 `settle_tie` ships AND server router fires it on draw AND frontend draw modal renders correctly

### N. Two-handed weapons chain-side gate (1.3.6 — ⚠️)
- **Status:** Frontend-only enforcement; chain accepts any-weapon-in-mainhand stacking
- **Safety net:** none on chain; rely on frontend
- **Verify before mainnet:** v5.1 `slot_type: u8` enforcement, OR rename "two-handed" to honest "frontend-recommended" if shipping without

### O. Dup-kiosk JS-only guard (1.7.11 — ⚠️)
- **Status:** Frontend pre-flight; PTB hand-crafter or two-tab race during indexing lag can bypass
- **Safety net:** `useKiosk` aggregation + `buildWithdrawAllKioskProfitsTx` sweep — funds are always recoverable, just possibly stranded in the "wrong" kiosk
- **Verify before mainnet:** v5.1 `KioskRegistry` + `create_or_get_player_kiosk`

---

# PART 4 — v5.1 scope & diff vs v5.0

## A. Contract-level changes (require v5.1 Move republish)

A fresh `sui client publish` of a new package. New `packageId`, new `AdminCap`, new `Publisher`, new `TransferPolicy`, new `Display<Character>`, new `Display<Item>`. Per MAINNET_PREP §A this is mandatory (no upgrade — old bytecode stays callable).

### A.1 New shared registries

| Item | Type | Module | Purpose |
|---|---|---|---|
| **`CharacterRegistry`** | NEW FEATURE | `character.move` | Shared `Table<address, ID>` mapping wallet → Character object id. Closes Block A Layer 3 (hand-crafted-PTB duplicate-mint). Inserted by `create_character`, removed by `burn_character`. |
| **`OpenWagerRegistry`** | NEW FEATURE | `arena.move` | Shared `Table<address, ID>` mapping creator → wager id. Inserted by `create_wager`, removed by `cancel_wager` / `settle_wager` / `admin_cancel_wager` / `cancel_expired_wager`. Closes the server-down-mid-create orphan class AND chain-side defence for silent-accept. |
| **`KioskRegistry`** | NEW FEATURE | `marketplace.move` | Shared `Table<address, ID>` mapping wallet → kiosk id. Replaces `create_player_kiosk` with `create_or_get_player_kiosk` that returns existing kiosk_id when sender already has one. Closes the phantom-empty-kiosk vector. |

### A.2 New entry functions

| Item | Type | Module | Signature |
|---|---|---|---|
| **`create_or_get_player_kiosk`** | NEW FEATURE | `marketplace.move` | `(registry: &mut KioskRegistry, ctx: &mut TxContext): ID` |
| **`burn_character`** | NEW FEATURE | `character.move` | `(admin: &AdminCap, character: Character, registry: &mut CharacterRegistry, ctx: &mut TxContext)` — admin-gated; removes registry entry; cleans up legacy mr_boss/sx residue |
| **`settle_tie`** | BUG FIX (mutual-KO) | `arena.move` | `(wager: &mut WagerMatch, clock: &Clock, ctx: &mut TxContext)` — TREASURY-only; asserts ACTIVE + player_b is_some; refunds 100% to each (no platform fee on draws). Emits new `WagerTied`. |
| **`settle_wager_attested`** | NEW FEATURE (trust) | `arena.move` | `(wager: &mut WagerMatch, winner: address, sig_a: vector<u8>, sig_b: vector<u8>, clock: &Clock, ctx: &mut TxContext)` — verifies both players' `signPersonalMessage` over canonical fight-outcome hash; closes TREASURY-trust assumption |
| **`update_after_fight_draw`** | NEW FEATURE | `character.move` | `(admin: &AdminCap, character: &mut Character, xp_gained: u64, clock: &Clock)` — increments `draws` instead of wins/losses; OR widen `update_after_fight` to take a `result: u8` discriminator (0=loss / 1=win / 2=draw) |

### A.3 Modified entry functions

| Item | Type | Module | Change |
|---|---|---|---|
| **`create_character`** | BUG FIX | `character.move` | Take `registry: &mut CharacterRegistry`; abort with `EWalletAlreadyHasCharacter` if entry exists |
| **`create_wager`** | BUG FIX | `arena.move` | Take `registry: &mut OpenWagerRegistry`; abort with `EAlreadyHasOpenWager` if caller in registry |
| **`accept_wager`** | BUG FIX | `arena.move` | Take `registry: &mut OpenWagerRegistry`; abort `EAlreadyHasOpenWager` if caller in registry |
| **`cancel_wager` / `settle_wager` / `admin_cancel_wager` / `cancel_expired_wager`** | BUG FIX | `arena.move` | Remove entry from `OpenWagerRegistry` on completion |
| **`equip_weapon`** | BUG FIX | `equipment.move` | Abort `EOffhandOccupied` if `item.slot_type == 2 (both_hands)` and offhand DOF non-empty |
| **`equip_offhand`** | BUG FIX | `equipment.move` | Abort `EWeaponIsTwoHanded` if pending weapon's `slot_type == 2`; abort `EItemNotOffhand` if incoming item's `slot_type == 2` |
| **`mint_item_admin`** | NEW FEATURE | `item.move` | Take `slot_type: u8` param (0=mainhand, 1=offhand, 2=both_hands) |
| **`settle_wager`** | POLISH | `arena.move` | Inline a comment that `EMatchAlreadySettled (abort 6)` is the expected race when player-side `cancel_wager` beats server defence-in-depth `admin_cancel_wager` |
| **`update_after_fight`** | NEW FEATURE | `character.move` | Widen signature: accept `result: u8` discriminator; OR keep existing + add `update_after_fight_draw` sibling (less invasive) |

### A.4 Struct changes

| Struct | Module | Change | Type |
|---|---|---|---|
| **`Character`** | `character.move` | Add `draws: u32` field | NEW FEATURE |
| **`Item`** | `item.move` | Add `slot_type: u8` field | NEW FEATURE |
| **`WagerMatch`** | `arena.move` | No struct change — events do the work | — |

### A.5 New events

| Event | Module | Emitted by |
|---|---|---|
| **`WagerTied`** | `arena.move` | `settle_tie` — `{ match_id, player_a, player_b, refund_each }` |
| **`CharacterBurned`** | `character.move` | `burn_character` — `{ character_id, owner }` |
| **`KioskRegistered`** | `marketplace.move` | First-time `create_or_get_player_kiosk` — `{ kiosk_id, owner }` |
| **`WagerSettledAttested`** | `arena.move` | `settle_wager_attested` — same fields as `WagerSettled` plus a flag |
| **`LootMinted`** (existing-ish via `item::ItemMinted`) | `item.move` | Already emitted; the v5.1 wire-up routes it to server's post-fight + a frontend `loot_minted` WS event |

### A.6 New error codes

| Error | Module | Value |
|---|---|---|
| `EWalletAlreadyHasCharacter` | `character.move` | next available (currently 0-5 used) |
| `EAlreadyHasOpenWager` | `arena.move` | next available (currently 0-10 used) |
| `EOffhandOccupied` | `equipment.move` | next |
| `EWeaponIsTwoHanded` | `equipment.move` | next |
| `EItemNotOffhand` | `equipment.move` | next |
| `EItemNotMainhand` | `equipment.move` | next |
| `ESignatureInvalid` | `arena.move` (settle_wager_attested) | next |

### A.7 Hardening / cleanup

| Item | Type | Notes |
|---|---|---|
| `#[allow(lint(public_entry))]` | TECH DEBT | Clean up redundant `public entry` warnings for mainnet professionalism |
| Remove all `EDeprecated` stubs | TECH DEBT | None should exist on a fresh publish (per MAINNET_PREP §C) |
| Move 2024 features pass | TECH DEBT | Adopt macros / enums / method syntax where it improves readability |
| `option::is_some` guards before every `option::borrow` | BUG FIX | `arena.move:163, 255, 313` flagged in Phase 0.5 audit |

### A.8 Optional / discussion-worthy

| Item | Type | Notes |
|---|---|---|
| **`sui::random` for fight resolution** | NEW FEATURE | GDD §11 references commit-reveal as optional; `sui::random` is the modern Sui pattern. **Significant design decision** — moves combat math at least partially on-chain (or keeps it off-chain but uses chain-RNG for crit/evasion rolls). Substantial work; deserves its own scope discussion. |
| **`sui::random` for loot rolls** | NEW FEATURE | Lower-stakes than fight RNG; rolls happen in `mint_item_admin` already (admin-controlled). Worth it if loot scarcity needs trust. |
| **`Display V2`** | POLISH (HARD DEADLINE) | Mysten's Display V1 deprecation **July 31 2026**. Frontend `lib/sui-contracts.ts` Display reads need an audit pass + migrate to V2. **Affects frontend more than contracts**, but the v5.1 Display objects should be V2 from publish. |
| **MVR named packages** | POLISH | Mysten Move Registry — name `@suicombats/...`. Improves discoverability + future cross-package interop. |
| **Item rarity stat-budget enforcement** | NEW FEATURE | Today `mint_item_admin` allows any bonus up to MAX_BONUS regardless of rarity. v5.1 could enforce per-rarity total stat budget (Common 1x ≤ X total bonus points; Legendary 4x). Currently informal in GDD §5.4. |

### A.9 Migration considerations (v5.0 → v5.1)

- **No migration of existing NFTs.** Standard since v4→v5 — players re-mint characters on v5.1. Confirmed in MAINNET_PREP §A.
- **22-item starter catalog + 9-item v5.1 catalog stay on v5 chain**, become unusable post-republish. Acceptable per STATE 05-04.
- **Fresh AdminCap / TREASURY / Publisher / UpgradeCap** per MAINNET_PREP §B.
- **`deployment.testnet-v5.1.json`** mirrors v5's structure; env-update is `SUI_PACKAGE_ID` / `ADMIN_CAP_ID` / `TRANSFER_POLICY_ID` / `PUBLISHER_OBJECT_ID` / `CHARACTER_REGISTRY_ID` / `OPEN_WAGER_REGISTRY_ID` / `KIOSK_REGISTRY_ID` swap.
- **The three new shared registries must be created at deploy time** (likely in `module init`) so the addresses are baked into env from day one.
- **Item catalog re-mint** required — including the `slot_type` field on every item. The Lv6-Lv8 catalog spec in `qa-mint-catalog.ts` needs the field added.

---

## B. Server + frontend changes (ship with the republish)

### B.1 Server — Move-bundle wiring

| Item | Type | Notes |
|---|---|---|
| **Settle-tie router in `fight-room.ts`** | BUG FIX (mutual-KO) | In `else if (draw)` branch (~line 728), call `settleTieOnChain(fight.wagerMatchId)` for `fight.type === 'wager'`. New helper in `sui-settle.ts` mirrors `adminCancelWagerOnChain` but calls `settle_tie`. Fall back to `admin_cancel_wager` on `settle_tie` failure. |
| **`update_after_fight` with draw discriminator** | BUG FIX | Pass `result: 'draw'` to bump the new `draws: u32` counter |
| **`settle_wager_attested` signing UX** | NEW FEATURE (trust) | Server constructs the canonical fight-outcome hash; broadcasts to both players via WS; collects their `signPersonalMessage` signatures; submits the attested-settle PTB. **New end-of-fight modal** for the signing handshake. |
| **`CharacterRegistry` lookup before pre-mint guard** | BUG FIX | The server's existing pre-mint guard (`findCharacterObjectId`) becomes defence-in-depth; the chain registry is now primary |
| **`OpenWagerRegistry` lookup before lobby insert** | BUG FIX | Defence-in-depth; the chain registry is now primary |
| **`create_or_get_player_kiosk` integration** | BUG FIX | Server's marketplace cold-sync needs to handle the case where the registry already has the kiosk |
| **Loot mint pipeline re-enabled** | NEW FEATURE | `rollLoot` math from `server/src/game/loot.ts` (currently disabled per BUG 3); server's post-fight handler calls `mint_item_admin` via treasury queue; frontend gets `loot_minted` WS event |

### B.2 Server — Mainnet-blocker work (Phase 1)

| Item | Type | Notes |
|---|---|---|
| **Settlement retry / journal** | BUG FIX (mainnet blocker) | Pre-fix: server crash mid-settle strands escrow. Add a `settlements` table with `pending / submitted / confirmed / failed` states + retry loop. STATE 05-04 Blocker #2 — gated on Supabase provisioning to test end-to-end. **Critical for mainnet.** |
| **`update_after_fight` retry** | BUG FIX (mainnet blocker) | Same concern — server↔chain divergence if the admin tx fails after fight resolves. Phase 1 work. |
| **WS message Zod validation** | TECH DEBT (mainnet blocker) | Per MAINNET_PREP §C — every WS message goes to a Zod schema. Untrusted payloads currently flow to admin calls. |
| **Per-wallet rate limits on WS messages** | TECH DEBT | Per MAINNET_PREP §D — `chat_message`, `queue_fight`, `create_wager` need caps |
| **SIGTERM shutdown handlers** | TECH DEBT | Clean exit for deploy rotations |
| **Empty `catch {}` sweep** | TECH DEBT | `characters.ts`, `sui-settle.ts`, `handler.ts`, `fight-room.ts` per MAINNET_PREP §C |
| **`MAX_WAGER_SUI` cap** | TECH DEBT | Server-side cap to bound single-match blast radius |
| **Admin endpoint network gating audit** | BUG FIX | STATE 05-04 Blocker #10 — sweep every `/api/admin/*` to confirm `CONFIG.SUI_NETWORK !== 'mainnet'` check |
| **`StatBonuses` shape unification** | TECH DEBT | Server uses `{armor, hp, defense, damage, critBonus, strength, ...}`; frontend expects `{armorBonus, hpBonus, defenseBonus, attackBonus, critChanceBonus, ...}`. Translation in `sanitizeItem` drops 4 stat fields (`critMultiplierBonus`, `evasionBonus`, `antiCritBonus`, `antiEvasionBonus`). **Resolve before mainnet.** |

### B.3 Server — gRPC migration (Track 4 deferred)

| Item | Type | Notes |
|---|---|---|
| **BCS decoder for `WagerMatch`** | TECH DEBT | `getWagerStatus` currently uses JSON-RPC; gRPC returns BCS — needs decoder |
| **`queryEvents` → checkpoint subscription** | TECH DEBT | `findCharacterObjectId` uses `queryEvents`; gRPC has no equivalent. Either swap to checkpoint-subscription cold-sync OR keep that one call on JSON-RPC |
| **`getDynamicFieldObject` → `listDynamicFields`** | TECH DEBT | `fetchEquippedFromDOFs` needs the new pagination shape |
| **Latency benchmark** | — | Worth doing; STATE 05-17 says "needs its own focused session with before/after measurements" |

### B.4 Frontend — Move-bundle wiring

| Item | Type | Notes |
|---|---|---|
| **Draw modal** | BUG FIX | New `<DrawOutcomeModal />` mirroring `<PostFightModal />`; neutral copy "Draw — both fighters down"; refund amount; consolation XP. Triggered in `game-provider.tsx:258` when `msg.fight.winner === null && fight.status === 'finished'` |
| **W/L/D counter** | BUG FIX | Navbar + character profile widen from W/L to W/L/D; badge tint neutral for draws |
| **Fight history `result: 'draw'`** | BUG FIX | Type widening from `'win' \| 'loss'` to `'win' \| 'loss' \| 'draw'`; badge color at `character-profile.tsx:817-818` |
| **`slot_type`-aware equipment picker** | NEW FEATURE | Drop `TWO_HANDED_NAMES` hardcoded list (`frontend/src/lib/two-handed-weapons.ts`); replace with chain-side `slot_type` read; picker greys offhand candidates when mainhand is `both_hands` and vice versa |
| **Settle-attested signing flow** | NEW FEATURE | Post-fight modal collects player signature on outcome hash; UX writeup needed (signing prompt vs auto-sign) |
| **`loot_minted` WS event handling** | NEW FEATURE | New WS message type; pops "You got X!" toast; refreshes inventory |
| **Drop `useMarketplaceActions.createKiosk` JS pre-flight** | TECH DEBT | After v5.1 `create_or_get_player_kiosk` ships, the JS guard becomes redundant |

### B.5 Frontend — Bug fixes deferred from v5.0

| Item | Type | Source (where flagged) |
|---|---|---|
| **Confirm-modal gate for every `signAndExecuteTransaction`** | BUG FIX (HARD mainnet blocker) | MAINNET_PREP §D. zkLogin signs silently today — walk-up theft attack vector. Single shared `<ConfirmTxModal />` showing function + amount + recipient + gas estimate before signer fires. Sites: matchmaking-queue, character-creation, useEquipmentActions, stat-allocate-modal, marketplace components |
| **Apple OAuth** | NEW FEATURE (pending) | Enoki SDK doesn't yet support Apple; three-site breadcrumb already in `enoki.ts` / `dapp-kit.ts` / `.env.local.example`; ~3-line diff when Enoki adds it |
| **Twitch zkLogin live test** | POLISH | Wiring shipped; live walk pending (see Part 3 §A) |
| **`assertTxSucceeded` shape regression** | TECH DEBT | SDK 2.16 moved `status` to `result.Transaction.status` (not `effects.status`). Currently neutralised by `$kind === "Transaction"` short-circuit but reads wrong path. Tighten per this session's findings. |
| **Post-tx chain-sync polling** | TECH DEBT (mainnet) | Replace 1s `setTimeout` after equip with `waitForChainSync(client, wallet, expectedGone, maxMs=10_000)` — per MAINNET_PREP §D code sample |
| **Outbound message queue idempotency** | BUG FIX | Per MAINNET_PREP "Known races" — make `queue_fight`, `wager_accepted` server-tolerant of duplicate re-sends so the WS pending queue can replay safely |
| **Empty primary kiosk after full withdraw (Polish A)** | POLISH | HANDOVER 2026-05-20 §2A. Tiebreaker for all-empty kiosks. ~30 min. |
| **"Create my Kiosk" CTA hide (Polish B)** | POLISH | HANDOVER 2026-05-20 §2B. Local `creating` flag. ~10 min. |
| **Mid-session zkLogin re-auth flicker (Polish C)** | POLISH | HANDOVER 2026-05-20 §2C. Instrument JWT expiry; `withZkLoginRefresh(...)` wrapper. |
| **"No character found" red flash on fresh load** | POLISH | STATE 05-04 / HANDOVER 05-20 §5. Wager polish item. |
| **Opponent inspector / level-mismatch warning** | NEW FEATURE | HANDOVER 05-20 §5; memory `project_opponent_scout_seed.md` — pre-accept modal showing W/L, gear, recent fights. Database-only (no contract change). Optional for v5.1; post-mainnet acceptable. |
| **DM modal closes/loses focus after Send** | POLISH | STATE 05-04 parking lot |
| **DM notification surfacing weak when other modals open** | POLISH | STATE 05-04 parking lot |
| **PlayerProfileModal DOF hydration race** | BUG FIX | STATE 05-04 parking lot; same class as "equipped items invisible at fight start"; gate render on hydration promise |
| **Inventory auto-refresh after rapid equip swaps** | POLISH | STATE 05-04 parking lot |
| **HP decimal display ("0.25 HP" → "0/90")** | POLISH | STATE 05-04 parking lot |
| **Equipped items invisible at fight start** | BUG FIX | STATE 05-04 parking lot; DOF hydration race |
| **Stat-allocate modal preset to 0/0/0/0** | POLISH | STATE 05-04 parking lot — pre-populate current allocations |
| **Buy button disabled-state stability** | POLISH | STATE 05-04 parking lot — poll-cycle flash |
| **Friendly abort-code → toast lookup** | POLISH | STATE 05-04 + STATE 05-04 abort-6 mystery |
| **TransferPolicy royalty withdraw UI** | NEW FEATURE | STATE 05-04 parking lot — ~0.14 SUI accumulated; CLI for now |
| **Race-condition Test 12 (parallel buy script)** | TECH DEBT | STATE 05-04 parking lot |

### B.6 Display V2 migration (HARD DEADLINE July 31 2026)

| Item | Type | Notes |
|---|---|---|
| **Audit `frontend/src/lib/sui-contracts.ts` Display reads** | BUG FIX | Mysten Display V1 deprecation July 31 — any Display V1 read breaks after that. |
| **Migrate Display objects to V2 at v5.1 deploy time** | POLISH | New `Display<Character>` and `Display<Item>` use V2 syntax |

### B.7 Tests + gauntlets to add or extend

| Item | Type | Notes |
|---|---|---|
| **`settle_tie` Move unit test** | TECH DEBT | Mirror `settle_wager_attested` tests — assert refund_each == stake_amount, status flips to SETTLED, both balances credited |
| **`settle_wager_attested` Move unit test** | TECH DEBT | Round-trip sig verification + abort path on wrong sig |
| **`slot_type` Move unit test** | TECH DEBT | Both directions (mainhand→offhand blocked, offhand→mainhand-as-both-hands blocked) |
| **`CharacterRegistry` / `OpenWagerRegistry` / `KioskRegistry` Move unit tests** | TECH DEBT | Insert + remove + abort-on-duplicate paths each |
| **Frontend draw-modal gauntlet** | TECH DEBT | Pin `<DrawOutcomeModal />` dispatch + W/L/D counter render + result widening |
| **Frontend `slot_type`-aware picker gauntlet** | TECH DEBT | Extend `qa-equip-picker` (78 PASS) for chain-side `slot_type` reads |
| **Frontend confirm-modal gauntlet** | TECH DEBT (mainnet blocker) | Per MAINNET_PREP §D — gauntlet fails if a new `signAndExecuteTransaction` site is added without a paired `confirmTransaction(...)` pre-call |
| **Settlement retry queue gauntlet** | TECH DEBT (mainnet blocker) | State machine for pending → submitted → confirmed → failed; recovery from crash mid-step |

### B.8 Documentation

| Item | Type | Notes |
|---|---|---|
| **`STATE_OF_PROJECT_2026-05-28.md`** (or kill the family in favour of HANDOVER) | TECH DEBT | The audit I shipped in this session noted that 5 `STATE_OF_PROJECT_*` snapshots are stale; consolidate before v5.1 wrap |
| **Update GDD §11 to reflect v5.1 changes** | TECH DEBT | `settle_tie`, `draws` counter, `slot_type` enforcement, attested settlement, registries |
| **Update README status block** | TECH DEBT | Currently says "Status (2026-05-04): v5 testnet hardened" — three phases out of date |
| **Bump `MAINNET_PREP.md` last-updated header** | DONE this session | 2026-05-28 |

---

# PART 5 — Gap analysis: am I missing anything?

Cross-referencing the GDD, memories, standard PvP-RPG patterns, MAINNET_PREP, and the parking lot.

## 5.1 In the GDD but unimplemented

| Item | Source | Reality | Verdict |
|---|---|---|---|
| **Item-stake fight type** | GDD §4.4 — fight types include "Item Stake" where each player puts up an NFT item, winner takes both | Zero scaffolding. `arena.move` only escrows SUI. | **OUT OF SCOPE for v5.1.** Would require new `arena.move` paths for Item escrow + atomic-swap on settle. NEEDS v5.2+. |
| **Daily first-fight XP bonus** | GDD §9.2 — "Daily first fight: 50 XP bonus" | Not implemented; `calculateXpReward` doesn't track per-wallet daily firsts | **NEEDS v5.1** (small, pure server logic; engagement loop primitive). Database-only. |
| **Character respec** | GDD §8.2 — "Character respecs (re-allocate stats)" listed as SUI sink | Not implemented; once allocated, points are permanent | **NEEDS v5.1** if you want the SUI sink; otherwise v5.2+. Owner-only Move entry, charge configurable fee to treasury. |
| **Crafting (combine lower items into higher rarity)** | GDD §5.5 | Zero scaffolding | **OUT OF SCOPE for v5.1.** Significant content addition; depends on rarity-budget enforcement (A.8) to be coherent. v5.2+ minimum. |
| **Equipment runes / enchanting** | GDD §11 — Future feature | Zero scaffolding | **OUT OF SCOPE.** Post-mainnet content tier per STATE 05-04. |
| **Clan wars / Guilds** | GDD §11 — Future feature | Zero scaffolding | **OUT OF SCOPE.** Post-mainnet. |
| **Pets** | Not in GDD; user-mentioned in prompt | Zero scaffolding | **OUT OF SCOPE.** Not in canonical design. |
| **Herbs / consumables** | Not in GDD | Zero scaffolding | **OUT OF SCOPE.** Item taxonomy has 9 item types (weapon/shield/helmet/chest/gloves/boots/belt/ring/necklace); consumables would be a 10th. v5.2+ at earliest. |
| **Tournaments (community + pot-funded)** | GDD §8 + Grant App Phase 4; memory `project_tournament_seed.md` | Zero scaffolding; explicitly user-deferred until "ready to spec" | **OUT OF SCOPE for v5.1.** User said hold. Schedule for post-mainnet. |
| **Mainnet portal on Walrus Sites** | Grant App Phase 4 | Testnet only today | **NEEDS v5.1** if mainnet ships on Walrus; **NEEDS v5.2** if Vercel-first |
| **Mobile-responsive UI** | Grant App Phase 4 | Desktop-only; Tailwind utility classes are mostly responsive but no mobile-first pass | **NEEDS v5.1 OR v5.2** depending on launch priorities. Audit before mainnet. |
| **Commit-reveal zone picks** | GDD §4.5 — "Optional: commit zone picks as hashes" | Not implemented; both clients send picks plain to server | **OUT OF SCOPE.** "Optional" in GDD; server-authoritative resolution covers the trust gap if you trust the server. Bundles with `sui::random` discussion. |
| **Two-handed weapons "trinity" enforced on chain** | GDD §6 — Shield vs Dual-wield vs Two-handed | Frontend-only enforcement today | **NEEDS v5.1** — `slot_type: u8` (already in bundle A.3-A.4) |
| **Spectate fights** | GDD §7.1 + §7.3 | Partial (guest landing works; authenticated path lightly QA'd; no spectator chat, no "who's watching" counter) | **NEEDS v5.1 polish OR v5.2.** Core works; UX layer is post-mainnet content. |
| **Whisper / DM** | GDD §7.1 | Implemented (DM channels); two known polish issues (DM modal focus loss + notification burial) | **NEEDS v5.1 polish.** |
| **Profiles with stats / gear / W/L** | GDD §7.1 | Implemented in PlayerProfileModal; DOF hydration race outstanding | **NEEDS v5.1 polish.** |
| **Cosmetic purchases** | GDD §8.2 — listed as SUI sink | Zero scaffolding | **OUT OF SCOPE.** v5.2+ content. |
| **Anti-bot measures** | GDD §10 Phase 5 + Grant App | Zero scaffolding | **NEEDS v5.1 minimum.** Rate limits are the floor; CAPTCHA-class measures are v5.2+. |

## 5.2 Mentioned in past handoffs and at risk of being forgotten

| Item | Source | Verdict |
|---|---|---|
| **Bug C — Battle log render asymmetry** | STATE 05-17 "Open bug log"; pre-redesign symptom not re-tested against Phase 3 fight-room redesign | **NEEDS v5.1 verification.** Test plan in STATE 05-16; two-wallet live fight, compare DamageLog content between tabs. |
| **Multi-day overnight stability test** | STATE 05-04 Bucket 3 #3 | **NEEDS pre-mainnet.** Surfaces memory leaks, silent fails, orphan-wager idle conditions. |
| **Fresh-user onboarding from never-seen wallet** | STATE 05-04 Bucket 3 #4 | **NEEDS pre-mainnet.** Tests Block A duplicate-mint guard + auth_phase state machine end-to-end from a wallet with no localStorage / no character. |
| **Race-condition Test 12 (parallel buy on same listing)** | STATE 05-04 parking lot | **NEEDS v5.1 OR ts-node script.** Two PTBs in parallel via SDK; verify Kiosk behaviour. |
| **Server crash mid-settlement → settlement-queue recovery** | STATE 05-04 gaps | **NEEDS v5.1 hardening** — Phase 1 settlement journal. |
| **Treasury queue concurrency knob (`TREASURY_QUEUE_CONCURRENCY`)** | STATE 05-04 "implemented but undocumented" | **NEEDS v5.1 doc.** Mention in README. |
| **Lv6-Lv8 catalog design rationale not in GDD** | STATE 05-04 implemented-but-undocumented | **NEEDS v5.1 doc.** Add paragraph to GDD §5. |

## 5.3 Standard PvP-RPG patterns we lack

| Pattern | Industry baseline | Reality | Verdict |
|---|---|---|---|
| **Replay viewer** | Most PvP games store a fight replay so players (and refs/community) can re-watch | No replay storage; fight log is broadcast live then discarded | **NEEDS v5.2+.** Dispute-resolution value; not blocker. |
| **Achievements system** | Standard engagement loop | Zero scaffolding | **OUT OF SCOPE.** Post-mainnet content. |
| **Daily quests** | Standard engagement loop | Zero scaffolding (daily-first-fight XP would be the seed) | **OUT OF SCOPE.** Post-mainnet content. |
| **Anti-collusion detection** | Wager-game critical | Zero scaffolding | **NEEDS v5.1 minimum.** Same-IP heuristic + wallet-cluster detection. Per MAINNET_PREP §D "matchmaking guardrails". |
| **Rate limits on WS messages** | Standard server hardening | None | **NEEDS v5.1** (MAINNET_PREP §D). |
| **Sybil resistance** | Standard wager-game | Zero scaffolding; wallet-creation is free | **NEEDS v5.1 minimum** — at least require character creation gas cost; consider per-wallet daily wager cap. |
| **Player blocking / ignore lists** | Standard social | Zero scaffolding | **NEEDS v5.1** for chat moderation; OUT OF SCOPE for fights (matchmaking is paired). |
| **Mute lists for chat** | Standard | Zero scaffolding | **NEEDS v5.1** alongside blocking. |
| **Profanity filter for character names + chat** | Standard | Zero scaffolding; `MAX_NAME_LENGTH=32` is the only name validation | **NEEDS v5.1** at least for character names (Move-side check); chat filter is post-mainnet. |
| **Spectator chat** | Standard for tournament-style PvP | Zero scaffolding | **OUT OF SCOPE.** Post-mainnet content. |
| **Tournament brackets UI** | Standard | Zero scaffolding | **OUT OF SCOPE.** Bundles with tournament feature. |
| **Public profile pages (URL-shareable)** | Standard for social proof | Zero scaffolding | **NEEDS v5.2** content tier. |
| **Live "who's watching" counter on fights** | Twitch-style | Zero scaffolding | **OUT OF SCOPE.** v5.2+ content. |
| **Email / handle backup for zkLogin sessions** | Standard auth UX | None — zkLogin JWT expires → re-login flow | **OUT OF SCOPE** (zkLogin design). The Enoki refresh polish (HANDOVER 05-20 §C) is the v5.1 minimum. |
| **Dispute mechanism** | Standard for real-money PvP | None — admin can refund via endpoint | **NEEDS v5.1 polish.** At least document a community contact + SLA. |

## 5.4 Mainnet-readiness items (cross-ref MAINNET_PREP)

| Item | MAINNET_PREP ref | Status today | Verdict |
|---|---|---|---|
| **Fresh publisher / TREASURY / AdminCap / UpgradeCap** | §B | Testnet keys in use | **NEEDS v5.1 deploy time.** |
| **Private-key vault (HashiCorp / AWS / 1Password)** | §B | Local dev only | **NEEDS pre-mainnet.** |
| **Key rotation procedure** | §B | Not documented | **NEEDS v5.1 doc.** |
| **All deprecated v1 stubs removed** | §C contract | Done since v5 (fresh publish has none) | ✅ |
| **`mint_item_admin` is only mint path** | §C contract | Verified | ✅ |
| **`list_item_with_fee` is only list path** | §C contract | Verified (named `list_item` in v5) | ✅ |
| **Equip/unequip have owner + fight-lock check** | §C contract | Verified (every `equip_*` / `unequip_*` does both) | ✅ |
| **`option::borrow` guarded** | §C contract | `arena.move:163, 255, 313` — STILL FLAGGED | **NEEDS v5.1.** |
| **One-Kiosk-per-wallet on-chain invariant** | §C contract | JS-only today | **NEEDS v5.1** (bundled — KioskRegistry). |
| **Mutual-KO / draw bundle** | §C contract (added this session) | Bundled this session | **NEEDS v5.1.** |
| **`sui-settle.ts` no `execSync`** | §C server | Verified — only SDK calls | ✅ |
| **`config.ts` no testnet defaults** | §C server | env-throws on missing | ✅ |
| **Settlement retry / journal** | §C server | Phase 1 work, **NOT DONE** | **NEEDS v5.1 — critical mainnet blocker.** |
| **`update_after_fight` retry** | §C server | Has retry on object-version stale; broader retry queue not done | **NEEDS v5.1.** |
| **No `console.log` of sensitive data** | §C server | Spot-check OK; needs sweep | **NEEDS v5.1 audit.** |
| **Empty `catch {}` sweep** | §C server | Some present | **NEEDS v5.1 sweep.** |
| **WS message Zod validation** | §C server | NOT DONE | **NEEDS v5.1.** |
| **SIGTERM shutdown** | §C server | NOT DONE | **NEEDS v5.1.** |
| **Frontend dead-code sweep** | §C frontend | DONE (verified 2026-05-19) | ✅ |
| **No hardcoded testnet fallback IDs** | §C frontend | DONE — `sui-contracts.ts:44` throws | ✅ |
| **No testnet wallet addresses in source** | §C frontend | NEEDS sweep | **NEEDS v5.1.** |
| **`StatBonuses` shape unification** | §C shared | NOT DONE — 4 fields silently dropped | **NEEDS v5.1.** |
| **`.env.example` placeholders only** | §C shared | OK | ✅ |
| **`Published.toml` cleanup** | §C shared | NOT DONE (will regenerate on v5.1 publish) | **NEEDS v5.1 deploy.** |
| **`settle_wager` verifies caller bounds** | §D contract | Asserts `winner == player_a \|\| player_b`? **Need to verify** | **VERIFY** — looks like `arena.move:162-163` asserts winner is one of the two participants; ✅ if confirmed. |
| **`update_after_fight` bounds XP** | §D contract | ✅ `MAX_XP_PER_FIGHT=1000` |
| **`set_fight_lock` caps expiry** | §D contract | ✅ `MAX_LOCK_MS=1h` |
| **Item bonus caps** | §D contract | ✅ `MAX_BONUS=1000` |
| **`level_req` cap** | §D contract | ✅ `MAX_LEVEL_REQ=20` |
| **zkLogin confirm-popup gate** | §D UX (HARD MAINNET BLOCKER) | NOT DONE | **NEEDS v5.1 — HARD MAINNET BLOCKER per MAINNET_PREP itself.** |
| **Pinning: gauntlet fails on new `signAndExecuteTransaction` without confirm** | §D UX | NOT DONE | **NEEDS v5.1.** |
| **External smart contract audit** | §D audit | NOT STARTED | **NEEDS pre-mainnet.** 2-4 weeks. Engage 6 weeks before launch. $10-30k. |
| **Penetration test** | §D audit | NOT STARTED | **NEEDS pre-mainnet.** |
| **Bug bounty** | §D audit | NOT STARTED | **NEEDS pre-mainnet.** $5-10k initial pool. |
| **Monitoring + alerting** | §F | NOT STARTED | **NEEDS pre-mainnet.** Grafana / Datadog; settlement failure alerts; admin-signer alerts. |
| **RPC failover** | (implied) | Single public fullnode today | **NEEDS pre-mainnet.** Multi-fullnode or paid RPC. |
| **Post-tx chain-sync polling (replace 1s delay)** | §D | NOT DONE | **NEEDS v5.1.** |
| **`MAX_WAGER_SUI` cap** | §D | NOT DONE | **NEEDS v5.1.** |
| **Fight-lock race test** | §D | NOT DONE — gauntlet doesn't cover the parallel-server-process scenario | **NEEDS pre-mainnet.** Less concern for single-instance server. |

## 5.5 User-trust items

| Item | Reality | Verdict |
|---|---|---|
| **Transparent randomness** | Server-RNG; user must trust the server | **NEEDS v5.1 OR v5.2.** `sui::random` for crit/evasion rolls + loot. Significant scope. |
| **Player-signed settlement attestation** | TREASURY can pick any winner from `{player_a, player_b}` | **NEEDS v5.1** — `settle_wager_attested` (bundled). |
| **Fair matchmaking (ELO not gamed)** | Current ELO update is straightforward; matchmaking pairs by rating with some tolerance | **NEEDS v5.1 audit** — gauntlet doesn't pin matchmaking-pair fairness across rating bands. |
| **Anti-collusion** | None | **NEEDS v5.1.** Heuristics. |
| **Public audit results** | None | **NEEDS pre-mainnet** alongside audit engagement. |
| **Open-source code** | Public on GitHub, MIT licensed | ✅ |
| **Anti-self-play (single user controlling both wallets in a wager)** | None (one user can run two wallets) | **NEEDS v5.1 minimum** — heuristics in the matchmaker. Or accept as testnet-acceptable. |

---

# PART 6 — Honest recommendation

## 6.1 Is v5.0 truly ready to merge to `main`?

**No.** And honestly, "merge to `main`" is the wrong question by the project's own conventions — STATE_OF_PROJECT_2026-05-17 §Branch state and STATE_OF_PROJECT_2026-05-13 both say `main` stays at v4-era `08ff991` **until v5.1 lands**. The standing rule is "no merge to main without v5.1". So the answer is "no" by policy alone.

Even setting policy aside, three classes of issue make a `main` merge premature:

1. **Latent SUI-loss vectors with safety nets but no root fix:**
   - Draw bug (manual refund only)
   - Server-down-mid-create wager orphan (manual refund only; v5.1 OpenWagerRegistry is the root fix)
   - JS-only kiosk dup-create guard (PTB or two-tab race can bypass; v5.1 KioskRegistry is the root fix)
   - JS-only two-handed weapon enforcement (chain accepts any stacking; v5.1 slot_type is the root fix)
   
2. **Mainnet blockers that have never been addressed:**
   - Settlement retry / journal (Phase 1) — server crash mid-settle strands ACTIVE escrow with no automated recovery
   - Confirm-modal gates for every `signAndExecuteTransaction` (HARD mainnet blocker per MAINNET_PREP §D — zkLogin walk-up theft surface)
   - WS message validation (Zod schemas) — untrusted payloads currently flow to admin calls
   - Rate limits on WS messages
   - Admin endpoint network-gating audit
   
3. **Untested surfaces of v5.0 itself:**
   - Twitch zkLogin (Google walked, Twitch not)
   - Level-up modal (unit-only, never seen live)
   - Authenticated-user spectator path
   - `cancel_expired_wager` live walk
   - Friendly + Ranked queue 12-test gauntlet equivalent
   - Hall of Fame click-through at ≥5 entries
   - Fresh-user onboarding from never-seen wallet
   - Multi-day stability

`feature/phase-2-design` is in good shape **as a testnet branch.** It's not in good shape **as a mainnet candidate.**

## 6.2 What blocks v5.1 from being mainnet-ready vs another testnet step?

Layering the work:

**v5.1 testnet (5-7 days of focused contract work + 1-2 weeks of frontend/server + testing):**
- The Move bundle (Part 4 §A) — registries, settle_tie, settle_wager_attested, slot_type, KioskRegistry, draws field, burn_character
- Server wiring (B.1): settle_tie router, attested signing flow, loot mint pipeline
- Frontend (B.4 + B.5): draw modal, slot_type-aware picker, settle-attested signing UX, post-v5.0 polish backlog
- Mainnet-blocker work (B.2): settlement retry queue, Zod validation, rate limits, SIGTERM, empty catch sweep, MAX_WAGER_SUI
- Display V2 migration before July 31 2026 deadline
- New gauntlets (B.7)

**v5.1 testnet → mainnet promotion gate (mandatory before mainnet `sui client publish`):**
- 2-4 weeks external audit (OtterSec / Zellic / Movebit)
- Multi-day stability test
- Fresh-user onboarding test
- Admin endpoint network-gating audit
- Multi-day high-volume QA (target ≥ 100 wager fights, ≥ 50 marketplace transactions, ≥ 1000 chat messages without any stranded SUI or stuck objects)
- Monitoring + alerting stack (Grafana / Datadog)
- RPC failover plan (multi-fullnode or paid endpoint)
- Treasury key in production vault (HashiCorp / AWS / 1Password)
- Bug bounty announced

The v5.1 testnet ship is **5-7 days contract work + 1-2 weeks support code** by the STATE 05-04 estimate. The audit gate is **2-4 weeks**. So the realistic earliest-mainnet date is **6-9 weeks** from v5.1 testnet ship.

## 6.3 Should we plan a v5.2, or is v5.1 the mainnet cut?

**My recommendation: think of it as "v5.1 testnet → v6.0 mainnet" rather than "v5.1 mainnet."**

The v5.1 republish bundle as currently scoped is the right set of root fixes — but mainnet should be a separately-marked publish because:

1. **MAINNET_PREP §A** mandates a fresh publish anyway (no upgrade from v5.1).
2. **The audit is between v5.1-testnet and mainnet.** Audit findings will produce code changes. Those changes against an already-mainnet-published package would require yet another republish. Better to gate testnet ship → audit → fix-cycle → mainnet publish as one flow.
3. **v5.2 makes sense as a slot for things explicitly deferred from v5.1** — item-stake fights, character respec, daily quests, anti-collusion heuristics, ≥5 of the §5.3 "standard genre patterns we lack". This becomes a content tier rather than a fundamental rewrite.

So the mental model:

```
v5.0  (current testnet)            — feature/phase-2-design
v5.1  (testnet republish)          — feature/v5.1-contracts (planned)
       ↓ audit + hardening cycle
v6.0  (mainnet fresh publish)      — feature/v6-mainnet
v6.1+ (post-mainnet content)       — tournaments, replay, achievements, etc.
```

## 6.4 Honest assessment of the riskiest unfinished thing

In order of mainnet-launch risk:

### #1 — Settlement retry / journal is not implemented
A server crash between fight resolution and `settle_wager` (or between `settle_wager` submission and confirmation) leaves the wager in ACTIVE state with full escrow stranded. The orphan-wager sweeper handles WAITING wagers but not the post-fight gap. Today on testnet that's an admin-cancel curl away. On mainnet that's a real-money loss with a single-point-of-failure recovery (admin-only intervention) that delays the player AND signals "this game can't reliably pay out" — which kills trust permanently.

**This is THE critical mainnet blocker.** Everything else is annoying-but-recoverable; this is structurally broken.

### #2 — zkLogin confirm-popup gate
A user walks away from their screen with an active zkLogin session. Anyone walking up can fire arbitrary `accept_wager` / `list_item` / `buy_listing` PTBs without seeing a confirmation. Worse: a malicious page-injection or browser-extension can fire those silently from the same session. Both vectors are non-hypothetical on a public mainnet.

MAINNET_PREP §D calls this a "HARD MAINNET BLOCKER" and I agree.

### #3 — TREASURY trust assumption
Server signs all settlements with the TREASURY key. Key compromise = drain every ACTIVE wager + mint loot items to attacker's wallet + repin characters arbitrarily. The `MAX_XP_PER_FIGHT` + `MAX_LOCK_MS` + `MAX_BONUS` + `MAX_LEVEL_REQ` caps bound individual-call blast radius (good), but the systemic risk is real.

v5.1 `settle_wager_attested` closes the wager half. The mint / lock / repin paths still rely on TREASURY signing. Layered defences: vault with rotation; cold-multisig for key custody; monitoring on admin-signer addresses.

### #4 — `sui::random` not adopted
Server picks crit / evasion / damage rolls. Player must trust the server. Realistic on testnet; questionable on mainnet for wager fights. `sui::random` is the Sui-native path; replacing the server RNG is significant work but is on the table per `sui_latest.md`.

### #5 — Anti-collusion / self-play
A user with two wallets can wager against themselves; lose-on-purpose to launder rating; same-IP wagers; etc. Heuristic detection isn't perfect but is the floor. Today: nothing.

### #6 — Display V1 deprecation deadline (July 31 2026)
Hard date. Sui Display V1 deprecates. Frontend Display reads break. NFT art stops rendering in wallet extensions. This is two months out and needs a migration pass.

---

# Final notes on what I do NOT know with certainty

- **Exact Move-test count today.** STATE_OF_PROJECT_2026-05-17 cites 35/35; HANDOVER_2026-05-20 cites 37/37 after the 05-18 wager-race tests. I have not run `sui move test` in this session to confirm — the actual current count is one of those two, almost certainly 37.
- **Whether `arena.move::settle_wager` asserts `winner == player_a || winner == player_b`.** MAINNET_PREP §D §Contract-level security flags it as a TODO ("flagged in audit, fix before mainnet"). Reading `arena.move:160-180` it does have `assert!(winner == player_a_addr || winner == player_b_addr, EInvalidWinner)` — so this is ✅. The MAINNET_PREP TODO line is stale.
- **Whether the auto-cancel-on-disconnect handler covers ALL fight states or just open wager lobbies.** Empirically (2026-05-27 session log) it handled the ACTIVE wager `0xf3aae8c5468e…` after Mr_Boss closed his tab. But I have not read the handler exhaustively to confirm it handles every state.
- **Whether the static gauntlet total is exactly 2,307 today.** That was the figure at STATE 05-17. Between then and now I have hard evidence of `qa-kiosk-orphan` adding 46 PASS (HANDOVER 05-20), but no full re-count.
- **The exact current size of the test suite.** I would run `for f in scripts/qa-*.ts; do …; done` to get the current honest total before any "ship" decision.

If any of these matter for the decision in front of you, say so and I will run the actual command.

---

*End of audit. Compiled 2026-05-28. Single source of truth for the v5.0 → v5.1 transition.*
