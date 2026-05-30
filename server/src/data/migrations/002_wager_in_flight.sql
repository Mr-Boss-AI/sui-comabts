-- 002 — orphan-wager recovery + character pin columns
--
-- Activates the boot-time sweeper (`sweepOrphanActiveWagers`) so that a
-- mid-fight server crash with a real on-chain wager in flight gets
-- auto-recovered to a 50/50 refund within seconds of restart, instead of
-- waiting ~10 minutes for the on-chain `cancel_expired_wager` safety net.
--
-- Also backfills two columns added to `characters` in v5:
--   `unallocated_points` — server-side stat-allocation budget that survives
--     restarts; previously stored only in memory.
--   `onchain_character_id` — pins the canonical Character NFT object id at
--     auth time so admin calls (update_after_fight, set_fight_lock, DOF
--     reads) target the correct NFT for wallets that have minted multiple
--     Characters during testing. Closes the multi-character regression
--     (Other-A) from the 2026-04-30 Gemini audit.
--
-- Idempotent: every statement uses IF NOT EXISTS / IF EXISTS so re-running
-- on top of a partial migration is safe.

-- ─── characters: backfill v5 columns ───────────────────────────────────

ALTER TABLE characters
  ADD COLUMN IF NOT EXISTS unallocated_points INTEGER NOT NULL DEFAULT 0;

ALTER TABLE characters
  ADD COLUMN IF NOT EXISTS onchain_character_id TEXT;

CREATE INDEX IF NOT EXISTS idx_characters_onchain
  ON characters(onchain_character_id)
  WHERE onchain_character_id IS NOT NULL;

-- ─── wager_in_flight: orphan-recovery row per ACTIVE wager ────────────
--
-- Insert before `wagerLobby.delete` (in handleWagerAccepted), drop after
-- successful `settle_wager`. On boot, `sweepOrphanActiveWagers` reads
-- rows older than STALE_AGE_MS (60s) and reconciles each against chain
-- status: STATUS_ACTIVE → admin_cancel_wager 50/50, STATUS_SETTLED →
-- drop stale row, RPC fail → leave for next sweep tick.

CREATE TABLE IF NOT EXISTS wager_in_flight (
  wager_match_id TEXT PRIMARY KEY,
  player_a       TEXT NOT NULL,
  player_b       TEXT NOT NULL,
  accepted_at_ms BIGINT NOT NULL,
  fight_id       TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wager_in_flight_age
  ON wager_in_flight(accepted_at_ms);

-- Server is the only client; row-level security enabled then opened for
-- the anon key, matching the policy used by the v1 tables in 001_initial.
ALTER TABLE wager_in_flight ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Server full access" ON wager_in_flight;
CREATE POLICY "Server full access" ON wager_in_flight
  FOR ALL USING (true) WITH CHECK (true);
