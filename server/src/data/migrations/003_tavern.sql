-- 003 — Tavern social hub: presence, fight requests, DM channel registry, friends.
--
-- Adds the persistence layer for the Bucket 3 Tavern rebuild:
--   1. presence            — last-seen timestamps + current room per wallet,
--                            so a player who reconnects from a different tab
--                            doesn't appear "offline" for ~3s while the WS
--                            handshake completes, and so cross-server awareness
--                            survives a server restart for the duration of
--                            the heartbeat TTL.
--   2. fight_requests      — explicit player-to-player challenges with a state
--                            machine (pending → accepted | declined | expired |
--                            canceled). Persisted so a player who refreshes
--                            mid-incoming-request doesn't lose it. 90s TTL.
--   3. dm_channels         — Sui Stack Messaging channel id mapped to the
--                            unordered wallet pair {a,b}. Insert-once on first
--                            DM. No message bodies stored here — that's on
--                            chain + Walrus, off-server.
--   4. dm_channel_unread   — per-recipient unread counter, bumped by the
--                            sender's WS broadcast and reset by the recipient
--                            opening the DM panel. Cheap and decoupled from
--                            the on-chain message log.
--   5. friends             — mutual friend graph. Either side can request,
--                            other side accepts; once accepted both rows
--                            exist with status='accepted'. Used to surface
--                            a "Friends" filter on the player sidebar.
--
-- All idempotent (IF NOT EXISTS / DROP POLICY IF EXISTS). Re-running on top
-- of a partial migration is safe.

-- ─── presence ─────────────────────────────────────────────────────────
--
-- One row per wallet. Updated by every heartbeat (~20s cadence). The boot
-- sweeper trims rows older than PRESENCE_STALE_MS (60s) on each tick so
-- the in-memory presence store can be rehydrated cleanly across restarts.

