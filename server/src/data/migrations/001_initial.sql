-- SUI Combats — Initial Schema
-- Run this in the Supabase SQL Editor if automated migration fails.

-- Characters table: persists character progress across server restarts
CREATE TABLE IF NOT EXISTS characters (
  wallet_address TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  strength SMALLINT NOT NULL DEFAULT 5,
  dexterity SMALLINT NOT NULL DEFAULT 5,
  intuition SMALLINT NOT NULL DEFAULT 5,
  endurance SMALLINT NOT NULL DEFAULT 5,
  level SMALLINT NOT NULL DEFAULT 1,
  xp INTEGER NOT NULL DEFAULT 0,
  gold INTEGER NOT NULL DEFAULT 500,
  rating INTEGER NOT NULL DEFAULT 1000,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Fight history: record of every fight
CREATE TABLE IF NOT EXISTS fight_history (
  id TEXT PRIMARY KEY,
  winner_wallet TEXT NOT NULL REFERENCES characters(wallet_address),
  loser_wallet TEXT NOT NULL REFERENCES characters(wallet_address),
  turns SMALLINT NOT NULL,
  fight_type TEXT NOT NULL,
  winner_xp INTEGER NOT NULL DEFAULT 0,
  loser_xp INTEGER NOT NULL DEFAULT 0,
  winner_elo_change INTEGER NOT NULL DEFAULT 0,
  loser_elo_change INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Items inventory: server-side items (not on-chain)
CREATE TABLE IF NOT EXISTS items_inventory (
  id TEXT PRIMARY KEY,
  owner_wallet TEXT NOT NULL REFERENCES characters(wallet_address),
  item_name TEXT NOT NULL,
  item_type SMALLINT NOT NULL,
  rarity SMALLINT NOT NULL DEFAULT 1,
  level_req SMALLINT NOT NULL DEFAULT 1,
  strength SMALLINT NOT NULL DEFAULT 0,
  dexterity SMALLINT NOT NULL DEFAULT 0,
  intuition SMALLINT NOT NULL DEFAULT 0,
  endurance SMALLINT NOT NULL DEFAULT 0,
  hp SMALLINT NOT NULL DEFAULT 0,
  armor SMALLINT NOT NULL DEFAULT 0,
  defense SMALLINT NOT NULL DEFAULT 0,
  attack SMALLINT NOT NULL DEFAULT 0,
  crit_chance SMALLINT NOT NULL DEFAULT 0,
  crit_multiplier SMALLINT NOT NULL DEFAULT 0,
  evasion SMALLINT NOT NULL DEFAULT 0,
  anti_crit SMALLINT NOT NULL DEFAULT 0,
  anti_evasion SMALLINT NOT NULL DEFAULT 0,
  damage_min SMALLINT NOT NULL DEFAULT 0,
  damage_max SMALLINT NOT NULL DEFAULT 0,
  image_url TEXT,
  equipped_slot TEXT,
  is_onchain BOOLEAN NOT NULL DEFAULT false,
  onchain_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_fight_history_winner ON fight_history(winner_wallet);
CREATE INDEX IF NOT EXISTS idx_fight_history_loser ON fight_history(loser_wallet);
CREATE INDEX IF NOT EXISTS idx_fight_history_created ON fight_history(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_items_owner ON items_inventory(owner_wallet);

-- Disable RLS for server-side access with anon key
ALTER TABLE characters ENABLE ROW LEVEL SECURITY;
ALTER TABLE fight_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE items_inventory ENABLE ROW LEVEL SECURITY;

-- Allow full access with anon key (server is the only client)
CREATE POLICY "Server full access" ON characters FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Server full access" ON fight_history FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Server full access" ON items_inventory FOR ALL USING (true) WITH CHECK (true);
