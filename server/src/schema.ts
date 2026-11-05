import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// Personal study data — the user's own bookmarks, highlights, notes,
// settings and reading position. The Fresh Water corpus itself is NOT
// stored here: it is read live from ~/workspace/fwt-app/data/ through the
// privileged corpus reader (see privileged.ts).

export const bookmarks = sqliteTable("bookmarks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  refKey: text("ref_key").notNull().unique(),
  lang: text("lang").notNull(),
  slug: text("slug").notNull(),
  bookTitle: text("book_title").notNull(),
  chapter: integer("chapter").notNull(),
  verse: integer("verse").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const highlights = sqliteTable("highlights", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  refKey: text("ref_key").notNull().unique(),
  lang: text("lang").notNull(),
  slug: text("slug").notNull(),
  bookTitle: text("book_title").notNull(),
  chapter: integer("chapter").notNull(),
  verse: integer("verse").notNull(),
  color: text("color").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const notes = sqliteTable("notes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  refKey: text("ref_key").notNull().unique(),
  lang: text("lang").notNull(),
  slug: text("slug").notNull(),
  bookTitle: text("book_title").notNull(),
  chapter: integer("chapter").notNull(),
  verse: integer("verse").notNull(),
  body: text("body").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const studies = sqliteTable("studies", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  topic: text("topic").notNull().default(""),
  passagesJson: text("passages_json").notNull().default("[]"),
  observation: text("observation").notNull().default(""),
  interpretation: text("interpretation").notNull().default(""),
  application: text("application").notNull().default(""),
  questionsJson: text("questions_json").notNull().default("[]"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const plans = sqliteTable("plans", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  templateId: text("template_id").notNull(),
  title: text("title").notNull(),
  readingsJson: text("readings_json").notNull().default("[]"),
  completedJson: text("completed_json").notNull().default("[]"),
  startDate: text("start_date").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const devotionals = sqliteTable("devotionals", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  dateKey: text("date_key").notNull().unique(),
  usfmRef: text("usfm_ref").notNull().default(""),
  referenceLabel: text("reference_label").notNull().default(""),
  scriptureText: text("scripture_text").notNull().default(""),
  bodyJson: text("body_json").notNull().default("{}"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const aiNotes = sqliteTable("ai_notes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  refKey: text("ref_key").notNull().default(""),
  question: text("question").notNull(),
  answer: text("answer").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});
