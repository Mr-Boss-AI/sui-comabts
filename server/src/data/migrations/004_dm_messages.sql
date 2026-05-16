-- 004 — DM messages: plaintext WS-driven body store.
--
-- Hotfix #6 (2026-05-06): the Sui Stack Messaging SDK we wired in
-- Bucket 3 #1 ships in alpha and hangs silently before the wallet
-- popup on `executeCreateChannelTransaction`. We're swapping the DM
-- transport for plain WebSocket + Supabase persistence (the same
-- shape global Tavern chat uses) and deferring the encrypted SDK
-- until it reaches beta. The frontend has a feature flag
-- (NEXT_PUBLIC_DM_TRANSPORT) that flips between the two transports
-- without code changes — see TAVERN_DESIGN.md § "DM transport".
--
-- This table holds the message bodies. dm_channels (003) keeps the
-- per-pair channel metadata + unread counters; we add a synthetic
-- channel id for plaintext channels (sha256 of the canonical pair,
-- 0x-prefixed) so the existing registry, unread, and pip-rendering
-- code paths work unchanged.

CREATE TABLE IF NOT EXISTS dm_messages (
  -- BIGSERIAL gives us a monotonic id we can paginate on (history
  -- is "newest N" with optional `before_id` cursor for older pages).
  id            BIGSERIAL PRIMARY KEY,
  -- Foreign key to dm_channels — cascade so deleting a channel row
  -- also wipes its history. Channel id format is `0x` + 64 hex; for
  -- plaintext channels it's the synthetic id (sha256 of canonical
  -- pair); for encrypted (future re-enable) it'll be the on-chain
  -- Sui Stack channel object id. The table doesn't care which.
  channel_id    TEXT NOT NULL REFERENCES dm_channels(channel_id) ON DELETE CASCADE,
  sender_wallet TEXT NOT NULL,
  -- Recipient denormalised here so a single-table query can answer
  -- "give me my last N DMs" without a join. Always lowercased to
  -- match the dm_channels canonical pair convention.
  recipient_wallet TEXT NOT NULL,
  -- Message body. 2000-char cap matches the frontend textarea
  -- maxLength so the boundary is enforced both client + server.
  body          TEXT NOT NULL CHECK (LENGTH(body) <= 2000 AND LENGTH(body) > 0),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- "Recent N for this channel" — drives the panel's history fetch.
CREATE INDEX IF NOT EXISTS idx_dm_messages_channel_recent
  ON dm_messages(channel_id, created_at DESC, id DESC);

-- "Unread by recipient" — useful for boot-time unread reconstruction
-- in case dm_channel_unread drifts out of sync (defensive; the live
-- counter is the source of truth).
CREATE INDEX IF NOT EXISTS idx_dm_messages_recipient_recent
  ON dm_messages(recipient_wallet, created_at DESC);

ALTER TABLE dm_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Server full access" ON dm_messages;
CREATE POLICY "Server full access" ON dm_messages
  FOR ALL USING (true) WITH CHECK (true);
