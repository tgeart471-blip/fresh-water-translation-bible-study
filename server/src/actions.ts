import { defineAction, z, type ActionsModule } from "@hatch/space-sdk";
import { privileged } from "@space/privileged";
import { asc, desc, eq } from "drizzle-orm";
import * as schema from "./schema";

// ---------------------------------------------------------------------------
// Canonical book table (66 books). The corpus files under
// ~/workspace/fwt-app/data/ are matched to this table by slug/title aliases,
// which gives every book its testament, canonical order and USFM code (for
// the YouVersion compare view). Per the user's direction (2026-11-03) the
// library is the 66 canonical books only for now — no Apocrypha /
// deuterocanon shelf yet. Books carry `collection: "canonical"` so a
// deuterocanonical collection can be added later by extending the table
// and the whitelist, with no change to the reader.
// ---------------------------------------------------------------------------

type CanonEntry = {
  slug: string;
  title: string;
  usfm: string;
  testament: "OT" | "NT";
  aliases: string[];
};

const CANON: CanonEntry[] = [
  ["genesis", "Genesis", "GEN", "OT", ["gen", "génesis"]],
  ["exodus", "Exodus", "EXO", "OT", ["exo", "éxodo", "exodo"]],
  ["leviticus", "Leviticus", "LEV", "OT", ["lev", "levítico", "levitico"]],
  ["numbers", "Numbers", "NUM", "OT", ["num", "números", "numeros"]],
  ["deuteronomy", "Deuteronomy", "DEU", "OT", ["deu", "deuteronomio"]],
  ["joshua", "Joshua", "JOS", "OT", ["jos", "josué", "josue"]],
  ["judges", "Judges", "JDG", "OT", ["jdg", "jueces"]],
  ["ruth", "Ruth", "RUT", "OT", ["rut", "rut"]],
  ["1-samuel", "1 Samuel", "1SA", "OT", ["1samuel", "1sa", "1 samuel"]],
  ["2-samuel", "2 Samuel", "2SA", "OT", ["2samuel", "2sa", "2 samuel"]],
  ["1-kings", "1 Kings", "1KI", "OT", ["1kings", "1ki", "1 reyes"]],
  ["2-kings", "2 Kings", "2KI", "OT", ["2kings", "2ki", "2 reyes"]],
  ["1-chronicles", "1 Chronicles", "1CH", "OT", ["1chronicles", "1ch", "1 crónicas", "1 cronicas"]],
  ["2-chronicles", "2 Chronicles", "2CH", "OT", ["2chronicles", "2ch", "2 crónicas", "2 cronicas"]],
  ["ezra", "Ezra", "EZR", "OT", ["ezr", "esdras"]],
  ["nehemiah", "Nehemiah", "NEH", "OT", ["neh", "nehemías", "nehemias"]],
  ["esther", "Esther", "EST", "OT", ["est", "ester"]],
  ["job", "Job", "JOB", "OT", ["job"]],
  ["psalms", "Psalms", "PSA", "OT", ["psalm", "psa", "salmos", "psalter"]],
  ["proverbs", "Proverbs", "PRO", "OT", ["pro", "proverbios"]],
  ["ecclesiastes", "Ecclesiastes", "ECC", "OT", ["ecc", "eclesiastés", "eclesiastes", "qoheleth"]],
  ["song-of-solomon", "Song of Solomon", "SNG", "OT", ["song-of-songs", "song", "sng", "cantares", "canticle-of-canticles"]],
  ["isaiah", "Isaiah", "ISA", "OT", ["isa", "isaías", "isaias"]],
  ["jeremiah", "Jeremiah", "JER", "OT", ["jer", "jeremías", "jeremias"]],
  ["lamentations", "Lamentations", "LAM", "OT", ["lam", "lamentaciones"]],
  ["ezekiel", "Ezekiel", "EZK", "OT", ["ezk", "ezequiel"]],
  ["daniel", "Daniel", "DAN", "OT", ["dan"]],
  ["hosea", "Hosea", "HOS", "OT", ["hos", "oseas"]],
  ["joel", "Joel", "JOL", "OT", ["jol"]],
  ["amos", "Amos", "AMO", "OT", ["amo", "amós", "amos"]],
  ["obadiah", "Obadiah", "OBA", "OT", ["oba", "abdías", "abdias"]],
  ["jonah", "Jonah", "JON", "OT", ["jon", "jonás", "jonas"]],
  ["micah", "Micah", "MIC", "OT", ["mic", "miqueas"]],
  ["nahum", "Nahum", "NAM", "OT", ["nam", "nahúm", "nahum"]],
  ["habakkuk", "Habakkuk", "HAB", "OT", ["hab", "habacuc"]],
  ["zephaniah", "Zephaniah", "ZEP", "OT", ["zep", "sofonías", "sofonias"]],
  ["haggai", "Haggai", "HAG", "OT", ["hag", "hageo"]],
  ["zechariah", "Zechariah", "ZEC", "OT", ["zec", "zacarías", "zacarias"]],
  ["malachi", "Malachi", "MAL", "OT", ["mal", "malaquías", "malaquias"]],
  ["matthew", "Matthew", "MAT", "NT", ["mat", "mateo"]],
  ["mark", "Mark", "MRK", "NT", ["mrk", "marcos"]],
  ["luke", "Luke", "LUK", "NT", ["luk", "lucas"]],
  ["john", "John", "JHN", "NT", ["jhn", "juan"]],
  ["acts", "Acts", "ACT", "NT", ["act", "hechos", "acts-of-the-apostles"]],
  ["romans", "Romans", "ROM", "NT", ["rom", "romanos"]],
  ["1-corinthians", "1 Corinthians", "1CO", "NT", ["1corinthians", "1co", "1 corintios"]],
  ["2-corinthians", "2 Corinthians", "2CO", "NT", ["2corinthians", "2co", "2 corintios"]],
  ["galatians", "Galatians", "GAL", "NT", ["gal", "gálatas", "galatas"]],
  ["ephesians", "Ephesians", "EPH", "NT", ["eph", "efesios"]],
  ["philippians", "Philippians", "PHP", "NT", ["php", "filipenses"]],
  ["colossians", "Colossians", "COL", "NT", ["col", "colosenses"]],
  ["1-thessalonians", "1 Thessalonians", "1TH", "NT", ["1thessalonians", "1th", "1 tesalonicenses"]],
  ["2-thessalonians", "2 Thessalonians", "2TH", "NT", ["2thessalonians", "2th", "2 tesalonicenses"]],
  ["1-timothy", "1 Timothy", "1TI", "NT", ["1timothy", "1ti", "1 timoteo"]],
  ["2-timothy", "2 Timothy", "2TI", "NT", ["2timothy", "2ti", "2 timoteo"]],
  ["titus", "Titus", "TIT", "NT", ["tit", "tito"]],
  ["philemon", "Philemon", "PHM", "NT", ["phm", "filemón", "filemon"]],
  ["hebrews", "Hebrews", "HEB", "NT", ["heb", "hebreos"]],
  ["james", "James", "JAS", "NT", ["jas", "santiago"]],
  ["1-peter", "1 Peter", "1PE", "NT", ["1peter", "1pe", "1 pedro"]],
  ["2-peter", "2 Peter", "2PE", "NT", ["2peter", "2pe", "2 pedro"]],
  ["1-john", "1 John", "1JN", "NT", ["1john", "1jn", "1 juan"]],
  ["2-john", "2 John", "2JN", "NT", ["2john", "2jn", "2 juan"]],
  ["3-john", "3 John", "3JN", "NT", ["3john", "3jn", "3 juan"]],
  ["jude", "Jude", "JUD", "NT", ["jud", "judas"]],
  ["revelation", "Revelation", "REV", "NT", ["rev", "apocalipsis", "apocalypse"]],
].map(([slug, title, usfm, testament, aliases]) => ({
  slug: slug as string,
  title: title as string,
  usfm: usfm as string,
  testament: testament as "OT" | "NT",
  aliases: aliases as string[],
}));

