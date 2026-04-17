"use client";

import { createContext, useContext } from "react";
import type { useGameSocket } from "./useGameSocket";
import type {
  Character,
  Item,
  EquipmentSlots,
  FightState,
  ChatMessage,
  OnlinePlayer,
  LeaderboardEntry,
  MarketplaceListing,
  LootBoxResult,
  WagerLobbyEntry,
} from "@/types/game";
import type { OnChainCharacter } from "@/lib/sui-contracts";
import type { FightHistoryEntry } from "@/types/ws-messages";

export interface GameState {
  // Connection
  socket: ReturnType<typeof useGameSocket>;

  // Character
  character: Character | null;
  inventory: Item[];
  onChainItems: Item[];
  onChainEquipped: Partial<Record<keyof EquipmentSlots, Item>>;
  onChainCharacter: OnChainCharacter | null;

  // Fight
  fight: FightState | null;
  fightQueue: string | null; // fight type queued for
  lootResult: LootBoxResult | null;

  // Social
  chatMessages: ChatMessage[];
  onlinePlayers: OnlinePlayer[];

  // Data
  shopItems: (Item & { price: number })[];
  leaderboard: LeaderboardEntry[];
  fightHistory: FightHistoryEntry[];
  marketplaceListings: MarketplaceListing[];

  // Spectating
  spectatingFight: FightState | null;

  // Challenges
  pendingChallenge: {
    challengeId: string;
    from: string;
    fromName: string;
    fightType: string;
  } | null;

  // Wager Lobby
  wagerLobby: WagerLobbyEntry[];

  // Wager accept (Player B)
  pendingWagerAccept: {
    wagerMatchId: string;
    stakeAmount: number;
    opponentName: string;
  } | null;

  // UI
  currentArea: "character" | "arena" | "marketplace" | "tavern" | "hall_of_fame";
  errorMessage: string | null;
  errorTimestamp: number | null;
}

export const initialGameState: GameState = {
  socket: null!,
  character: null,
  inventory: [],
  onChainItems: [],
  onChainEquipped: {},
  onChainCharacter: null,
  fight: null,
  fightQueue: null,
  lootResult: null,
  chatMessages: [],
  onlinePlayers: [],
  shopItems: [],
  leaderboard: [],
  fightHistory: [],
  marketplaceListings: [],
  spectatingFight: null,
  wagerLobby: [],
  pendingChallenge: null,
  pendingWagerAccept: null,
  currentArea: "character",
  errorMessage: null,
  errorTimestamp: null,
};

export type GameAction =
  | { type: "SET_CHARACTER"; character: Character }
  | { type: "SET_INVENTORY"; items: Item[] }
  | { type: "SET_ONCHAIN_ITEMS"; items: Item[] }
  | { type: "SET_ONCHAIN_CHARACTER"; data: OnChainCharacter | null }
  | { type: "EQUIP_ONCHAIN_ITEM"; item: Item; slot: keyof EquipmentSlots }
  | { type: "UNEQUIP_ONCHAIN_ITEM"; slot: keyof EquipmentSlots }
  | { type: "SET_FIGHT"; fight: FightState | null }
  | { type: "SET_FIGHT_QUEUE"; fightType: string | null }
  | { type: "SET_LOOT_RESULT"; loot: LootBoxResult | null }
  | { type: "ADD_CHAT_MESSAGE"; message: ChatMessage }
  | { type: "SET_ONLINE_PLAYERS"; players: OnlinePlayer[] }
  | { type: "ADD_ONLINE_PLAYER"; player: OnlinePlayer }
  | { type: "REMOVE_ONLINE_PLAYER"; walletAddress: string }
  | { type: "UPDATE_PLAYER_STATUS"; walletAddress: string; status: OnlinePlayer["status"] }
  | { type: "SET_SHOP_ITEMS"; items: (Item & { price: number })[] }
  | { type: "SET_LEADERBOARD"; entries: LeaderboardEntry[] }
  | { type: "SET_FIGHT_HISTORY"; fights: FightHistoryEntry[] }
  | { type: "SET_MARKETPLACE_LISTINGS"; listings: MarketplaceListing[] }
  | { type: "ADD_MARKETPLACE_LISTING"; listing: MarketplaceListing }
  | { type: "REMOVE_MARKETPLACE_LISTING"; listingId: string }
  | { type: "SET_SPECTATING"; fight: FightState | null }
  | { type: "SET_PENDING_CHALLENGE"; challenge: GameState["pendingChallenge"] }
  | { type: "SET_AREA"; area: GameState["currentArea"] }
  | { type: "SET_PENDING_WAGER_ACCEPT"; payload: GameState["pendingWagerAccept"] }
  | { type: "SET_WAGER_LOBBY"; entries: WagerLobbyEntry[] }
  | { type: "ADD_WAGER_LOBBY_ENTRY"; entry: WagerLobbyEntry }
  | { type: "REMOVE_WAGER_LOBBY_ENTRY"; wagerMatchId: string }
  | { type: "SET_ERROR"; message: string | null }
  | { type: "UPDATE_TURN"; turn: number; turnDeadline: number }
  | { type: "APPEND_TURN_RESULT"; fight: FightState; result: import("@/types/game").TurnResult };

