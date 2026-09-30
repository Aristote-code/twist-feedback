-- Postgres schema, for when DATABASE_URL is set. Run the files in this folder
-- in order, once each, for example: psql "$DATABASE_URL" -f 001_initial-schema.sql
-- The same tables for SQLite are created in src/server/db.ts; keep the two in step.
-- `seq` keeps insertion order, to break ties between rows with the same
-- timestamp or position (SQLite uses its built-in rowid for this).

CREATE TABLE feedback (
  id            TEXT PRIMARY KEY,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  category      TEXT NOT NULL,
  post_type     TEXT,
  title         TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'new',
  source        TEXT NOT NULL,
  locale        TEXT,
  page_url      TEXT,
  user_id       TEXT,
  user_name     TEXT,
  user_email    TEXT,
  user_verified INTEGER NOT NULL DEFAULT 0,
  metadata      TEXT NOT NULL DEFAULT '{}',
  screenshot    TEXT,
  internal_note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX feedback_created_at ON feedback (created_at DESC);

CREATE TABLE conversations (
  id              TEXT PRIMARY KEY,
  owner_key       TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  last_message_at TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'open',
  mode            TEXT NOT NULL DEFAULT 'human',
  topic           TEXT,
  handoff_reason  TEXT,
  ai_busy_since   TEXT,
  source          TEXT NOT NULL,
  locale          TEXT,
  page_url        TEXT,
  user_id         TEXT,
  user_name       TEXT,
  user_email      TEXT,
  user_verified   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX conversations_owner ON conversations (owner_key, last_message_at DESC);
CREATE INDEX conversations_recent ON conversations (last_message_at DESC);

CREATE TABLE messages (
  id              TEXT PRIMARY KEY,
  seq             BIGSERIAL,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  created_at      TEXT NOT NULL,
  author          TEXT NOT NULL,
  author_name     TEXT,
  body            TEXT NOT NULL,
  meta            TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX messages_conversation ON messages (conversation_id, created_at, seq);

CREATE TABLE help_collections (
  id             TEXT PRIMARY KEY,
  seq            BIGSERIAL,
  position       INTEGER NOT NULL DEFAULT 0,
  title_en       TEXT NOT NULL,
  title_de       TEXT NOT NULL DEFAULT '',
  description_en TEXT NOT NULL DEFAULT '',
  description_de TEXT NOT NULL DEFAULT ''
);

CREATE TABLE help_articles (
  id            TEXT PRIMARY KEY,
  seq           BIGSERIAL,
  collection_id TEXT NOT NULL REFERENCES help_collections(id) ON DELETE CASCADE,
  position      INTEGER NOT NULL DEFAULT 0,
  title_en      TEXT NOT NULL,
  title_de      TEXT NOT NULL DEFAULT '',
  body_en       TEXT NOT NULL DEFAULT '',
  body_de       TEXT NOT NULL DEFAULT '',
  published     INTEGER NOT NULL DEFAULT 1,
  updated_at    TEXT NOT NULL
);

CREATE TABLE updates (
  id           TEXT PRIMARY KEY,
  published_at TEXT NOT NULL,
  title_en     TEXT NOT NULL,
  title_de     TEXT NOT NULL DEFAULT '',
  body_en      TEXT NOT NULL DEFAULT '',
  body_de      TEXT NOT NULL DEFAULT '',
  image_url    TEXT,
  published    INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
