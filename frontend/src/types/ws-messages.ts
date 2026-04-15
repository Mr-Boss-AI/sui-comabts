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
} from "./game";

// ===== CLIENT → SERVER =====
export type ClientMessage =
  | { type: "auth"; walletAddress: string }
  | {
      type: "create_character";
      name: string;
      strength: number;
      dexterity: number;
      intuition: number;
      endurance: number;
    }
  | { type: "get_character" }
  | { type: "allocate_points"; strength: number; dexterity: number; intuition: number; endurance: number }
  | { type: "queue_fight"; fightType: FightType; wagerAmount?: number; onChainEquipment?: Record<string, unknown> }
  | { type: "cancel_queue" }
  | { type: "fight_action"; attackZones: Zone[]; blockZones: Zone[] }
  | { type: "chat_message"; content: string; target?: string }
  | { type: "get_online_players" }
  | { type: "equip_item"; itemId: string; slot: string }
  | { type: "unequip_item"; slot: string }
  | { type: "buy_shop_item"; itemId: string }
  | { type: "get_shop" }
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
  | { type: "decline_challenge"; challengeId: string };

// ===== SERVER → CLIENT =====
export type ServerMessage =
  | { type: "auth_ok"; walletAddress: string }
  | { type: "error"; message: string }
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
  | { type: "shop_data"; items: (Item & { price: number })[] }
  | { type: "item_purchased"; item: Item; character: Character }
  | { type: "leaderboard"; entries: LeaderboardEntry[] }
  | { type: "fight_history"; fights: FightHistoryEntry[] }
  | { type: "spectate_update"; fight: FightState }
  | { type: "marketplace_data"; listings: MarketplaceListing[] }
  | { type: "item_listed"; listing: MarketplaceListing }
  | { type: "item_delisted"; listingId: string }
  | { type: "item_bought"; listing: MarketplaceListing }
  | { type: "challenge_received"; challengeId: string; from: string; fromName: string; fightType: FightType }
  | { type: "challenge_accepted"; challengeId: string; fight: FightState }
  | { type: "challenge_declined"; challengeId: string };

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
