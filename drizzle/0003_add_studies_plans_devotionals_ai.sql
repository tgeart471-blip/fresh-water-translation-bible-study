CREATE TABLE studies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  topic TEXT NOT NULL DEFAULT '',
  passages_json TEXT NOT NULL DEFAULT '[]',
  observation TEXT NOT NULL DEFAULT '',
  interpretation TEXT NOT NULL DEFAULT '',
  application TEXT NOT NULL DEFAULT '',
  questions_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id TEXT NOT NULL,
  title TEXT NOT NULL,
  readings_json TEXT NOT NULL DEFAULT '[]',
  completed_json TEXT NOT NULL DEFAULT '[]',
  start_date TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE devotionals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date_key TEXT NOT NULL UNIQUE,
  usfm_ref TEXT NOT NULL DEFAULT '',
  reference_label TEXT NOT NULL DEFAULT '',
  scripture_text TEXT NOT NULL DEFAULT '',
  body_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE ai_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref_key TEXT NOT NULL DEFAULT '',
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
