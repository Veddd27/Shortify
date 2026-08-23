-- Stage 1 schema for Shortify.
-- Run manually for now with: psql -U shortify_user -d shortify -f src/db/schema.sql
-- (We're doing this by hand deliberately in Stage 1 — a proper migration tool
-- comes later once we've felt the pain of managing schema changes without one.)

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------
-- BIGSERIAL = Postgres shorthand for "auto-incrementing 8-byte integer".
-- Under the hood it creates a SEQUENCE (a separate counter object in the DB)
-- and wires this column's DEFAULT to pull the next value from it. We use
-- BIGINT (not the default 4-byte INT/SERIAL) everywhere here on purpose:
-- INT caps out at ~2.1 billion, and the whole point of this project is
-- pretending we might actually hit scale limits.
CREATE TABLE IF NOT EXISTS users (
    id            BIGSERIAL PRIMARY KEY,
    email         VARCHAR(255) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Note: PRIMARY KEY and UNIQUE both silently create an index behind the
-- scenes (a B-tree by default). We didn't have to write CREATE INDEX
-- ourselves for id or email — Postgres does it as part of the constraint.
-- That matters later when we're diagnosing slow queries: "is there an index
-- on this column" and "is there a constraint on this column" are often the
-- same question.

-- ---------------------------------------------------------------------------
-- urls
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS urls (
    id           BIGSERIAL PRIMARY KEY,
    -- short_code is what actually appears in the shareable link
    -- (e.g. "aB92xK"). We generate it in application code by base62-encoding
    -- this row's own `id` — see src/utils/base62.js. It's stored as its own
    -- column (rather than re-deriving it from id on every read) so that the
    -- redirect lookup can hit a plain indexed equality check.
    short_code   VARCHAR(10) NOT NULL UNIQUE,
    original_url TEXT NOT NULL,
    -- REFERENCES users(id) is a foreign key: Postgres will refuse to insert
    -- a url row whose user_id doesn't exist in users, and ON DELETE CASCADE
    -- means deleting a user automatically deletes their urls instead of
    -- leaving orphaned rows or throwing a constraint error.
    user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The redirect endpoint (GET /:shortCode) is the hottest path in this whole
-- system — it's the one request type that scales with total clicks, not
-- total users. UNIQUE on short_code already gives us an index for it, so
-- Stage 1 needs nothing extra here. We'll come back to this exact query in
-- Stage 4 (Performance) to actually measure it instead of assuming it's fast.

-- A regular (non-unique) index to make "show me this user's urls" fast too,
-- since that query filters on user_id instead of the primary key.
CREATE INDEX IF NOT EXISTS idx_urls_user_id ON urls (user_id);
