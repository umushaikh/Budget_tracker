-- One row per share link. Unlike the group-board pattern this is modeled on,
-- there is exactly one writer (the owner's app) and any number of anonymous
-- readers (whoever has the link) - no membership, no join flow. The snapshot
-- is overwritten in place on every push, never appended to, so the table
-- stays one row per share regardless of how often the owner edits their
-- budget.
CREATE TABLE IF NOT EXISTS shares (
  code            TEXT PRIMARY KEY,
  token_hash      TEXT NOT NULL,
  label           TEXT NOT NULL DEFAULT '',
  snapshot_json   TEXT NOT NULL DEFAULT '{}',
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
