-- Migration 003: Stage 3 (Analytics).
-- Run manually with: psql -U shortify_user -d shortify -f src/db/migrations/003_add_clicks_table.sql

-- One row per redirect. This is deliberately its own table rather than a
-- click_count column on urls: a single counter could only ever tell us
-- "how many," never "when," "from where," or "on what device" — all of
-- which need one row per event to answer.
CREATE TABLE IF NOT EXISTS clicks (
    id          BIGSERIAL PRIMARY KEY,
    -- ON DELETE CASCADE here too: if a url gets deleted, its click history
    -- is meaningless on its own and should go with it, same reasoning as
    -- urls.user_id referencing users.
    url_id      BIGINT NOT NULL REFERENCES urls(id) ON DELETE CASCADE,
    clicked_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- All four of these are nullable on purpose — a request might have no
    -- Referer header (someone typed the link directly, or their browser
    -- strips it for privacy), and user-agent parsing can fail to identify
    -- a browser/os/device for an unusual or spoofed client. We store
    -- "we don't know" as NULL rather than guessing.
    referrer    TEXT,
    user_agent  TEXT,
    browser     VARCHAR(50),
    os          VARCHAR(50),
    device_type VARCHAR(20),
    ip_address  VARCHAR(45)  -- 45 = long enough for the longest possible IPv6 address
);

-- A composite index on (url_id, clicked_at), not two separate single-column
-- indexes. Every analytics query we're about to write filters by url_id
-- AND cares about clicked_at (grouping by day, ordering recent-first) in
-- the same query — a composite index lets Postgres satisfy both parts of
-- that pattern using one index instead of picking just one column to
-- optimize for. Column order matters: this index is efficient for
-- "WHERE url_id = X" and "WHERE url_id = X ORDER BY clicked_at", but not
-- for a query that filters on clicked_at alone without url_id — we don't
-- have that query, so this ordering is the right fit for what we actually run.
CREATE INDEX IF NOT EXISTS idx_clicks_url_id_clicked_at ON clicks (url_id, clicked_at);
