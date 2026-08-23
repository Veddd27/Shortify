-- Migration 002: Stage 2 (Better URL Management).
-- Run manually with: psql -U shortify_user -d shortify -f src/db/migrations/002_add_url_management.sql
--
-- Unlike 001, this is a real ALTER TABLE against a table that already has
-- live rows in it — this is exactly the situation migrations exist for.
-- Re-running CREATE TABLE would have done nothing once the table already
-- existed; ALTER TABLE has no such built-in "already done" guard, so this
-- file is meant to be run exactly once, in order, after 001.

-- DEFAULT true here does two things at once: it's the value new rows get
-- going forward, AND — because this is an ALTER on a table that already
-- has rows — Postgres backfills every existing row with `true` immediately
-- as part of this same statement. We don't need a separate UPDATE to fix
-- up old data; the DEFAULT clause handles both cases in one step.
ALTER TABLE urls ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT true;

-- No DEFAULT here on purpose — NULL means "never expires," which is
-- exactly the correct state for every url that already existed before
-- this migration ran (they were created with no concept of expiration).
ALTER TABLE urls ADD COLUMN expires_at TIMESTAMPTZ;