// Deuterocanonical / Apocrypha slugs — excluded from the library for now
// by the user's direction; kept here so the exclusion is explicit and the
// books can be admitted later by moving them into CANON.
const EXCLUDED_SLUGS = new Set([
  "tobit", "tobias", "judith", "wisdom", "wisdom-of-solomon",
  "sirach", "ecclesiasticus", "ben-sira", "baruch", "1-maccabees",
  "2-maccabees", "1maccabees", "2maccabees", "1-esdras", "1esdras",
  "prayer-of-manasseh", "manasseh", "enoch", "1-enoch", "psalm-151",
  "3-maccabees", "4-maccabees", "2-esdras", "additions-to-esther",
  "additions-to-daniel", "susanna", "bel-and-the-dragon",
]);

function normKey(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[_\s]+/g, "-")
    .trim();
}

const ALIAS_TO_CANON = new Map<string, CanonEntry>();
for (const entry of CANON) {
  ALIAS_TO_CANON.set(normKey(entry.slug), entry);
  ALIAS_TO_CANON.set(normKey(entry.title), entry);
  for (const a of entry.aliases) ALIAS_TO_CANON.set(normKey(a), entry);
}

function resolveCanon(rawSlug: string, rawTitle?: string): CanonEntry | null {
  if (EXCLUDED_SLUGS.has(normKey(rawSlug))) return null;
  const bySlug = ALIAS_TO_CANON.get(normKey(rawSlug));
  if (bySlug) return bySlug;
  if (rawTitle) {
    const byTitle = ALIAS_TO_CANON.get(normKey(rawTitle));
    if (byTitle) return byTitle;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Corpus normalisation — tolerant of the extraction's exact key choices.
// Book file model: chapters[] with blocks in reading order; heading blocks
// and para blocks whose verses carry segments with flags
// b=blue, i=italic, sc=small caps, sh=shaded.
// ---------------------------------------------------------------------------

type AnyRecord = Record<string, unknown>;
function asRecord(v: unknown): AnyRecord | null {
  return v != null && typeof v === "object" && !Array.isArray(v)
    ? (v as AnyRecord)
    : null;
}
function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function num(v: unknown, fallback: number): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const parsed = Number.parseInt(v, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}
function verseLabel(v: unknown, fallback: number): string {
  if (typeof v === "string" && v.length > 0) return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return fallback > 0 ? String(fallback) : "";
}
function flag(v: unknown): boolean {
  return v === true || v === 1 || v === "true";
}

type Segment = { t: string; b: boolean; i: boolean; sc: boolean; sh: boolean };
type Block =
  | { kind: "heading"; text: string }
  | { kind: "para"; verses: { n: number; label: string; segments: Segment[] }[] };
type Chapter = { number: number; blocks: Block[] };

function normalizeSegment(raw: unknown): Segment {
  if (typeof raw === "string") return { t: raw, b: false, i: false, sc: false, sh: false };
  const r = asRecord(raw) ?? {};
  return {
    t: str(r["t"] ?? r["text"]),
    b: flag(r["b"] ?? r["blue"]),
    i: flag(r["i"] ?? r["italic"] ?? r["italics"]),
    sc: flag(r["sc"] ?? r["smallCaps"] ?? r["small_caps"]),
    sh: flag(r["sh"] ?? r["shaded"] ?? r["shade"]),
  };
}

// Verses split across printed lines appear as consecutive entries with the
// same verse number — concatenate those fragments into one verse. Entries
// with the same label but different shading are NOT fragments (Daniel 3
// carries two legitimate verse-24 sequences: the shaded Greek insertion,
// then the Hebrew text), so shading signature must match to merge.
function mergeVerseFragments(
  verses: { n: number; label: string; segments: Segment[] }[],
): { n: number; label: string; segments: Segment[] }[] {
  const out: { n: number; label: string; segments: Segment[] }[] = [];
  for (const v of verses) {
    const prev = out[out.length - 1];
    const shSig = (x: { segments: Segment[] }) => x.segments.some((s) => s.sh);
    if (prev && prev.label === v.label && shSig(prev) === shSig(v)) {
      const lastSeg = prev.segments[prev.segments.length - 1];
      const firstSeg = v.segments[0];
      const needsSpace =
        lastSeg &&
        firstSeg &&
        !/\s$/.test(lastSeg.t) &&
        !/^[\s.,;:!?%")\]]/.test(firstSeg.t);
      prev.segments = needsSpace
        ? [...prev.segments, { t: " ", b: false, i: false, sc: false, sh: false }, ...v.segments]
        : [...prev.segments, ...v.segments];
    } else {
      out.push({ n: v.n, label: v.label, segments: [...v.segments] });
    }
  }
  return out;
}

// A verse split across printed lines often lands in the corpus as one
// single-verse para block per line, each repeating the verse number
// (poetry especially: Hosea 9:1 spans five such blocks, Psalm 1:1 four).
// Merge a para block's first verse into the previous para block's last
// verse when it is the same verse with the same shading signature, so
// the verse — and its number — exists exactly once and reads whole.
// Verses after the first in such a block keep their own paragraph. A
// heading breaks the chain, and a same-numbered verse with different
// shading (Daniel 3's two verse-24 sequences) is a distinct verse,
// never a fragment.
function consolidateBlocks(blocks: Block[]): Block[] {
  const out: Block[] = [];
  const shSig = (v: { segments: Segment[] }) => v.segments.some((s) => s.sh);
  for (const block of blocks) {
    const prev = out[out.length - 1];
    if (block.kind === "para" && prev?.kind === "para") {
      const prevLast = prev.verses[prev.verses.length - 1];
      const first = block.verses[0];
      if (
        prevLast &&
        first &&
        first.label !== "" &&
        prevLast.label === first.label &&
        shSig(prevLast) === shSig(first)
      ) {
        prev.verses = [
          ...prev.verses.slice(0, -1),
          ...mergeVerseFragments([prevLast, first]),
        ];
        const rest = block.verses.slice(1);
        if (rest.length > 0) out.push({ kind: "para", verses: rest });
        continue;
      }
    }
    out.push(block);
  }
  return out;
}

function normalizeBook(parsed: unknown): { title: string; chapters: Chapter[] } {
  const book = asRecord(parsed) ?? {};
  const title = str(book["title"] ?? book["name"] ?? book["book"]);
  const rawChapters = Array.isArray(book["chapters"]) ? book["chapters"] : [];
  const chapters: Chapter[] = [];
  rawChapters.forEach((rawCh, ci) => {
    const ch = asRecord(rawCh);
    if (!ch) return;
    const chNum = num(ch["number"] ?? ch["n"] ?? ch["chapter"], ci + 1);
    const blocks: Block[] = [];
    const rawBlocks = Array.isArray(ch["blocks"]) ? ch["blocks"] : [];
    for (const rawBlock of rawBlocks) {
      const block = asRecord(rawBlock);
      if (!block) continue;
      const type = str(block["type"] ?? block["kind"]);
      const headingText = str(block["text"] ?? block["heading"] ?? block["title"]);
      if (type === "heading" || type === "title" || (headingText && !Array.isArray(block["verses"]))) {
        if (headingText) blocks.push({ kind: "heading", text: headingText });
        continue;
      }
      const rawVerses = Array.isArray(block["verses"]) ? block["verses"] : [];
      const verses = rawVerses
        .map((rawV) => {
          const v = asRecord(rawV);
          if (!v) return null;
          const segs = Array.isArray(v["segments"]) ? v["segments"] : [];
          const segments = segs.map(normalizeSegment).filter((s) => s.t.length > 0);
          // Tolerate a verse carried as plain text.
          if (segments.length === 0 && str(v["text"])) {
            segments.push({ t: str(v["text"]), b: false, i: false, sc: false, sh: false });
          }
          const rawN = v["n"] ?? v["verse"] ?? v["number"];
          return {
            n: num(rawN, 0),
            label: verseLabel(rawN, num(rawN, 0)),
            segments,
          };
        })
        .filter((v): v is { n: number; label: string; segments: Segment[] } => v != null && v.segments.length > 0);
      if (verses.length > 0) blocks.push({ kind: "para", verses: mergeVerseFragments(verses) });
    }
    // Chapters carrying verses directly.
    if (blocks.length === 0 && Array.isArray(ch["verses"])) {
      const verses = (ch["verses"] as unknown[])
        .map((rawV) => {
          const v = asRecord(rawV);
          if (!v) return null;
          const segs = Array.isArray(v["segments"]) ? v["segments"] : [];
          const segments = segs.map(normalizeSegment).filter((s) => s.t.length > 0);
          if (segments.length === 0 && str(v["text"])) {
            segments.push({ t: str(v["text"]), b: false, i: false, sc: false, sh: false });
          }
          const rawN = v["n"] ?? v["verse"] ?? v["number"];
          return { n: num(rawN, 0), label: verseLabel(rawN, num(rawN, 0)), segments };
        })
        .filter((v): v is { n: number; label: string; segments: Segment[] } => v != null && v.segments.length > 0);
      if (verses.length > 0) blocks.push({ kind: "para", verses: mergeVerseFragments(verses) });
    }
    chapters.push({ number: chNum, blocks: consolidateBlocks(blocks) });
  });
  return { title, chapters };
}

function parseJson(content: string | null): unknown {
  if (!content) return null;
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

// Index entries (when index.json exists) enrich file-derived metadata.
type IndexEntry = { lang: string; slug: string; title: string; chapters: number };
function parseIndex(parsed: unknown): IndexEntry[] {
  const out: IndexEntry[] = [];
  const rows: unknown[] = Array.isArray(parsed)
    ? parsed
    : Array.isArray(asRecord(parsed)?.["books"])
      ? (asRecord(parsed)?.["books"] as unknown[])
      : [];
  for (const raw of rows) {
    const r = asRecord(raw);
    if (!r) continue;
    const slug = str(r["slug"] ?? r["id"] ?? r["book"]);
    if (!slug) continue;
    out.push({
      lang: str(r["lang"] ?? r["language"]) || "en",
      slug,
      title: str(r["title"] ?? r["name"] ?? r["book"]),
      chapters: num(r["chapters"] ?? r["chapterCount"], 0),
    });
  }
  return out;
}

const segmentSchema = z.object({
  t: z.string(),
  b: z.boolean(),
  i: z.boolean(),
  sc: z.boolean(),
  sh: z.boolean(),
});
const blockSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("heading"), text: z.string() }),
  z.object({
    kind: z.literal("para"),
    verses: z.array(z.object({ n: z.number(), label: z.string(), segments: z.array(segmentSchema) })),
  }),
]);