CREATE TABLE IF NOT EXISTS presence (
  wallet_address TEXT PRIMARY KEY,
  character_name TEXT NOT NULL,
  level          SMALLINT NOT NULL DEFAULT 1,
  rating         INTEGER NOT NULL DEFAULT 1000,
  -- 'tavern' | 'character' | 'arena' | 'marketplace' | 'fight' | 'hall_of_fame'
  -- Stored as text rather than enum so adding a new room (`spectate`, `dungeon`,
  -- etc.) is a write-only schema change, no ALTER TYPE.
  current_room   TEXT NOT NULL DEFAULT 'tavern',
  -- 'online' | 'in_fight' | 'in_marketplace' | 'idle' — derived from
  -- current_room + activity. Keeping a denormalised column here lets the
  -- player-sidebar query be a single SELECT, not a join.
  status         TEXT NOT NULL DEFAULT 'online',
  fight_id       TEXT,
  last_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_presence_last_seen
  ON presence(last_seen_at);
CREATE INDEX IF NOT EXISTS idx_presence_room
  ON presence(current_room);
CREATE INDEX IF NOT EXISTS idx_presence_level
  ON presence(level);

ALTER TABLE presence ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Server full access" ON presence;
CREATE POLICY "Server full access" ON presence
  FOR ALL USING (true) WITH CHECK (true);


-- ─── fight_requests ───────────────────────────────────────────────────
--
-- A specific-target challenge from one wallet to another. Friendly variant
-- (no SUI), Wager variant (creator pre-fills stake, accept opens wager-
-- create flow on the target side).
--
-- States and transitions:
--   pending → accepted   (target clicked Accept; fight starts immediately)
--   pending → declined   (target clicked Decline)
--   pending → canceled   (creator withdrew before target acted)
--   pending → expired    (90s TTL passed; sweep marks it on the next tick)
--
-- Once any non-pending state is set, `resolved_at` is stamped and the row
-- is read-only. Old rows are NOT auto-deleted — they're handy for a future
-- "challenge history" UI and the volume is tiny.

CREATE TABLE IF NOT EXISTS fight_requests (
  id              TEXT PRIMARY KEY,
  -- 'friendly' | 'wager' — only the variants that make sense as direct
  -- challenges. Ranked is a queue concept, not a 1:1 challenge.
  request_type    TEXT NOT NULL,
  from_wallet     TEXT NOT NULL,
  from_name       TEXT NOT NULL,
  to_wallet       TEXT NOT NULL,
  to_name         TEXT NOT NULL,
  -- For wager variant: the creator's proposed stake in MIST as a string
  -- (BigInt-safe). Null for friendly. Stored as text to match existing
  -- BigInt-string convention from the marketplace listings table.
  stake_mist      TEXT,
  -- 'pending' | 'accepted' | 'declined' | 'canceled' | 'expired'
  status          TEXT NOT NULL DEFAULT 'pending',
  -- Optional message from the challenger ("first to 3? :)"). Capped to 280
  -- chars at the API layer.
  message         TEXT,
  expires_at      TIMESTAMPTZ NOT NULL,
  resolved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fight_requests_to
  ON fight_requests(to_wallet, status);
CREATE INDEX IF NOT EXISTS idx_fight_requests_from
  ON fight_requests(from_wallet, status);
CREATE INDEX IF NOT EXISTS idx_fight_requests_expires
  ON fight_requests(expires_at)
  WHERE status = 'pending';

ALTER TABLE fight_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Server full access" ON fight_requests;
CREATE POLICY "Server full access" ON fight_requests
  FOR ALL USING (true) WITH CHECK (true);


-- ─── dm_channels ──────────────────────────────────────────────────────
--
-- Maps a Sui Stack Messaging channel id to the unordered wallet pair
-- {participant_a, participant_b}. participant_a is always the
-- lexicographically smaller address (lowercased) so `(a, b)` is a stable
-- canonical key — looking up "the channel between X and Y" is a single
-- equality query regardless of who initiated.
--
-- The actual encrypted message bodies live on chain (channel object) +
-- Walrus (attachments). This table only knows that channel `0x…` exists
-- between these two wallets, plus a bit of metadata (who created it,
-- when) for sorting and access control.

CREATE TABLE IF NOT EXISTS dm_channels (
  channel_id        TEXT PRIMARY KEY,
  -- LOWER(LEAST(a, b)) and LOWER(GREATEST(a, b)) — the API layer sets
  -- both; a CHECK enforces ordering so misordered inserts surface
  -- immediately instead of silently de-duplicating.
  participant_a     TEXT NOT NULL,
  participant_b     TEXT NOT NULL,
  -- Sui Stack member-cap object ids per side. The cap is held by the
  -- wallet and authorises sending into the channel; we cache them so the
  -- frontend doesn't have to re-derive on every send.
  member_cap_a      TEXT,
  member_cap_b      TEXT,
  -- Encrypted symmetric key bytes returned by
  -- executeCreateChannelTransaction, base64-encoded. Each side also has
  -- their own copy fetched at decrypt-time; this is the creator-side copy
  -- used for the very first send (before either side has fetched).
  encrypted_key_b64 TEXT,
  created_by        TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_message_at   TIMESTAMPTZ,
  CHECK (participant_a < participant_b)
);

CREATE INDEX IF NOT EXISTS idx_dm_channels_pair
  ON dm_channels(participant_a, participant_b);
CREATE INDEX IF NOT EXISTS idx_dm_channels_a
  ON dm_channels(participant_a);
CREATE INDEX IF NOT EXISTS idx_dm_channels_b
  ON dm_channels(participant_b);

ALTER TABLE dm_channels ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Server full access" ON dm_channels;
CREATE POLICY "Server full access" ON dm_channels
  FOR ALL USING (true) WITH CHECK (true);


-- ─── dm_channel_unread ────────────────────────────────────────────────
--
-- Per-recipient unread counter. One row per (channel_id, recipient).
-- Bumped by the sender's `register_dm_message` WS message; reset to 0
-- when the recipient opens the DM panel. Lives separate from dm_channels
-- so a high-volume sender can't slow down channel metadata reads.

CREATE TABLE IF NOT EXISTS dm_channel_unread (
  channel_id   TEXT NOT NULL REFERENCES dm_channels(channel_id) ON DELETE CASCADE,
  recipient    TEXT NOT NULL,
  unread_count INTEGER NOT NULL DEFAULT 0,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_id, recipient)
);

CREATE INDEX IF NOT EXISTS idx_dm_unread_recipient
  ON dm_channel_unread(recipient)
  WHERE unread_count > 0;

ALTER TABLE dm_channel_unread ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Server full access" ON dm_channel_unread;
CREATE POLICY "Server full access" ON dm_channel_unread
  FOR ALL USING (true) WITH CHECK (true);


-- ─── friends ──────────────────────────────────────────────────────────
--
-- Mutual friendship via two rows: A→B and B→A. Initial request inserts
-- one row with status='requested'. Acceptance inserts the mirror row
-- with status='accepted' and updates the original to 'accepted'. Block
-- is unilateral (only the blocker's row flips to 'blocked'); the other
-- side sees the friendship vanish but learns nothing about the block.

CREATE TABLE IF NOT EXISTS friends (
  owner          TEXT NOT NULL,
  friend         TEXT NOT NULL,
  -- 'requested' | 'accepted' | 'blocked'
  status         TEXT NOT NULL DEFAULT 'requested',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (owner, friend),
  CHECK (owner <> friend)
);

CREATE INDEX IF NOT EXISTS idx_friends_owner
  ON friends(owner, status);
CREATE INDEX IF NOT EXISTS idx_friends_friend
  ON friends(friend, status);

ALTER TABLE friends ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Server full access" ON friends;
CREATE POLICY "Server full access" ON friends
  FOR ALL USING (true) WITH CHECK (true);


-- ─── helpful triggers ─────────────────────────────────────────────────
--
-- presence: bump last_seen_at automatically on UPDATE so callers never
-- forget. Cheap; presence rows are tiny and updated at heartbeat cadence
-- so the trigger overhead is negligible.

CREATE OR REPLACE FUNCTION presence_touch_last_seen()
RETURNS trigger AS $$
BEGIN
  NEW.last_seen_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_presence_touch_last_seen ON presence;
CREATE TRIGGER trg_presence_touch_last_seen
  BEFORE UPDATE ON presence
  FOR EACH ROW
  WHEN (OLD.last_seen_at IS NOT DISTINCT FROM NEW.last_seen_at)
  EXECUTE FUNCTION presence_touch_last_seen();

-- friends: bump updated_at automatically on UPDATE.
CREATE OR REPLACE FUNCTION friends_touch_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_friends_touch_updated_at ON friends;
CREATE TRIGGER trg_friends_touch_updated_at
  BEFORE UPDATE ON friends
  FOR EACH ROW
  EXECUTE FUNCTION friends_touch_updated_at();
