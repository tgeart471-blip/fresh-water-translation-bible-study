import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SafeAreaTopScrim } from "@hatch/space-sdk/client";
import { api, type ApiResponse } from "./api";

type LibraryData = ApiResponse<typeof api, "getLibrary">;
type BookMeta = LibraryData["books"][number];
type BookData = ApiResponse<typeof api, "getBook">;
type StudyData = ApiResponse<typeof api, "getStudyData">;
type SearchResult = ApiResponse<typeof api, "searchCorpus">["results"][number];

type View = "home" | "library" | "reader" | "search" | "study" | "settings";
type StudyTab = "marks" | "verses" | "builder" | "plans" | "devotional" | "helper";
type Lang = "en" | "es";

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function downloadText(filename: string, text: string, mime = "text/plain") {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const HIGHLIGHT_COLORS: { name: string; label: string; cls: string; swatch: string }[] = [
  { name: "yellow", label: "Yellow", cls: "bg-yellow-200/70 dark:bg-yellow-500/25", swatch: "#fde68a" },
  { name: "green", label: "Green", cls: "bg-green-200/70 dark:bg-green-500/25", swatch: "#a7f3c9" },
  { name: "blue", label: "Blue", cls: "bg-sky-200/70 dark:bg-sky-500/25", swatch: "#bae6fd" },
  { name: "pink", label: "Pink", cls: "bg-pink-200/70 dark:bg-pink-500/25", swatch: "#fbcfe8" },
  { name: "orange", label: "Orange", cls: "bg-orange-200/70 dark:bg-orange-500/25", swatch: "#fed7aa" },
  { name: "purple", label: "Purple", cls: "bg-violet-200/70 dark:bg-violet-500/25", swatch: "#ddd6fe" },
];
function hlClsFor(color: string | undefined): string {
  return HIGHLIGHT_COLORS.find((c) => c.name === color)?.cls ?? "";
}

function refKey(lang: string, slug: string, chapter: number, verse: number | string): string {
  return `${lang}:${slug}:${chapter}:${verse}`;
}

// ---------------------------------------------------------------------------
// YouVersion Platform API — called directly from the client with the user's
// own App Key (stored only in this app's storage via saveSettings).
// ---------------------------------------------------------------------------

type YvVersion = { id: number; title: string; abbr: string };

// Non-reversible fingerprint of the key for query keys: a different key must
// re-run verification instead of inheriting the previous key's cached
// result, without putting the raw key itself into the query cache.
function keyFingerprint(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) {
    h = (Math.imul(h, 31) + key.charCodeAt(i)) | 0;
  }
  return key ? `${key.length}.${(h >>> 0).toString(36)}` : "none";
}

async function yvGet(key: string, path: string): Promise<unknown> {
  // Bounded wait: a slow or hung YouVersion call must settle as an error,
  // never leave a panel pending forever.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  let res: Response;
  try {
    res = await fetch(`https://api.youversion.com/v1${path}`, {
      headers: { "X-YVP-App-Key": key, Accept: "application/json" },
      signal: controller.signal,
    });
  } catch {
    throw new Error("YouVersion request timed out or failed");
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`YouVersion request failed (${res.status})`);
  return res.json();
}

function asObj(v: unknown): Record<string, unknown> | null {
  return v != null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function parseVersions(json: unknown): YvVersion[] {
  const root = asObj(json);
  const data = Array.isArray(root?.["data"]) ? (root["data"] as unknown[]) : [];
  const out: YvVersion[] = [];
  for (const raw of data) {
    const d = asObj(raw);
    if (!d) continue;
    const id = Number(d["id"]);
    if (!Number.isFinite(id) || id <= 0) continue;
    const title =
      (typeof d["local_title"] === "string" && d["local_title"]) ||
      (typeof d["title"] === "string" && d["title"]) ||
      (typeof d["name"] === "string" && d["name"]) ||
      `Bible ${id}`;
    const abbr =
      (typeof d["local_abbreviation"] === "string" && d["local_abbreviation"]) ||
      (typeof d["abbreviation"] === "string" && d["abbreviation"]) ||
      "";
    out.push({ id, title: String(title), abbr: String(abbr) });
  }
  return out;
}

function parsePassage(json: unknown): { content: string; reference: string } {
  const root = asObj(json);
  const d = asObj(root?.["data"]) ?? root ?? {};
  return {
    content: typeof d["content"] === "string" ? d["content"] : "",
    reference: typeof d["reference"] === "string" ? d["reference"] : "",
  };
}

function useYvVersions(key: string, lang: Lang) {
  return useQuery({
    queryKey: ["yv-versions", keyFingerprint(key), lang],
    enabled: key.length > 4,
    staleTime: 1000 * 60 * 60,
    retry: false,
    queryFn: async () => {
      const range = lang === "es" ? "spa" : "eng";
      const json = await yvGet(
        key,
        `/bibles?language_ranges[]=${range}`,
      );
      return parseVersions(json);
    },
  });
}

// ---------------------------------------------------------------------------
// Small UI pieces
// ---------------------------------------------------------------------------

function Icon({ d, label }: { d: string; label: string }) {
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox="0 0 24 24"
      className="h-6 w-6"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={d} />
    </svg>
  );
}

const ICONS = {
  home: "M3 10.5 12 3l9 7.5M5 9.5V21h14V9.5",
  library: "M4 19.5A2.5 2.5 0 0 1 6.5 17H20V4H6.5A2.5 2.5 0 0 0 4 6.5v13zM4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3",
  bookmark: "M6 3h12v18l-6-4-6 4V3z",
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.51 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9c.24.6.86 1 1.51 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1z",
};

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--dim)]">
      {children}
    </h2>
  );
}

// ---------------------------------------------------------------------------
// Home
// ---------------------------------------------------------------------------