const bookMetaSchema = z.object({
  lang: z.string(),
  slug: z.string(),
  title: z.string(),
  testament: z.string(),
  usfm: z.string(),
  chapters: z.number(),
  order: z.number(),
  collection: z.string(),
});

const refFields = {
  refKey: z.string().min(1),
  lang: z.string().min(1),
  slug: z.string().min(1),
  bookTitle: z.string().min(1),
  chapter: z.number().int().positive(),
  verse: z.number().int().positive(),
};

// --- Helpers for verses / plans / devotional -------------------------------
const USFM_TO_CANON = new Map<string, CanonEntry>();
for (const c of CANON) USFM_TO_CANON.set(c.usfm.toUpperCase(), c);

function parseUsfmRef(ref: string): { canon: CanonEntry; chapter: number; verseStart: number; verseEnd: number } | null {
  const m = ref.trim().toUpperCase().match(/^([1-3]?[A-Z]{3})\.(\d+)(?:\.(\d+)(?:-(\d+))?)?/);
  if (!m) return null;
  const canon = USFM_TO_CANON.get(m[1] ?? "");
  if (!canon) return null;
  const chapter = Number(m[2] ?? "1") || 1;
  const vs = m[3] ? Number(m[3]) : 1;
  const ve = m[4] ? Number(m[4]) : vs;
  return { canon, chapter, verseStart: vs, verseEnd: Math.max(vs, ve) };
}

function plainOfVerse(v: { segments: Segment[] }): string {
  return v.segments.map((s) => s.t).join("").trim();
}

function extractPassage(book: { chapters: Chapter[] }, chapterNum: number, vStart: number, vEnd: number): { text: string; segments: Segment[] } {
  const ch = book.chapters.find((c) => c.number === chapterNum);
  if (!ch) return { text: "", segments: [] };
  const segs: Segment[] = [];
  const texts: string[] = [];
  for (const b of ch.blocks) {
    if (b.kind !== "para") continue;
    for (const v of b.verses) {
      if (v.n >= vStart && v.n <= vEnd) {
        texts.push(plainOfVerse(v));
        segs.push(...v.segments);
        if (v.n < vEnd) segs.push({ t: " ", b: false, i: false, sc: false, sh: false });
      }
    }
  }
  return { text: texts.join(" ").trim(), segments: segs };
}

