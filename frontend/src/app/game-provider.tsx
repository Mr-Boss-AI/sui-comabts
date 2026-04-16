"use client";

import { useReducer, useEffect, useCallback, useRef } from "react";
import { useCurrentAccount, useCurrentClient } from "@mysten/dapp-kit-react";
import { useGameSocket } from "@/hooks/useGameSocket";
import {
  GameContext,
  gameReducer,
  initialGameState,
} from "@/hooks/useGameStore";
import type { ServerMessage } from "@/types/ws-messages";
import { playSoundIf } from "@/lib/sounds";
import { fetchCharacterNFT, fetchOwnedItems } from "@/lib/sui-contracts";
import type { SuiGrpcClient } from "@mysten/sui/grpc";

export default function GameProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const account = useCurrentAccount();
  const walletAddress = account?.address ?? null;
  const client = useCurrentClient() as SuiGrpcClient | null;
  const socket = useGameSocket(walletAddress);
  const [state, dispatch] = useReducer(gameReducer, {
    ...initialGameState,
    socket,
  });
  const onChainCheckDone = useRef(false);

  // Keep socket ref in sync
  const stateWithSocket = { ...state, socket };

  const handleMessage = useCallback(
    (msg: ServerMessage) => {
      switch (msg.type) {
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
        case "fight_end":
          dispatch({
            type: "SET_FIGHT",
            fight: msg.fight,
          });
          dispatch({ type: "SET_LOOT_RESULT", loot: msg.loot });
          dispatch({ type: "SET_FIGHT_QUEUE", fightType: null });
          if (msg.fight.winner === walletAddress) {
            playSoundIf("victory");
          } else {
            playSoundIf("defeat");
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
        case "shop_data":
          dispatch({ type: "SET_SHOP_ITEMS", items: msg.items });
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
          break;
        case "item_bought":
          dispatch({
            type: "REMOVE_MARKETPLACE_LISTING",
            listingId: msg.listing.id,
          });
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
        case "error":
          dispatch({ type: "SET_ERROR", message: msg.message });
          break;
      }
    },
    [walletAddress]
  );

  useEffect(() => {
    return socket.addHandler(handleMessage);
  }, [socket, handleMessage]);

  // Auto-fetch character on auth
  useEffect(() => {
    if (socket.authenticated) {
      socket.send({ type: "get_character" });
      socket.send({ type: "get_online_players" });
      socket.send({ type: "get_inventory" });
    }
    // Reset on-chain check when auth state changes
    onChainCheckDone.current = false;
  }, [socket, socket.authenticated]);

  // If server has no character after auth, check on-chain for existing Character NFT
  useEffect(() => {
    if (!socket.authenticated || !walletAddress || !client || onChainCheckDone.current) return;
    if (state.character) return; // Server already has the character

    // Small delay to let server respond with character_data first
    const timer = setTimeout(async () => {
      if (state.character || onChainCheckDone.current) return;
      onChainCheckDone.current = true;

      try {
        const nft = await fetchCharacterNFT(client, walletAddress);
        if (nft) {
          // Restore character on server from on-chain data
          socket.send({
            type: "create_character",
            name: nft.name,
            strength: nft.strength,
            dexterity: nft.dexterity,
            intuition: nft.intuition,
            endurance: nft.endurance,
          });
        }
      } catch {
        // On-chain query failed — player can still create manually
      }
    }, 1500);

    return () => clearTimeout(timer);
  }, [socket, socket.authenticated, walletAddress, client, state.character]);

  // Fetch on-chain Item NFTs owned by this wallet
  useEffect(() => {
    if (!socket.authenticated || !walletAddress || !client) return;

    let cancelled = false;
    (async () => {
      try {
        const items = await fetchOwnedItems(client, walletAddress);
        if (!cancelled) {
          dispatch({ type: "SET_ONCHAIN_ITEMS", items });
        }
      } catch {
        // On-chain query failed — server inventory still works
      }
    })();

    return () => { cancelled = true; };
  }, [socket.authenticated, walletAddress, client]);

  return (
    <GameContext.Provider value={{ state: stateWithSocket, dispatch }}>
      {children}
    </GameContext.Provider>
  );
}
