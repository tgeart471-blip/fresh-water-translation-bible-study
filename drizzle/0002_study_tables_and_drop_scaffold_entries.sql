DROP TABLE IF EXISTS entries;
--> statement-breakpoint
CREATE TABLE bookmarks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref_key TEXT NOT NULL UNIQUE,
  lang TEXT NOT NULL,
  slug TEXT NOT NULL,
  book_title TEXT NOT NULL,
  chapter INTEGER NOT NULL,
  verse INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE highlights (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref_key TEXT NOT NULL UNIQUE,
  lang TEXT NOT NULL,
  slug TEXT NOT NULL,
  book_title TEXT NOT NULL,
  chapter INTEGER NOT NULL,
  verse INTEGER NOT NULL,
  color TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref_key TEXT NOT NULL UNIQUE,
  lang TEXT NOT NULL,
  slug TEXT NOT NULL,
  book_title TEXT NOT NULL,
  chapter INTEGER NOT NULL,
  verse INTEGER NOT NULL,
  body TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