function extractChapterVerses(book: { chapters: Chapter[] }, chapterNum: number): { n: number; label: string; text: string; segments: Segment[] }[] {
  const ch = book.chapters.find((c) => c.number === chapterNum);
  if (!ch) return [];
  const out: { n: number; label: string; text: string; segments: Segment[] }[] = [];
  for (const b of ch.blocks) {
    if (b.kind !== "para") continue;
    for (const v of b.verses) out.push({ n: v.n, label: v.label, text: plainOfVerse(v), segments: v.segments });
  }
  return out;
}

// Reading plan templates — readings are chapter ranges in FWT books.
type PlanReading = { day: number; label: string; lang: string; slug: string; chapter: number };
function buildReadings(templateId: string): PlanReading[] {
  const r: PlanReading[] = [];
  const push = (day: number, label: string, slug: string, chapter: number) => r.push({ day, label, lang: "en", slug, chapter });
  if (templateId === "psalms-30") {
    // 150 psalms over 30 days = 5 chapters/day (Psalms is one book, chapters = psalms)
    for (let d = 1; d <= 30; d++) { const start = (d - 1) * 5 + 1; for (let c = start; c < start + 5 && c <= 150; c++) push(d, `Psalms ${c}`, "psalms", c); }
  } else if (templateId === "proverbs-31") {
    for (let d = 1; d <= 31; d++) push(d, `Proverbs ${d}`, "proverbs", d);
  } else if (templateId === "gospels-40") {
    const books: [string, string, number][] = [["matthew", "Matthew", 28], ["mark", "Mark", 16], ["luke", "Luke", 24], ["john", "John", 21]];
    let day = 1; let countInDay = 0;
    for (const [slug, title, total] of books) for (let c = 1; c <= total; c++) { push(day, `${title} ${c}`, slug, c); countInDay++; if (countInDay >= 3) { day++; countInDay = 0; } if (day > 40) break; }
    // trim to 40 days max label-wise (keep all readings, days may reach 30)
  } else if (templateId === "nt-90") {
    const seq: [string, string, number][] = [["matthew","Matthew",28],["mark","Mark",16],["luke","Luke",24],["john","John",21],["acts","Acts",28],["romans","Romans",16],["1-corinthians","1 Corinthians",16],["2-corinthians","2 Corinthians",13],["galatians","Galatians",6],["ephesians","Ephesians",6],["philippians","Philippians",4],["colossians","Colossians",4],["1-thessalonians","1 Thessalonians",5],["2-thessalonians","2 Thessalonians",3],["1-timothy","1 Timothy",6],["2-timothy","2 Timothy",4],["titus","Titus",3],["philemon","Philemon",1],["hebrews","Hebrews",13],["james","James",5],["1-peter","1 Peter",5],["2-peter","2 Peter",3],["1-john","1 John",5],["2-john","2 John",1],["3-john","3 John",1],["jude","Jude",1],["revelation","Revelation",22]];
    let day = 1; let n = 0;
    for (const [slug, title, total] of seq) for (let c = 1; c <= total; c++) { push(day, `${title} ${c}`, slug, c); n++; if (n >= 3) { day++; n = 0; } }
  } else if (templateId === "psalm-a-day") {
    for (let d = 1; d <= 30; d++) push(d, `Psalm ${d}`, "psalms", d);
  }
  return r;
}
const PLAN_TEMPLATES = [
  { id: "psalms-30", title: "Psalms in 30 Days", description: "Five psalms a day through the whole Psalter — worship, lament and praise in a month.", days: 30 },
  { id: "proverbs-31", title: "Proverbs in 31 Days", description: "One chapter of wisdom a day for a month. Short, sharp, practical.", days: 31 },
  { id: "gospels-40", title: "The Gospels in 40 Days", description: "Walk with Yeshua through Matthew, Mark, Luke and John — about three chapters a day.", days: 30 },
  { id: "nt-90", title: "New Testament in 90 Days", description: "The whole New Testament at about three chapters a day.", days: 90 },
  { id: "psalm-a-day", title: "A Psalm a Day — 30 Days", description: "Psalms 1–30, one each morning. A gentle on-ramp to daily reading.", days: 30 },
];
// Fallback verses of the day (FWT refs) when YouVersion has no key yet —
// day-of-year rotates through these well-known passages, all in the corpus.
const FALLBACK_VOTD: { usfm: string; label: string }[] = [
  { usfm: "PSA.1.1-3", label: "Psalm 1:1–3" }, { usfm: "PSA.19.14", label: "Psalm 19:14" },
  { usfm: "PSA.23.1", label: "Psalm 23:1" }, { usfm: "PSA.46.1", label: "Psalm 46:1" },
  { usfm: "PSA.119.11", label: "Psalm 119:11" }, { usfm: "PSA.119.105", label: "Psalm 119:105" },
  { usfm: "PRO.3.5-6", label: "Proverbs 3:5–6" }, { usfm: "ISA.40.31", label: "Isaiah 40:31" },
  { usfm: "JER.29.11", label: "Jeremiah 29:11" }, { usfm: "MIC.6.8", label: "Micah 6:8" },
  { usfm: "MAT.11.28", label: "Matthew 11:28" }, { usfm: "JHN.3.16", label: "John 3:16" },
  { usfm: "JHN.15.5", label: "John 15:5" }, { usfm: "ROM.8.28", label: "Romans 8:28" },
  { usfm: "ROM.12.2", label: "Romans 12:2" }, { usfm: "PHP.4.13", label: "Philippians 4:13" },
  { usfm: "HEB.11.1", label: "Hebrews 11:1" }, { usfm: "JAS.1.5", label: "James 1:5" },
  { usfm: "1PE.5.7", label: "1 Peter 5:7" }, { usfm: "PSA.27.1", label: "Psalm 27:1" },
  { usfm: "PSA.51.10", label: "Psalm 51:10" }, { usfm: "PSA.90.12", label: "Psalm 90:12" },
  { usfm: "PSA.103.1", label: "Psalm 103:1" }, { usfm: "ECC.3.1", label: "Ecclesiastes 3:1" },
  { usfm: "HAB.3.17-18", label: "Habakkuk 3:17–18" }, { usfm: "MAT.6.33", label: "Matthew 6:33" },
  { usfm: "MRK.10.45", label: "Mark 10:45" }, { usfm: "LUK.9.23", label: "Luke 9:23" },
  { usfm: "GAL.5.22-23", label: "Galatians 5:22–23" }, { usfm: "EPH.6.10", label: "Ephesians 6:10" },
];

const passageRefSchema = z.object({ lang: z.string(), slug: z.string(), bookTitle: z.string(), chapter: z.number(), verseStart: z.number(), verseEnd: z.number(), label: z.string() });
const studySchemaOut = z.object({ id: z.number(), title: z.string(), topic: z.string(), passages: z.array(passageRefSchema), observation: z.string(), interpretation: z.string(), application: z.string(), questions: z.array(z.string()), updatedAt: z.string() });
const devotionalBodySchema = z.object({
  historicalContext: z.string(), devotional: z.string(),
  keyTerms: z.array(z.object({ term: z.string(), transliteration: z.string(), definition: z.string(), implication: z.string() })),
  application: z.array(z.string()), prayer: z.string(),
});