export function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case "SET_CHARACTER":
      return { ...state, character: action.character };
    case "SET_INVENTORY":
      return { ...state, inventory: action.items };
    case "SET_ONCHAIN_ITEMS":
      return { ...state, onChainItems: action.items };
    case "SET_ONCHAIN_CHARACTER":
      return { ...state, onChainCharacter: action.data };
    case "EQUIP_ONCHAIN_ITEM": {
      const { item, slot } = action;
      const newOnChainItems = state.onChainItems.filter((i) => i.id !== item.id);
      const newEquipped = { ...state.onChainEquipped };
      // If slot already has an on-chain item, move it back to inventory
      const displaced = newEquipped[slot];
      if (displaced) newOnChainItems.push(displaced);
      newEquipped[slot] = item;
      return { ...state, onChainItems: newOnChainItems, onChainEquipped: newEquipped };
    }
    case "UNEQUIP_ONCHAIN_ITEM": {
      const { slot } = action;
      const newEquipped = { ...state.onChainEquipped };
      const item = newEquipped[slot];
      delete newEquipped[slot];
      const newOnChainItems = item ? [...state.onChainItems, item] : state.onChainItems;
      return { ...state, onChainItems: newOnChainItems, onChainEquipped: newEquipped };
    }
    case "SET_FIGHT":
      return { ...state, fight: action.fight };
    case "SET_FIGHT_QUEUE":
      return { ...state, fightQueue: action.fightType };
    case "SET_LOOT_RESULT":
      return { ...state, lootResult: action.loot };
    case "ADD_CHAT_MESSAGE":
      return {
        ...state,
        chatMessages: [...state.chatMessages.slice(-200), action.message],
      };
    case "SET_ONLINE_PLAYERS":
      return { ...state, onlinePlayers: action.players };
    case "ADD_ONLINE_PLAYER":
      return {
        ...state,
        onlinePlayers: [
          ...state.onlinePlayers.filter(
            (p) => p.walletAddress !== action.player.walletAddress
          ),
          action.player,
        ],
      };
    case "REMOVE_ONLINE_PLAYER":
      return {
        ...state,
        onlinePlayers: state.onlinePlayers.filter(
          (p) => p.walletAddress !== action.walletAddress
        ),
      };
    case "UPDATE_PLAYER_STATUS": {
      return {
        ...state,
        onlinePlayers: state.onlinePlayers.map((p) =>
          p.walletAddress === action.walletAddress
            ? { ...p, status: action.status }
            : p
        ),
      };
    }
    case "SET_SHOP_ITEMS":
      return { ...state, shopItems: action.items };
    case "SET_LEADERBOARD":
      return { ...state, leaderboard: action.entries };
    case "SET_FIGHT_HISTORY":
      return { ...state, fightHistory: action.fights };
    case "SET_MARKETPLACE_LISTINGS":
      return { ...state, marketplaceListings: action.listings };
    case "ADD_MARKETPLACE_LISTING":
      return {
        ...state,
        marketplaceListings: [...state.marketplaceListings, action.listing],
      };
    case "REMOVE_MARKETPLACE_LISTING":
      return {
        ...state,
        marketplaceListings: state.marketplaceListings.filter(
          (l) => l.id !== action.listingId
        ),
      };
    case "SET_SPECTATING":
      return { ...state, spectatingFight: action.fight };
    case "SET_PENDING_CHALLENGE":
      return { ...state, pendingChallenge: action.challenge };
    case "SET_AREA":
      return { ...state, currentArea: action.area };
    case "SET_PENDING_WAGER_ACCEPT":
      return { ...state, pendingWagerAccept: action.payload };
    case "SET_WAGER_LOBBY":
      return { ...state, wagerLobby: action.entries };
    case "ADD_WAGER_LOBBY_ENTRY":
      return { ...state, wagerLobby: [...state.wagerLobby, action.entry] };
    case "REMOVE_WAGER_LOBBY_ENTRY":
      return { ...state, wagerLobby: state.wagerLobby.filter(e => e.wagerMatchId !== action.wagerMatchId) };
    case "UPDATE_TURN":
      if (!state.fight) return state;
      return { ...state, fight: { ...state.fight, turn: action.turn, turnDeadline: action.turnDeadline } };
    case "APPEND_TURN_RESULT":
      if (!state.fight) return state;
      return { ...state, fight: { ...action.fight, log: [...(state.fight.log || []), action.result] } };
    case "SET_ERROR":
      return { ...state, errorMessage: action.message, errorTimestamp: action.message ? Date.now() : null };
    default:
      return state;
  }
}

export const GameContext = createContext<{
  state: GameState;
  dispatch: React.Dispatch<GameAction>;
} | null>(null);

export function useGame() {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error("useGame must be used within GameProvider");
  return ctx;
}