function VerseOfTheDay({ apiKey, bibleId }: { apiKey: string; bibleId: number }) {
  const votd = useQuery({
    queryKey: ["yv-votd", keyFingerprint(apiKey), bibleId],
    enabled: apiKey.length > 4,
    staleTime: 1000 * 60 * 60 * 6,
    retry: false,
    queryFn: async () => {
      const now = new Date();
      const start = new Date(now.getFullYear(), 0, 0);
      const doy = Math.floor((now.getTime() - start.getTime()) / 86400000);
      // Verified shape: GET /verse-of-the-days/{day-of-year} returns
      // { day, passage_id (a USFM reference), image_id }.
      const json = await yvGet(apiKey, `/verse-of-the-days/${doy}`);
      const root = asObj(json);
      const d = asObj(root?.["data"]) ?? root ?? {};
      const ref = typeof d["passage_id"] === "string" ? d["passage_id"] : "";
      if (!ref) throw new Error("No verse reference in response");
      const useBible = bibleId || 111; // 111 = NIV11, in the licensed set
      const passage = parsePassage(
        await yvGet(apiKey, `/bibles/${useBible}/passages/${ref}?format=text`),
      );
      return { ref, ...passage };
    },
  });

  if (!apiKey) {
    return (
      <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4">
        <SectionTitle>Verse of the day</SectionTitle>
        <p className="mt-2 text-sm text-[var(--dim)]">
          Add your YouVersion App Key in Settings and the verse of the day will
          appear here each morning.
        </p>
      </div>
    );
  }
  return (
    <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4">
      <SectionTitle>Verse of the day · YouVersion</SectionTitle>
      {votd.isPending ? (
        <p className="mt-2 text-sm text-[var(--dim)]">Loading…</p>
      ) : votd.isError || !votd.data ? (
        <p className="mt-2 text-sm text-[var(--dim)]">
          The verse of the day could not be loaded right now.
        </p>
      ) : (
        <>
          <p className="scripture mt-2 text-lg leading-relaxed text-[var(--text)]">
            {votd.data.content}
          </p>
          <p className="mt-2 text-sm font-medium text-[var(--accent)]">
            {votd.data.reference || votd.data.ref}
          </p>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Compare panel (YouVersion beside Fresh Water)
// ---------------------------------------------------------------------------

function ComparePanel({
  apiKey,
  study,
  meta,
  chapter,
  onGoSettings,
}: {
  apiKey: string;
  study: StudyData;
  meta: BookMeta;
  chapter: number;
  onGoSettings: () => void;
}) {
  const lang: Lang = meta.lang === "es" ? "es" : "en";
  const versions = useYvVersions(apiKey, lang);
  const queryClient = useQueryClient();
  const [bibleId, setBibleId] = useState<number>(study.compareBibleId);
  useEffect(() => {
    if (study.compareBibleId) setBibleId(study.compareBibleId);
  }, [study.compareBibleId]);
  useEffect(() => {
    if (!bibleId && versions.data && versions.data.length > 0) {
      setBibleId(versions.data[0]?.id ?? 0);
    }
  }, [versions.data, bibleId]);

  const saveCompare = useMutation({
    mutationFn: (v: YvVersion) =>
      api.saveSettings({ compareBibleId: v.id, compareBibleName: v.abbr || v.title }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["study"] }),
  });

  const passageRef = `${meta.usfm}.${chapter}`;
  const passage = useQuery({
    queryKey: ["yv-passage", bibleId, passageRef],
    enabled: apiKey.length > 4 && bibleId > 0,
    retry: false,
    queryFn: async () =>
      parsePassage(
        await yvGet(apiKey, `/bibles/${bibleId}/passages/${passageRef}?format=text`),
      ),
  });

  if (!apiKey) {
    return (
      <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-alt)] p-4">
        <p className="text-sm text-[var(--text)]">
          Compare this chapter with another translation from YouVersion.
        </p>
        <button
          type="button"
          onClick={onGoSettings}
          className="mt-3 rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white"
        >
          Add your YouVersion App Key
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="flex items-center justify-between gap-3">
        <SectionTitle>Compare · YouVersion</SectionTitle>
        {versions.isPending ? (
          <span className="text-xs text-[var(--dim)]">Loading versions…</span>
        ) : versions.data ? (
          <label className="sr-only" htmlFor="yv-version">YouVersion version</label>
        ) : null}
      </div>
      {versions.isError ? (
        <p className="mt-2 text-sm text-red-600 dark:text-red-400">
          YouVersion rejected the request — check your App Key in Settings.
        </p>
      ) : versions.data ? (
        <select
          id="yv-version"
          aria-label="YouVersion version"
          className="mt-2 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)]"
          value={bibleId || ""}
          onChange={(e) => {
            const v = versions.data?.find((x) => x.id === Number(e.target.value));
            if (v) {
              setBibleId(v.id);
              saveCompare.mutate(v);
            }
          }}
        >
          {versions.data.map((v) => (
            <option key={v.id} value={v.id}>
              {v.abbr ? `${v.abbr} — ` : ""}{v.title}
            </option>
          ))}
        </select>
      ) : null}
      <div className="mt-3">
        {passage.isPending && bibleId > 0 ? (
          <p className="text-sm text-[var(--dim)]">Loading passage…</p>
        ) : passage.isError ? (
          <p className="text-sm text-[var(--dim)]">
            This version does not offer {meta.title} {chapter}, or the passage
            could not be loaded.
          </p>
        ) : passage.data?.content ? (
          <>
            <p className="text-xs font-medium text-[var(--accent)]">
              {passage.data.reference || passageRef}
            </p>
            <p className="scripture mt-1 whitespace-pre-line text-base leading-relaxed text-[var(--text)]">
              {passage.data.content}
            </p>
          </>
        ) : (
          <p className="text-sm text-[var(--dim)]">Choose a version to compare.</p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reader
// ---------------------------------------------------------------------------

function VerseSheet({
  meta,
  chapter,
  verse,
  verseLabel,
  chapterVerses,
  study,
  onClose,
  onOpenBuilder,
}: {
  meta: BookMeta;
  chapter: number;
  verse: number;
  verseLabel: string;
  chapterVerses: { n: number; label: string }[];
  study: StudyData;
  onClose: () => void;
  onOpenBuilder: () => void;
}) {
  const queryClient = useQueryClient();
  const key = refKey(meta.lang, meta.slug, chapter, verseLabel);
  const ref = {
    refKey: key,
    lang: meta.lang,
    slug: meta.slug,
    bookTitle: meta.title,
    chapter,
    verse,
  };
  const bookmarked = study.bookmarks.some((b) => b.refKey === key);
  const highlight = study.highlights.find((h) => h.refKey === key);
  const existingNote = study.notes.find((n) => n.refKey === key);
  const [noteDraft, setNoteDraft] = useState<string | null>(null);
  const noteValue = noteDraft ?? existingNote?.body ?? "";

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["study"] });
    queryClient.invalidateQueries({ queryKey: ["marks"] });
  };
  const toggleBm = useMutation({
    mutationFn: () => api.toggleBookmark(ref),
    onSuccess: invalidate,
  });
  const setHl = useMutation({
    mutationFn: (color: string | null) => api.setHighlight({ ...ref, color }),
    onSuccess: invalidate,
  });
  const saveNote = useMutation({
    mutationFn: () => api.saveNote({ ...ref, body: noteValue }),
    onSuccess: () => {
      invalidate();
      setNoteDraft(null);
      setConfirmDeleteNote(false);
    },
  });
  const deleteNote = useMutation({
    mutationFn: () => api.saveNote({ ...ref, body: "" }),
    onSuccess: () => {
      invalidate();
      setNoteDraft(null);
      setConfirmDeleteNote(false);
    },
  });
  // Range highlighting: apply the chosen colour to every verse from this
  // verse through the picked end verse (stored per-verse, same data model).
  const [rangeEnd, setRangeEnd] = useState<number>(verse);
  const [rangeMsg, setRangeMsg] = useState("");
  const [confirmDeleteNote, setConfirmDeleteNote] = useState(false);
  useEffect(() => { setRangeEnd(verse); }, [verse, chapter, meta.slug]);
  const applyRangeHighlight = useMutation({
    mutationFn: async (color: string | null) => {
      const lo = Math.min(verse, rangeEnd);
      const hi = Math.max(verse, rangeEnd);
      const targets = chapterVerses.filter((v) => v.n >= lo && v.n <= hi);
      for (const v of targets) {
        await api.setHighlight({
          refKey: refKey(meta.lang, meta.slug, chapter, v.label),
          lang: meta.lang, slug: meta.slug, bookTitle: meta.title,
          chapter, verse: v.n, color,
        });
      }
      return targets.length;
    },
    onSuccess: (count, color) => {
      invalidate();
      setRangeMsg(color ? `Highlighted ${count} verse${count === 1 ? "" : "s"} ✓` : `Highlight removed from ${count} verse${count === 1 ? "" : "s"} ✓`);
    },
  });
  const passage = useQuery({
    queryKey: ["passage", meta.lang, meta.slug, chapter, verse],
    queryFn: () => api.getPassage({ lang: meta.lang, slug: meta.slug, chapter, verseStart: verse, verseEnd: verse }),
  });
  const studiesQ = useQuery({ queryKey: ["studies"], queryFn: () => api.listStudies({}) });
  const [explain, setExplain] = useState("");
  const [copied, setCopied] = useState(false);
  const [pickedStudy, setPickedStudy] = useState<number>(0);
  const explainMut = useMutation({
    mutationFn: () => api.explainPassage({ lang: meta.lang, slug: meta.slug, chapter, verseStart: verse, verseEnd: verse }),
    onSuccess: (d) => setExplain(d.answer),
  });
  const addToStudy = useMutation({
    mutationFn: async () => {
      const label = `${meta.title} ${chapter}:${verseLabel}`;
      const p = { lang: meta.lang, slug: meta.slug, bookTitle: meta.title, chapter, verseStart: verse, verseEnd: verse, label };
      const list = studiesQ.data?.studies ?? [];
      const target = list.find((s) => s.id === pickedStudy) ?? list[0];
      if (target) {
        if (target.passages.some((x) => x.label === label)) return target.id;
        return (await api.saveStudy({ id: target.id, title: target.title, topic: target.topic, passages: [...target.passages, p], observation: target.observation, interpretation: target.interpretation, application: target.application, questions: target.questions })).id;
      }
      return (await api.saveStudy({ title: `${meta.title} ${chapter} — Study`, topic: label, passages: [p], observation: "", interpretation: "", application: "", questions: ["What does the text say, in my own words?", "What does it reveal about God?"] })).id;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["studies"] }),
  });

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 mx-auto max-w-2xl px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-xl">
        <div className="flex items-center justify-between">
          <p className="scripture text-lg font-semibold text-[var(--text)]">
            {meta.title} {chapter}:{verseLabel}
          </p>
          <button
            type="button"
            aria-label="Close verse actions"
            onClick={onClose}
            className="rounded-full px-3 py-1 text-sm text-[var(--dim)]"
          >
            Done
          </button>
        </div>

        <p className="mt-1 text-xs text-[var(--dim)]">Highlight it, bookmark it, write a note — it all saves and shows in My Study.</p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => toggleBm.mutate()}
            aria-pressed={bookmarked}
            className={`rounded-full px-4 py-2 text-sm font-medium ${
              bookmarked
                ? "bg-[var(--accent)] text-white"
                : "bg-[var(--accent-soft)] text-[var(--accent)]"
            }`}
          >
            {bookmarked ? "🔖 Bookmarked" : "🔖 Bookmark"}
          </button>
        </div>

        <div className="mt-4 rounded-xl border border-[var(--border)] p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--dim)]">Highlight — 6 colours</p>
            {highlight ? <span className="text-xs text-[var(--dim)]">Now: {HIGHLIGHT_COLORS.find((c) => c.name === highlight.color)?.label ?? highlight.color}</span> : <span className="text-xs text-[var(--dim)]">Not highlighted</span>}
          </div>
          <div className="mt-2 grid grid-cols-6 gap-2" role="group" aria-label="Highlight colour">
            {HIGHLIGHT_COLORS.map((c) => (
              <button
                key={c.name}
                type="button"
                aria-label={`Highlight ${c.label}`}
                aria-pressed={highlight?.color === c.name}
                title={c.label}
                onClick={() => setHl.mutate(c.name)}
                className={`flex flex-col items-center gap-1 rounded-lg border-2 py-1.5 ${highlight?.color === c.name ? "border-[var(--accent)]" : "border-transparent"}`}
              >
                <span aria-hidden className="h-7 w-7 rounded-full border border-black/10" style={{ backgroundColor: c.swatch }} />
                <span className="text-[10px] font-medium text-[var(--dim)]">{c.label}</span>
              </button>
            ))}
          </div>
          {highlight ? (
            <button type="button" onClick={() => setHl.mutate(null)} className="mt-1 rounded-full px-3 py-1.5 text-sm text-[var(--dim)] underline">
              Remove highlight from this verse
            </button>
          ) : null}
          <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-2">
            <label htmlFor="range-end" className="text-sm text-[var(--text)]">Highlight a run: vv. {verseLabel} –</label>
            <select id="range-end" aria-label="Highlight through verse" value={rangeEnd} onChange={(e) => setRangeEnd(Number(e.target.value))} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm text-[var(--text)]">
              {chapterVerses.filter((v) => v.n >= verse).map((v) => (<option key={v.label} value={v.n}>{v.label}</option>))}
            </select>
            <span className="text-xs text-[var(--dim)]">then tap a colour:</span>
            {HIGHLIGHT_COLORS.map((c) => (
              <button key={c.name} type="button" aria-label={`Highlight verses ${verseLabel} to ${rangeEnd} in ${c.label}`} onClick={() => applyRangeHighlight.mutate(c.name)} disabled={applyRangeHighlight.isPending} className="h-7 w-7 rounded-full border border-black/10 disabled:opacity-40" style={{ backgroundColor: c.swatch }} />
            ))}
            {rangeEnd !== verse ? <button type="button" onClick={() => applyRangeHighlight.mutate(null)} disabled={applyRangeHighlight.isPending} className="text-xs text-[var(--dim)] underline">Remove from run</button> : null}
          </div>
          {rangeMsg ? <p className="mt-1 text-xs text-[var(--accent)]" aria-live="polite">{rangeMsg}</p> : null}
          {applyRangeHighlight.isError ? <p className="mt-1 text-xs text-red-600 dark:text-red-400">Highlighting the run failed — try again.</p> : null}
        </div>

        <div className="mt-4 rounded-xl border border-[var(--border)] p-3">
          <div className="flex items-center justify-between">
            <label htmlFor="verse-note" className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--dim)]">
              ✎ My note {existingNote ? "· saved" : ""}
            </label>
            <span className="text-xs text-[var(--dim)]">{noteValue.length} chars</span>
          </div>
          <textarea
            id="verse-note"
            value={noteValue}
            onChange={(e) => setNoteDraft(e.target.value)}
            rows={4}
            placeholder="Write what you see in this verse — observation, a cross-reference, a prayer…"
            className="mt-2 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)]"
          />
          {saveNote.isError || deleteNote.isError ? <p className="mt-1 text-xs text-red-600 dark:text-red-400">The note could not be saved — try again.</p> : null}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => saveNote.mutate()}
              disabled={saveNote.isPending || noteValue.trim() === "" || noteValue === (existingNote?.body ?? "")}
              className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
            >
              {saveNote.isPending ? "Saving…" : existingNote ? "Save changes" : "Save note"}
            </button>
            {noteDraft !== null && noteValue !== (existingNote?.body ?? "") ? (
              <button type="button" onClick={() => setNoteDraft(null)} className="rounded-full px-3 py-2 text-sm text-[var(--dim)]">Cancel edit</button>
            ) : null}
            {saveNote.isSuccess && noteDraft === null && existingNote ? <span className="text-xs text-[var(--accent)]">Note saved ✓ — badged ✎ in the text</span> : null}
            {existingNote ? (
              confirmDeleteNote ? (
                <>
                  <span className="text-xs text-[var(--text)]">Delete this note?</span>
                  <button type="button" onClick={() => deleteNote.mutate()} disabled={deleteNote.isPending} className="rounded-full bg-red-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-40">{deleteNote.isPending ? "Deleting…" : "Yes, delete"}</button>
                  <button type="button" onClick={() => setConfirmDeleteNote(false)} className="rounded-full px-3 py-2 text-sm text-[var(--dim)]">Keep it</button>
                </>
              ) : (
                <button type="button" onClick={() => setConfirmDeleteNote(true)} className="rounded-full px-3 py-2 text-sm text-red-600 dark:text-red-400 underline">Delete note</button>
              )
            ) : null}
          </div>
        </div>

        {passage.data?.text ? (
          <p className="scripture mt-3 rounded-lg bg-[var(--surface-alt)] p-3 text-[15px] leading-relaxed text-[var(--text)]">
            “{passage.data.text}” <span className="text-sm text-[var(--dim)]">— {meta.title} {chapter}:{verseLabel} (Fresh Water)</span>
          </p>
        ) : null}
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(`${passage.data?.text ?? ""} — ${meta.title} ${chapter}:${verseLabel} (Fresh Water Translation)`); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard unavailable */ } }} className="rounded-full bg-[var(--surface-alt)] px-3 py-2 text-sm font-medium text-[var(--text)]">
            {copied ? "Copied ✓" : "Copy verse"}
          </button>
          <button type="button" onClick={() => explainMut.mutate()} disabled={explainMut.isPending} className="rounded-full bg-[var(--surface-alt)] px-3 py-2 text-sm font-medium text-[var(--text)] disabled:opacity-40">
            {explainMut.isPending ? "Thinking…" : "✦ Explain with AI"}
          </button>
          <label className="sr-only" htmlFor="add-study-select">Add to study</label>
          <select id="add-study-select" aria-label="Add to study" value={pickedStudy} onChange={(e) => setPickedStudy(Number(e.target.value))} className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)]">
            <option value={0}>New study / first study</option>
            {(studiesQ.data?.studies ?? []).map((s) => (<option key={s.id} value={s.id}>{s.title}</option>))}
          </select>
          <button type="button" onClick={() => addToStudy.mutate()} disabled={addToStudy.isPending} className="rounded-full bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white disabled:opacity-40">
            {addToStudy.isSuccess ? "Added to study ✓" : "Add to study builder"}
          </button>
          <button type="button" onClick={onOpenBuilder} className="rounded-full bg-[var(--surface-alt)] px-3 py-2 text-sm font-medium text-[var(--accent)]">
            Open Study Builder →
          </button>
        </div>
        {explainMut.isError ? <p className="mt-2 text-sm text-red-600 dark:text-red-400">The AI helper could not answer just now. Try again in a moment.</p> : null}
        {explain ? <div className="mt-3 rounded-lg border border-[var(--border)] p-3"><p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--dim)]">AI explanation</p><p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-[var(--text)]">{explain}</p></div> : null}
      </div>
    </div>
  );
}

function verseAnchorId(label: string): string {
  return `verse-${label.replace(/[^a-zA-Z0-9]/g, "-")}`;
}

