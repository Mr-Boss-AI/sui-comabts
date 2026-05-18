import type {
  Zone,
  FightType,
  Character,
  Item,
  FightState,
  TurnResult,
  ChatMessage,
  OnlinePlayer,
  LeaderboardEntry,
  MarketplaceListing,
  LootBoxResult,
  WagerLobbyEntry,
} from "./game";

// ===== CLIENT → SERVER =====
export type ClientMessage =
  // v5 signed-challenge auth handshake. Sequence:
  //   client → auth_request (asking for a fresh challenge), OR
  //   client → auth_token  (resuming an existing 24h JWT session)
  //   client → auth_signature (after server emits auth_challenge)
  | { type: "auth_request"; walletAddress: string }
  | { type: "auth_signature"; signature: string }
  | { type: "auth_token"; walletAddress: string; token: string }
  | {
      type: "create_character";
      name: string;
      strength: number;
      dexterity: number;
      intuition: number;
      endurance: number;
    }
  | {
      type: "restore_character";
      name: string;
      /** Chain-truth Character NFT object id. Server pins this and uses it
       *  for every later admin call (no event scan) so multi-character
       *  wallets always hit the right NFT. */
      objectId: string;
      strength: number;
      dexterity: number;
      intuition: number;
      endurance: number;
      level: number;
      xp: number;
      unallocatedPoints: number;
      wins: number;
      losses: number;
      rating: number;
    }
  | { type: "get_character" }
  | { type: "delete_character" }
  | { type: "allocate_points"; strength: number; dexterity: number; intuition: number; endurance: number }
  | { type: "queue_fight"; fightType: FightType; wagerAmount?: number; wagerMatchId?: string; onChainEquipment?: Record<string, unknown> }
  | { type: "cancel_queue" }
  | { type: "wager_accepted"; wagerMatchId: string; txDigest: string }
  | { type: "fight_action"; attackZones: Zone[]; blockZones: Zone[] }
  | { type: "chat_message"; content: string; target?: string }
  | { type: "get_online_players" }
  | { type: "equip_item"; itemId: string; slot: string }
  | { type: "unequip_item"; slot: string }
  | { type: "get_inventory" }
  | { type: "get_leaderboard" }
  | { type: "get_fight_history" }
  | { type: "spectate_fight"; fightId: string }
  | { type: "stop_spectating" }
  | { type: "list_item"; itemId: string; price: number }
  | { type: "delist_item"; listingId: string }
  | { type: "buy_listing"; listingId: string }
  | { type: "get_marketplace" }
  | { type: "challenge_player"; targetAddress: string; fightType: FightType }
  | { type: "accept_challenge"; challengeId: string }
  | { type: "decline_challenge"; challengeId: string }
  | { type: "get_wager_lobby" }
  | { type: "cancel_wager_lobby"; wagerMatchId: string }
  // ===== Tavern (Bucket 3) =====
  | { type: "enter_room"; room: TavernRoom }
  | { type: "presence_heartbeat" }
  | { type: "get_player_profile"; walletAddress: string }
  | {
      type: "send_fight_request";
      toWallet: string;
      requestType: "friendly" | "wager";
      stakeMist?: string;
      message?: string;
    }
  | { type: "accept_fight_request"; requestId: string }
  | { type: "decline_fight_request"; requestId: string }
  | { type: "cancel_fight_request"; requestId: string }
  | { type: "get_pending_fight_requests" }
  | {
      type: "register_dm_channel";
      channelId: string;
      walletA: string;
      walletB: string;
      memberCapA?: string;
      memberCapB?: string;
      encryptedKeyB64?: string;
    }
  | { type: "notify_dm_sent"; channelId: string; recipient: string }
  | { type: "clear_dm_unread"; channelId: string }
  | { type: "get_dm_channels" }
  | { type: "lookup_dm_channel"; peerWallet: string }
  // Plaintext DM transport (Hotfix #6, 2026-05-06). The server lazily
  // registers a synthetic channel on first send + persists bodies to
  // dm_messages. Selected via NEXT_PUBLIC_DM_TRANSPORT=plaintext (default).
  | {
      type: "dm_send";
      /** Caller-generated id used to match the server echo
       *  (`dm_message_sent`) back to the optimistic bubble. Any unique
       *  string — a UUID is fine; the panel uses `pending-${ts}-${rand}`. */
      clientId: string;
      peerWallet: string;
      body: string;
    }
  | {
      type: "dm_history";
      peerWallet: string;
      /** Default 50, max 200. Server clamps if exceeded. */
      limit?: number;
      /** Cursor for pagination (older page). When omitted, returns
       *  the most recent page. */
      beforeId?: string;
    };

