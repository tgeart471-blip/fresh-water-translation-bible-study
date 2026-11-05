import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import {
definePrivilegedContracts,
definePrivilegedHandlers,
z,
} from "@hatch/space-sdk";

// The Fresh Water corpus lives OUTSIDE this artifact, extracted from the
// user's own verified translation volumes into ~/workspace/fwt-app/data/
// (index.json plus one <lang>-<slug>.json per book). These privileged
// handlers are the only code that touches that folder; actions consume
// them through ctx.executePrivileged.

const DATA_DIR = join(homedir(), "workspace", "fwt-app", "data");

function safeJsonName(name: string): string | null {
  const base = basename(name);
  if (!base.endsWith(".json")) return null;
  if (base !== name) return null;
  return base;
}

export const privileged = definePrivilegedContracts({
  listDataFiles: {
    request: z.object({}),
    response: z.object({ files: z.array(z.string()) }),
    capabilities: ["filesystem.read"],
    timeoutMs: 15000,
  },
  readDataFile: {
    request: z.object({ name: z.string() }),
    response: z.object({ content: z.string().nullable() }),
    capabilities: ["filesystem.read"],
    timeoutMs: 15000,
  },
  searchDataFiles: {
    request: z.object({ query: z.string(), lang: z.string() }),
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
    capabilities: ["filesystem.read"],
    timeoutMs: 30000,
  },
});

type AnyRecord = Record<string, unknown>;

function asRecord(v: unknown): AnyRecord | null {
  return v != null && typeof v === "object" && !Array.isArray(v)
    ? (v as AnyRecord)
    : null;
}

function segmentText(seg: unknown): string {
  const r = asRecord(seg);
  if (!r) return typeof seg === "string" ? seg : "";
  const t = r["t"] ?? r["text"] ?? "";
  return typeof t === "string" ? t : "";
}

function verseNumber(v: AnyRecord): number {
  const n = v["n"] ?? v["verse"] ?? v["number"] ?? 0;
  if (typeof n === "number") return n;
  const parsed = Number.parseInt(String(n), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function segShaded(seg: unknown): boolean {
  const r = asRecord(seg);
  if (!r) return false;
  const v = r["sh"] ?? r["shaded"] ?? r["shade"];
  return v === true || v === 1 || v === "true";
}

function plainTextOfBook(
  book: AnyRecord,
): { chapter: number; verse: number; text: string }[] {
  const raw: { chapter: number; verse: number; text: string; hasSh: boolean }[] = [];
  const out: { chapter: number; verse: number; text: string }[] = [];
  const chapters = Array.isArray(book["chapters"]) ? book["chapters"] : [];
  chapters.forEach((rawCh, ci) => {
    const ch = asRecord(rawCh);
    if (!ch) return;
    const chNum =
      typeof ch["number"] === "number"
        ? ch["number"]
        : typeof ch["n"] === "number"
          ? ch["n"]
          : ci + 1;
    const blocks = Array.isArray(ch["blocks"]) ? ch["blocks"] : [];
    for (const rawBlock of blocks) {
      const block = asRecord(rawBlock);
      if (!block) continue;
      const verses = Array.isArray(block["verses"]) ? block["verses"] : [];
      for (const rawVerse of verses) {
        const v = asRecord(rawVerse);
        if (!v) continue;
        const segs = Array.isArray(v["segments"]) ? v["segments"] : [];
        const text = segs.map(segmentText).join("").trim();
        if (text) raw.push({ chapter: chNum, verse: verseNumber(v), text, hasSh: segs.some(segShaded) });
      }
    }
    // Tolerate chapters that carry verses directly.
    const direct = Array.isArray(ch["verses"]) ? ch["verses"] : [];
    for (const rawVerse of direct) {
      const v = asRecord(rawVerse);
      if (!v) continue;
      const segs = Array.isArray(v["segments"]) ? v["segments"] : [];
      const text = segs.map(segmentText).join("").trim();
      if (text) raw.push({ chapter: chNum, verse: verseNumber(v), text, hasSh: segs.some(segShaded) });
    }
  });
  // Concatenate fragments of one verse split across printed lines
  // (consecutive entries with the same number and shading signature).
  // Daniel 3's two verse-24 sequences differ in shading, so they stay apart.
  let lastHasSh: boolean | null = null;
  for (const entry of raw) {
    const prev = out[out.length - 1];
    if (
      prev &&
      prev.chapter === entry.chapter &&
      prev.verse === entry.verse &&
      lastHasSh === entry.hasSh
    ) {
      const needsSpace =
        !/\s$/.test(prev.text) && !/^[\s.,;:!?%")\]]/.test(entry.text);
      prev.text = needsSpace ? `${prev.text} ${entry.text}` : `${prev.text}${entry.text}`;
    } else {
      out.push({ chapter: entry.chapter, verse: entry.verse, text: entry.text });
      lastHasSh = entry.hasSh;
    }
  }
  return out;
}

export const privilegedHandlers = definePrivilegedHandlers(privileged, {
  async listDataFiles() {
    try {
      const names = await readdir(DATA_DIR);
      return { files: names.filter((n) => n.endsWith(".json")).sort() };
    } catch {
      return { files: [] };
    }
  },

  async readDataFile(args) {
    const name = safeJsonName(args.name);
    if (!name) return { content: null };
    try {
      const content = await readFile(join(DATA_DIR, name), "utf8");
      return { content };
    } catch {
      return { content: null };
    }
  },

  async searchDataFiles(args) {
    const q = args.query.trim().toLowerCase();
    if (q.length < 2) return { results: [] };
    let files: string[] = [];
    try {
      files = (await readdir(DATA_DIR)).filter((n) => n.endsWith(".json"));
    } catch {
      return { results: [] };
    }
    const results: {
      lang: string;
      slug: string;
      bookTitle: string;
      chapter: number;
      verse: number;
      text: string;
    }[] = [];
    for (const file of files.sort()) {
      if (file === "index.json") continue;
      const m = /^([a-z]{2,3})-(.+)\.json$/.exec(file);
      if (!m) continue;
      const lang = m[1] ?? "";
      const slug = m[2] ?? "";
      if (args.lang && lang !== args.lang) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(await readFile(join(DATA_DIR, file), "utf8"));
      } catch {
        continue;
      }
      const book = asRecord(parsed);
      if (!book) continue;
      const title =
        typeof book["title"] === "string"
          ? book["title"]
          : typeof book["name"] === "string"
            ? book["name"]
            : typeof book["book"] === "string"
              ? book["book"]
              : slug;
      for (const v of plainTextOfBook(book)) {
        if (v.text.toLowerCase().includes(q)) {
          results.push({
            lang,
            slug,
            bookTitle: title,
            chapter: v.chapter,
            verse: v.verse,
            text: v.text.length > 300 ? `${v.text.slice(0, 300)}…` : v.text,
          });
          if (results.length >= 120) return { results };
        }
      }
    }
    return { results };
  },
});
