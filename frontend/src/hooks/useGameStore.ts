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
import type {
  FightHistoryEntry,
  FightRequestWire,
  DmChannelWire,
  PlayerProfileWire,
} from "@/types/ws-messages";
import { EMPTY_EQUIPMENT, cloneEquipment } from "@/lib/loadout";
import type { AuthPhase } from "@/lib/auth-phase";
import { applyLocalAllocate } from "@/lib/stat-points";
import { mergeLevelUpEvent } from "@/lib/level-up-display";
export type { AuthPhase } from "@/lib/auth-phase";

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
  authPhase: AuthPhase;
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

  // Block C1 reconnect-grace UI state (hotfix 2026-04-30 part 2). When a
  // player drops mid-fight the server emits opponent_disconnected; the
  // banner shown by <OpponentDisconnectedBanner /> reads this slice and
  // ticks down to expiresAt. Cleared on opponent_reconnected /
  // fight_resumed / fight_end.
  opponentDisconnect: {
    fightId: string;
    walletAddress: string;
    expiresAt: number;
    graceMs: number;
  } | null;

  // Level-up celebration state (Fix 3, 2026-05-04). Server emits
  // `character_leveled_up` after `update_after_fight` confirms a level
  // threshold crossing on chain. The `LevelUpModal` consumes this slice
  // and renders a one-shot celebration with an "Allocate Stat Points"
  // CTA. The modal queues itself when an active fight is present
  // (don't disrupt combat UI) — `LevelUpController` reads
  // `state.fight === null` before rendering.
  levelUpEvent: {
    oldLevel: number;
    newLevel: number;
    pointsGranted: number;
    newTotalUnallocated: number;
    fightId?: string;
  } | null;

  // Bridge from LevelUpModal "Allocate" CTA → CharacterProfile's
  // local `showAllocate` state. When true, the next render of
  // CharacterProfile pops its existing StatAllocateModal and the flag
  // is cleared. Avoids hoisting the modal-controller boolean into the
  // store while still letting the level-up flow open it directly.
  pendingStatAllocate: boolean;

  // ===== Tavern (Bucket 3) =====
  /** Pending fight requests addressed to me — server pushes one per
   *  `fight_request_received`. Sorted oldest-first; the toast
   *  controller renders newest at the top. */
  incomingFightRequests: FightRequestWire[];
  /** Outgoing requests I sent that are still pending — used to gate
   *  the "Challenge" button in the player sidebar (one outgoing per
   *  target at a time). */
  outgoingFightRequests: FightRequestWire[];
  /** All DM channels I'm a participant in, plus my unread counter
   *  per channel. Server populates via `dm_channels_list`. */
  dmChannels: DmChannelWire[];
  dmTotalUnread: number;
  dmUnreadByChannel: Record<string, number>;
  /** Wallet of the peer whose profile is currently open in the modal
   *  (or null if no modal open). The modal listens on
   *  `playerProfile` to render the body. */
  openProfileWallet: string | null;
  playerProfile: PlayerProfileWire | null;
  /** Wallet of the peer I'm currently DMing (or null). Drives the
   *  DmPanel mount + the `clear_dm_unread` send on open. */
  openDmPeer: string | null;
  /** Pre-filled wager target — when set, navigating to the Arena
   *  scrolls the wager-create form into focus with this opponent's
   *  wallet shown. Cleared on first wager-create attempt or on the
   *  next area change. */
  prefilledWagerTarget: { wallet: string; name: string; stakeMist?: string } | null;

  /** Live DM-incoming toast queue. The reducer pushes a fresh toast
   *  when `dm_unread_changed` arrives for a channel whose peer is
   *  NOT the currently-open DM peer (the panel itself eats the
   *  notification when open). Component renders top-right; user can
   *  click a toast to open the DM panel for that peer or dismiss it
   *  individually. Auto-fade is timer-driven inside the component
   *  so the reducer stays pure. Capped at 4 simultaneous; older
   *  toasts evicted FIFO when new ones arrive. */
  dmIncomingToasts: Array<{
    id: string;
    peerWallet: string;
    peerName: string;
    channelId: string;
    unreadCount: number;
    createdAt: number;
  }>;
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
  authPhase: "auth_pending",
  errorMessage: null,
  errorTimestamp: null,
  errorSticky: false,
  onChainRefreshTrigger: 0,
  opponentDisconnect: null,
  levelUpEvent: null,
  pendingStatAllocate: false,
  incomingFightRequests: [],
  outgoingFightRequests: [],
  dmChannels: [],
  dmTotalUnread: 0,
  dmUnreadByChannel: {},
  openProfileWallet: null,
  playerProfile: null,
  openDmPeer: null,
  prefilledWagerTarget: null,
  dmIncomingToasts: [],
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
  | { type: "SET_AUTH_PHASE"; phase: AuthPhase }
  | { type: "SET_OPPONENT_DISCONNECT"; payload: GameState["opponentDisconnect"] }
  | { type: "SET_LEVEL_UP_EVENT"; payload: GameState["levelUpEvent"] }
  | { type: "CLEAR_LEVEL_UP_EVENT" }
  | { type: "SET_PENDING_STAT_ALLOCATE"; pending: boolean }
  | { type: "SET_TURN_PAUSE"; paused: boolean; remainingMs: number | null; deadline: number | null }
  | { type: "LOCAL_ALLOCATE"; strength: number; dexterity: number; intuition: number; endurance: number }
  | { type: "BUMP_ONCHAIN_REFRESH" }
  | { type: "UPDATE_TURN"; turn: number; turnDeadline: number }
  | { type: "APPEND_TURN_RESULT"; fight: FightState; result: import("@/types/game").TurnResult }
  // ===== Tavern (Bucket 3) =====
  | { type: "ADD_INCOMING_FIGHT_REQUEST"; request: FightRequestWire }
  | { type: "REMOVE_FIGHT_REQUEST"; requestId: string }
  | {
      type: "SET_FIGHT_REQUEST_LISTS";
      incoming: FightRequestWire[];
      outgoing: FightRequestWire[];
    }
  | { type: "ADD_OUTGOING_FIGHT_REQUEST"; request: FightRequestWire }
  | { type: "SET_DM_CHANNELS"; channels: DmChannelWire[]; totalUnread: number }
  | { type: "UPSERT_DM_CHANNEL"; channel: DmChannelWire }
  | {
      type: "SET_DM_UNREAD";
      channelId: string;
      unreadCount: number;
      totalUnread: number;
      lastMessageAt: number | null;
    }
  | { type: "OPEN_PROFILE"; walletAddress: string | null }
  | { type: "SET_PLAYER_PROFILE"; profile: PlayerProfileWire | null }
  | { type: "OPEN_DM"; peerWallet: string | null }
  | {
      type: "SET_PREFILLED_WAGER_TARGET";
      target: GameState["prefilledWagerTarget"];
    }
  | {
      // The reducer derives `peerName` from `state.onlinePlayers` at
      // dispatch time so the call site (handleMessage) doesn't have
      // to pass a stale-closure snapshot. The reducer ALSO checks
      // `state.openDmPeer` and skips the toast when the matching DM
      // panel is already open — that decision MUST run against live
      // state, not a snapshot, otherwise opening a panel just before
      // a message lands would still surface a redundant toast.
      type: "PUSH_DM_TOAST";
      senderWallet: string;
      channelId: string;
      unreadCount: number;
    }
  | { type: "DISMISS_DM_TOAST"; id: string }
  | { type: "DISMISS_DM_TOASTS_FOR_CHANNEL"; channelId: string };