// ===== SERVER → CLIENT =====
export type ServerMessage =
  // Handshake: server sends `auth_challenge` after a fresh `auth_request`,
  // emits `auth_required` when an `auth_token` is invalid/expired (telling
  // the client to fall back to the signed flow), and replies with `auth_ok`
  // on either successful path. `auth_ok` carries the (re)issued JWT and its
  // expiry so the client can persist it.
  | { type: "auth_challenge"; message: string; expiresAt: number }
  | { type: "auth_required"; reason: string }
  | {
      type: "auth_ok";
      walletAddress: string;
      token: string;
      tokenExpiresAt: number;
      hasCharacter: boolean;
      character: Character | null;
    }
  | {
      type: "error";
      message: string;
      /** When true, bypass auto-fade — surfaces for irreversible chain
       *  events the player must see (failed fight-lock release, stuck
       *  wager settlement). Defaults to false. */
      sticky?: boolean;
    }
  | { type: "character_data"; character: Character }
  | { type: "character_created"; character: Character }
  | { type: "points_allocated"; character: Character }
  | { type: "queue_joined"; fightType: FightType }
  | { type: "queue_left" }
  | { type: "fight_start"; fight: FightState }
  | { type: "turn_start"; turn: number; deadline: number }
  | { type: "turn_result"; result: TurnResult; fight: FightState }
  | { type: "fight_end"; fight: FightState; loot: LootBoxResult }
  /** Bug 3 (2026-05-03): replays the per-wallet outcome of the most
   *  recently settled fight when a player auths in. Lets a player
   *  who was disconnected at settle time (forfeit / tab-close) see
   *  Victory/Defeat once on their next session. Frontend dedupes via
   *  `lib/fight-outcome-ack.ts` so this never re-fires after the
   *  modal has been dismissed. */
  | { type: "recent_fight_settled"; fight: FightState; loot: LootBoxResult }
  | { type: "chat"; message: ChatMessage }
  | { type: "online_players"; players: OnlinePlayer[] }
  | { type: "player_joined"; player: OnlinePlayer }
  | { type: "player_left"; walletAddress: string }
  | { type: "player_status_changed"; walletAddress: string; status: OnlinePlayer["status"] }
  | { type: "inventory"; items: Item[] }
  | { type: "item_equipped"; character: Character }
  | { type: "item_unequipped"; character: Character; item: Item }
  | { type: "item_purchased"; item: Item; character: Character }
  | { type: "leaderboard"; entries: LeaderboardEntry[] }
  | { type: "fight_history"; fights: FightHistoryEntry[] }
  | {
      // Two-shape message:
      //   - With `fight`: spectator-attached, this is the live fight
      //     state. Frontend reducer routes to SET_SPECTATING.
      //   - With `activeFights`: "list" reply when client sent
      //     `spectate_fight` without a fightId. Used by
      //     <SpectatorLanding /> (guest spectator flow) to populate the
      //     fight picker.
      type: "spectate_update";
      fight?: FightState;
      activeFights?: Array<{
        fightId: string;
        type: string;
        playerA: { name: string; level: number };
        playerB: { name: string; level: number };
        turn: number;
      }>;
    }
  | { type: "marketplace_data"; listings: MarketplaceListing[] }
  | { type: "item_listed"; listing: MarketplaceListing }
  | {
      type: "item_delisted";
      listingId: string;
      /** Kiosk owner who controlled this listing — used by the seller's
       *  client to react locally (e.g. refresh kiosk metadata). */
      seller: string;
      kioskId: string;
    }
  | {
      type: "item_bought";
      /** Bare reference — the listing is already gone from the index. */
      listing: { id: string };
      buyer: string;
      /** Seller (kiosk owner). Drives the seller-side reactive refresh in
       *  `useKiosk` so profits + listing counts update without a manual
       *  page reload after a buy. */
      seller: string;
      kioskId: string;
    }
  | { type: "challenge_received"; challengeId: string; from: string; fromName: string; fightType: FightType }
  | { type: "challenge_accepted"; challengeId: string; fight: FightState }
  | { type: "challenge_declined"; challengeId: string }
  | { type: "wager_accept_required"; wagerMatchId: string; stakeAmount: number; playerAName: string; playerAWallet: string }
  | { type: "wager_accept_timeout"; wagerMatchId: string }
  | { type: "wager_settled"; txDigest: string; wagerMatchId: string }
  | { type: "wager_lobby_list"; entries: WagerLobbyEntry[] }
  | { type: "wager_lobby_added"; entry: WagerLobbyEntry }
  | { type: "wager_lobby_removed"; wagerMatchId: string }
  | { type: "character_updated_onchain" }
  | { type: "character_deleted" }
  /** Level-up celebration trigger (Fix 3, 2026-05-04). Server emits
   *  this to the affected wallet after `update_after_fight` lands and
   *  the chain effects confirm a level threshold was crossed. The
   *  frontend `LevelUpModal` consumes the payload — `oldLevel` and
   *  `newLevel` differ by `levelsGained` (≥1; multi-level is rare but
   *  possible for big XP gains). `pointsGranted` is the per-fight
   *  delta from `applyXp` (`STAT_POINTS_PER_LEVEL × levelsGained`),
   *  while `newTotalUnallocated` is the post-level chain truth (may
   *  include pre-existing unspent points). */
  | {
      type: "character_leveled_up";
      oldLevel: number;
      newLevel: number;
      pointsGranted: number;
      newTotalUnallocated: number;
      /** Optional fightId — when present, the modal queues until the
       *  fight ends rather than disrupting active combat UI. */
      fightId?: string;
    }
  // Reconnect grace window (Block C1, 2026-04-30 + hotfix). Server emits
  // these when a player's WebSocket drops mid-fight; the forfeit only
  // fires after `graceMs` if they don't reconnect. While at least one
  // player is in the grace window, the turn timer is paused server-side
  // (`timer_paused`); on full reconnection it resumes (`timer_resumed`)
  // with a fresh deadline. `fight_resumed` rehydrates the rejoining
  // client's view; `walletAddress` on disconnect/reconnect identifies
  // WHICH side dropped (used for the banner copy when there are
  // spectators).
  | {
      type: "opponent_disconnected";
      fightId: string;
      walletAddress: string;
      expiresAt: number;
      graceMs: number;
    }
  | { type: "opponent_reconnected"; fightId: string; walletAddress: string }
  | { type: "fight_resumed"; fight: FightState }
  | { type: "timer_paused"; fightId: string; turn: number; remainingMs: number }
  | {
      type: "timer_resumed";
      fightId: string;
      turn: number;
      deadline: number;
      remainingMs: number;
    }
  // ===== Tavern (Bucket 3) =====
  | { type: "room_entered"; room: TavernRoom }
  | { type: "player_profile"; profile: PlayerProfileWire }
  | { type: "player_profile_not_found"; walletAddress: string }
  | { type: "fight_request_sent"; request: FightRequestWire }
  | { type: "fight_request_received"; request: FightRequestWire }
  | {
      type: "fight_request_resolved";
      request: FightRequestWire;
      action: "accept" | "decline" | "cancel" | "expire";
    }
  | {
      type: "fight_request_pending_list";
      incoming: FightRequestWire[];
      outgoing: FightRequestWire[];
    }
  | { type: "wager_challenge_ready"; request: { id: string; toWallet: string; toName: string; stakeMist: string | null } }
  | { type: "wager_challenge_waiting"; request: { id: string; fromWallet: string; fromName: string; stakeMist: string | null } }
  | { type: "dm_channel_registered"; channel: DmChannelWire }
  | { type: "dm_channel_lookup"; peerWallet: string; channel: DmChannelWire | null }
  | {
      type: "dm_unread_changed";
      channelId: string;
      unreadCount: number;
      totalUnread: number;
      lastMessageAt: number | null;
      /** Wallet of the OTHER participant — present only on the bump path
       *  (`notify_dm_sent` → recipient). Absent on the self-clear path
       *  (`clear_dm_unread` → caller's own ack), since the sender is the
       *  caller themselves and the toast/badge UX doesn't apply. */
      senderWallet?: string;
    }
  | { type: "dm_channels_list"; channels: DmChannelWire[]; totalUnread: number }
  // Plaintext DM transport (Hotfix #6, 2026-05-06).
  | {
      type: "dm_message_sent";
      /** Echoes the caller's clientId so the panel matches this
       *  server-confirmed message back to its optimistic bubble. */
      clientId: string;
      message: DmMessageWire;
    }
  | {
      type: "dm_message_received";
      message: DmMessageWire;
    }
  | {
      type: "dm_history";
      peerWallet: string;
      /** Null iff no channel exists yet for this pair (no DMs ever
       *  exchanged). Drives the panel's "no messages yet" empty state. */
      channelId: string | null;
      /** Chronological — oldest first within the page. */
      messages: DmMessageWire[];
      hasMore: boolean;
    };

