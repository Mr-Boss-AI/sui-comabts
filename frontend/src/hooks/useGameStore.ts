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
import { EMPTY_EQUIPMENT, cloneEquipment } from "@/lib/loadout";

export interface GameState {
  // Connection
  socket: ReturnType<typeof useGameSocket>;

  // Character
  character: Character | null;
  inventory: Item[];
  onChainItems: Item[];
  onChainCharacter: OnChainCharacter | null;

  // Loadout save flow (LOADOUT_DESIGN.md D1-D5). Two parallel slices:
  //   committedEquipment — snapshot of the last chain-saved loadout. Written
  //     on SET_CHARACTER (server hydrates from DOFs) and on COMMIT_SAVED
  //     (after a saveLoadout PTB lands). This is what combat uses and what
  //     fight-arena renders.
  //   pendingEquipment — mutable local copy the user fiddles with via
  //     STAGE_EQUIP / STAGE_UNEQUIP. `computeDirtySlots(committed, pending)`
  //     produces the set of slots that changed. This is what the character
  //     page doll + inventory hide-set render against.
  committedEquipment: EquipmentSlots;
  pendingEquipment: EquipmentSlots;

  // Fight
  fight: FightState | null;
  fightQueue: string | null; // fight type queued for
  lootResult: LootBoxResult | null;

  // Social
  chatMessages: ChatMessage[];
  onlinePlayers: OnlinePlayer[];

  // Data
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
  // Sticky errors bypass the 5s auto-fade and require user dismissal.
  // Use for irreversible/financial events the player must see — e.g. a
  // wager lock that didn't register with the server.
  errorSticky: boolean;

  // Bump to force GameProvider to re-fetch on-chain items + character NFT.
  // Incremented after every successful on-chain equip/unequip so the UI reconverges
  // with chain truth (especially important: equipped items become DOFs and should
  // disappear from the wallet-owned list).
  onChainRefreshTrigger: number;
}

export const initialGameState: GameState = {
  socket: null!,
  character: null,
  inventory: [],
  onChainItems: [],
  onChainCharacter: null,
  committedEquipment: EMPTY_EQUIPMENT,
  pendingEquipment: EMPTY_EQUIPMENT,
  fight: null,
  fightQueue: null,
  lootResult: null,
  chatMessages: [],
  onlinePlayers: [],
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
  errorSticky: false,
  onChainRefreshTrigger: 0,
};

export type GameAction =
  | { type: "SET_CHARACTER"; character: Character }
  | { type: "SET_INVENTORY"; items: Item[] }
  | { type: "SET_ONCHAIN_ITEMS"; items: Item[] }
  | { type: "SET_ONCHAIN_CHARACTER"; data: OnChainCharacter | null }
  // Loadout save flow (LOADOUT_DESIGN.md D1-D5).
  | { type: "STAGE_EQUIP"; item: Item; slot: keyof EquipmentSlots }
  | { type: "STAGE_UNEQUIP"; slot: keyof EquipmentSlots }
  | { type: "STAGE_DISCARD" }
  | { type: "COMMIT_SAVED"; committed: EquipmentSlots }
  | { type: "SET_FIGHT"; fight: FightState | null }
  | { type: "SET_FIGHT_QUEUE"; fightType: string | null }
  | { type: "SET_LOOT_RESULT"; loot: LootBoxResult | null }
  | { type: "ADD_CHAT_MESSAGE"; message: ChatMessage }
  | { type: "SET_ONLINE_PLAYERS"; players: OnlinePlayer[] }
  | { type: "ADD_ONLINE_PLAYER"; player: OnlinePlayer }
  | { type: "REMOVE_ONLINE_PLAYER"; walletAddress: string }
  | { type: "UPDATE_PLAYER_STATUS"; walletAddress: string; status: OnlinePlayer["status"] }
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
  | { type: "SET_ERROR"; message: string | null; sticky?: boolean }
  | { type: "BUMP_ONCHAIN_REFRESH" }
  | { type: "UPDATE_TURN"; turn: number; turnDeadline: number }
  | { type: "APPEND_TURN_RESULT"; fight: FightState; result: import("@/types/game").TurnResult };

export function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case "SET_CHARACTER": {
      // Snapshot committed = chain-truth from server. Rebase pending when
      // either condition holds:
      //   1. Chain state changed (new slot set on chain) — user's local
      //      fiddling is now stale vs the chain, start over from chain truth.
      //   2. Pending is effectively unhydrated (all nulls) — the very first
      //      SET_CHARACTER of a session, or a refresh after an explicit
      //      STAGE_DISCARD. Without this, pending stays EMPTY_EQUIPMENT even
      //      after the server sends a populated character, which makes every
      //      stageUnequip() see a null slot and fall through to the legacy
      //      WS path — exactly the bug observed on 2026-04-21 with ring2.
      // Otherwise preserve pending — the user may have staged changes the
      // server doesn't know about yet.
      const nextCommitted = cloneEquipment(action.character.equipment);
      let nextPending = state.pendingEquipment;
      const committedChanged = (Object.keys(nextCommitted) as (keyof EquipmentSlots)[])
        .some((slot) => nextCommitted[slot]?.id !== state.committedEquipment[slot]?.id);
      const pendingEmpty = Object.values(state.pendingEquipment).every((v) => v == null);
      const incomingHasItems = Object.values(nextCommitted).some((v) => v != null);
      if (committedChanged || (pendingEmpty && incomingHasItems)) {
        nextPending = cloneEquipment(nextCommitted);
      }
      return {
        ...state,
        character: action.character,
        committedEquipment: nextCommitted,
        pendingEquipment: nextPending,
      };
    }
    case "SET_INVENTORY":
      return { ...state, inventory: action.items };
    case "SET_ONCHAIN_ITEMS":
      return { ...state, onChainItems: action.items };
    case "SET_ONCHAIN_CHARACTER":
      return { ...state, onChainCharacter: action.data };
    // === Loadout save flow (LOADOUT_DESIGN.md D1-D5) ===
    // STAGE_* mutate ONLY pendingEquipment. No chain tx fires here; the
    // saveLoadout hook diffs committed→pending and emits one atomic PTB.
    // On success COMMIT_SAVED rebases committed := pending so isDirty → false.
    case "STAGE_EQUIP": {
      const { item, slot } = action;
      if (state.pendingEquipment[slot]?.id === item.id) return state;
      return {
        ...state,
        pendingEquipment: { ...state.pendingEquipment, [slot]: item },
      };
    }
    case "STAGE_UNEQUIP": {
      const { slot } = action;
      if (state.pendingEquipment[slot] == null) return state;
      return {
        ...state,
        pendingEquipment: { ...state.pendingEquipment, [slot]: null },
      };
    }
    case "STAGE_DISCARD":
      return {
        ...state,
        pendingEquipment: cloneEquipment(state.committedEquipment),
      };
    case "COMMIT_SAVED": {
      // Called by saveLoadout after the PTB lands and chain DOFs are re-read.
      // Committed becomes chain truth; pending snaps to match so isDirty → false.
      const next = cloneEquipment(action.committed);
      return {
        ...state,
        committedEquipment: next,
        pendingEquipment: cloneEquipment(next),
      };
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
      return {
        ...state,
        errorMessage: action.message,
        errorTimestamp: action.message ? Date.now() : null,
        errorSticky: !!(action.message && action.sticky),
      };
    case "BUMP_ONCHAIN_REFRESH":
      return { ...state, onChainRefreshTrigger: state.onChainRefreshTrigger + 1 };
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