export const Actions = {
  getLibrary: defineAction({
    description: "Lists the Fresh Water corpus books present in the data folder, canonical 66 only, by language and testament.",
    request: z.object({}),
    response: z.object({
      books: z.array(bookMetaSchema),
      corpusReady: z.boolean(),
      fileCount: z.number(),
    }),
    privileged: [privileged.listDataFiles, privileged.readDataFile],
    async handler(ctx) {
      const { files } = await ctx.executePrivileged(privileged.listDataFiles, {});
      const indexContent = files.includes("index.json")
        ? (await ctx.executePrivileged(privileged.readDataFile, { name: "index.json" })).content
        : null;
      const index = parseIndex(parseJson(indexContent));
      const indexByFile = new Map<string, IndexEntry>();
      for (const e of index) indexByFile.set(`${e.lang}-${e.slug}.json`, e);

      const books: z.infer<typeof bookMetaSchema>[] = [];
      for (const file of files) {
        if (file === "index.json") continue;
        const m = file.match(/^([a-z]{2,3})-(.+)\.json$/);
        if (!m) continue;
        const lang = m[1] ?? "";
        const rawSlug = m[2] ?? "";
        const fromIndex = indexByFile.get(file);
        const canon = resolveCanon(rawSlug, fromIndex?.title);
        if (!canon) continue; // not in the canonical 66 (yet) — excluded by design
        let title = fromIndex?.title ?? "";
        let chapters = fromIndex?.chapters ?? 0;
        if (!title || !chapters) {
          const content = (await ctx.executePrivileged(privileged.readDataFile, { name: file })).content;
          const normalized = normalizeBook(parseJson(content));
          if (!title) title = normalized.title;
          if (!chapters) chapters = normalized.chapters.length;
        }
        books.push({
          lang,
          slug: rawSlug,
          title: title || (lang === "es" ? canon.title : canon.title),
          testament: canon.testament,
          usfm: canon.usfm,
          chapters,
          order: CANON.indexOf(canon),
          collection: "canonical",
        });
      }
      books.sort((a, b) => a.lang.localeCompare(b.lang) || a.order - b.order);
      return { books, corpusReady: books.length > 0, fileCount: files.length };
    },
  }),

  getBook: defineAction({
    description: "Returns one Fresh Water book's full normalized text (chapters, blocks, verses, formatted segments).",
    request: z.object({ lang: z.string().min(1), slug: z.string().min(1) }),
    response: z.object({
      found: z.boolean(),
      title: z.string(),
      usfm: z.string(),
      testament: z.string(),
      chapters: z.array(
        z.object({ number: z.number(), blocks: z.array(blockSchema) }),
      ),
    }),
    privileged: [privileged.readDataFile],
    async handler(ctx, args) {
      const canon = resolveCanon(args.slug);
      if (!canon) return { found: false, title: "", usfm: "", testament: "", chapters: [] };
      const name = `${args.lang}-${args.slug}.json`;
      const { content } = await ctx.executePrivileged(privileged.readDataFile, { name });
      if (!content) return { found: false, title: canon.title, usfm: canon.usfm, testament: canon.testament, chapters: [] };
      const normalized = normalizeBook(parseJson(content));
      return {
        found: true,
        title: normalized.title || canon.title,
        usfm: canon.usfm,
        testament: canon.testament,
        chapters: normalized.chapters,
      };
    },
  }),

  searchCorpus: defineAction({
    description: "Full-text search across the loaded Fresh Water corpus, returning verse references with matching text.",
    request: z.object({ query: z.string(), lang: z.string().default("") }),
    response: z.object({
      results: z.array(
        z.object({
          lang: z.string(),
          slug: z.string(),
          bookTitle: z.string(),
          chapter: z.number(),
          verse: z.number(),
          text: z.string(),
        }),
      ),
    }),
    privileged: [privileged.searchDataFiles],
    async handler(ctx, args) {
      const q = args.query.trim();
      if (q.length < 2) return { results: [] };
      const langs = args.lang ? [args.lang] : ["en", "es"];
      const all: {
        lang: string; slug: string; bookTitle: string;
        chapter: number; verse: number; text: string;
      }[] = [];
      for (const lang of langs) {
        const { results } = await ctx.executePrivileged(privileged.searchDataFiles, { query: q, lang });
        for (const r of results) {
          const canon = resolveCanon(r.slug, r.bookTitle);
          if (!canon) continue;
          all.push({ ...r, bookTitle: r.bookTitle || canon.title });
        }
      }
      return { results: all.slice(0, 100) };
    },
  }),

  getStudyData: defineAction({
    description: "Returns the user's bookmarks, highlights, notes, settings and last reading position.",
    request: z.object({}),
    response: z.object({
      bookmarks: z.array(z.object({
        refKey: z.string(), lang: z.string(), slug: z.string(), bookTitle: z.string(),
        chapter: z.number(), verse: z.number(),
      })),
      highlights: z.array(z.object({
        refKey: z.string(), lang: z.string(), slug: z.string(), bookTitle: z.string(),
        chapter: z.number(), verse: z.number(), color: z.string(),
      })),
      notes: z.array(z.object({
        refKey: z.string(), lang: z.string(), slug: z.string(), bookTitle: z.string(),
        chapter: z.number(), verse: z.number(), body: z.string(), updatedAt: z.string(),
      })),
      youversionKey: z.string(),
      compareBibleId: z.number(),
      compareBibleName: z.string(),
      position: z.object({
        lang: z.string(), slug: z.string(), chapter: z.number(),
      }).nullable(),
    }),
    async handler(ctx) {
      const db = ctx.db<typeof schema>();
      const [bm, hl, nt, st] = await Promise.all([
        db.select().from(schema.bookmarks).orderBy(desc(schema.bookmarks.createdAt)),
        db.select().from(schema.highlights).orderBy(desc(schema.highlights.updatedAt)),
        db.select().from(schema.notes).orderBy(desc(schema.notes.updatedAt)),
        db.select().from(schema.settings),
      ]);
      const get = (k: string) => st.find((s) => s.key === k)?.value ?? "";
      let position: { lang: string; slug: string; chapter: number } | null = null;
      const rawPos = get("position");
      if (rawPos) {
        const p = asRecord(parseJson(rawPos));
        if (p) {
          position = {
            lang: str(p["lang"]) || "en",
            slug: str(p["slug"]),
            chapter: num(p["chapter"], 1),
          };
          if (!position.slug) position = null;
        }
      }
      return {
        bookmarks: bm.map((r) => ({
          refKey: r.refKey, lang: r.lang, slug: r.slug, bookTitle: r.bookTitle,
          chapter: r.chapter, verse: r.verse,
        })),
        highlights: hl.map((r) => ({
          refKey: r.refKey, lang: r.lang, slug: r.slug, bookTitle: r.bookTitle,
          chapter: r.chapter, verse: r.verse, color: r.color,
        })),
        notes: nt.map((r) => ({
          refKey: r.refKey, lang: r.lang, slug: r.slug, bookTitle: r.bookTitle,
          chapter: r.chapter, verse: r.verse, body: r.body,
          updatedAt: r.updatedAt.toISOString(),
        })),
        youversionKey: get("youversion_key"),
        compareBibleId: Number(get("compare_bible_id")) || 0,
        compareBibleName: get("compare_bible_name"),
        position,
      };
    },
  }),

  toggleBookmark: defineAction({
    description: "Bookmarks a verse, or removes the bookmark if it already exists.",
    request: z.object(refFields),
    response: z.object({ bookmarked: z.boolean() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const existing = await db.select().from(schema.bookmarks)
        .where(eq(schema.bookmarks.refKey, args.refKey));
      if (existing.length > 0) {
        await db.delete(schema.bookmarks).where(eq(schema.bookmarks.refKey, args.refKey));
        ctx.invalidateQueries();
        return { bookmarked: false };
      }
      await db.insert(schema.bookmarks).values({
        refKey: args.refKey, lang: args.lang, slug: args.slug,
        bookTitle: args.bookTitle, chapter: args.chapter, verse: args.verse,
      });
      ctx.invalidateQueries();
      return { bookmarked: true };
    },
  }),

  setHighlight: defineAction({
    description: "Sets or clears (color null) the highlight color on a verse.",
    request: z.object({ ...refFields, color: z.string().nullable() }),
    response: z.object({ ok: z.boolean() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      if (!args.color) {
        await db.delete(schema.highlights).where(eq(schema.highlights.refKey, args.refKey));
      } else {
        await db.insert(schema.highlights).values({
          refKey: args.refKey, lang: args.lang, slug: args.slug,
          bookTitle: args.bookTitle, chapter: args.chapter, verse: args.verse,
          color: args.color,
        }).onConflictDoUpdate({
          target: schema.highlights.refKey,
          set: { color: args.color, updatedAt: new Date() },
        });
      }
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  saveNote: defineAction({
    description: "Saves a personal study note on a verse; an empty body deletes the note.",
    request: z.object({ ...refFields, body: z.string() }),
    response: z.object({ ok: z.boolean() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const body = args.body.trim();
      if (!body) {
        await db.delete(schema.notes).where(eq(schema.notes.refKey, args.refKey));
      } else {
        await db.insert(schema.notes).values({
          refKey: args.refKey, lang: args.lang, slug: args.slug,
          bookTitle: args.bookTitle, chapter: args.chapter, verse: args.verse, body,
        }).onConflictDoUpdate({
          target: schema.notes.refKey,
          set: { body, updatedAt: new Date() },
        });
      }
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  saveSettings: defineAction({
    description: "Saves the user's YouVersion App Key and/or preferred compare version into the app's own storage.",
    request: z.object({
      youversionKey: z.string().optional(),
      compareBibleId: z.number().int().optional(),
      compareBibleName: z.string().optional(),
    }),
    response: z.object({ ok: z.boolean() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const upsert = async (key: string, value: string) => {
        await db.insert(schema.settings).values({ key, value })
          .onConflictDoUpdate({ target: schema.settings.key, set: { value, updatedAt: new Date() } });
      };
      if (args.youversionKey !== undefined) await upsert("youversion_key", args.youversionKey.trim());
      if (args.compareBibleId !== undefined) await upsert("compare_bible_id", String(args.compareBibleId));
      if (args.compareBibleName !== undefined) await upsert("compare_bible_name", args.compareBibleName);
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  savePosition: defineAction({
    description: "Records the user's last reading position for Continue Reading.",
    request: z.object({
      lang: z.string().min(1),
      slug: z.string().min(1),
      chapter: z.number().int().positive(),
    }),
    response: z.object({ ok: z.boolean() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const value = JSON.stringify({ lang: args.lang, slug: args.slug, chapter: args.chapter });
      await db.insert(schema.settings).values({ key: "position", value })
        .onConflictDoUpdate({ target: schema.settings.key, set: { value, updatedAt: new Date() } });
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  listBookmarksForChapter: defineAction({
    description: "Lists bookmark/highlight/note ref keys for one chapter so the reader can mark verses.",
    request: z.object({ lang: z.string(), slug: z.string(), chapter: z.number().int().positive() }),
    response: z.object({
      bookmarkKeys: z.array(z.string()),
      highlightColors: z.array(z.object({ refKey: z.string(), color: z.string() })),
      noteKeys: z.array(z.string()),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const prefix = `${args.lang}:${args.slug}:${args.chapter}:`;
      const [bm, hl, nt] = await Promise.all([
        db.select().from(schema.bookmarks).orderBy(asc(schema.bookmarks.verse)),
        db.select().from(schema.highlights),
        db.select().from(schema.notes),
      ]);
      return {
        bookmarkKeys: bm.filter((r) => r.refKey.startsWith(prefix)).map((r) => r.refKey),
        highlightColors: hl.filter((r) => r.refKey.startsWith(prefix))
          .map((r) => ({ refKey: r.refKey, color: r.color })),
        noteKeys: nt.filter((r) => r.refKey.startsWith(prefix)).map((r) => r.refKey),
      };
    },
  }),

  getVersesBulk: defineAction({
    description: "Returns Fresh Water text for a list of verse references (for the Verses collection view).",
    request: z.object({ refs: z.array(z.object({ lang: z.string(), slug: z.string(), chapter: z.number(), verse: z.number() })).max(60) }),
    response: z.object({ verses: z.array(z.object({ refKey: z.string(), text: z.string(), segments: z.array(segmentSchema) })) }),
    privileged: [privileged.readDataFile],
    async handler(ctx, args) {
      const cache = new Map<string, { chapters: Chapter[] }>();
      const out: { refKey: string; text: string; segments: Segment[] }[] = [];
      for (const r of args.refs) {
        const key = `${r.lang}:${r.slug}:${r.chapter}:${r.verse}`;
        const fileKey = `${r.lang}-${r.slug}`;
        if (!cache.has(fileKey)) {
          const { content } = await ctx.executePrivileged(privileged.readDataFile, { name: `${fileKey}.json` });
          cache.set(fileKey, normalizeBook(parseJson(content)));
        }
        const book = cache.get(fileKey);
        const chVerses = book ? extractChapterVerses(book, r.chapter) : [];
        const v = chVerses.find((x) => x.n === r.verse);
        out.push({ refKey: key, text: v?.text ?? "", segments: v?.segments ?? [] });
      }
      return { verses: out };
    },
  }),

  getPassage: defineAction({
    description: "Returns Fresh Water text for one passage range with formatting segments.",
    request: z.object({ lang: z.string(), slug: z.string(), chapter: z.number(), verseStart: z.number(), verseEnd: z.number() }),
    response: z.object({ found: z.boolean(), text: z.string(), segments: z.array(segmentSchema) }),
    privileged: [privileged.readDataFile],
    async handler(ctx, args) {
      const { content } = await ctx.executePrivileged(privileged.readDataFile, { name: `${args.lang}-${args.slug}.json` });
      if (!content) return { found: false, text: "", segments: [] };
      const book = normalizeBook(parseJson(content));
      const p = extractPassage(book, args.chapter, args.verseStart, args.verseEnd);
      return { found: p.text.length > 0, text: p.text, segments: p.segments };
    },
  }),

  // ---- Study Builder (Precept: Observation / Interpretation / Application) ----
  listStudies: defineAction({
    description: "Lists the user's saved Precept studies.",
    request: z.object({}),
    response: z.object({ studies: z.array(studySchemaOut) }),
    async handler(ctx) {
      const db = ctx.db<typeof schema>();
      const rows = await db.select().from(schema.studies).orderBy(desc(schema.studies.updatedAt));
      return { studies: rows.map((r) => ({ id: r.id, title: r.title, topic: r.topic, passages: (() => { try { return JSON.parse(r.passagesJson); } catch { return []; } })(), observation: r.observation, interpretation: r.interpretation, application: r.application, questions: (() => { try { return JSON.parse(r.questionsJson); } catch { return []; } })(), updatedAt: r.updatedAt.toISOString() })) };
    },
  }),

  saveStudy: defineAction({
    description: "Creates or updates a Precept study (passages, Observation/Interpretation/Application, questions).",
    request: z.object({ id: z.number().optional(), title: z.string().min(1), topic: z.string().default(""), passages: z.array(passageRefSchema).default([]), observation: z.string().default(""), interpretation: z.string().default(""), application: z.string().default(""), questions: z.array(z.string()).default([]) }),
    response: z.object({ id: z.number(), ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ id: number; ok: true }> {
      const db = ctx.db<typeof schema>();
      const vals = { title: args.title, topic: args.topic, passagesJson: JSON.stringify(args.passages), observation: args.observation, interpretation: args.interpretation, application: args.application, questionsJson: JSON.stringify(args.questions), updatedAt: new Date() };
      if (args.id) {
        await db.update(schema.studies).set(vals).where(eq(schema.studies.id, args.id));
        ctx.invalidateQueries();
        return { id: args.id, ok: true as const };
      }
      const inserted = await db.insert(schema.studies).values(vals).returning({ id: schema.studies.id });
      ctx.invalidateQueries();
      return { id: inserted[0]?.id ?? 0, ok: true as const };
    },
  }),

  deleteStudy: defineAction({
    description: "Deletes a saved study.",
    request: z.object({ id: z.number() }),
    response: z.object({ ok: z.boolean() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await db.delete(schema.studies).where(eq(schema.studies.id, args.id));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  // ---- Bible Plans ----
  listPlanTemplates: defineAction({
    description: "Lists available Bible reading plan templates.",
    request: z.object({}),
    response: z.object({ templates: z.array(z.object({ id: z.string(), title: z.string(), description: z.string(), days: z.number() })) }),
    async handler() { return { templates: PLAN_TEMPLATES }; },
  }),

  listMyPlans: defineAction({
    description: "Lists the user's active reading plans with progress.",
    request: z.object({}),
    response: z.object({ plans: z.array(z.object({ id: z.number(), templateId: z.string(), title: z.string(), readings: z.array(z.object({ day: z.number(), label: z.string(), lang: z.string(), slug: z.string(), chapter: z.number() })), completed: z.array(z.number()), startDate: z.string() })) }),
    async handler(ctx) {
      const db = ctx.db<typeof schema>();
      const rows = await db.select().from(schema.plans).orderBy(desc(schema.plans.updatedAt));
      return { plans: rows.map((r) => ({ id: r.id, templateId: r.templateId, title: r.title, readings: (() => { try { return JSON.parse(r.readingsJson); } catch { return []; } })(), completed: (() => { try { return JSON.parse(r.completedJson); } catch { return []; } })(), startDate: r.startDate })) };
    },
  }),

  startPlan: defineAction({
    description: "Starts a reading plan from a template.",
    request: z.object({ templateId: z.string() }),
    response: z.object({ id: z.number(), ok: z.boolean() }),
    async handler(ctx, args) {
      const t = PLAN_TEMPLATES.find((x) => x.id === args.templateId);
      if (!t) return { id: 0, ok: false };
      const db = ctx.db<typeof schema>();
      const readings = buildReadings(args.templateId);
      const today = new Date().toISOString().slice(0, 10);
      const inserted = await db.insert(schema.plans).values({ templateId: t.id, title: t.title, readingsJson: JSON.stringify(readings), completedJson: "[]", startDate: today }).returning({ id: schema.plans.id });
      ctx.invalidateQueries();
      return { id: inserted[0]?.id ?? 0, ok: true };
    },
  }),

  togglePlanDay: defineAction({
    description: "Marks or unmarks one day of a reading plan as read.",
    request: z.object({ planId: z.number(), day: z.number() }),
    response: z.object({ ok: z.boolean(), completed: z.array(z.number()) }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const rows = await db.select().from(schema.plans).where(eq(schema.plans.id, args.planId));
      const row = rows[0];
      if (!row) return { ok: false, completed: [] };
      let completed: number[] = [];
      try { completed = JSON.parse(row.completedJson); } catch { completed = []; }
      completed = completed.includes(args.day) ? completed.filter((d) => d !== args.day) : [...completed, args.day].sort((a, b) => a - b);
      await db.update(schema.plans).set({ completedJson: JSON.stringify(completed), updatedAt: new Date() }).where(eq(schema.plans.id, args.planId));
      ctx.invalidateQueries();
      return { ok: true, completed };
    },
  }),

  deletePlan: defineAction({
    description: "Removes a reading plan.",
    request: z.object({ id: z.number() }),
    response: z.object({ ok: z.boolean() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await db.delete(schema.plans).where(eq(schema.plans.id, args.id));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  // ---- Daily Devotional (from Verse of the Day, FWT text) ----
  getDevotional: defineAction({
    description: "Returns today's devotional built on the verse of the day in Fresh Water text; generates and caches it once per day.",
    request: z.object({ dateKey: z.string(), votdUsfm: z.string().default("") }),
    response: z.object({ dateKey: z.string(), referenceLabel: z.string(), usfmRef: z.string(), scriptureText: z.string(), scriptureSegments: z.array(segmentSchema), body: devotionalBodySchema, source: z.string() }),
    privileged: [privileged.readDataFile],
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const existing = await db.select().from(schema.devotionals).where(eq(schema.devotionals.dateKey, args.dateKey));
      // Resolve the verse ref: client-supplied YouVersion VOTD, else fallback rotation
      let usfm = args.votdUsfm.trim();
      let source = usfm ? "youversion" : "fwt-rotation";
      if (!usfm) {
        const doy = Math.floor((new Date(args.dateKey + "T12:00:00").getTime() - new Date(new Date(args.dateKey + "T12:00:00").getFullYear(), 0, 0).getTime()) / 86400000);
        const fb = FALLBACK_VOTD[Math.abs(doy) % FALLBACK_VOTD.length] ?? FALLBACK_VOTD[0]!;
        usfm = fb.usfm;
      }
      if (existing[0] && existing[0].usfmRef === usfm) {
        const body = (() => { try { return JSON.parse(existing[0].bodyJson); } catch { return null; } })();
        if (body) {
          // re-extract segments for faithful rendering
          const parsed = parseUsfmRef(existing[0].usfmRef);
          let segs: Segment[] = [];
          if (parsed) {
            const { content } = await ctx.executePrivileged(privileged.readDataFile, { name: `en-${parsed.canon.slug}.json` });
            if (content) segs = extractPassage(normalizeBook(parseJson(content)), parsed.chapter, parsed.verseStart, parsed.verseEnd).segments;
          }
          return { dateKey: args.dateKey, referenceLabel: existing[0].referenceLabel, usfmRef: existing[0].usfmRef, scriptureText: existing[0].scriptureText, scriptureSegments: segs, body, source };
        }
      }
      const parsed = parseUsfmRef(usfm);
      if (!parsed) throw new Error("Could not parse verse reference");
      const refLabel = `${parsed.canon.title} ${parsed.chapter}:${parsed.verseStart}${parsed.verseEnd !== parsed.verseStart ? `–${parsed.verseEnd}` : ""}`;
      const { content } = await ctx.executePrivileged(privileged.readDataFile, { name: `en-${parsed.canon.slug}.json` });
      const book = content ? normalizeBook(parseJson(content)) : { title: "", chapters: [] as Chapter[] };
      const pass = extractPassage(book, parsed.chapter, parsed.verseStart, parsed.verseEnd);
      const scriptureText = pass.text || refLabel;
      const prompt = `Write a daily devotional for Christian men — direct, masculine, encouraging, convicting and practical — based on this Fresh Water Translation passage.\n\nPassage: ${refLabel}\nText (Fresh Water Translation): "${scriptureText}"\n\nRequirements (keep the WHOLE devotional under about 2,400 characters total):\n- historicalContext: 2–3 sentences on setting, author, audience.\n- devotional: the heart of it — follow the passage's own movement, plain and strong.\n- keyTerms: exactly 2 terms — each with the original Hebrew or Greek word, transliteration, a literal definition, and its implication for the reader.\n- application: 1–2 measurable, do-today steps (not vague intentions).\n- prayer: short, first person.\nDo not add a Scripture field — the app prints the passage itself. Stay close to the text; do not invent quotations.`;
      const body = await ctx.inference.complete(prompt, { schema: devotionalBodySchema });
      await db.insert(schema.devotionals).values({ dateKey: args.dateKey, usfmRef: usfm, referenceLabel: refLabel, scriptureText, bodyJson: JSON.stringify(body) }).onConflictDoUpdate({ target: schema.devotionals.dateKey, set: { usfmRef: usfm, referenceLabel: refLabel, scriptureText, bodyJson: JSON.stringify(body) } });
      ctx.invalidateQueries();
      return { dateKey: args.dateKey, referenceLabel: refLabel, usfmRef: usfm, scriptureText, scriptureSegments: pass.segments, body, source };
    },
  }),

  // ---- AI Helper ----
  askHelper: defineAction({
    description: "Asks the AI study helper a Bible question, grounded in the Fresh Water text and any passage context supplied.",
    request: z.object({ question: z.string().min(2), contextRef: z.string().default(""), contextText: z.string().default("") }),
    response: z.object({ answer: z.string(), id: z.number() }),
    async handler(ctx, args) {
      const ctxBlock = args.contextText ? `\n\nThe user is looking at ${args.contextRef || "this passage"} (Fresh Water Translation): "${args.contextText}"` : "";
      const prompt = `You are a Bible study helper inside the Fresh Water Translation Bible Study app. Answer the man's question straight and helpfully, grounded in Scripture. Quote or cite Fresh Water wording where you use it, give references for claims, explain Hebrew/Greek terms when they matter, and keep it practical. If the question goes beyond what Scripture says, say so plainly. Keep the answer focused (roughly 150–350 words) with short paragraphs.${ctxBlock}\n\nQuestion: ${args.question}`;
      const result = await ctx.inference.complete(prompt, { schema: z.object({ answer: z.string() }) });
      const db = ctx.db<typeof schema>();
      const inserted = await db.insert(schema.aiNotes).values({ refKey: args.contextRef, question: args.question, answer: result.answer }).returning({ id: schema.aiNotes.id });
      ctx.invalidateQueries();
      return { answer: result.answer, id: inserted[0]?.id ?? 0 };
    },
  }),

  explainPassage: defineAction({
    description: "Explains one Fresh Water passage: what it says, key terms, and how it applies.",
    request: z.object({ lang: z.string(), slug: z.string(), chapter: z.number(), verseStart: z.number(), verseEnd: z.number() }),
    response: z.object({ answer: z.string() }),
    privileged: [privileged.readDataFile],
    async handler(ctx, args) {
      const canon = resolveCanon(args.slug);
      const { content } = await ctx.executePrivileged(privileged.readDataFile, { name: `${args.lang}-${args.slug}.json` });
      const book = content ? normalizeBook(parseJson(content)) : null;
      const pass = book ? extractPassage(book, args.chapter, args.verseStart, args.verseEnd) : { text: "", segments: [] as Segment[] };
      const label = `${canon?.title ?? args.slug} ${args.chapter}:${args.verseStart}${args.verseEnd !== args.verseStart ? `–${args.verseEnd}` : ""}`;
      const prompt = `Explain this Fresh Water Translation passage for a man studying his Bible. Passage: ${label}\nText: "${pass.text}"\n\nGive: (1) what it says in plain words, (2) one or two key Hebrew/Greek terms with transliteration and meaning if relevant, (3) what it asks of the reader today. About 200 words, direct tone.`;
      const result = await ctx.inference.complete(prompt, { schema: z.object({ answer: z.string() }) });
      return { answer: result.answer };
    },
  }),

  listAiNotes: defineAction({
    description: "Lists recent AI helper answers the user has received.",
    request: z.object({}),
    response: z.object({ notes: z.array(z.object({ id: z.number(), refKey: z.string(), question: z.string(), answer: z.string(), createdAt: z.string() })) }),
    async handler(ctx) {
      const db = ctx.db<typeof schema>();
      const rows = await db.select().from(schema.aiNotes).orderBy(desc(schema.aiNotes.createdAt));
      return { notes: rows.slice(0, 30).map((r) => ({ id: r.id, refKey: r.refKey, question: r.question, answer: r.answer, createdAt: r.createdAt.toISOString() })) };
    },
  }),
} satisfies ActionsModule;