export type TavernRoom =
  | "tavern"
  | "character"
  | "arena"
  | "marketplace"
  | "hall_of_fame"
  | "fight";

export interface PlayerProfileWire {
  walletAddress: string;
  name: string;
  level: number;
  xp: number;
  rating: number;
  wins: number;
  losses: number;
  totalFights: number;
  winRate: number;
  stats: {
    strength: number;
    dexterity: number;
    intuition: number;
    endurance: number;
  };
  unallocatedPoints: number;
  equipment: import("./game").EquipmentSlots;
  onChainObjectId?: string;
  fresh: boolean;
}

export interface FightRequestWire {
  id: string;
  requestType: "friendly" | "wager";
  fromWallet: string;
  fromName: string;
  toWallet: string;
  toName: string;
  stakeMist: string | null;
  message: string | null;
  status: "pending" | "accepted" | "declined" | "canceled" | "expired";
  expiresAt: number;
  resolvedAt: number | null;
  createdAt: number;
}

export interface DmChannelWire {
  channelId: string;
  participantA: string;
  participantB: string;
  memberCapA: string | null;
  memberCapB: string | null;
  encryptedKeyB64: string | null;
  createdBy: string;
  createdAt: number;
  lastMessageAt: number | null;
}

/** Plaintext DM message wire shape (Hotfix #6). Hint: maps cleanly to
 *  the existing `LocalMessage`/`DecryptedMessageWire` shapes consumed
 *  by `DmPanel`, so the rendering JSX is transport-agnostic. */
export interface DmMessageWire {
  id: string;
  channelId: string;
  senderWallet: string;
  recipientWallet: string;
  body: string;
  createdAtMs: number;
}

export interface FightHistoryEntry {
  id: string;
  type: FightType;
  playerA: { name: string; walletAddress: string };
  playerB: { name: string; walletAddress: string };
  winner: string;
  turns: number;
  timestamp: number;
  wagerAmount?: number;
}