function Reader({
  meta,
  chapter,
  targetVerse,
  jumpNonce,
  study,
  onChapter,
  onBack,
  onGoSettings,
  onOpenBuilder,
}: {
  meta: BookMeta;
  chapter: number;
  targetVerse: string | null;
  jumpNonce: number;
  study: StudyData;
  onChapter: (n: number) => void;
  onBack: () => void;
  onGoSettings: () => void;
  onOpenBuilder: () => void;
}) {
  const queryClient = useQueryClient();
  const book = useQuery({
    queryKey: ["book", meta.lang, meta.slug],
    queryFn: () => api.getBook({ lang: meta.lang, slug: meta.slug }),
  });
  const marks = useQuery({
    queryKey: ["marks", meta.lang, meta.slug, chapter],
    queryFn: () =>
      api.listBookmarksForChapter({ lang: meta.lang, slug: meta.slug, chapter }),
  });
  const [selVerse, setSelVerse] = useState<{ n: number; label: string } | null>(null);
  const [compareOpen, setCompareOpen] = useState(false);
  const [fontSize, setFontSize] = useState<number>(() => {
    try { return Number(localStorage.getItem("fwt-font-size")) || 19; } catch { return 19; }
  });
  // Multi-verse selection for passage highlighting.
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<{ n: number; label: string }[]>([]);
  const [selMsg, setSelMsg] = useState("");
  useEffect(() => { try { localStorage.setItem("fwt-font-size", String(fontSize)); } catch { /* private mode */ } }, [fontSize]);
  const applySelectionHighlight = useMutation({
    mutationFn: async (color: string | null) => {
      for (const v of selected) {
        await api.setHighlight({
          refKey: refKey(meta.lang, meta.slug, chapter, v.label),
          lang: meta.lang, slug: meta.slug, bookTitle: meta.title, chapter, verse: v.n, color,
        });
      }
      return selected.length;
    },
    onSuccess: (count, color) => {
      queryClient.invalidateQueries({ queryKey: ["marks"] });
      queryClient.invalidateQueries({ queryKey: ["study"] });
      setSelMsg(color ? `${count} verse${count === 1 ? "" : "s"} highlighted ✓` : `Highlight removed from ${count} verse${count === 1 ? "" : "s"} ✓`);
    },
  });
  const toggleSelectVerse = (v: { n: number; label: string }) => {
    setSelMsg("");
    setSelected((prev) => prev.some((x) => x.label === v.label) ? prev.filter((x) => x.label !== v.label) : [...prev, v].sort((a, b) => a.n - b.n));
  };
  // Verse-level navigation: scroll a verse into view and flash it.
  const [goVerse, setGoVerse] = useState<string>("");
  const [flashLabel, setFlashLabel] = useState<string | null>(null);
  const flashTimer = useRef<number | null>(null);
  const jumpedNonce = useRef<number>(-1);
  const jumpToVerse = (label: string) => {
    const el = document.getElementById(verseAnchorId(label));
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setFlashLabel(label);
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlashLabel(null), 2800);
  };

  const chapters: BookData["chapters"] = book.data?.chapters ?? [];
  const current = chapters.find((c) => c.number === chapter) ?? chapters[0];
  const totalChapters = meta.chapters || chapters.length;
  const hlMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const h of marks.data?.highlightColors ?? []) m.set(h.refKey, h.color);
    return m;
  }, [marks.data]);
  const bmSet = useMemo(
    () => new Set(marks.data?.bookmarkKeys ?? []),
    [marks.data],
  );
  const noteSet = useMemo(
    () => new Set(marks.data?.noteKeys ?? []),
    [marks.data],
  );

  useEffect(() => {
    // When arriving with a target verse, the jump effect below handles
    // scrolling instead of resetting to the top of the chapter.
    if (!targetVerse) window.scrollTo({ top: 0 });
    setSelVerse(null);
    setSelected([]);
    setSelectMode(false);
    setSelMsg("");
    setGoVerse("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapter, meta.slug]);

  const chapterVerses = useMemo(() => {
    const out: { n: number; label: string }[] = [];
    const seen = new Set<string>();
    for (const b of current?.blocks ?? []) {
      if (b.kind !== "para") continue;
      for (const v of b.verses) if (!seen.has(v.label)) { seen.add(v.label); out.push({ n: v.n, label: v.label }); }
    }
    return out;
  }, [current]);

  // Defence in depth for the verse-number rule: if a verse still arrives
  // as consecutive fragments with the same label and shading (a line of
  // the verse repeated in the corpus), only the first fragment carries
  // the number — continuation lines render their text with no number.
  // A heading breaks the chain, and a same-numbered verse with different
  // shading (Daniel 3's two 24s) is a distinct verse and keeps its number.
  const continuationVerses = useMemo(() => {
    const set = new Set<string>();
    if (!current) return set;
    let prevLabel: string | null = null;
    let prevSh = false;
    current.blocks.forEach((b, bi) => {
      if (b.kind === "heading") { prevLabel = null; return; }
      b.verses.forEach((v, vi) => {
        const sh = v.segments.some((s) => s.sh);
        if (prevLabel !== null && prevLabel === v.label && prevSh === sh) {
          set.add(`${bi}:${vi}`);
        }
        prevLabel = v.label;
        prevSh = sh;
      });
    });
    return set;
  }, [current]);

  // Land on the requested verse once the chapter text is on screen.
  useEffect(() => {
    if (!targetVerse || jumpedNonce.current === jumpNonce) return;
    if (!chapterVerses.some((v) => v.label === targetVerse)) return;
    jumpedNonce.current = jumpNonce;
    const t = window.setTimeout(() => jumpToVerse(targetVerse), 120);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetVerse, jumpNonce, chapterVerses]);

  return (
    <div className="mx-auto max-w-2xl">
      <div className="sticky top-0 z-20 -mx-4 bg-[var(--bg)]/95 px-4 pb-2 pt-safe backdrop-blur">
        <div className="flex items-center justify-between gap-2 pt-2">
          <button
            type="button"
            onClick={onBack}
            className="rounded-full bg-[var(--surface)] px-3 py-2 text-sm font-medium text-[var(--accent)] border border-[var(--border)]"
          >
            ← Library
          </button>
          <p className="scripture text-lg font-semibold text-[var(--text)]">
            {meta.title} {current?.number ?? chapter}
          </p>
          <button
            type="button"
            onClick={() => setCompareOpen((v) => !v)}
            aria-expanded={compareOpen}
            className={`rounded-full px-3 py-2 text-sm font-medium border ${
              compareOpen
                ? "bg-[var(--accent)] text-white border-[var(--accent)]"
                : "bg-[var(--surface)] text-[var(--accent)] border-[var(--border)]"
            }`}
          >
            Compare
          </button>
        </div>
        <div className="mt-2 flex items-center justify-between">
          <button
            type="button"
            aria-label="Previous chapter"
            disabled={chapter <= 1}
            onClick={() => onChapter(chapter - 1)}
            className="rounded-full px-3 py-1 text-sm text-[var(--accent)] disabled:opacity-30"
          >
            ← Ch. {chapter - 1}
          </button>
          <label className="flex items-center gap-2 text-sm text-[var(--dim)]">
            Chapter
            <select
              aria-label="Chapter"
              value={current?.number ?? chapter}
              onChange={(e) => onChapter(Number(e.target.value))}
              className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-sm text-[var(--text)]"
            >
              {Array.from({ length: Math.max(totalChapters, 1) }, (_, i) => i + 1).map(
                (n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ),
              )}
            </select>
            of {totalChapters}
          </label>
          <button
            type="button"
            aria-label="Next chapter"
            disabled={totalChapters > 0 && chapter >= totalChapters}
            onClick={() => onChapter(chapter + 1)}
            className="rounded-full px-3 py-1 text-sm text-[var(--accent)] disabled:opacity-30"
          >
            Ch. {chapter + 1} →
          </button>
        </div>
        <form
          className="mt-2 flex items-center gap-2"
          onSubmit={(e) => { e.preventDefault(); if (goVerse) jumpToVerse(goVerse); }}
        >
          <label htmlFor="go-verse" className="text-sm text-[var(--dim)]">Go to verse</label>
          <select
            id="go-verse"
            aria-label="Go to verse"
            value={goVerse}
            onChange={(e) => setGoVerse(e.target.value)}
            className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm text-[var(--text)]"
          >
            <option value="">Verse…</option>
            {chapterVerses.map((v) => (
              <option key={v.label} value={v.label}>{v.label}</option>
            ))}
          </select>
          <button type="submit" disabled={!goVerse} className="rounded-full bg-[var(--accent)] px-4 py-1.5 text-sm font-medium text-white disabled:opacity-40">
            Go →
          </button>
          {flashLabel ? <span className="text-xs text-[var(--accent)]" aria-live="polite">Verse {flashLabel} ↓</span> : null}
        </form>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button type="button" aria-pressed={selectMode} onClick={() => { setSelectMode((v) => !v); setSelected([]); setSelMsg(""); }} className={`rounded-full px-3 py-1.5 text-xs font-semibold border ${selectMode ? "bg-[var(--accent)] text-white border-[var(--accent)]" : "bg-[var(--surface)] text-[var(--accent)] border-[var(--border)]"}`}>
            {selectMode ? "✓ Selecting verses — tap verses, then a colour" : "🖍 Select verses to highlight"}
          </button>
          <span className="ml-auto flex items-center gap-1" role="group" aria-label="Text size">
            <span className="text-xs text-[var(--dim)]">Text</span>
            {[17, 19, 22, 25].map((s) => (
              <button key={s} type="button" aria-label={`Text size ${s}`} aria-pressed={fontSize === s} onClick={() => setFontSize(s)} className={`rounded-full px-2 py-1 text-xs font-medium ${fontSize === s ? "bg-[var(--accent)] text-white" : "bg-[var(--surface)] text-[var(--dim)] border border-[var(--border)]"}`}>{s === 17 ? "S" : s === 19 ? "M" : s === 22 ? "L" : "XL"}</button>
            ))}
          </span>
        </div>
        <p className="mt-1.5 text-xs text-[var(--dim)]">
          Tap any verse number to <strong>highlight (6 colours)</strong>, <strong>bookmark 🔖</strong> or <strong>write a note ✎</strong>. Badges: 🔖 = bookmarked · ✎ = has your note · colour wash = highlighted.
        </p>
      </div>

      {compareOpen ? (
        <div className="mb-4">
          <ComparePanel
            apiKey={study.youversionKey}
            study={study}
            meta={meta}
            chapter={current?.number ?? chapter}
            onGoSettings={onGoSettings}
          />
        </div>
      ) : null}

      {book.isPending ? (
        <p className="py-10 text-center text-sm text-[var(--dim)]">Loading the text…</p>
      ) : book.isError || !book.data?.found ? (
        <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-5 text-center">
          <p className="text-sm text-[var(--text)]">
            This book's Fresh Water text is not in the corpus folder yet.
          </p>
          <p className="mt-1 text-sm text-[var(--dim)]">
            Once its extracted file is in place, it will open here exactly as
            translated — headings, blue letters and shading intact.
          </p>
        </div>
      ) : current ? (
        <article className="scripture leading-[1.75] text-[var(--text)]" style={{ fontSize }}>
          {current.blocks.map((block, bi) => {
            if (block.kind === "heading") {
              return (
                <h3
                  key={bi}
                  className="mb-2 mt-6 font-bold tracking-wide text-[var(--accent)] first:mt-1"
                  style={{ fontSize: Math.max(15, fontSize - 2) }}
                >
                  {block.text}
                </h3>
              );
            }
            return (
              <p key={bi} className="mb-4">
                {block.verses.map((verse, vi) => {
                  const isContinuation = continuationVerses.has(`${bi}:${vi}`);
                  const key = refKey(meta.lang, meta.slug, current.number, verse.label);
                  const hl = hlMap.get(key);
                  const hlCls = hlClsFor(hl);
                  const isSingle = selVerse?.label === verse.label;
                  const inSelection = selected.some((x) => x.label === verse.label);
                  const handleTap = () => {
                    if (selectMode) toggleSelectVerse({ n: verse.n, label: verse.label });
                    else setSelVerse({ n: verse.n, label: verse.label });
                  };
                  return (
                    <span
                      key={verse.label}
                      id={isContinuation ? undefined : verseAnchorId(verse.label)}
                      style={{ scrollMarginTop: "13rem" }}
                      className={`rounded px-0.5 ${hlCls} ${isSingle ? "outline outline-2 outline-[var(--accent)]" : ""} ${inSelection ? "outline-dashed outline outline-2 outline-[var(--gold)]" : ""} ${flashLabel === verse.label ? "verse-flash" : ""}`}
                    >
                      {isContinuation ? null : (
                        <>
                          <button
                            type="button"
                            aria-label={selectMode ? `Select verse ${verse.label} for highlighting` : `Verse ${verse.label}: highlight, bookmark and note actions${bmSet.has(key) ? ", bookmarked" : ""}${noteSet.has(key) ? ", has your note" : ""}${hl ? `, highlighted ${hl}` : ""}`}
                            aria-pressed={selectMode ? inSelection : undefined}
                            onClick={handleTap}
                            className="mr-1 align-super text-[11px] font-bold text-[var(--accent)]"
                          >
                            {verse.label}
                            {bmSet.has(key) ? "🔖" : ""}
                            {noteSet.has(key) ? "✎" : ""}
                          </button>
                          {" "}
                        </>
                      )}
                      <span onClick={handleTap} className="cursor-pointer">
                        {verse.segments.map((seg, si) => (
                          <span
                            key={si}
                            className={[
                              seg.b ? "seg-blue font-medium" : "",
                              seg.i ? "italic" : "",
                              seg.sc ? "seg-sc" : "",
                              seg.sh ? "seg-sh" : "",
                            ].join(" ")}
                          >
                            {seg.t}
                          </span>
                        ))}
                      </span>{" "}
                    </span>
                  );
                })}
              </p>
            );
          })}
          <p className="mt-6 text-center text-xs text-[var(--dim)]">
            Tap a verse number to highlight it in one of six colours, bookmark it, or write a note. Use “Select verses” above to highlight a whole passage at once.
          </p>
        </article>
      ) : (
        <p className="py-10 text-center text-sm text-[var(--dim)]">
          This chapter is not in the corpus file yet.
        </p>
      )}

      {selectMode ? (
        <div className="fixed inset-x-0 bottom-16 z-40 mx-auto max-w-2xl px-3">
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3 shadow-xl">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-[var(--text)]">{selected.length === 0 ? "Tap verses to select them" : `${selected.length} verse${selected.length === 1 ? "" : "s"} selected${selected[0] && selected[selected.length - 1] ? ` (vv. ${selected[0].label}–${selected[selected.length - 1]?.label})` : ""}`}</p>
              <button type="button" onClick={() => { setSelectMode(false); setSelected([]); }} className="rounded-full px-3 py-1 text-sm text-[var(--dim)]">Done</button>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2" role="group" aria-label="Highlight selected verses">
              <span className="text-xs text-[var(--dim)]">Highlight in:</span>
              {HIGHLIGHT_COLORS.map((c) => (
                <button key={c.name} type="button" aria-label={`Highlight selected verses ${c.label}`} disabled={selected.length === 0 || applySelectionHighlight.isPending} onClick={() => applySelectionHighlight.mutate(c.name)} className="flex items-center gap-1 rounded-full border border-[var(--border)] py-1 pl-1 pr-2 disabled:opacity-40">
                  <span aria-hidden className="h-6 w-6 rounded-full border border-black/10" style={{ backgroundColor: c.swatch }} />
                  <span className="text-xs font-medium text-[var(--text)]">{c.label}</span>
                </button>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" disabled={selected.length === 0 || applySelectionHighlight.isPending} onClick={() => applySelectionHighlight.mutate(null)} className="rounded-full px-3 py-1.5 text-xs text-[var(--dim)] underline disabled:opacity-40">Remove highlight</button>
              <button type="button" disabled={selected.length === 0} onClick={() => setSelected([])} className="rounded-full px-3 py-1.5 text-xs text-[var(--dim)] disabled:opacity-40">Clear selection</button>
              {selected[0] ? <button type="button" onClick={() => { const f = selected[0]; if (f) { setSelectMode(false); setSelVerse({ n: f.n, label: f.label }); } }} className="rounded-full bg-[var(--accent-soft)] px-3 py-1.5 text-xs font-medium text-[var(--accent)]">✎ Note on v. {selected[0].label}…</button> : null}
            </div>
            {selMsg ? <p className="mt-1 text-xs text-[var(--accent)]" aria-live="polite">{selMsg}</p> : null}
            {applySelectionHighlight.isError ? <p className="mt-1 text-xs text-red-600 dark:text-red-400">Highlighting failed — try again.</p> : null}
          </div>
        </div>
      ) : null}

      {selVerse != null && !selectMode ? (
        <VerseSheet
          meta={meta}
          chapter={current?.number ?? chapter}
          verse={selVerse.n}
          verseLabel={selVerse.label}
          chapterVerses={chapterVerses}
          study={study}
          onClose={() => setSelVerse(null)}
          onOpenBuilder={onOpenBuilder}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Library
// ---------------------------------------------------------------------------

function ChapterVersePicker({
  meta,
  chapter,
  onOpenChapter,
  onOpenVerse,
}: {
  meta: BookMeta;
  chapter: number;
  onOpenChapter: () => void;
  onOpenVerse: (verseLabel: string) => void;
}) {
  const book = useQuery({
    queryKey: ["book", meta.lang, meta.slug],
    queryFn: () => api.getBook({ lang: meta.lang, slug: meta.slug }),
  });
  const ch = book.data?.chapters.find((c) => c.number === chapter);
  const verses: { n: number; label: string }[] = [];
  const seen = new Set<string>();
  for (const b of ch?.blocks ?? []) {
    if (b.kind !== "para") continue;
    for (const v of b.verses) if (!seen.has(v.label)) { seen.add(v.label); verses.push({ n: v.n, label: v.label }); }
  }
  return (
    <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--surface-alt)] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-semibold text-[var(--text)]">{meta.title} {chapter} — pick a verse</p>
        <button type="button" onClick={onOpenChapter} className="ml-auto rounded-full bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white">
          Read whole chapter →
        </button>
      </div>
      {book.isPending ? (
        <p className="mt-2 text-sm text-[var(--dim)]">Loading verses…</p>
      ) : verses.length === 0 ? (
        <p className="mt-2 text-sm text-[var(--dim)]">This chapter's verses are not in the corpus file yet — open the chapter to read what's there.</p>
      ) : (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {verses.map((v) => (
            <button
              key={v.label}
              type="button"
              aria-label={`${meta.title} chapter ${chapter} verse ${v.label}`}
              onClick={() => onOpenVerse(v.label)}
              className="min-w-9 rounded-lg bg-[var(--surface)] border border-[var(--border)] px-2 py-1.5 text-sm font-medium text-[var(--accent)]"
            >
              {v.label}
            </button>
          ))}
        </div>
      )}
      <p className="mt-2 text-xs text-[var(--dim)]">Picking a verse opens the chapter right at that verse and flashes it so your eye lands on it.</p>
    </div>
  );
}

function Library({
  library,
  lang,
  onLang,
  onOpen,
  onOpenVerse,
}: {
  library: LibraryData;
  lang: Lang;
  onLang: (l: Lang) => void;
  onOpen: (meta: BookMeta, chapter: number) => void;
  onOpenVerse: (meta: BookMeta, chapter: number, verseLabel: string) => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [picked, setPicked] = useState<{ key: string; chapter: number } | null>(null);
  const books = library.books.filter((b) => b.lang === lang);
  const ot = books.filter((b) => b.testament === "OT");
  const nt = books.filter((b) => b.testament === "NT");

  const renderGroup = (title: string, group: BookMeta[]) =>
    group.length === 0 ? null : (
      <section key={title} className="mt-6">
        <SectionTitle>
          {title} · {group.length}
        </SectionTitle>
        <div className="mt-2 overflow-hidden rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)]">
          {group.map((b) => {
            const isOpen = expanded === `${b.lang}:${b.slug}`;
            return (
              <div key={`${b.lang}:${b.slug}`} className="border-b border-[var(--border)] last:border-b-0">
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => setExpanded(isOpen ? null : `${b.lang}:${b.slug}`)}
                  className="flex w-full items-center justify-between px-4 py-3 text-left"
                >
                  <span className="scripture text-lg text-[var(--text)]">{b.title}</span>
                  <span className="text-xs text-[var(--dim)]">
                    {b.chapters > 0 ? `${b.chapters} ch.` : ""} {isOpen ? "▲" : "▼"}
                  </span>
                </button>
                {isOpen ? (
                  <div className="px-4 pb-4">
                    <p className="text-xs text-[var(--dim)]">Book → chapter → verse: tap a chapter, then pick a verse to land right on it — or read the whole chapter.</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {Array.from({ length: Math.max(b.chapters, 1) }, (_, i) => i + 1).map(
                        (n) => {
                          const isPicked = picked?.key === `${b.lang}:${b.slug}` && picked.chapter === n;
                          return (
                            <button
                              key={n}
                              type="button"
                              aria-label={`${b.title} chapter ${n}`}
                              aria-pressed={isPicked}
                              onClick={() => setPicked(isPicked ? null : { key: `${b.lang}:${b.slug}`, chapter: n })}
                              className={`min-w-10 rounded-lg px-3 py-2 text-sm font-medium ${isPicked ? "bg-[var(--accent)] text-white" : "bg-[var(--accent-soft)] text-[var(--accent)]"}`}
                            >
                              {n}
                            </button>
                          );
                        },
                      )}
                    </div>
                    {picked?.key === `${b.lang}:${b.slug}` ? (
                      <ChapterVersePicker
                        meta={b}
                        chapter={picked.chapter}
                        onOpenChapter={() => onOpen(b, picked.chapter)}
                        onOpenVerse={(label) => onOpenVerse(b, picked.chapter, label)}
                      />
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </section>
    );

  return (
    <div className="mx-auto max-w-2xl">
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Library language">
        {(
          [
            ["en", "Fresh Water · English"],
            ["es", "Traducción Agua Fresca"],
          ] as [Lang, string][]
        ).map(([l, label]) => (
          <button
            key={l}
            type="button"
            role="tab"
            aria-selected={lang === l}
            onClick={() => onLang(l)}
            className={`rounded-full px-4 py-2 text-sm font-medium ${
              lang === l
                ? "bg-[var(--accent)] text-white"
                : "bg-[var(--surface)] text-[var(--dim)] border border-[var(--border)]"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {lang === "es" ? (
        <p className="scripture mt-3 text-base text-[var(--dim)]">
          Traducción Agua Fresca — el Nuevo Testamento en español
        </p>
      ) : null}

      {!library.corpusReady || books.length === 0 ? (
        <div className="mt-6 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-5">
          <p className="scripture text-lg text-[var(--text)]">
            The library is being filled.
          </p>
          <p className="mt-2 text-sm leading-relaxed text-[var(--dim)]">
            {library.fileCount === 0
              ? "The extracted Fresh Water corpus has not reached the data folder yet. As each book's file arrives — English Old and New Testaments and the Spanish New Testament — it will appear here on its shelf, ready to read."
              : "Corpus files are present, but none match this language's canonical books yet. Books appear here as their files are added."}
          </p>
        </div>
      ) : (
        <>
          {renderGroup(lang === "es" ? "Antiguo Testamento" : "Old Testament", ot)}
          {renderGroup(lang === "es" ? "Nuevo Testamento" : "New Testament", nt)}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

function SearchView({
  lang,
  onOpenRef,
}: {
  lang: Lang;
  onOpenRef: (r: SearchResult) => void;
}) {
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<"all" | Lang>("all");
  const search = useQuery({
    queryKey: ["search", query, scope],
    enabled: query.trim().length >= 2,
    queryFn: () =>
      api.searchCorpus({ query: query.trim(), lang: scope === "all" ? "" : scope }),
  });

  return (
    <div className="mx-auto max-w-2xl">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(input);
        }}
        className="flex gap-2"
      >
        <label className="sr-only" htmlFor="corpus-search">Search the Fresh Water text</label>
        <input
          id="corpus-search"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={lang === "es" ? "Busca una palabra o frase…" : "Search a word or phrase…"}
          className="min-w-0 flex-1 rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-base text-[var(--text)]"
        />
        <button
          type="submit"
          className="rounded-full bg-[var(--accent)] px-5 py-3 text-sm font-medium text-white"
        >
          Search
        </button>
      </form>
      <div className="mt-3 flex gap-2">
        {(
          [
            ["all", "Both languages"],
            ["en", "English"],
            ["es", "Agua Fresca"],
          ] as ["all" | Lang, string][]
        ).map(([s, label]) => (
          <button
            key={s}
            type="button"
            onClick={() => setScope(s)}
            aria-pressed={scope === s}
            className={`rounded-full px-3 py-1.5 text-xs font-medium ${
              scope === s
                ? "bg-[var(--accent)] text-white"
                : "bg-[var(--surface)] text-[var(--dim)] border border-[var(--border)]"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mt-5">
        {query.trim().length < 2 ? (
          <p className="text-sm text-[var(--dim)]">
            Search runs across every loaded Fresh Water book and returns the
            verses that match.
          </p>
        ) : search.isPending ? (
          <p className="text-sm text-[var(--dim)]">Searching the corpus…</p>
        ) : search.isError ? (
          <p className="text-sm text-red-600 dark:text-red-400">Search failed. Try again.</p>
        ) : (search.data?.results.length ?? 0) === 0 ? (
          <p className="text-sm text-[var(--dim)]">
            No verses match “{query}” in the loaded corpus.
          </p>
        ) : (
          <>
            <SectionTitle>{search.data?.results.length} results</SectionTitle>
            <div className="mt-2 space-y-2">
              {search.data?.results.map((r, i) => (
                <button
                  key={`${r.lang}:${r.slug}:${r.chapter}:${r.verse}:${i}`}
                  type="button"
                  onClick={() => onOpenRef(r)}
                  className="block w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-3 text-left"
                >
                  <span className="text-sm font-semibold text-[var(--accent)]">
                    {r.bookTitle} {r.chapter}:{r.verse}
                    {r.lang === "es" ? " · ES" : ""}
                  </span>
                  <span className="scripture mt-1 block text-base leading-relaxed text-[var(--text)]">
                    {r.text}
                  </span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Study (bookmarks, highlights, notes)
// ---------------------------------------------------------------------------

function MarksView({
  study,
  onOpenRef,
}: {
  study: StudyData;
  onOpenRef: (r: { lang: string; slug: string; chapter: number }) => void;
}) {
  const queryClient = useQueryClient();
  const [noteEdits, setNoteEdits] = useState<Record<string, string>>({});
  const [confirmDel, setConfirmDel] = useState<string>("");
  const [hlFilter, setHlFilter] = useState<string>("all");
  const saveNoteMut = useMutation({
    mutationFn: (n: StudyData["notes"][number]) => api.saveNote({ refKey: n.refKey, lang: n.lang, slug: n.slug, bookTitle: n.bookTitle, chapter: n.chapter, verse: n.verse, body: noteEdits[n.refKey] ?? n.body }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["study"] }); setNoteEdits({}); },
  });
  const deleteNoteMut = useMutation({
    mutationFn: (n: StudyData["notes"][number]) => api.saveNote({ refKey: n.refKey, lang: n.lang, slug: n.slug, bookTitle: n.bookTitle, chapter: n.chapter, verse: n.verse, body: "" }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["study"] }); setConfirmDel(""); },
  });
  const removeHlMut = useMutation({
    mutationFn: (h: StudyData["highlights"][number]) => api.setHighlight({ refKey: h.refKey, lang: h.lang, slug: h.slug, bookTitle: h.bookTitle, chapter: h.chapter, verse: h.verse, color: null }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["study"] }),
  });
  const recolorMut = useMutation({
    mutationFn: (v: { h: StudyData["highlights"][number]; color: string }) => api.setHighlight({ refKey: v.h.refKey, lang: v.h.lang, slug: v.h.slug, bookTitle: v.h.bookTitle, chapter: v.h.chapter, verse: v.h.verse, color: v.color }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["study"] }),
  });
  const shownHighlights = study.highlights.filter((h) => hlFilter === "all" || h.color === hlFilter);
  const empty =
    study.bookmarks.length === 0 &&
    study.notes.length === 0 &&
    study.highlights.length === 0;
  return (
    <div className="space-y-8">
      {empty ? (
        <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-5">
          <p className="scripture text-lg text-[var(--text)]">Your study shelf is empty — for now.</p>
          <p className="mt-2 text-sm leading-relaxed text-[var(--dim)]">
            While reading, tap any verse number: <strong>highlight it in one of six colours</strong> (yellow, green, blue, pink, orange, purple), <strong>bookmark it 🔖</strong>, or <strong>write a note ✎</strong>. Use “Select verses” in the reader to highlight a whole passage at once. Everything you mark gathers here, colours and all.
          </p>
        </div>
      ) : null}

      {study.notes.length > 0 ? (
        <section>
          <SectionTitle>✎ Notes · {study.notes.length}</SectionTitle>
          <div className="mt-2 space-y-2">
            {study.notes.map((n) => {
              const editing = noteEdits[n.refKey] !== undefined;
              const val = noteEdits[n.refKey] ?? n.body;
              return (
                <div key={n.refKey} className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-3">
                  <div className="flex items-center justify-between gap-2">
                    <button type="button" onClick={() => onOpenRef(n)} className="text-sm font-semibold text-[var(--accent)]">
                      {n.bookTitle} {n.chapter}:{n.verse} → read
                    </button>
                    <span className="text-xs text-[var(--dim)]">{new Date(n.updatedAt).toLocaleDateString()}</span>
                  </div>
                  {editing ? (
                    <>
                      <label className="sr-only" htmlFor={`note-edit-${n.refKey}`}>Edit note on {n.bookTitle} {n.chapter}:{n.verse}</label>
                      <textarea id={`note-edit-${n.refKey}`} value={val} onChange={(e) => setNoteEdits((p) => ({ ...p, [n.refKey]: e.target.value }))} rows={3} className="mt-2 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)]" />
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button type="button" onClick={() => saveNoteMut.mutate(n)} disabled={saveNoteMut.isPending || val.trim() === "" || val === n.body} className="rounded-full bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">{saveNoteMut.isPending ? "Saving…" : "Save changes"}</button>
                        <button type="button" onClick={() => setNoteEdits((p) => { const c = { ...p }; delete c[n.refKey]; return c; })} className="rounded-full px-3 py-1.5 text-sm text-[var(--dim)]">Cancel</button>
                      </div>
                    </>
                  ) : (
                    <>
                      <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-[var(--text)]">{n.body}</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button type="button" onClick={() => setNoteEdits((p) => ({ ...p, [n.refKey]: n.body }))} className="rounded-full bg-[var(--accent-soft)] px-3 py-1.5 text-sm font-medium text-[var(--accent)]">Edit note</button>
                        {confirmDel === n.refKey ? (
                          <>
                            <span className="text-sm text-[var(--text)]">Delete?</span>
                            <button type="button" onClick={() => deleteNoteMut.mutate(n)} disabled={deleteNoteMut.isPending} className="rounded-full bg-red-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">Yes, delete</button>
                            <button type="button" onClick={() => setConfirmDel("")} className="rounded-full px-3 py-1.5 text-sm text-[var(--dim)]">Keep</button>
                          </>
                        ) : (
                          <button type="button" onClick={() => setConfirmDel(n.refKey)} className="rounded-full px-3 py-1.5 text-sm text-red-600 dark:text-red-400 underline">Delete note</button>
                        )}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {study.bookmarks.length > 0 ? (
        <section>
          <SectionTitle>🔖 Bookmarks · {study.bookmarks.length}</SectionTitle>
          <div className="mt-2 overflow-hidden rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)]">
            {study.bookmarks.map((b) => (
              <button
                key={b.refKey}
                type="button"
                onClick={() => onOpenRef(b)}
                className="block w-full border-b border-[var(--border)] px-4 py-3 text-left last:border-b-0"
              >
                <span className="scripture text-base text-[var(--text)]">
                  {b.bookTitle} {b.chapter}:{b.verse}
                </span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {study.highlights.length > 0 ? (
        <section>
          <SectionTitle>🖍 Highlights · {study.highlights.length} — colour kept on every verse</SectionTitle>
          <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Filter highlights by colour">
            <button type="button" aria-pressed={hlFilter === "all"} onClick={() => setHlFilter("all")} className={`rounded-full px-3 py-1.5 text-xs font-medium ${hlFilter === "all" ? "bg-[var(--accent)] text-white" : "bg-[var(--surface)] text-[var(--dim)] border border-[var(--border)]"}`}>All colours</button>
            {HIGHLIGHT_COLORS.map((c) => {
              const count = study.highlights.filter((h) => h.color === c.name).length;
              if (count === 0) return null;
              return (
                <button key={c.name} type="button" aria-pressed={hlFilter === c.name} onClick={() => setHlFilter(c.name)} className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ${hlFilter === c.name ? "bg-[var(--accent)] text-white" : "bg-[var(--surface)] text-[var(--text)] border border-[var(--border)]"}`}>
                  <span aria-hidden className="h-3.5 w-3.5 rounded-full border border-black/10" style={{ backgroundColor: c.swatch }} />{c.label} · {count}
                </button>
              );
            })}
          </div>
          <div className="mt-2 space-y-2">
            {shownHighlights.map((h) => (
              <div key={h.refKey} className={`rounded-[var(--radius)] border border-[var(--border)] p-3 ${hlClsFor(h.color)}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" onClick={() => onOpenRef(h)} className="scripture text-base font-medium text-[var(--text)]">
                    {h.bookTitle} {h.chapter}:{h.verse} →
                  </button>
                  <span className="flex items-center gap-1 text-xs text-[var(--dim)]"><span aria-hidden className="h-3.5 w-3.5 rounded-full border border-black/10" style={{ backgroundColor: HIGHLIGHT_COLORS.find((c) => c.name === h.color)?.swatch ?? "#eee" }} />{HIGHLIGHT_COLORS.find((c) => c.name === h.color)?.label ?? h.color}</span>
                  <span className="ml-auto flex items-center gap-1">
                    {HIGHLIGHT_COLORS.filter((c) => c.name !== h.color).map((c) => (
                      <button key={c.name} type="button" aria-label={`Change ${h.bookTitle} ${h.chapter}:${h.verse} highlight to ${c.label}`} title={`Change to ${c.label}`} onClick={() => recolorMut.mutate({ h, color: c.name })} className="h-5 w-5 rounded-full border border-black/10" style={{ backgroundColor: c.swatch }} />
                    ))}
                    <button type="button" onClick={() => removeHlMut.mutate(h)} className="ml-1 text-xs text-[var(--dim)] underline">Remove</button>
                  </span>
                </div>
              </div>
            ))}
            {shownHighlights.length === 0 ? <p className="text-sm text-[var(--dim)]">No highlights in this colour yet.</p> : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Verses collection, Study Builder, Plans, Devotional, AI Helper
// ---------------------------------------------------------------------------

type Seg = { t: string; b: boolean; i: boolean; sc: boolean; sh: boolean };
function SegText({ segments }: { segments: Seg[] }) {
  return (<>{segments.map((seg, si) => (<span key={si} className={[seg.b ? "seg-blue font-medium" : "", seg.i ? "italic" : "", seg.sc ? "seg-sc" : "", seg.sh ? "seg-sh" : ""].join(" ")}>{seg.t}</span>))}</>);
}

function useVotdRef(apiKey: string) {
  return useQuery({
    queryKey: ["yv-votd-ref", keyFingerprint(apiKey)],
    enabled: apiKey.length > 4,
    staleTime: 1000 * 60 * 60 * 6,
    retry: false,
    queryFn: async () => {
      const now = new Date();
      const start = new Date(now.getFullYear(), 0, 0);
      const doy = Math.floor((now.getTime() - start.getTime()) / 86400000);
      const json = await yvGet(apiKey, `/verse-of-the-days/${doy}`);
      const root = asObj(json);
      const d = asObj(root?.["data"]) ?? root ?? {};
      return typeof d["passage_id"] === "string" ? d["passage_id"] : "";
    },
  });
}

function VersesView({ study, library, onOpenRef }: { study: StudyData; library: LibraryData | undefined; onOpenRef: (r: { lang: string; slug: string; chapter: number }) => void }) {
  const [filter, setFilter] = useState<"all" | "bookmark" | "highlight" | "note">("all");
  const [colorFilter, setColorFilter] = useState<string>("all");
  const [copiedKey, setCopiedKey] = useState("");
  const refs = useMemo(() => {
    const map = new Map<string, { lang: string; slug: string; bookTitle: string; chapter: number; verse: number; kinds: string[]; color?: string; note?: string }>();
    const add = (r: { lang: string; slug: string; bookTitle: string; chapter: number; verse: number }, kind: string, extra?: { color?: string; note?: string }) => {
      const k = `${r.lang}:${r.slug}:${r.chapter}:${r.verse}`;
      const cur = map.get(k) ?? { ...r, kinds: [] as string[] };
      cur.kinds = [...new Set([...cur.kinds, kind])];
      if (extra?.color) cur.color = extra.color;
      if (extra?.note) cur.note = extra.note;
      map.set(k, cur);
    };
    for (const b of study.bookmarks) add(b, "bookmark");
    for (const h of study.highlights) add(h, "highlight", { color: h.color });
    for (const n of study.notes) add(n, "note", { note: n.body });
    return [...map.values()];
  }, [study]);
  const shown = refs.filter((r) => (filter === "all" || r.kinds.includes(filter)) && (colorFilter === "all" || r.color === colorFilter));
  const bulk = useQuery({
    queryKey: ["verses-bulk", shown.map((r) => `${r.lang}:${r.slug}:${r.chapter}:${r.verse}`).join("|")],
    enabled: shown.length > 0,
    queryFn: () => api.getVersesBulk({ refs: shown.slice(0, 60).map((r) => ({ lang: r.lang, slug: r.slug, chapter: r.chapter, verse: r.verse })) }),
  });
  const textMap = useMemo(() => { const m = new Map<string, { text: string; segments: Seg[] }>(); for (const v of bulk.data?.verses ?? []) m.set(v.refKey, { text: v.text, segments: v.segments as Seg[] }); return m; }, [bulk.data]);
  // Lookup
  const enBooks = (library?.books ?? []).filter((b) => b.lang === "en");
  const [lkSlug, setLkSlug] = useState("john");
  const [lkChapter, setLkChapter] = useState(3);
  const [lkVerse, setLkVerse] = useState(16);
  const lkMeta = enBooks.find((b) => b.slug === lkSlug);
  const lookup = useQuery({ queryKey: ["lookup", lkSlug, lkChapter, lkVerse], enabled: !!lkMeta, queryFn: () => api.getPassage({ lang: "en", slug: lkSlug, chapter: lkChapter, verseStart: lkVerse, verseEnd: lkVerse }) });
  return (
    <div className="space-y-6">
      <section className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4">
        <SectionTitle>Look up a verse — Fresh Water text</SectionTitle>
        <div className="mt-3 grid grid-cols-3 gap-2">
          <label className="col-span-3 text-sm text-[var(--text)] sm:col-span-1">Book
            <select aria-label="Lookup book" value={lkSlug} onChange={(e) => { setLkSlug(e.target.value); setLkChapter(1); }} className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-2 text-sm text-[var(--text)]">
              {enBooks.map((b) => (<option key={b.slug} value={b.slug}>{b.title}</option>))}
            </select>
          </label>
          <label className="text-sm text-[var(--text)]">Chapter
            <input aria-label="Lookup chapter" type="number" min={1} max={lkMeta?.chapters ?? 150} value={lkChapter} onChange={(e) => setLkChapter(Math.max(1, Number(e.target.value) || 1))} className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-2 text-sm text-[var(--text)]" />
          </label>
          <label className="text-sm text-[var(--text)]">Verse
            <input aria-label="Lookup verse" type="number" min={1} value={lkVerse} onChange={(e) => setLkVerse(Math.max(1, Number(e.target.value) || 1))} className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-2 text-sm text-[var(--text)]" />
          </label>
        </div>
        {lookup.isPending ? <p className="mt-3 text-sm text-[var(--dim)]">Loading…</p> : lookup.data?.found ? (
          <div className="mt-3">
            <p className="scripture text-lg leading-relaxed text-[var(--text)]"><SegText segments={lookup.data.segments as Seg[]} /></p>
            <p className="mt-1 text-sm font-medium text-[var(--accent)]">{lkMeta?.title} {lkChapter}:{lkVerse} · Fresh Water Translation</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(`${lookup.data?.text ?? ""} — ${lkMeta?.title} ${lkChapter}:${lkVerse} (Fresh Water Translation)`); setCopiedKey("lookup"); setTimeout(() => setCopiedKey(""), 1500); } catch { /* noop */ } }} className="rounded-full bg-[var(--accent-soft)] px-3 py-2 text-sm font-medium text-[var(--accent)]">{copiedKey === "lookup" ? "Copied ✓" : "Copy verse"}</button>
              <button type="button" onClick={() => lkMeta && onOpenRef({ lang: "en", slug: lkSlug, chapter: lkChapter })} className="rounded-full bg-[var(--surface-alt)] px-3 py-2 text-sm font-medium text-[var(--text)]">Open chapter — highlight &amp; note it there →</button>
            </div>
          </div>
        ) : <p className="mt-3 text-sm text-[var(--dim)]">That verse is not in the loaded text for this book yet.</p>}
      </section>

      <section>
        <SectionTitle>Your verses · {refs.length} saved</SectionTitle>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {([["all", "All"], ["bookmark", "🔖 Bookmarked"], ["highlight", "🖍 Highlighted"], ["note", "✎ With notes"]] as const).map(([f, label]) => (
            <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)} className={`rounded-full px-3 py-1.5 text-xs font-medium ${filter === f ? "bg-[var(--accent)] text-white" : "bg-[var(--surface)] text-[var(--dim)] border border-[var(--border)]"}`}>{label}</button>
          ))}
          {HIGHLIGHT_COLORS.map((c) => (
            <button key={c.name} type="button" aria-label={`Filter by ${c.label} highlights`} aria-pressed={colorFilter === c.name} onClick={() => setColorFilter(colorFilter === c.name ? "all" : c.name)} className={`h-7 w-7 rounded-full border-2 ${colorFilter === c.name ? "border-[var(--accent)]" : "border-[var(--border)]"}`} style={{ backgroundColor: c.swatch }} />
          ))}
        </div>
        {refs.length === 0 ? (
          <p className="mt-3 text-sm leading-relaxed text-[var(--dim)]">Nothing saved yet. Open any chapter, tap a verse number, and highlight it, bookmark it or add a note — your verses gather here with their Fresh Water text.</p>
        ) : shown.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--dim)]">No verses match this filter.</p>
        ) : (
          <div className="mt-3 space-y-2">
            {shown.map((r) => {
              const k = `${r.lang}:${r.slug}:${r.chapter}:${r.verse}`;
              const got = textMap.get(k);
              return (
                <div key={k} className={`rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-3 ${r.color ? hlClsFor(r.color) : ""}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-[var(--accent)]">{r.bookTitle} {r.chapter}:{r.verse}{r.lang === "es" ? " · ES" : ""}</span>
                    {r.kinds.includes("bookmark") ? <span className="text-xs">🔖</span> : null}
                    {r.kinds.includes("note") ? <span className="text-xs font-semibold text-[var(--accent)]">✎ note</span> : null}
                    {r.color ? <span className="flex items-center gap-1 text-xs text-[var(--dim)]"><span aria-hidden className="h-3.5 w-3.5 rounded-full border border-black/10" style={{ backgroundColor: HIGHLIGHT_COLORS.find((c) => c.name === r.color)?.swatch }} />{HIGHLIGHT_COLORS.find((c) => c.name === r.color)?.label}</span> : null}
                  </div>
                  {got?.text ? <p className="scripture mt-1 text-base leading-relaxed text-[var(--text)]"><SegText segments={got.segments} /></p> : <p className="mt-1 text-sm text-[var(--dim)]">{bulk.isPending ? "Loading text…" : "Text not loaded for this verse."}</p>}
                  {r.note ? <p className="mt-2 rounded-lg bg-[var(--surface)]/80 p-2 text-sm whitespace-pre-line text-[var(--text)]"><span className="font-semibold">✎ </span>{r.note}</p> : null}
                  <div className="mt-2 flex gap-2">
                    <button type="button" onClick={() => onOpenRef(r)} className="rounded-full bg-[var(--accent-soft)] px-3 py-1.5 text-sm font-medium text-[var(--accent)]">Open in reader</button>
                    <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(`${got?.text ?? ""} — ${r.bookTitle} ${r.chapter}:${r.verse} (Fresh Water Translation)`); setCopiedKey(k); setTimeout(() => setCopiedKey(""), 1500); } catch { /* noop */ } }} className="rounded-full px-3 py-1.5 text-sm text-[var(--dim)]">{copiedKey === k ? "Copied ✓" : "Copy"}</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

type StudyOut = ApiResponse<typeof api, "listStudies">["studies"][number];
type PassageRef = StudyOut["passages"][number];

function StudyPassageText({ p }: { p: PassageRef }) {
  const q = useQuery({ queryKey: ["study-passage", p.lang, p.slug, p.chapter, p.verseStart, p.verseEnd], queryFn: () => api.getPassage({ lang: p.lang, slug: p.slug, chapter: p.chapter, verseStart: p.verseStart, verseEnd: p.verseEnd }) });
  return (
    <div className="rounded-lg bg-[var(--surface-alt)] p-3">
      <p className="text-sm font-semibold text-[var(--accent)]">{p.label}</p>
      {q.isPending ? <p className="mt-1 text-sm text-[var(--dim)]">Loading Fresh Water text…</p> : q.data?.found ? <p className="scripture mt-1 text-base leading-relaxed text-[var(--text)]"><SegText segments={q.data.segments as Seg[]} /></p> : <p className="mt-1 text-sm text-[var(--dim)]">Text not in the loaded corpus for this passage.</p>}
    </div>
  );
}

function BuilderView({ library, onOpenRef }: { library: LibraryData | undefined; onOpenRef: (r: { lang: string; slug: string; chapter: number }) => void }) {
  const queryClient = useQueryClient();
  const studiesQ = useQuery({ queryKey: ["studies"], queryFn: () => api.listStudies({}) });
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<{ title: string; topic: string; passages: PassageRef[]; observation: string; interpretation: string; application: string; questions: string[] } | null>(null);
  const [printId, setPrintId] = useState<number | null>(null);
  const enBooks = (library?.books ?? []).filter((b) => b.lang === "en");
  const [addSlug, setAddSlug] = useState("john");
  const [addChapter, setAddChapter] = useState(1);
  const [addVs, setAddVs] = useState(1);
  const [addVe, setAddVe] = useState(1);
  const [newQ, setNewQ] = useState("");
  const saveMut = useMutation({
    mutationFn: () => api.saveStudy({ id: editingId ?? undefined, title: draft!.title, topic: draft!.topic, passages: draft!.passages, observation: draft!.observation, interpretation: draft!.interpretation, application: draft!.application, questions: draft!.questions }),
    onSuccess: (d) => { queryClient.invalidateQueries({ queryKey: ["studies"] }); setEditingId(d.id); },
  });
  const deleteMut = useMutation({ mutationFn: (id: number) => api.deleteStudy({ id }), onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["studies"] }); setDraft(null); setEditingId(null); } });
  const startNew = () => { setEditingId(null); setDraft({ title: "", topic: "", passages: [], observation: "", interpretation: "", application: "", questions: ["What does the text say? List the facts.", "What does it mean? Key terms and cross-references.", "What will I do with it this week?"] }); };
  const openStudy = (s: StudyOut) => { setEditingId(s.id); setDraft({ title: s.title, topic: s.topic, passages: s.passages, observation: s.observation, interpretation: s.interpretation, application: s.application, questions: s.questions }); };
  const printStudy = printId != null ? (studiesQ.data?.studies ?? []).find((s) => s.id === printId) : undefined;
  const studyToMarkdown = (s: StudyOut) => [`# ${s.title}`, s.topic ? `*${s.topic}*` : "", "", "## Passages", ...s.passages.map((p) => `- ${p.label}`), "", "## Observation — What does it say?", s.observation || "_(not yet written)_", "", "## Interpretation — What does it mean?", s.interpretation || "_(not yet written)_", "", "## Application — What will I do?", s.application || "_(not yet written)_", "", "## My Questions", ...s.questions.map((q, i) => `${i + 1}. ${q}`), "", "— Built in Fresh Water Translation Bible Study (Precept pattern: Observation · Interpretation · Application)"].join("\n");
  if (printStudy) {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setPrintId(null)} className="rounded-full bg-[var(--surface)] border border-[var(--border)] px-4 py-2 text-sm font-medium text-[var(--accent)]">← Back to builder</button>
          <button type="button" onClick={() => downloadText(`${printStudy.title.replace(/[^\w-]+/g, "-").toLowerCase() || "study"}.md`, studyToMarkdown(printStudy), "text/markdown")} className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white">Download document (.md)</button>
          <button type="button" onClick={() => downloadText(`${printStudy.title.replace(/[^\w-]+/g, "-").toLowerCase() || "study"}.txt`, studyToMarkdown(printStudy))} className="rounded-full bg-[var(--surface-alt)] px-4 py-2 text-sm font-medium text-[var(--text)]">Download .txt</button>
        </div>
        <article className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-5">
          <h3 className="scripture text-2xl font-bold text-[var(--text)]">{printStudy.title}</h3>
          {printStudy.topic ? <p className="mt-1 italic text-[var(--dim)]">{printStudy.topic}</p> : null}
          <h4 className="mt-5 text-sm font-bold uppercase tracking-wide text-[var(--accent)]">Passages — Fresh Water Translation</h4>
          <div className="mt-2 space-y-2">{printStudy.passages.length ? printStudy.passages.map((p, i) => (<StudyPassageText key={i} p={p} />)) : <p className="text-sm text-[var(--dim)]">No passages added yet.</p>}</div>
          {([["Observation — What does it say?", printStudy.observation], ["Interpretation — What does it mean?", printStudy.interpretation], ["Application — What will I do?", printStudy.application]] as [string, string][]).map(([h, body]) => (
            <div key={h}><h4 className="mt-5 text-sm font-bold uppercase tracking-wide text-[var(--accent)]">{h}</h4><p className="mt-1 whitespace-pre-line text-base leading-relaxed text-[var(--text)]">{body || "—"}</p></div>
          ))}
          <h4 className="mt-5 text-sm font-bold uppercase tracking-wide text-[var(--accent)]">My Questions</h4>
          <ol className="mt-1 list-decimal space-y-1 pl-5 text-base text-[var(--text)]">{printStudy.questions.map((q, i) => (<li key={i}>{q}</li>))}</ol>
          <p className="mt-6 text-xs text-[var(--dim)]">Precept pattern — Observation · Interpretation · Application. Print this page from your browser or device to keep it on paper.</p>
        </article>
      </div>
    );
  }
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-[var(--dim)]">Build a study the workbook way: gather passages in Fresh Water text, then work them through <strong>Observation → Interpretation → Application</strong> with your own questions.</p>
      </div>
      <button type="button" onClick={startNew} className="rounded-full bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-white">+ New study</button>
      {!draft && (studiesQ.data?.studies.length ?? 0) > 0 ? (
        <div className="space-y-2">
          {(studiesQ.data?.studies ?? []).map((s) => (
            <div key={s.id} className="flex items-center gap-2 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-3">
              <button type="button" onClick={() => openStudy(s)} className="min-w-0 flex-1 text-left">
                <span className="scripture block truncate text-lg font-semibold text-[var(--text)]">{s.title || "Untitled study"}</span>
                <span className="block text-xs text-[var(--dim)]">{s.passages.length} passage{s.passages.length === 1 ? "" : "s"} · updated {new Date(s.updatedAt).toLocaleDateString()}</span>
              </button>
              <button type="button" onClick={() => setPrintId(s.id)} className="rounded-full bg-[var(--accent-soft)] px-3 py-2 text-sm font-medium text-[var(--accent)]">Document</button>
            </div>
          ))}
        </div>
      ) : null}
      {studiesQ.isPending ? <p className="text-sm text-[var(--dim)]">Loading your studies…</p> : null}
      {!draft && (studiesQ.data?.studies.length ?? 0) === 0 && !studiesQ.isPending ? <p className="text-sm text-[var(--dim)]">No studies yet. Start one above — or tap a verse in the reader and choose “Add to study builder”.</p> : null}
      {draft ? (
        <div className="space-y-4 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4">
          <label className="block text-sm font-medium text-[var(--text)]">Study title
            <input aria-label="Study title" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="e.g. Abiding in the Vine — John 15" className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-base text-[var(--text)]" />
          </label>
          <label className="block text-sm font-medium text-[var(--text)]">Topic / focus
            <input aria-label="Study topic" value={draft.topic} onChange={(e) => setDraft({ ...draft, topic: e.target.value })} placeholder="What question is this study answering?" className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)]" />
          </label>
          <div>
            <SectionTitle>Passages in this study</SectionTitle>
            <div className="mt-2 space-y-2">
              {draft.passages.map((p, i) => (
                <div key={i} className="flex items-start gap-2">
                  <div className="min-w-0 flex-1"><StudyPassageText p={p} /></div>
                  <button type="button" aria-label={`Remove passage ${p.label}`} onClick={() => setDraft({ ...draft, passages: draft.passages.filter((_, j) => j !== i) })} className="rounded-full px-2 py-1 text-sm text-red-600 dark:text-red-400">✕</button>
                  <button type="button" onClick={() => onOpenRef({ lang: p.lang, slug: p.slug, chapter: p.chapter })} className="rounded-full px-2 py-1 text-sm text-[var(--accent)]">Read →</button>
                </div>
              ))}
              {draft.passages.length === 0 ? <p className="text-sm text-[var(--dim)]">No passages yet — add one below.</p> : null}
            </div>
            <div className="mt-3 grid grid-cols-4 gap-2">
              <label className="col-span-4 text-sm text-[var(--text)] sm:col-span-1">Book
                <select aria-label="Add passage book" value={addSlug} onChange={(e) => setAddSlug(e.target.value)} className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-2 text-sm text-[var(--text)]">{enBooks.map((b) => (<option key={b.slug} value={b.slug}>{b.title}</option>))}</select>
              </label>
              <label className="text-sm text-[var(--text)]">Chapter<input aria-label="Add passage chapter" type="number" min={1} value={addChapter} onChange={(e) => setAddChapter(Math.max(1, Number(e.target.value) || 1))} className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-2 text-sm text-[var(--text)]" /></label>
              <label className="text-sm text-[var(--text)]">From v.<input aria-label="Add passage from verse" type="number" min={1} value={addVs} onChange={(e) => setAddVs(Math.max(1, Number(e.target.value) || 1))} className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-2 text-sm text-[var(--text)]" /></label>
              <label className="text-sm text-[var(--text)]">To v.<input aria-label="Add passage to verse" type="number" min={1} value={addVe} onChange={(e) => setAddVe(Math.max(1, Number(e.target.value) || 1))} className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-2 text-sm text-[var(--text)]" /></label>
            </div>
            <button type="button" onClick={() => { const meta = enBooks.find((b) => b.slug === addSlug); if (!meta) return; const ve = Math.max(addVs, addVe); const label = `${meta.title} ${addChapter}:${addVs}${ve !== addVs ? `–${ve}` : ""}`; setDraft({ ...draft, passages: [...draft.passages, { lang: "en", slug: addSlug, bookTitle: meta.title, chapter: addChapter, verseStart: addVs, verseEnd: ve, label }] }); }} className="mt-2 rounded-full bg-[var(--accent-soft)] px-4 py-2 text-sm font-medium text-[var(--accent)]">+ Add passage</button>
          </div>
          {([["observation", "1 · Observation — What does it say?", "Mark the facts: who, what, where, repeated words, commands, promises…"], ["interpretation", "2 · Interpretation — What does it mean?", "Key terms in Hebrew/Greek, cross-references, what it meant to its first hearers…"], ["application", "3 · Application — What will I do?", "One clear obedience step: what, when, how you'll know it's done…"]] as const).map(([field, heading, ph]) => (
            <label key={field} className="block">
              <span className="text-sm font-bold text-[var(--accent)]">{heading}</span>
              <textarea aria-label={heading} value={draft[field]} onChange={(e) => setDraft({ ...draft, [field]: e.target.value })} rows={4} placeholder={ph} className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm leading-relaxed text-[var(--text)]" />
            </label>
          ))}
          <div>
            <SectionTitle>My questions</SectionTitle>
            <div className="mt-2 space-y-2">
              {draft.questions.map((q, i) => (
                <div key={i} className="flex gap-2">
                  <input aria-label={`Question ${i + 1}`} value={q} onChange={(e) => setDraft({ ...draft, questions: draft.questions.map((x, j) => (j === i ? e.target.value : x)) })} className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)]" />
                  <button type="button" aria-label={`Remove question ${i + 1}`} onClick={() => setDraft({ ...draft, questions: draft.questions.filter((_, j) => j !== i) })} className="rounded-full px-2 text-sm text-red-600 dark:text-red-400">✕</button>
                </div>
              ))}
            </div>
            <div className="mt-2 flex gap-2">
              <input aria-label="New question" value={newQ} onChange={(e) => setNewQ(e.target.value)} placeholder="Add a question…" className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)]" />
              <button type="button" onClick={() => { if (newQ.trim()) { setDraft({ ...draft, questions: [...draft.questions, newQ.trim()] }); setNewQ(""); } }} className="rounded-full bg-[var(--accent-soft)] px-3 py-2 text-sm font-medium text-[var(--accent)]">Add</button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 border-t border-[var(--border)] pt-3">
            <button type="button" onClick={() => saveMut.mutate()} disabled={saveMut.isPending || draft.title.trim() === ""} className="rounded-full bg-[var(--accent)] px-5 py-2.5 text-sm font-medium text-white disabled:opacity-40">{saveMut.isPending ? "Saving…" : editingId ? "Save study" : "Create study"}</button>
            {saveMut.isSuccess ? <span className="self-center text-sm text-[var(--accent)]">Saved ✓</span> : null}
            {saveMut.isError ? <span className="self-center text-sm text-red-600 dark:text-red-400">Save failed — try again.</span> : null}
            {editingId ? <button type="button" onClick={() => setPrintId(editingId)} className="rounded-full bg-[var(--surface-alt)] px-4 py-2.5 text-sm font-medium text-[var(--text)]">View document / export</button> : null}
            <button type="button" onClick={() => { setDraft(null); setEditingId(null); }} className="rounded-full px-4 py-2.5 text-sm text-[var(--dim)]">Close editor</button>
            {editingId ? <button type="button" onClick={() => deleteMut.mutate(editingId)} disabled={deleteMut.isPending} className="rounded-full px-4 py-2.5 text-sm text-red-600 dark:text-red-400 underline disabled:opacity-40">Delete study</button> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PlansView({ onOpenRef }: { onOpenRef: (r: { lang: string; slug: string; chapter: number }) => void }) {
  const queryClient = useQueryClient();
  const templatesQ = useQuery({ queryKey: ["plan-templates"], queryFn: () => api.listPlanTemplates({}) });
  const plansQ = useQuery({ queryKey: ["my-plans"], queryFn: () => api.listMyPlans({}) });
  const startMut = useMutation({ mutationFn: (templateId: string) => api.startPlan({ templateId }), onSuccess: () => queryClient.invalidateQueries({ queryKey: ["my-plans"] }) });
  const toggleMut = useMutation({ mutationFn: (v: { planId: number; day: number }) => api.togglePlanDay(v), onSuccess: () => queryClient.invalidateQueries({ queryKey: ["my-plans"] }) });
  const deleteMut = useMutation({ mutationFn: (id: number) => api.deletePlan({ id }), onSuccess: () => queryClient.invalidateQueries({ queryKey: ["my-plans"] }) });
  const [openPlan, setOpenPlan] = useState<number | null>(null);
  return (
    <div className="space-y-6">
      <section>
        <SectionTitle>Start a plan</SectionTitle>
        <div className="mt-2 space-y-2">
          {(templatesQ.data?.templates ?? []).map((t) => (
            <div key={t.id} className="flex items-center gap-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4">
              <div className="min-w-0 flex-1">
                <p className="scripture text-lg font-semibold text-[var(--text)]">{t.title}</p>
                <p className="mt-0.5 text-sm text-[var(--dim)]">{t.description}</p>
              </div>
              <button type="button" onClick={() => startMut.mutate(t.id)} disabled={startMut.isPending} className="shrink-0 rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-40">Start</button>
            </div>
          ))}
          {templatesQ.isPending ? <p className="text-sm text-[var(--dim)]">Loading plans…</p> : null}
        </div>
      </section>
      <section>
        <SectionTitle>My plans · {(plansQ.data?.plans ?? []).length}</SectionTitle>
        {(plansQ.data?.plans ?? []).length === 0 ? <p className="mt-2 text-sm text-[var(--dim)]">No plan running yet. Pick one above and take it a day at a time.</p> : null}
        <div className="mt-2 space-y-3">
          {(plansQ.data?.plans ?? []).map((plan) => {
            const days = [...new Set(plan.readings.map((r) => r.day))].sort((a, b) => a - b);
            const done = plan.completed.length;
            const pct = days.length ? Math.round((done / days.length) * 100) : 0;
            const isOpen = openPlan === plan.id;
            const nextDay = days.find((d) => !plan.completed.includes(d));
            return (
              <div key={plan.id} className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="scripture text-lg font-semibold text-[var(--text)]">{plan.title}</p>
                  <span className="text-sm font-semibold text-[var(--accent)]">{pct}%</span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--surface-alt)]" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${plan.title} progress`}>
                  <div className="h-full bg-[var(--accent)]" style={{ width: `${pct}%` }} />
                </div>
                <p className="mt-1.5 text-sm text-[var(--dim)]">{done} of {days.length} days read{plan.startDate ? ` · started ${plan.startDate}` : ""}{nextDay ? ` · next: Day ${nextDay}` : " · complete — well done."}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button type="button" aria-expanded={isOpen} onClick={() => setOpenPlan(isOpen ? null : plan.id)} className="rounded-full bg-[var(--accent-soft)] px-3 py-2 text-sm font-medium text-[var(--accent)]">{isOpen ? "Hide days" : "Show days & readings"}</button>
                  <button type="button" onClick={() => deleteMut.mutate(plan.id)} className="rounded-full px-3 py-2 text-sm text-red-600 dark:text-red-400 underline">Remove plan</button>
                </div>
                {isOpen ? (
                  <div className="mt-3 space-y-2">
                    {days.map((day) => {
                      const readings = plan.readings.filter((r) => r.day === day);
                      const isDone = plan.completed.includes(day);
                      return (
                        <div key={day} className={`rounded-lg border border-[var(--border)] p-3 ${isDone ? "bg-[var(--accent-soft)]" : "bg-[var(--surface-alt)]"}`}>
                          <div className="flex items-center gap-2">
                            <input id={`plan-${plan.id}-day-${day}`} type="checkbox" checked={isDone} onChange={() => toggleMut.mutate({ planId: plan.id, day })} className="h-5 w-5 accent-[var(--accent)]" />
                            <label htmlFor={`plan-${plan.id}-day-${day}`} className="text-sm font-semibold text-[var(--text)]">Day {day} {isDone ? "✓ read" : ""}</label>
                          </div>
                          <div className="mt-1.5 flex flex-wrap gap-1.5 pl-7">
                            {readings.map((r, i) => (
                              <button key={i} type="button" onClick={() => onOpenRef({ lang: r.lang, slug: r.slug, chapter: r.chapter })} className="rounded-full bg-[var(--surface)] border border-[var(--border)] px-2.5 py-1 text-xs font-medium text-[var(--accent)]">{r.label} →</button>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function DevotionalView({ study }: { study: StudyData }) {
  const votdRef = useVotdRef(study.youversionKey);
  const usfm = votdRef.data ?? "";
  const devo = useQuery({
    queryKey: ["devotional", todayKey(), usfm],
    enabled: !study.youversionKey || votdRef.isSuccess || votdRef.isError,
    staleTime: 1000 * 60 * 60,
    retry: 1,
    queryFn: () => api.getDevotional({ dateKey: todayKey(), votdUsfm: usfm }),
  });
  const [copied, setCopied] = useState(false);
  const d = devo.data;
  const fullText = d ? [`Scripture — ${d.referenceLabel} (Fresh Water Translation)`, d.scriptureText, "", "Historical Context", d.body.historicalContext, "", "Devotional", d.body.devotional, "", "Hebrew/Greek Key Terms", ...d.body.keyTerms.map((t) => `${t.term} (${t.transliteration}) — ${t.definition} ${t.implication}`), "", "Application", ...d.body.application.map((a, i) => `${i + 1}. ${a}`), "", "Prayer", d.body.prayer].join("\n") : "";
  return (
    <div className="space-y-4">
      <p className="text-sm leading-relaxed text-[var(--dim)]">Today's devotional is built fresh each morning on the <strong>verse of the day</strong>{study.youversionKey ? " from YouVersion" : " (add your YouVersion key in Settings to use their verse of the day; until then a Fresh Water rotation verse is used)"}, with the Scripture quoted from <strong>your Fresh Water Translation</strong>. It's written for the day and kept for the day.</p>
      {devo.isPending ? <p className="py-6 text-center text-sm text-[var(--dim)]">Preparing today's devotional…</p> : devo.isError || !d ? (
        <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4">
          <p className="text-sm text-[var(--text)]">Today's devotional could not be prepared just now.</p>
          <button type="button" onClick={() => devo.refetch()} className="mt-3 rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white">Try again</button>
        </div>
      ) : (
        <article className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--dim)]">Daily devotional · {d.dateKey} · {d.source === "youversion" ? "Verse of the day via YouVersion" : "Fresh Water rotation verse"}</p>
          <h3 className="mt-4 text-base font-bold text-[var(--text)]">Scripture</h3>
          <p className="scripture mt-1 text-lg leading-relaxed text-[var(--text)]">{d.scriptureSegments.length ? <SegText segments={d.scriptureSegments as Seg[]} /> : d.scriptureText}</p>
          <p className="mt-1 text-sm font-semibold text-[var(--accent)]">{d.referenceLabel} — Fresh Water Translation</p>
          <h3 className="mt-5 text-base font-bold text-[var(--text)]">Historical Context</h3>
          <p className="mt-1 text-base leading-relaxed text-[var(--text)]">{d.body.historicalContext}</p>
          <h3 className="mt-5 text-base font-bold text-[var(--text)]">Devotional</h3>
          <p className="mt-1 whitespace-pre-line text-base leading-relaxed text-[var(--text)]">{d.body.devotional}</p>
          <h3 className="mt-5 text-base font-bold text-[var(--text)]">Hebrew/Greek Key Terms</h3>
          <div className="mt-1 space-y-2">
            {d.body.keyTerms.map((t, i) => (
              <p key={i} className="text-base leading-relaxed text-[var(--text)]"><strong>{t.term}</strong> ({t.transliteration}) — {t.definition} <span className="text-[var(--dim)]">{t.implication}</span></p>
            ))}
          </div>
          <h3 className="mt-5 text-base font-bold text-[var(--text)]">Application</h3>
          <ol className="mt-1 list-decimal space-y-1 pl-5 text-base leading-relaxed text-[var(--text)]">{d.body.application.map((a, i) => (<li key={i}>{a}</li>))}</ol>
          <h3 className="mt-5 text-base font-bold text-[var(--text)]">Prayer</h3>
          <p className="scripture mt-1 text-base italic leading-relaxed text-[var(--text)]">{d.body.prayer}</p>
          <div className="mt-5 flex flex-wrap gap-2 border-t border-[var(--border)] pt-3">
            <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(fullText); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* noop */ } }} className="rounded-full bg-[var(--accent-soft)] px-4 py-2 text-sm font-medium text-[var(--accent)]">{copied ? "Copied ✓" : "Copy devotional"}</button>
            <button type="button" onClick={() => downloadText(`devotional-${d.dateKey}.txt`, fullText)} className="rounded-full bg-[var(--surface-alt)] px-4 py-2 text-sm font-medium text-[var(--text)]">Download .txt</button>
          </div>
        </article>
      )}
    </div>
  );
}

function HelperView({ study }: { study: StudyData }) {
  const queryClient = useQueryClient();
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const historyQ = useQuery({ queryKey: ["ai-notes"], queryFn: () => api.listAiNotes({}) });
  const posLabel = study.position ? `${study.position.slug} ${study.position.chapter}` : "";
  const askMut = useMutation({
    mutationFn: () => api.askHelper({ question: question.trim(), contextRef: posLabel, contextText: "" }),
    onSuccess: (d) => { setAnswer(d.answer); queryClient.invalidateQueries({ queryKey: ["ai-notes"] }); },
  });
  const quick = ["Explain John 3:16 in plain words", "What does 'steadfast love' (hesed) mean in the Psalms?", "Cross-references for trusting God in hard times", "What is the difference between observation and interpretation in Bible study?", "Give me a prayer based on Psalm 23"];
  return (
    <div className="space-y-5">
      <p className="text-sm leading-relaxed text-[var(--dim)]">Ask about a passage, a word, or how to study. Answers are grounded in Scripture and the Fresh Water text — check them against the passage itself, as you should with any helper.</p>
      <div className="flex flex-wrap gap-1.5">
        {quick.map((q) => (<button key={q} type="button" onClick={() => setQuestion(q)} className="rounded-full bg-[var(--surface)] border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--text)]">{q}</button>))}
      </div>
      <form onSubmit={(e) => { e.preventDefault(); if (question.trim().length >= 2) askMut.mutate(); }} className="space-y-2">
        <label htmlFor="ai-question" className="text-sm font-medium text-[var(--text)]">Your question</label>
        <textarea id="ai-question" value={question} onChange={(e) => setQuestion(e.target.value)} rows={3} placeholder="e.g. What does Romans 8:28 actually promise — and what doesn't it promise?" className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm leading-relaxed text-[var(--text)]" />
        <button type="submit" disabled={askMut.isPending || question.trim().length < 2} className="rounded-full bg-[var(--accent)] px-5 py-2.5 text-sm font-medium text-white disabled:opacity-40">{askMut.isPending ? "Thinking…" : "✦ Ask the helper"}</button>
        {askMut.isError ? <p className="text-sm text-red-600 dark:text-red-400">The helper could not answer just now. Try again in a moment.</p> : null}
      </form>
      {answer ? (
        <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4">
          <SectionTitle>Answer</SectionTitle>
          <p className="mt-2 whitespace-pre-line text-base leading-relaxed text-[var(--text)]">{answer}</p>
        </div>
      ) : null}
      {(historyQ.data?.notes.length ?? 0) > 0 ? (
        <section>
          <SectionTitle>Earlier questions · {historyQ.data?.notes.length}</SectionTitle>
          <div className="mt-2 space-y-2">
            {(historyQ.data?.notes ?? []).slice(0, 10).map((n) => (
              <details key={n.id} className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-3">
                <summary className="cursor-pointer text-sm font-semibold text-[var(--text)]">{n.question}</summary>
                <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-[var(--text)]">{n.answer}</p>
                <p className="mt-1 text-xs text-[var(--dim)]">{new Date(n.createdAt).toLocaleString()}</p>
              </details>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function StudyView({ study, library, tab, onTab, onOpenRef }: { study: StudyData; library: LibraryData | undefined; tab: StudyTab; onTab: (t: StudyTab) => void; onOpenRef: (r: { lang: string; slug: string; chapter: number }) => void }) {
  const tabs: [StudyTab, string][] = [["marks", "🔖 Marks & Notes"], ["verses", "Verses"], ["builder", "Study Builder"], ["plans", "Bible Plans"], ["devotional", "Daily Devotional"], ["helper", "✦ AI Helper"]];
  return (
    <div className="mx-auto max-w-2xl">
      <div className="flex gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label="Study tools">
        {tabs.map(([t, label]) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => onTab(t)} className={`shrink-0 rounded-full px-3.5 py-2 text-sm font-medium ${tab === t ? "bg-[var(--accent)] text-white" : "bg-[var(--surface)] text-[var(--dim)] border border-[var(--border)]"}`}>{label}</button>
        ))}
      </div>
      <div className="mt-4">
        {tab === "marks" ? <MarksView study={study} onOpenRef={onOpenRef} /> : null}
        {tab === "verses" ? <VersesView study={study} library={library} onOpenRef={onOpenRef} /> : null}
        {tab === "builder" ? <BuilderView library={library} onOpenRef={onOpenRef} /> : null}
        {tab === "plans" ? <PlansView onOpenRef={onOpenRef} /> : null}
        {tab === "devotional" ? <DevotionalView study={study} /> : null}
        {tab === "helper" ? <HelperView study={study} /> : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

function SettingsView({ study }: { study: StudyData }) {
  const queryClient = useQueryClient();
  const [keyDraft, setKeyDraft] = useState<string | null>(null);
  const keyValue = keyDraft ?? study.youversionKey;
  const versions = useYvVersions(study.youversionKey, "en");
  // The save itself is only the storage write: it settles as soon as the
  // key is persisted. Key verification is the separate versions query
  // below (keyed on the saved key's fingerprint) and never gates this
  // mutation — a slow or failing YouVersion call cannot leave the button
  // stuck on "Saving…".
  const save = useMutation({
    mutationFn: () => api.saveSettings({ youversionKey: keyValue }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["study"] });
      setKeyDraft(null);
    },
  });
  const saveCompare = useMutation({
    mutationFn: (v: YvVersion) =>
      api.saveSettings({ compareBibleId: v.id, compareBibleName: v.abbr || v.title }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["study"] }),
  });

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <section>
        <SectionTitle>YouVersion compare</SectionTitle>
        <p className="mt-2 text-sm leading-relaxed text-[var(--dim)]">
          Paste your YouVersion App Key to set other translations beside the
          Fresh Water text and to load the verse of the day. The key is stored
          only in this app's own storage and sent only to api.youversion.com.
        </p>
        <label htmlFor="yv-key" className="mt-3 block text-sm font-medium text-[var(--text)]">
          YouVersion App Key
        </label>
        <input
          id="yv-key"
          type="password"
          autoComplete="off"
          value={keyValue}
          onChange={(e) => setKeyDraft(e.target.value)}
          placeholder="Paste your App Key"
          className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--text)]"
        />
        <div className="mt-2 flex items-center gap-3">
          <button
            type="button"
            onClick={() => save.mutate()}
            disabled={save.isPending || keyValue === study.youversionKey}
            className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            {save.isPending ? "Saving…" : "Save key"}
          </button>
          {save.isError ? (
            <span className="text-xs text-red-600 dark:text-red-400">
              The key could not be saved — check your connection and try again.
            </span>
          ) : save.isSuccess && keyDraft === null ? (
            <span className="text-xs text-[var(--dim)]">Key saved.</span>
          ) : study.youversionKey ? (
            <span className="text-xs text-[var(--dim)]">Key saved.</span>
          ) : (
            <span className="text-xs text-[var(--dim)]">No key saved yet.</span>
          )}
        </div>
        {study.youversionKey ? (
          <p className="mt-2 text-xs text-[var(--dim)]" aria-live="polite">
            {versions.isError
              ? "Key check: YouVersion is currently rejecting requests with this key."
              : versions.isPending
                ? "Key check: verifying with YouVersion…"
                : versions.data
                  ? `Key check: working — ${versions.data.length} English versions available.`
                  : "Key check: not run yet."}
          </p>
        ) : null}

        {versions.data && versions.data.length > 0 ? (
          <>
            <label htmlFor="yv-default" className="mt-5 block text-sm font-medium text-[var(--text)]">
              Preferred compare version
            </label>
            <select
              id="yv-default"
              aria-label="Preferred compare version"
              className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)]"
              value={study.compareBibleId || ""}
              onChange={(e) => {
                const v = versions.data?.find((x) => x.id === Number(e.target.value));
                if (v) saveCompare.mutate(v);
              }}
            >
              <option value="">Choose a version…</option>
              {versions.data.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.abbr ? `${v.abbr} — ` : ""}{v.title}
                </option>
              ))}
            </select>
          </>
        ) : null}
      </section>

      <section>
        <SectionTitle>How the Fresh Water text is printed</SectionTitle>
        <div className="scripture mt-2 space-y-2 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4 text-base leading-relaxed text-[var(--text)]">
          <p>
            <span className="seg-blue font-medium">Blue letters</span> — the spoken
            words of Yeshua.
          </p>
          <p>
            <em>Italics</em> — words supplied by the translators for English sense.
          </p>
          <p>
            <span className="seg-sc">Small caps</span> — quotations from the Old
            Testament.
          </p>
          <p>
            <span className="seg-sh">Gold shading</span> — restored passages, kept
            in the text and marked as restorations.
          </p>
        </div>
      </section>

      <section>
        <SectionTitle>Highlighting &amp; notes</SectionTitle>
        <p className="mt-2 text-sm leading-relaxed text-[var(--dim)]">
          Every verse can be highlighted in one of <strong>six colours</strong> — the colour is saved with the verse and kept everywhere it appears. Tap a verse number in the reader to highlight, bookmark or write a note; use “Select verses” to highlight a whole passage at once. Notes show as a ✎ badge in the text and live under My Study → Marks &amp; Notes, where you can edit or delete them.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {HIGHLIGHT_COLORS.map((c) => (
            <span key={c.name} className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-[var(--text)] ${c.cls}`}>
              <span aria-hidden className="h-3.5 w-3.5 rounded-full border border-black/10" style={{ backgroundColor: c.swatch }} />{c.label}
            </span>
          ))}
        </div>
      </section>

      <section>
        <SectionTitle>Your study data</SectionTitle>
        <p className="mt-2 text-sm leading-relaxed text-[var(--dim)]">
          Bookmarks, highlights (with their colours), notes, studies, plans and devotionals are stored in this app on this device. General maintenance: if a book ever looks stale, reopen the Library — the corpus is read fresh from its files on every visit.
        </p>
      </section>

      <section>
        <SectionTitle>About this library</SectionTitle>
        <p className="mt-2 text-sm leading-relaxed text-[var(--dim)]">
          The reader carries the Fresh Water Translation's 66 canonical books in
          English and «Traducción Agua Fresca», the Spanish New Testament,
          drawn from the verified volumes themselves. The Apocrypha books are
          not on the shelf yet — they can be added later without changing the
          reader.
        </p>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// App shell
// ---------------------------------------------------------------------------

export function App() {
  const queryClient = useQueryClient();
  const [view, setView] = useState<View>("home");
  const [studyTab, setStudyTab] = useState<StudyTab>("marks");
  const [lang, setLang] = useState<Lang>("en");
  const [current, setCurrent] = useState<{ meta: BookMeta; chapter: number; verseLabel: string | null; nonce: number } | null>(null);
  const myPlans = useQuery({ queryKey: ["my-plans"], queryFn: () => api.listMyPlans({}) });
  const goStudy = (t: StudyTab) => { setStudyTab(t); setView("study"); };

  const library = useQuery({
    queryKey: ["library"],
    queryFn: () => api.getLibrary({}),
  });
  const study = useQuery({
    queryKey: ["study"],
    queryFn: () => api.getStudyData({}),
  });

  const savePos = useMutation({
    mutationFn: (p: { lang: string; slug: string; chapter: number }) =>
      api.savePosition(p),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["study"] }),
  });

  const openBook = (meta: BookMeta, chapter: number, verseLabel?: string) => {
    setCurrent({ meta, chapter, verseLabel: verseLabel ?? null, nonce: Date.now() });
    setView("reader");
    savePos.mutate({ lang: meta.lang, slug: meta.slug, chapter });
  };

  const openRef = (r: { lang: string; slug: string; chapter: number; verse?: number }) => {
    const meta = library.data?.books.find(
      (b) => b.lang === r.lang && b.slug === r.slug,
    );
    const verseLabel = r.verse ? String(r.verse) : undefined;
    if (meta) {
      openBook(meta, r.chapter, verseLabel);
    } else if (library.data) {
      // Corpus may have been reorganised; fall back to any same-slug book.
      const alt = library.data.books.find((b) => b.slug === r.slug);
      if (alt) openBook(alt, r.chapter, verseLabel);
    }
  };

  const studyData: StudyData = study.data ?? {
    bookmarks: [],
    highlights: [],
    notes: [],
    youversionKey: "",
    compareBibleId: 0,
    compareBibleName: "",
    position: null,
  };

  const positionMeta = studyData.position
    ? library.data?.books.find(
        (b) =>
          b.lang === studyData.position?.lang && b.slug === studyData.position?.slug,
      )
    : undefined;

  const navItems: { view: View; label: string; icon: string }[] = [
    { view: "home", label: "Home", icon: ICONS.home },
    { view: "library", label: "Library", icon: ICONS.library },
    { view: "search", label: "Search", icon: ICONS.search },
    { view: "study", label: "My Study", icon: ICONS.bookmark },
    { view: "settings", label: "Settings", icon: ICONS.settings },
  ];

  return (
    <div className="min-h-screen bg-[var(--bg)] pb-24">
      <SafeAreaTopScrim backgroundColor="var(--bg)" />
      <main className="px-4 pb-6 pt-safe">
        {view !== "reader" ? (
          <header className="mx-auto max-w-2xl pb-4 pt-3">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--gold)]">
              Fresh Water Translation
            </p>
            <h1 className="scripture mt-1 text-3xl font-bold text-[var(--text)]">
              {view === "home"
                ? "Bible Study"
                : view === "library"
                  ? "Library"
                  : view === "search"
                    ? "Search"
                    : view === "study"
                      ? "My Study"
                      : "Settings"}
            </h1>
          </header>
        ) : null}

        {view === "home" ? (
          <div className="mx-auto max-w-2xl space-y-4">
            {positionMeta && studyData.position ? (
              <button
                type="button"
                onClick={() => openBook(positionMeta, studyData.position?.chapter ?? 1)}
                className="block w-full rounded-[var(--radius)] bg-[var(--accent)] p-5 text-left text-white"
              >
                <span className="text-xs font-semibold uppercase tracking-[0.14em] opacity-80">
                  Continue reading
                </span>
                <span className="scripture mt-1 block text-2xl font-semibold">
                  {positionMeta.title} {studyData.position.chapter}
                </span>
                <span className="mt-1 block text-sm opacity-80">
                  Pick up right where you left off →
                </span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setView("library")}
                className="block w-full rounded-[var(--radius)] bg-[var(--accent)] p-5 text-left text-white"
              >
                <span className="text-xs font-semibold uppercase tracking-[0.14em] opacity-80">
                  Start reading
                </span>
                <span className="scripture mt-1 block text-2xl font-semibold">
                  Open the Library
                </span>
                <span className="mt-1 block text-sm opacity-80">
                  66 books in English · Traducción Agua Fresca — Nuevo Testamento →
                </span>
              </button>
            )}

            <VerseOfTheDay
              apiKey={studyData.youversionKey}
              bibleId={studyData.compareBibleId}
            />

            <button type="button" onClick={() => goStudy("devotional")} className="block w-full rounded-[var(--radius)] border border-[var(--gold)] bg-[var(--surface)] p-4 text-left">
              <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--gold)]">Daily devotional</span>
              <span className="scripture mt-1 block text-xl font-semibold text-[var(--text)]">Today's devotional — on the verse of the day</span>
              <span className="mt-1 block text-sm text-[var(--dim)]">Scripture in Fresh Water text, with Historical Context, Key Terms, Application and Prayer →</span>
            </button>

            {(myPlans.data?.plans ?? []).length > 0 ? (
              <section>
                <SectionTitle>Reading plans in progress</SectionTitle>
                <div className="mt-2 space-y-2">
                  {(myPlans.data?.plans ?? []).map((plan) => {
                    const totalDays = new Set(plan.readings.map((r) => r.day)).size;
                    const pct = totalDays ? Math.round((plan.completed.length / totalDays) * 100) : 0;
                    return (
                      <button key={plan.id} type="button" onClick={() => goStudy("plans")} className="block w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-3 text-left">
                        <span className="flex items-center justify-between"><span className="scripture text-base font-semibold text-[var(--text)]">{plan.title}</span><span className="text-sm font-semibold text-[var(--accent)]">{pct}%</span></span>
                        <span className="mt-1.5 block h-2 overflow-hidden rounded-full bg-[var(--surface-alt)]"><span className="block h-full bg-[var(--accent)]" style={{ width: `${pct}%` }} /></span>
                        <span className="mt-1 block text-xs text-[var(--dim)]">{plan.completed.length} of {totalDays} days read — keep going →</span>
                      </button>
                    );
                  })}
                </div>
              </section>
            ) : null}

            <section>
              <SectionTitle>Study tools</SectionTitle>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {([
                  ["builder", "📖 Study Builder", "Precept studies: Observation · Interpretation · Application"],
                  ["plans", "🗓 Bible Plans", "Psalms in 30 days, NT in 90, and more"],
                  ["verses", "Verses", "Every verse you've saved, with its text"],
                  ["marks", "🖍 Highlights & Notes", "Six colours, notes, bookmarks — all in one place"],
                  ["helper", "✦ AI Helper", "Ask about a passage, a word, a next step"],
                  ["devotional", "☀ Devotional", "Today's, on the verse of the day"],
                ] as [StudyTab, string, string][]).map(([t, title, sub]) => (
                  <button key={t} type="button" onClick={() => goStudy(t)} className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-3 text-left">
                    <span className="block text-base font-semibold text-[var(--text)]">{title}</span>
                    <span className="mt-0.5 block text-xs leading-relaxed text-[var(--dim)]">{sub}</span>
                  </button>
                ))}
              </div>
            </section>

            {library.data && !library.data.corpusReady ? (
              <div className="rounded-[var(--radius)] border border-[var(--gold)] bg-[var(--surface)] p-4">
                <p className="text-sm font-medium text-[var(--text)]">
                  The corpus is still being prepared
                </p>
                <p className="mt-1 text-sm text-[var(--dim)]">
                  The extracted book files have not landed in the data folder
                  yet. The library, reader and search will fill in
                  automatically as they arrive — your bookmarks, highlights and
                  notes already save normally.
                </p>
                <button
                  type="button"
                  onClick={() => library.refetch()}
                  className="mt-3 rounded-full bg-[var(--accent-soft)] px-4 py-2 text-sm font-medium text-[var(--accent)]"
                >
                  Check again
                </button>
              </div>
            ) : null}

            {studyData.notes.length > 0 ? (
              <section>
                <SectionTitle>Recent notes</SectionTitle>
                <div className="mt-2 space-y-2">
                  {studyData.notes.slice(0, 3).map((n) => (
                    <button
                      key={n.refKey}
                      type="button"
                      onClick={() => openRef(n)}
                      className="block w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-3 text-left"
                    >
                      <span className="text-sm font-semibold text-[var(--accent)]">
                        {n.bookTitle} {n.chapter}:{n.verse}
                      </span>
                      <span className="mt-1 line-clamp-2 block text-sm text-[var(--text)]">
                        {n.body}
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            ) : null}

            <div className="grid grid-cols-3 gap-2 text-center">
              {([
                [`${studyData.bookmarks.length}`, "Bookmarks", "marks"],
                [`${studyData.highlights.length}`, "Highlights", "marks"],
                [`${studyData.notes.length}`, "Notes", "marks"],
              ] as [string, string, StudyTab][]).map(([n, label, t]) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => goStudy(t)}
                  className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-3"
                >
                  <span className="scripture block text-2xl font-bold text-[var(--text)]">{n}</span>
                  <span className="text-xs text-[var(--dim)]">{label}</span>
                </button>
              ))}
            </div>
            {studyData.highlights.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1.5" aria-label="Your highlight colours">
                <span className="text-xs text-[var(--dim)]">Your colours:</span>
                {HIGHLIGHT_COLORS.map((c) => {
                  const count = studyData.highlights.filter((h) => h.color === c.name).length;
                  if (!count) return null;
                  return (<button key={c.name} type="button" onClick={() => goStudy("marks")} className="flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs text-[var(--text)]"><span aria-hidden className="h-3.5 w-3.5 rounded-full border border-black/10" style={{ backgroundColor: c.swatch }} />{c.label} · {count}</button>);
                })}
              </div>
            ) : null}
          </div>
        ) : null}

        {view === "library" ? (
          library.data ? (
            <Library
              library={library.data}
              lang={lang}
              onLang={setLang}
              onOpen={openBook}
              onOpenVerse={(meta, chapter, verseLabel) => openBook(meta, chapter, verseLabel)}
            />
          ) : (
            <p className="py-10 text-center text-sm text-[var(--dim)]">Loading the library…</p>
          )
        ) : null}

        {view === "reader" && current ? (
          <Reader
            meta={current.meta}
            chapter={current.chapter}
            targetVerse={current.verseLabel}
            jumpNonce={current.nonce}
            study={studyData}
            onChapter={(n) => openBook(current.meta, n)}
            onBack={() => setView("library")}
            onGoSettings={() => setView("settings")}
            onOpenBuilder={() => goStudy("builder")}
          />
        ) : null}

        {view === "search" ? (
          <SearchView
            lang={lang}
            onOpenRef={(r) => openRef(r)}
          />
        ) : null}

        {view === "study" ? (
          <StudyView study={studyData} library={library.data} tab={studyTab} onTab={setStudyTab} onOpenRef={(r) => openRef(r)} />
        ) : null}

        {view === "settings" ? <SettingsView study={studyData} /> : null}
      </main>

      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--border)] bg-[var(--surface)] pb-[env(safe-area-inset-bottom)]"
      >
        <div className="mx-auto grid max-w-2xl grid-cols-5">
          {navItems.map((item) => {
            const active =
              view === item.view || (item.view === "library" && view === "reader");
            return (
              <button
                key={item.view}
                type="button"
                aria-current={active ? "page" : undefined}
                onClick={() => setView(item.view)}
                className={`flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${
                  active ? "text-[var(--accent)]" : "text-[var(--dim)]"
                }`}
              >
                <Icon d={item.icon} label={item.label} />
                {item.label}
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
