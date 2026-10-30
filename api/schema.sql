-- Wiserax Games API (Cloudflare D1). Safe to re-run.
CREATE TABLE IF NOT EXISTS counters (
  game TEXT NOT NULL,
  kind TEXT NOT NULL,            -- view | play | like | comment
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (game, kind)
);

-- one row per (kind, game, ip, day): a view or play counts once per visitor per day
CREATE TABLE IF NOT EXISTS seen (
  key TEXT PRIMARY KEY,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS seen_at ON seen(at);

CREATE TABLE IF NOT EXISTS likes (
  game TEXT NOT NULL,
  visitor TEXT NOT NULL,
  ip TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (game, visitor)
);
CREATE INDEX IF NOT EXISTS likes_ip ON likes(ip, at);

CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game TEXT NOT NULL,
  name TEXT NOT NULL,
  body TEXT NOT NULL,
  at INTEGER NOT NULL,
  ip TEXT NOT NULL,
  visitor TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'visible',  -- visible | held | hidden | spam
  reports INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS comments_game ON comments(game, status, id DESC);
CREATE INDEX IF NOT EXISTS comments_ip ON comments(ip, at);

CREATE TABLE IF NOT EXISTS reports (
  comment INTEGER NOT NULL,
  visitor TEXT NOT NULL,
  PRIMARY KEY (comment, visitor)
);
