"use client";

import { useReducer, useEffect, useCallback, useRef } from "react";
import {
  useCurrentAccount,
  useCurrentClient,
  useDAppKit,
} from "@mysten/dapp-kit-react";
import { CurrentAccountSigner, type DAppKit } from "@mysten/dapp-kit-core";
import { useGameSocket, type SignChallengeFn } from "@/hooks/useGameSocket";
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

  const socket = useGameSocket(walletAddress, signChallenge);
  const [state, dispatch] = useReducer(gameReducer, {
    ...initialGameState,
    socket,
  });
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
          if (msg.character) {
            dispatch({ type: "SET_CHARACTER", character: msg.character });
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
        case "wager_lobby_removed":
          dispatch({ type: "REMOVE_WAGER_LOBBY_ENTRY", wagerMatchId: msg.wagerMatchId });
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
          if (msg.fight.winner === walletAddress) {
            playSoundIf("victory");
          } else {
            playSoundIf("defeat");
          }
          break;
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
          dispatch({ type: "SET_SPECTATING", fight: msg.fight });
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
