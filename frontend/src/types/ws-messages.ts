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
  | { type: "cancel_wager_lobby"; wagerMatchId: string };

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
  | { type: "spectate_update"; fight: FightState }
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
  | { type: "character_deleted" };

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
