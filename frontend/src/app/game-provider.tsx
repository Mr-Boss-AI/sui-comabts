"use client";

import { useReducer, useEffect, useCallback, useRef } from "react";
import {
  useCurrentAccount,
  useCurrentClient,
  useDAppKit,
} from "@mysten/dapp-kit-react";
import { CurrentAccountSigner, type DAppKit } from "@mysten/dapp-kit-core";
import {
  useGameSocket,
  forgetStoredJwt,
  type SignChallengeFn,
} from "@/hooks/useGameSocket";
import {
  GameContext,
  gameReducer,
  initialGameState,
} from "@/hooks/useGameStore";
import type { ServerMessage } from "@/types/ws-messages";
import type { Item } from "@/types/game";
import { playSoundIf } from "@/lib/sounds";
import { fetchCharacterNFT, fetchOwnedItems, fetchKioskItems } from "@/lib/sui-contracts";
import { computeDirtySlots } from "@/lib/loadout";
import {
  getAcknowledgedFightId,
  shouldReplayOutcome,
} from "@/lib/fight-outcome-ack";
import type { SuiGrpcClient } from "@mysten/sui/grpc";

export default function GameProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const account = useCurrentAccount();
  const walletAddress = account?.address ?? null;
  const client = useCurrentClient() as SuiGrpcClient | null;
  const dAppKit = useDAppKit() as unknown as DAppKit;

  // The signed-challenge handshake delegates the wallet popup to dapp-kit.
  // The hook calls this when the server emits `auth_challenge`; we return the
  // base64 signature for the server to verify with verifyPersonalMessageSignature.
  const signChallenge: SignChallengeFn = useCallback(
    async (messageBytes) => {
      const signer = new CurrentAccountSigner(dAppKit);
      const result = await signer.signPersonalMessage(messageBytes);
      return result.signature;
    },
    [dAppKit],
  );

  // Reducer first so the guest-spectator flag can drive socket setup
  // BELOW. `socket` is patched in via `stateWithSocket` and used by
  // every consumer through context — the `socket: null!` initial slot
  // is never observed because the merge below always overrides it.
  const [state, dispatch] = useReducer(gameReducer, initialGameState);
  const socket = useGameSocket(walletAddress, signChallenge, state.spectatorMode);
  // Track the prior wallet address so the disconnect effect can:
  //   1) Detect a truthy → null transition (logout) without firing on
  //      first mount or on rapid re-mounts with the same value.
  //   2) Forget the JWT keyed to that specific old address (other
  //      stored JWTs for unrelated wallets are left alone).
  const prevWalletRef = useRef<string | null>(walletAddress);
  // True while a fetchCharacterNFT scan is in flight. Prevents the chain-check
  // effect from double-firing if React re-renders mid-scan (StrictMode in dev,
  // or a state update from an unrelated message). Reset on auth flip and on
  // explicit retry.
  const chainCheckInFlight = useRef(false);
  const toastedFightIdRef = useRef<string | null>(null);
  // BUG E (2026-05-02 retest #2) — handleMessage is memoised over
  // [walletAddress, socket, client], so it closes over a stale snapshot of
  // state.character. Reading state.character.onChainObjectId from inside
  // the handler requires a live ref. Updated by the effect below on every
  // character change.
  const pinnedCharIdRef = useRef<string | null>(null);

  // Keep socket ref in sync
  const stateWithSocket = { ...state, socket };

  const handleMessage = useCallback(
    (msg: ServerMessage) => {
      switch (msg.type) {
        case "auth_ok":
          // BUG D fix (2026-05-02 retest): the server's auth_ok payload
          // already carries the fully-hydrated character (DOF equipment
          // included via acceptAuthenticatedSession + hydrateDOFsForCharacter).
          // Pre-fix this handler didn't dispatch — game-provider waited for
          // the redundant get_character round-trip, exposing a window where
          // game-screen rendered with character=null AFTER auth completed
          // (LoadingScreen looked skipped). Dispatching here makes the
          // gate release with full equipment in one step.
          //
          // Bug 6 (2026-05-19) — server-restart amnesia self-heal. When the
          // server restarts WITHOUT Supabase, the in-memory characters map
          // is empty after boot. The client auto-reconnects with its
          // existing JWT (`auth_token`) and the server responds with
          // `auth_ok` carrying `hasCharacter: false, character: null` —
          // but the FRONTEND's reducer still holds the pre-restart
          // character. Pre-fix the null branch was silent: state.character
          // stayed stale, the chain-check effect bailed (its
          // `state.character` guard), and `restore_character` was never
          // sent. Any subsequent action (queue_fight, allocate_points,
          // equip_item, …) hit a missing-character sendError; create_wager
          // already-signed-on-chain ended up as an orphan (see
          // 0xd94d...01a2). Now: when auth_ok reports no character but we
          // hold one, dispatch BEGIN_SERVER_REHYDRATE. The reducer drops
          // the cached character + flips authPhase to chain_check_pending;
          // the chain-check effect re-arms, fetches the on-chain NFT, and
          // re-sends restore_character. PreCharacterGate renders the
          // "Checking the chain for your fighter…" loader during the
          // round-trip so every wallet-action button is blocked.
          if (msg.character) {
            dispatch({ type: "SET_CHARACTER", character: msg.character });
          } else if (msg.hasCharacter === false) {
            // Only rehydrate when there IS a cached character — a
            // genuinely-no-character session (never minted, or just
            // deleted) keeps the existing PreCharacterGate flow.
            dispatch({ type: "BEGIN_SERVER_REHYDRATE" });
          }
          break;
        case "character_data":
        case "character_created":
        case "points_allocated":
        case "item_equipped":
          dispatch({ type: "SET_CHARACTER", character: msg.character });
          if (msg.type === "character_created") playSoundIf("level_up");
          break;
        case "item_unequipped":
          dispatch({ type: "SET_CHARACTER", character: msg.character });
          break;
        case "item_purchased":
          dispatch({ type: "SET_CHARACTER", character: msg.character });
          playSoundIf("purchase");
          break;
        case "inventory":
          dispatch({ type: "SET_INVENTORY", items: msg.items });
          break;
        case "queue_joined":
          dispatch({ type: "SET_FIGHT_QUEUE", fightType: msg.fightType });
          break;
        case "queue_left":
          dispatch({ type: "SET_FIGHT_QUEUE", fightType: null });
          break;
        case "character_leveled_up":
          // Fix 3 (2026-05-04) — server emitted this after
          // `update_after_fight` confirmed a level threshold crossing.
          // The reducer merges with any pre-existing event (rare
          // multi-fight burst) and the LevelUpController surfaces the
          // modal once the active fight ends.
          dispatch({
            type: "SET_LEVEL_UP_EVENT",
            payload: {
              oldLevel: msg.oldLevel,
              newLevel: msg.newLevel,
              pointsGranted: msg.pointsGranted,
              newTotalUnallocated: msg.newTotalUnallocated,
              fightId: msg.fightId,
            },
          });
          playSoundIf("level_up");
          break;
        case "wager_accept_required":
          dispatch({
            type: "SET_PENDING_WAGER_ACCEPT",
            payload: {
              wagerMatchId: msg.wagerMatchId,
              stakeAmount: msg.stakeAmount,
              opponentName: msg.playerAName,
            },
          });
          dispatch({ type: "SET_FIGHT_QUEUE", fightType: null });
          break;
        case "wager_accept_timeout":
          dispatch({ type: "SET_PENDING_WAGER_ACCEPT", payload: null });
          dispatch({ type: "SET_FIGHT_QUEUE", fightType: null });
          break;
        case "wager_settled":
          // Informational — the fight_end message handles UI
          console.log("[Wager] Settled on-chain:", msg.txDigest);
          break;
        case "wager_lobby_list":
          dispatch({ type: "SET_WAGER_LOBBY", entries: msg.entries });
          break;
        case "wager_lobby_added":
          dispatch({ type: "ADD_WAGER_LOBBY_ENTRY", entry: msg.entry });
          break;
        case "wager_lobby_updated":
          // v5.2 — in-place transition (WAITING ↔ PENDING_APPROVAL).
          dispatch({ type: "UPDATE_WAGER_LOBBY_ENTRY", entry: msg.entry });
          break;
        case "wager_lobby_removed":
          dispatch({ type: "REMOVE_WAGER_LOBBY_ENTRY", wagerMatchId: msg.wagerMatchId });
          break;
        case "wager_notification":
          // v5.2 (2026-05-31) — targeted CENTERED MODAL to the party
          // affected by a state transition they didn't sign. The
          // wager-lobby entry has already updated (or removed) via
          // the prior wager_lobby_updated broadcast; this is the
          // explicit "your stake was just refunded" / "your challenger
          // walked away" UX cue. Routed through SET_WAGER_NOTIFICATION
          // (not SET_ERROR) so it renders as the centered, deliberate-
          // dismiss WagerNotificationModal rather than the bottom-corner
          // 5s-fade error toast — these are stake-bearing financial
          // events that warrant a deliberate ack.
          dispatch({
            type: "SET_WAGER_NOTIFICATION",
            payload: {
              kind: msg.kind,
              wagerMatchId: msg.wagerMatchId,
              message: msg.message,
            },
          });
          break;
        case "fight_start":
          dispatch({ type: "SET_FIGHT", fight: msg.fight });
          dispatch({ type: "SET_FIGHT_QUEUE", fightType: null });
          dispatch({ type: "SET_PENDING_WAGER_ACCEPT", payload: null });
          playSoundIf("challenge");
          break;
        case "turn_start":
          dispatch({ type: "UPDATE_TURN", turn: msg.turn, turnDeadline: msg.deadline });
          playSoundIf("turn_start");
          break;
        case "turn_result":
          dispatch({ type: "APPEND_TURN_RESULT", fight: msg.fight, result: msg.result });
          // Play hit sounds
          for (const hit of [...msg.result.playerA.hits, ...msg.result.playerB.hits]) {
            if (hit.blocked) playSoundIf("block");
            else if (hit.dodged) playSoundIf("dodge");
            else if (hit.crit) playSoundIf("crit");
            else if (hit.damage > 0) playSoundIf("hit");
          }
          break;
        case "opponent_disconnected":
          // Block C1.a (hotfix) — drive the persistent banner. The
          // toast-based version flashed and disappeared, leaving the
          // connected player no signal that the game was waiting on a
          // reconnect. The banner ticks down to expiresAt and clears
          // only on opponent_reconnected / fight_resumed / fight_end.
          dispatch({
            type: "SET_OPPONENT_DISCONNECT",
            payload: {
              fightId: msg.fightId,
              walletAddress: msg.walletAddress,
              expiresAt: msg.expiresAt,
              graceMs: msg.graceMs,
            },
          });
          break;
        case "opponent_reconnected":
          // Clear the banner. The TurnTimer will resume on the
          // separate timer_resumed message.
          dispatch({ type: "SET_OPPONENT_DISCONNECT", payload: null });
          break;
        case "timer_paused":
          // Block C1.b — server paused the turn timer. Mirror into
          // fight.turnPaused so the TurnTimer freezes its countdown.
          dispatch({
            type: "SET_TURN_PAUSE",
            paused: true,
            remainingMs: msg.remainingMs,
            deadline: null,
          });
          break;
        case "timer_resumed":
          dispatch({
            type: "SET_TURN_PAUSE",
            paused: false,
            remainingMs: msg.remainingMs,
            deadline: msg.deadline,
          });
          break;
        case "fight_resumed":
          // Block C1.c — we were the one who reconnected. The payload
          // carries the live timer state (turnDeadline / turnPaused /
          // turnPausedRemainingMs) and the last-saved equipment. Set
          // the fight state and clear the banner if it was our drop.
          dispatch({ type: "SET_FIGHT", fight: msg.fight });
          dispatch({ type: "SET_OPPONENT_DISCONNECT", payload: null });
          break;
        case "fight_end":
          dispatch({
            type: "SET_FIGHT",
            fight: msg.fight,
          });
          dispatch({ type: "SET_LOOT_RESULT", loot: msg.loot });
          dispatch({ type: "SET_FIGHT_QUEUE", fightType: null });
          // Re-fetch server character data (updated XP, wins, losses, rating)
          socket.send({ type: "get_character" });
          // Three-state — server sends `winner: null` on a mutual-KO
          // draw (fight-room.ts:820). Skip the sting on draw so it
          // doesn't fall through to the defeat audio.
          if (msg.fight.winner == null) {
            // draw — no sound
          } else if (msg.fight.winner === walletAddress) {
            playSoundIf("victory");
          } else {
            playSoundIf("defeat");
          }
          break;
        case "recent_fight_settled": {
          // Bug 3 (2026-05-03) — server replays the most recent settled
          // fight on auth so a player who was offline at settle time
          // sees the modal once. Skip if the user has already
          // acknowledged this fight id on a prior session (localStorage
          // dedupe via `lib/fight-outcome-ack.ts`).
          const lastAck = walletAddress
            ? getAcknowledgedFightId(walletAddress)
            : null;
          if (shouldReplayOutcome(msg.fight.id, lastAck)) {
            dispatch({ type: "SET_FIGHT", fight: msg.fight });
            dispatch({ type: "SET_LOOT_RESULT", loot: msg.loot });
            dispatch({ type: "SET_FIGHT_QUEUE", fightType: null });
            // Refresh chain-side stats once — XP / level / rating land
            // via `update_after_fight` shortly after server settlement.
            socket.send({ type: "get_character" });
            // No victory/defeat sound — the moment of settlement was
            // earlier; replaying the sting now would feel jarring.
          }
          break;
        }
        case "character_deleted":
          dispatch({ type: "SET_CHARACTER", character: null as any });
          dispatch({ type: "SET_ONCHAIN_CHARACTER", data: null });
          break;
        case "character_updated_onchain":
          // On-chain update complete — re-fetch for unallocated points / level
          // Use the server-pinned id (BUG E fix) so multi-character wallets
          // (mr_boss has 3 NFTs) read the canonical NFT, not whichever
          // CharacterCreated event happens to be newest.
          if (client && walletAddress) {
            (async () => {
              try {
                const nft = await fetchCharacterNFT(
                  client,
                  walletAddress,
                  pinnedCharIdRef.current,
                );
                if (nft) dispatch({ type: "SET_ONCHAIN_CHARACTER", data: nft });
              } catch {}
            })();
          }
          break;
        case "chat":
          dispatch({ type: "ADD_CHAT_MESSAGE", message: msg.message });
          if (msg.message.type === "whisper") playSoundIf("chat");
          break;
        case "online_players":
          dispatch({ type: "SET_ONLINE_PLAYERS", players: msg.players });
          break;
        case "player_joined":
          dispatch({ type: "ADD_ONLINE_PLAYER", player: msg.player });
          break;
        case "player_left":
          dispatch({
            type: "REMOVE_ONLINE_PLAYER",
            walletAddress: msg.walletAddress,
          });
          break;
        case "player_status_changed":
          dispatch({
            type: "UPDATE_PLAYER_STATUS",
            walletAddress: msg.walletAddress,
            status: msg.status,
          });
          break;
        case "leaderboard":
          dispatch({ type: "SET_LEADERBOARD", entries: msg.entries });
          break;
        case "fight_history":
          dispatch({ type: "SET_FIGHT_HISTORY", fights: msg.fights });
          break;
        case "marketplace_data":
          dispatch({
            type: "SET_MARKETPLACE_LISTINGS",
            listings: msg.listings,
          });
          break;
        case "item_listed":
          dispatch({
            type: "ADD_MARKETPLACE_LISTING",
            listing: msg.listing,
          });
          break;
        case "item_delisted":
          dispatch({
            type: "REMOVE_MARKETPLACE_LISTING",
            listingId: msg.listingId,
          });
          // Seller-side reactive refresh: if I own the kiosk this listing
          // was in, my listing count + on-chain item set just changed even
          // though I might not be the tab that signed the delist (e.g. a
          // second tab open on the same wallet). BUMP triggers
          // `fetchOwnedItems`, `fetchKioskItems`, and `useKiosk`.
          if (msg.seller && walletAddress &&
              msg.seller.toLowerCase() === walletAddress.toLowerCase()) {
            dispatch({ type: "BUMP_ONCHAIN_REFRESH" });
          }
          break;
        case "item_bought":
          dispatch({
            type: "REMOVE_MARKETPLACE_LISTING",
            listingId: msg.listing.id,
          });
          // Seller-side reactive refresh: I didn't sign the buy tx (the
          // BUYER did), so without this the seller's profits + item_count
          // would lag chain until the next manual refresh. With this, the
          // seller sees their profits jump within the gRPC delivery
          // latency of the ItemPurchased event.
          if (msg.seller && walletAddress &&
              msg.seller.toLowerCase() === walletAddress.toLowerCase()) {
            dispatch({ type: "BUMP_ONCHAIN_REFRESH" });
          }
          break;
        case "spectate_update":
          // Two-shape message — see ws-messages.ts. List-only replies
          // (no `fight`) come from the SpectatorLanding initial fetch
          // and feed the active-fights picker; live-fight replies route
          // straight to the SET_SPECTATING slice that <SpectateView />
          // renders.
          if (msg.fight) {
            dispatch({ type: "SET_SPECTATING", fight: msg.fight });
          }
          if (msg.activeFights) {
            dispatch({ type: "SET_ACTIVE_SPECTATE_FIGHTS", fights: msg.activeFights });
          }
          break;
        case "challenge_received":
          dispatch({
            type: "SET_PENDING_CHALLENGE",
            challenge: {
              challengeId: msg.challengeId,
              from: msg.from,
              fromName: msg.fromName,
              fightType: msg.fightType,
            },
          });
          playSoundIf("challenge");
          break;
        case "challenge_accepted":
          dispatch({ type: "SET_FIGHT", fight: msg.fight });
          dispatch({ type: "SET_PENDING_CHALLENGE", challenge: null });
          break;
        case "challenge_declined":
          dispatch({ type: "SET_PENDING_CHALLENGE", challenge: null });
          break;
        case "fight_request_received":
          dispatch({
            type: "ADD_INCOMING_FIGHT_REQUEST",
            request: msg.request,
          });
          playSoundIf("challenge");
          break;
        case "fight_request_sent":
          dispatch({
            type: "ADD_OUTGOING_FIGHT_REQUEST",
            request: msg.request,
          });
          break;
        case "fight_request_resolved":
          dispatch({ type: "REMOVE_FIGHT_REQUEST", requestId: msg.request.id });
          if (msg.action === "accept" && msg.request.requestType === "wager") {
            // Wager challenge accepted by target — open the wager-create
            // flow for the challenger with the stake pre-filled. The
            // prefilledWagerTarget slice survives the area switch.
            const isChallenger =
              walletAddress?.toLowerCase() === msg.request.fromWallet.toLowerCase();
            if (isChallenger) {
              dispatch({
                type: "SET_PREFILLED_WAGER_TARGET",
                target: {
                  wallet: msg.request.toWallet,
                  name: msg.request.toName,
                  stakeMist: msg.request.stakeMist ?? undefined,
                },
              });
              dispatch({ type: "SET_AREA", area: "arena" });
            }
          }
          break;
        case "fight_request_pending_list":
          dispatch({
            type: "SET_FIGHT_REQUEST_LISTS",
            incoming: msg.incoming,
            outgoing: msg.outgoing,
          });
          break;
        case "wager_challenge_ready":
          // Target accepted my wager challenge — same as the resolve
          // path above, surfaced as its own event for clarity. Already
          // handled by the resolve branch when this client is the
          // challenger; the explicit message is a nice-to-have for
          // future UI hooks.
          break;
        case "wager_challenge_waiting":
          // Challenger needs to sign create_wager. Surface a transient
          // info banner so the target understands what they're waiting
          // for. The wager will appear in the lobby filtered to the
          // pair when the challenger signs.
          dispatch({
            type: "SET_ERROR",
            message: `Waiting for ${msg.request.fromName} to sign the wager…`,
            sticky: false,
          });
          break;
        case "player_profile":
          dispatch({ type: "SET_PLAYER_PROFILE", profile: msg.profile });
          break;
        case "player_profile_not_found":
          dispatch({
            type: "SET_ERROR",
            message: "Could not load player profile",
            sticky: false,
          });
          dispatch({ type: "OPEN_PROFILE", walletAddress: null });
          break;
        case "dm_channels_list":
          dispatch({
            type: "SET_DM_CHANNELS",
            channels: msg.channels,
            totalUnread: msg.totalUnread,
          });
          break;
        case "dm_channel_registered":
          dispatch({ type: "UPSERT_DM_CHANNEL", channel: msg.channel });
          break;
        case "dm_unread_changed": {
          dispatch({
            type: "SET_DM_UNREAD",
            channelId: msg.channelId,
            unreadCount: msg.unreadCount,
            totalUnread: msg.totalUnread,
            lastMessageAt: msg.lastMessageAt,
          });
          // Toast surface (Bug 2 fix). The reducer owns:
          //   • the openDmPeer check (skip toast if panel for sender
          //     is already open) — uses LIVE state, not stale closure
          //   • the onlinePlayers lookup for peerName
          //   • the FIFO/coalesce/cap logic
          // We just dispatch the wire facts. The bump path (server's
          // notify_dm_sent → recipient) carries `senderWallet`; the
          // self-clear ack does NOT, which is how we tell the two
          // apart without a separate event type.
          if (msg.unreadCount > 0 && msg.senderWallet) {
            dispatch({
              type: "PUSH_DM_TOAST",
              senderWallet: msg.senderWallet,
              channelId: msg.channelId,
              unreadCount: msg.unreadCount,
            });
            playSoundIf("chat");
          }
          break;
        }
        case "room_entered":
          // Server ack — no-op besides closing the round-trip; useful
          // for future telemetry hooks.
          break;
        case "error": {
          // BUG B fix (2026-05-02 retest): "Not authenticated. Send
          // auth_request first." fires when a client message arrives
          // during a WS auth-pending window (fresh socket re-connecting,
          // auth_token round-trip not done). The user can't act on it
          // and useGameSocket auto-retries the handshake. Surfacing it
          // as a red toast confused the user during stat-allocate, which
          // landed the chain tx then sent its WS sync mid-reconnect.
          // Demote to a console log so the auto-recovery is silent.
          if (
            msg.message === "Not authenticated. Send auth_request first." ||
            msg.message === "Not authenticated"
          ) {
            console.warn(
              "[WS] auth-pending error suppressed (auto-retries via auth_token):",
              msg.message,
            );
            break;
          }
          dispatch({
            type: "SET_ERROR",
            message: msg.message,
            // Sticky errors bypass the auto-fade — used for irreversible chain
            // events the player must see (failed fight-lock release, stuck wager).
            sticky: msg.sticky === true,
          });
          break;
        }
      }
    },
    [walletAddress, socket, client]
  );

  useEffect(() => {
    return socket.addHandler(handleMessage);
  }, [socket, handleMessage]);

  // Wallet-disconnect watcher (Bug 1 fix, 2026-05-18).
  // ──────────────────────────────────────────────────────────────────────
  // When dApp Kit's `useCurrentAccount()` flips from a connected address
  // back to null (Disconnect button, account switcher dismissing the
  // session, wallet extension removed mid-session, Enoki sign-out), the
  // useGameSocket effect tears down the WS but leaves every wallet-scoped
  // slice in the reducer untouched. Pre-fix that meant the Navbar still
  // rendered the old character avatar / name / LV badge / ELO over the
  // LandingPage (the inline `if (!account) return <LandingPage />` in
  // game-screen only short-circuits the body — the surrounding Navbar
  // reads `state.character` and rendered the stale row until manual
  // refresh).
  //
  // We watch the previous → current transition explicitly. Effects with
  // a `[walletAddress]` dep fire on EVERY change including null → addr
  // (connect) and addr1 → addr2 (account swap); only truthy → null is
  // the "logout" path that needs the full reset. Account swaps still
  // need a reset too — different wallet, different character — so we
  // also treat addr1 → addr2 as a wipe + re-init.
  //
  // Side-effects bundled here so they don't drift apart:
  //   1. `RESET_WALLET_SCOPED` clears every wallet-keyed slice via
  //      `buildWalletScopedReset` (single source of truth tested by
  //      qa-wallet-disconnect-reset.ts).
  //   2. `forgetStoredJwt` evicts the JWT for the *old* address so the
  //      next session on that wallet re-signs (explicit disconnect is a
  //      signout-intent, not a refresh). Other wallets' JWTs are
  //      untouched.
  //   3. `acknowledgedFightId` localStorage entries aren't wallet-keyed
  //      and survive cleanly — fight-outcome ack is per-fight, not
  //      per-wallet.
  useEffect(() => {
    const prev = prevWalletRef.current;
    prevWalletRef.current = walletAddress;
    if (prev === walletAddress) return;

    if (prev !== null && walletAddress === null) {
      // Truthy → null. Full disconnect.
      forgetStoredJwt(prev);
      dispatch({ type: "RESET_WALLET_SCOPED" });
      return;
    }
    if (prev !== null && walletAddress !== null && prev !== walletAddress) {
      // Account swap. The new wallet's character/inventory/etc are
      // entirely separate from the old — wipe and let the auth flow
      // hydrate the new session from scratch.
      forgetStoredJwt(prev);
      dispatch({ type: "RESET_WALLET_SCOPED" });
      return;
    }
    if (prev === null && walletAddress !== null) {
      // Null → truthy. Connect path. The reducer's spectatorMode is no
      // longer meaningful (the authenticated UI takes over), so drop it
      // explicitly. RESET would be too aggressive (it would re-clear
      // auth phase / area state we may already be hydrating).
      if (state.spectatorMode) {
        dispatch({ type: "SET_SPECTATOR_MODE", enabled: false });
      }
    }
  }, [walletAddress, state.spectatorMode]);

  // Keep the pinned-id ref in sync with state.character. handleMessage
  // reads pinnedCharIdRef.current when it needs to refresh the chain
  // character — using the SERVER-pinned id ensures the frontend reads
  // chain truth from the same NFT the server is using (closes BUG E).
  useEffect(() => {
    pinnedCharIdRef.current = state.character?.onChainObjectId ?? null;
  }, [state.character?.onChainObjectId]);

  // Auto-fetch character on auth, and prime the auth-phase state machine.
  useEffect(() => {
    if (socket.authenticated) {
      socket.send({ type: "get_character" });
      socket.send({ type: "get_online_players" });
      socket.send({ type: "get_inventory" });
      socket.send({ type: "get_wager_lobby" });
      // Bucket 3 — bootstrap social slices.
      socket.send({ type: "get_pending_fight_requests" });
      socket.send({ type: "get_dm_channels" });
      socket.send({ type: "enter_room", room: state.currentArea as never });
    } else {
      // Wallet disconnected / token expired / fresh page load — roll the gate
      // back to "auth_pending" so the LoadingScreen renders during the
      // signed-challenge handshake instead of leaking the create-character
      // form. Layer 1 of the duplicate-mint fix.
      dispatch({ type: "SET_AUTH_PHASE", phase: "auth_pending" });
    }
    chainCheckInFlight.current = false;
  }, [socket, socket.authenticated]);

  // Auth-phase state machine
  // ──────────────────────────────────────────────────────────────────────
  // The previous build rendered <CharacterCreation /> as the default fallback
  // any time `state.character` was null — including the 1.5s window between
  // wallet connect and the on-chain `fetchCharacterNFT` resolving. A user who
  // clicked Create during that window could mint a SECOND Character NFT on a
  // wallet that already had one. Reproduced live 2026-04-30 (mr_boss minted
  // "mee" on top of Mr_Boss_v5.1). See STATUS_v5.md.
  //
  // Layer 1 of the fix: explicit phases. The create-character form ONLY
  // renders when `authPhase === "no_character"` — which we transition to only
  // after a definitive null response from the chain. RPC failures land in
  // "chain_check_failed" and surface a retry button instead of falling
  // through to the form.
  // ──────────────────────────────────────────────────────────────────────
  useEffect(() => {
    // Without auth or RPC infra we can't run the check. The auth-flip effect
    // above is responsible for resetting to "auth_pending" in that branch,
    // so we just bail.
    if (!socket.authenticated || !walletAddress || !client) return;

    // Server already returned a character (auth_ok included it, or get_character
    // landed first). The gate UI is bypassed entirely; phase is irrelevant.
    if (state.character) return;

    // Prime the chain check on the first authenticated tick. The actual scan
    // runs in a separate branch below — this just records intent so the
    // gate UI can render the LoadingScreen immediately.
    if (state.authPhase === "auth_pending") {
      dispatch({ type: "SET_AUTH_PHASE", phase: "chain_check_pending" });
      return;
    }

    // Only the "chain_check_pending" phase performs the network scan. The
    // explicit retry path also drops us back into this phase, so a single
    // branch handles both first-load and post-failure retries.
    if (state.authPhase !== "chain_check_pending") return;
    if (chainCheckInFlight.current) return;

    chainCheckInFlight.current = true;
    let cancelled = false;
    (async () => {
      try {
        const nft = await fetchCharacterNFT(client, walletAddress);
        if (cancelled) return;
        if (nft) {
          // Existing on-chain character — sync server state via
          // restore_character (NOT create_character). On-chain stats may sum
          // > 20 from leveling, which would fail create_character validation.
          // Passing objectId pins THIS NFT server-side so later admin calls
          // (update_after_fight, set_fight_lock, DOF reads) target the
          // correct Character even when the wallet has multiple. The reply
          // arrives as `character_created` → SET_CHARACTER, which makes the
          // gate UI step aside automatically.
          socket.send({
            type: "restore_character",
            name: nft.name,
            objectId: nft.objectId,
            strength: nft.strength,
            dexterity: nft.dexterity,
            intuition: nft.intuition,
            endurance: nft.endurance,
            level: nft.level,
            xp: nft.xp,
            unallocatedPoints: nft.unallocatedPoints,
            wins: nft.wins,
            losses: nft.losses,
            draws: nft.draws,
            rating: nft.rating,
          });
          // Phase stays "chain_check_pending" — LoadingScreen continues
          // showing until SET_CHARACTER lands. Worst case (server doesn't
          // reply), the user can refresh; we never fall through to the
          // create form here.
        } else {
          // Definitive null — chain has no Character for this wallet. NOW
          // it's safe to render <CharacterCreation />.
          dispatch({ type: "SET_AUTH_PHASE", phase: "no_character" });
        }
      } catch (err) {
        if (cancelled) return;
        console.warn("[ChainCheck] fetchCharacterNFT threw:", err);
        // Chain RPC error. Show error+retry, NOT the create form. The
        // alternative — silently dropping into "no_character" — is what
        // caused the 2026-04-30 duplicate-mint incident.
        dispatch({ type: "SET_AUTH_PHASE", phase: "chain_check_failed" });
      } finally {
        chainCheckInFlight.current = false;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    socket,
    socket.authenticated,
    walletAddress,
    client,
    state.character,
    state.authPhase,
  ]);

  // Fetch on-chain Character NFT (for unallocated_points, level, xp)
  // Re-runs when onChainRefreshTrigger bumps (after successful equip/unequip)
  // OR when the server pins a different canonical id (e.g. via the admin
  // repin endpoint) so the chain read tracks the server's source of truth.
  useEffect(() => {
    if (!socket.authenticated || !walletAddress || !client) return;
    let cancelled = false;
    const pinnedId = state.character?.onChainObjectId ?? null;
    (async () => {
      try {
        // BUG E fix (2026-05-02 retest #2): pass the server-pinned id so
        // the read targets the canonical NFT instead of "whichever
        // CharacterCreated event happens to be newest" — which broke
        // mr_boss (3 chain Characters: Mr_Boss_v5 / Mr_Boss_v5.1 / "mee";
        // descending scan returned "mee" with 0 unallocated while server
        // had Mr_Boss_v5.1 with 6 pinned).
        const nft = await fetchCharacterNFT(client, walletAddress, pinnedId);
        if (!cancelled && nft) {
          dispatch({ type: "SET_ONCHAIN_CHARACTER", data: nft });
        }
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [
    socket.authenticated,
    walletAddress,
    client,
    state.onChainRefreshTrigger,
    state.character?.onChainObjectId,
  ]);

  // Fight-with-dirty toast (LOADOUT_DESIGN.md D4). When a fight begins and the
  // user had staged-but-unsaved changes, surface a one-time info message so
  // they understand why the combat stats reflect last-saved gear instead of
  // what's on their doll. Keyed to fightId so the toast doesn't retrigger on
  // every turn_result within the same fight.
  useEffect(() => {
    const fightId = state.fight?.id ?? null;
    if (!fightId) {
      toastedFightIdRef.current = null;
      return;
    }
    if (fightId === toastedFightIdRef.current) return;
    toastedFightIdRef.current = fightId;
    const dirty = computeDirtySlots(state.committedEquipment, state.pendingEquipment);
    if (dirty.size > 0) {
      dispatch({
        type: "SET_ERROR",
        message: `Fighting with last saved loadout. ${dirty.size} staged change${dirty.size === 1 ? "" : "s"} inactive until you Save.`,
      });
    }
  }, [state.fight, state.committedEquipment, state.pendingEquipment]);

  // Bucket 3 — broadcast room changes so the player sidebar can show
  // who's where. Server tracks `currentRoom` per wallet via the
  // presence service.
  useEffect(() => {
    if (!socket.authenticated) return;
    socket.send({ type: "enter_room", room: state.currentArea as never });
  }, [socket, socket.authenticated, state.currentArea]);

  // Heartbeat tick — every 20s. Without it, presence rows go stale
  // after PRESENCE_STALE_MS (60s) and the player drops off the
  // sidebar. The send() helper queues during reconnect windows so a
  // brief WS drop doesn't kill the heartbeat.
  useEffect(() => {
    if (!socket.authenticated) return;
    const id = setInterval(() => {
      socket.send({ type: "presence_heartbeat" });
    }, 20_000);
    return () => clearInterval(id);
  }, [socket, socket.authenticated]);

  // Fetch on-chain Item NFTs owned by this wallet.
  // Re-runs on onChainRefreshTrigger bump — critical because equipped items
  // become DOFs and should disappear from the wallet-owned list here.
  useEffect(() => {
    if (!socket.authenticated || !walletAddress || !client) return;

    let cancelled = false;
    (async () => {
      try {
        const [owned, kiosk] = await Promise.all([
          fetchOwnedItems(client, walletAddress),
          fetchKioskItems(client, walletAddress).catch((): Item[] => []),
        ]);
        if (!cancelled) {
          dispatch({ type: "SET_ONCHAIN_ITEMS", items: [...owned, ...kiosk] });
        }
      } catch {
        // On-chain query failed — server inventory still works
      }
    })();

    return () => { cancelled = true; };
  }, [socket.authenticated, walletAddress, client, state.onChainRefreshTrigger]);

  return (
    <GameContext.Provider value={{ state: stateWithSocket, dispatch }}>
      {children}
    </GameContext.Provider>
  );
}
