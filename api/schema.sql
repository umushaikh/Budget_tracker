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

-- One row per two-way sync link between a person's own devices. Unlike
-- `shares` above, reading this requires the same secret token as writing it
-- (see authenticate() in src/index.js) - it holds the full editable dataset,
-- including net worth, so the code alone is deliberately not enough to read
-- it the way a share link's code is.
CREATE TABLE IF NOT EXISTS syncs (
  code            TEXT PRIMARY KEY,
  token_hash      TEXT NOT NULL,
  label           TEXT NOT NULL DEFAULT '',
  data_json       TEXT NOT NULL DEFAULT '{}',
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
