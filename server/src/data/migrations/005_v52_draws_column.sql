-- 005 — v5.2 hardening: backfill characters.draws + PostgREST cache reload.
--
-- Live testnet bug surfaced 2026-06-01 in Railway logs:
--   [DB] Failed to save character: Could not find the 'draws' column of
--   'characters' in the schema cache
--   [DB] Failed to save fight: insert or update on table "fight_history"
--   violates foreign key constraint "fight_history_winner_wallet_fkey"
--
-- The server code has carried `Character.draws` since v5.1 (mutual-KO
-- counter mirrored from chain `Character.draws: u32`) and
-- `dbSaveCharacter` writes the field on every upsert. Migration 001
-- shipped `characters` with `wins` + `losses` but no `draws`, and
-- migration 002 backfilled `unallocated_points` + `onchain_character_id`
-- without picking up the draws column. PostgREST rejects the entire
-- upsert when the payload references an unknown column — so every
-- character upsert (create-time + every post-fight update) has been
-- silently failing on live testnet, leaving the `characters` table
-- empty / stale.
--
-- That cascades into the fight_history FK violation: the FK on
-- `fight_history.winner_wallet → characters.wallet_address` cannot
-- resolve because the parent row was never persisted. The draw branch
-- in finishFight (fight-room.ts:766-854) does NOT call dbSaveFight, so
-- "NULL winner on draw" is NOT the cause — the violation is on normal
-- win/loss fights where the (missing) parent row should exist.
--
-- Fix: add the column with a safe default, then NOTIFY PostgREST to
-- reload its schema cache so the next REST call sees the new column
-- without waiting for the next auto-reload (which can lag minutes on
-- the hosted Supabase tier).
--
-- Idempotent: re-running this migration on a partial / repaired schema
-- is safe — IF NOT EXISTS guards the ALTER, and NOTIFY is a no-op when
-- the cache is already current.

-- ─── characters: add v5.1 draws counter ───────────────────────────────

ALTER TABLE characters
  ADD COLUMN IF NOT EXISTS draws INTEGER NOT NULL DEFAULT 0;

-- ─── PostgREST schema cache reload ────────────────────────────────────
--
-- Without this NOTIFY, PostgREST keeps serving the old schema until its
-- next auto-reload tick. On the hosted Supabase tier the auto-reload
-- can lag long enough that the very next upsert STILL hits the "column
-- not found" error even though the DDL has committed. The NOTIFY tells
-- PostgREST to refresh immediately.

NOTIFY pgrst, 'reload schema';