export function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case "SET_CHARACTER": {
      // Null means the character was deleted server-side (delete_character WS).
      // Drop committed/pending equipment and roll the auth phase back so the
      // create-character flow renders again on next mount.
      if (!action.character) {
        return {
          ...state,
          character: null,
          committedEquipment: EMPTY_EQUIPMENT,
          pendingEquipment: EMPTY_EQUIPMENT,
          authPhase: "no_character",
        };
      }
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
    case "SET_FIGHT": {
      // When a fight ends or is cleared, also wipe the disconnect banner
      // — the player has no fight to be disconnected FROM. fight_resumed
      // re-sends a populated FightState (with potentially turnPaused
      // mid-flight), so we trust the server's payload over local state.
      const next = { ...state, fight: action.fight };
      if (!action.fight || action.fight.status === "finished") {
        next.opponentDisconnect = null;
      }
      return next;
    }
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
    case "SET_AUTH_PHASE":
      if (state.authPhase === action.phase) return state;
      return { ...state, authPhase: action.phase };
    case "LOCAL_ALLOCATE": {
      // BUG B fix (2026-05-02 retest): after a successful on-chain
      // allocate_points tx, immediately reflect the new stats locally.
      // The server-side WS sync is best-effort — if the WS auth is mid-
      // reconnect when we send `allocate_points`, the server rejects with
      // "Not authenticated. Send auth_request first." and its in-memory
      // stats stay stale until the next get_character refresh. The local
      // dispatch ensures the user sees the correct stats immediately
      // regardless of WS state. Server eventually reconciles via chain
      // re-read on next reconnect.
      if (!state.character) return state;
      const next = applyLocalAllocate(
        { stats: state.character.stats, unallocatedPoints: state.character.unallocatedPoints },
        action,
      );
      if (!next) return state;
      return {
        ...state,
        character: {
          ...state.character,
          stats: next.stats,
          unallocatedPoints: next.unallocatedPoints,
        },
      };
    }
    case "SET_OPPONENT_DISCONNECT":
      return { ...state, opponentDisconnect: action.payload };
    case "SET_TURN_PAUSE": {
      // Mirror the server-side timer state into fight.turnPaused /
      // turnDeadline so <TurnTimer paused={...} /> freezes correctly
      // and resumes with a fresh countdown.
      if (!state.fight) return state;
      const nextFight = {
        ...state.fight,
        turnPaused: action.paused,
        turnPausedRemainingMs: action.remainingMs,
        // Only overwrite the deadline when the server gives us a new
        // one (resume). Pause keeps the old deadline so the UI can
        // freeze the countdown at the captured point if it wants to
        // (the TurnTimer freezes by simply not advancing — same
        // outcome).
        turnDeadline: action.deadline ?? state.fight.turnDeadline,
      };
      return { ...state, fight: nextFight };
    }
    case "BUMP_ONCHAIN_REFRESH":
      return { ...state, onChainRefreshTrigger: state.onChainRefreshTrigger + 1 };
    case "SET_LEVEL_UP_EVENT": {
      // Multi-level: if a level-up event lands while one is already
      // pending (rare — would require two fights settling before the
      // first modal renders), merge via `mergeLevelUpEvent` so we
      // celebrate the full jump in one modal rather than stacking.
      // The merge logic lives in `lib/level-up-display.ts` so the QA
      // gauntlet can test it without dragging in the full reducer.
      if (action.payload === null) {
        return { ...state, levelUpEvent: null };
      }
      return {
        ...state,
        levelUpEvent: mergeLevelUpEvent(state.levelUpEvent, action.payload),
      };
    }
    case "CLEAR_LEVEL_UP_EVENT":
      return { ...state, levelUpEvent: null };
    case "SET_PENDING_STAT_ALLOCATE":
      if (state.pendingStatAllocate === action.pending) return state;
      return { ...state, pendingStatAllocate: action.pending };
    // ===== Tavern (Bucket 3) =====
    case "ADD_INCOMING_FIGHT_REQUEST": {
      // Replace any prior pending request with the same id; otherwise
      // append. Server is authoritative — duplicate ids should not
      // happen but be defensive.
      const without = state.incomingFightRequests.filter(
        (r) => r.id !== action.request.id,
      );
      return {
        ...state,
        incomingFightRequests: [...without, action.request].sort(
          (a, b) => a.createdAt - b.createdAt,
        ),
      };
    }
    case "REMOVE_FIGHT_REQUEST":
      return {
        ...state,
        incomingFightRequests: state.incomingFightRequests.filter(
          (r) => r.id !== action.requestId,
        ),
        outgoingFightRequests: state.outgoingFightRequests.filter(
          (r) => r.id !== action.requestId,
        ),
      };
    case "SET_FIGHT_REQUEST_LISTS":
      return {
        ...state,
        incomingFightRequests: action.incoming,
        outgoingFightRequests: action.outgoing,
      };
    case "ADD_OUTGOING_FIGHT_REQUEST": {
      const without = state.outgoingFightRequests.filter(
        (r) => r.id !== action.request.id,
      );
      return {
        ...state,
        outgoingFightRequests: [...without, action.request].sort(
          (a, b) => a.createdAt - b.createdAt,
        ),
      };
    }
    case "SET_DM_CHANNELS": {
      const map: Record<string, number> = {};
      // Preserve any per-channel counter the server didn't include —
      // the list call carries the totalUnread but per-channel granularity
      // arrives via dm_unread_changed. Default to existing values.
      for (const ch of action.channels) {
        map[ch.channelId] = state.dmUnreadByChannel[ch.channelId] ?? 0;
      }
      return {
        ...state,
        dmChannels: action.channels,
        dmTotalUnread: action.totalUnread,
        dmUnreadByChannel: map,
      };
    }
    case "UPSERT_DM_CHANNEL": {
      const without = state.dmChannels.filter(
        (c) => c.channelId !== action.channel.channelId,
      );
      return {
        ...state,
        dmChannels: [action.channel, ...without].sort((a, b) => {
          const ax = a.lastMessageAt ?? a.createdAt;
          const bx = b.lastMessageAt ?? b.createdAt;
          return bx - ax;
        }),
      };
    }
    case "SET_DM_UNREAD": {
      const nextChannels = state.dmChannels.map((ch) =>
        ch.channelId === action.channelId
          ? { ...ch, lastMessageAt: action.lastMessageAt }
          : ch,
      );
      return {
        ...state,
        dmChannels: nextChannels,
        dmTotalUnread: action.totalUnread,
        dmUnreadByChannel: {
          ...state.dmUnreadByChannel,
          [action.channelId]: action.unreadCount,
        },
      };
    }
    case "OPEN_PROFILE":
      return {
        ...state,
        openProfileWallet: action.walletAddress,
        // Stale data is worse than no data — clear the panel until the
        // server replies.
        playerProfile:
          action.walletAddress
            && state.playerProfile?.walletAddress.toLowerCase()
              === action.walletAddress.toLowerCase()
            ? state.playerProfile
            : null,
      };
    case "SET_PLAYER_PROFILE":
      return { ...state, playerProfile: action.profile };
    case "OPEN_DM": {
      // Opening a DM panel implicitly dismisses any toasts for that
      // peer — otherwise the toast lingers above an already-open
      // conversation, which is just noise.
      const next = { ...state, openDmPeer: action.peerWallet };
      if (action.peerWallet) {
        const peerLower = action.peerWallet.toLowerCase();
        next.dmIncomingToasts = state.dmIncomingToasts.filter(
          (t) => t.peerWallet.toLowerCase() !== peerLower,
        );
      }
      return next;
    }
    case "SET_PREFILLED_WAGER_TARGET":
      return { ...state, prefilledWagerTarget: action.target };
    case "PUSH_DM_TOAST": {
      // Live-state guard — if the DM panel for this peer is open, the
      // panel itself surfaces the message (its `dm_unread_changed`
      // watcher refreshes the message list). Toast would just be
      // redundant noise. Pre-fix this check lived in handleMessage's
      // closure and used a stale snapshot; moving it into the reducer
      // means the comparison always runs against live state.
      const senderLower = action.senderWallet.toLowerCase();
      if (state.openDmPeer?.toLowerCase() === senderLower) {
        return state;
      }
      // Resolve display name from live online-players. Falls back to
      // a truncated wallet when the peer isn't currently in the
      // sidebar (offline player who DM'd before going dark — rare).
      const onlinePeer = state.onlinePlayers.find(
        (op) => op.walletAddress.toLowerCase() === senderLower,
      );
      const peerName =
        onlinePeer?.name ??
        `${action.senderWallet.slice(0, 6)}…${action.senderWallet.slice(-4)}`;
      const newToast = {
        id: `${action.channelId}-${Date.now()}`,
        peerWallet: action.senderWallet,
        peerName,
        channelId: action.channelId,
        unreadCount: action.unreadCount,
        createdAt: Date.now(),
      };
      // Coalesce by channelId — replace any pre-existing toast for
      // the same channel with the fresh one (latest count, latest
      // createdAt). FIFO cap at 4 keeps the stack manageable.
      const without = state.dmIncomingToasts.filter(
        (t) => t.channelId !== action.channelId,
      );
      const next = [...without, newToast];
      return {
        ...state,
        dmIncomingToasts: next.length > 4 ? next.slice(next.length - 4) : next,
      };
    }
    case "DISMISS_DM_TOAST":
      return {
        ...state,
        dmIncomingToasts: state.dmIncomingToasts.filter(
          (t) => t.id !== action.id,
        ),
      };
    case "DISMISS_DM_TOASTS_FOR_CHANNEL":
      return {
        ...state,
        dmIncomingToasts: state.dmIncomingToasts.filter(
          (t) => t.channelId !== action.channelId,
        ),
      };
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
