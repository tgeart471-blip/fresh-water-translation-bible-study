# Data Plan

## Context provenance
- `Build a Bible Study app Fresh Water Translation and I also have API key of YouVersion` (verbatim build request)
- Corpus source authoritative instruction: JSON at ~/workspace/fwt-app/data/ — index.json plus one <lang>-<slug>.json per book, extracted from user's own verified Fresh Water Translation docx volumes (English OT 48 + NT 27, Spanish NT 19). Each book: chapters[] with blocks — heading blocks and para blocks whose verses carry segments with flags b=blue, i=italic, sc=small caps, sh=shaded. Render faithfully. If data folder not complete, build so books load from that model and populate from whatever is present.
- Features v1 enumerated in handoff: (1) library by language/testament with book+chapter nav; (2) reader preserving paragraphs, headings, blue, italics, small caps, gold shading; (3) full-text search; (4) per-verse bookmarks/highlights/notes in app storage; (5) Compare panel — user pastes own YouVersion App Key in Settings (stored only in app storage), app calls https://api.youversion.com/v1 directly — GET /bibles?language_ranges[]=eng, GET /bibles/{id}/passages/{USFM_REF}?format=text, header X-YVP-App-Key; (6) home with continue reading + verse of the day via same key when set.
- MEMORY context: FWT conventions — Yeshua's speech in blue, small caps for OT quotations, italics for supplied words, restored passages shaded/marked, section headings own. These map directly to segment flags.

## Tested sources
### Corpus folder ~/workspace/fwt-app/data/
**Used by**: getLibrary, getBook, searchCorpus actions
**Test command**: `ls -R ~/workspace/fwt-app/data; cat index.json`
**Sample output**: Folder exists but is EMPTY at plan time (0 files, created 2026-11-03 22:18). No index.json yet — extraction still in preparation per handoff ("JSON being prepared").
**Processing**: Server actions read index.json + per-book JSON from that folder at request time (fs read, multiple candidate paths), parse chapters/blocks/verses/segments, return typed data. If folder empty/missing, actions return empty library and client shows honest empty state explaining corpus is being prepared — no Bible text is invented or substituted from any other source. When files land, same actions serve them with no code change. Search iterates loaded books server-side.

### YouVersion Platform API
**Used by**: Client-side Compare panel + verse of the day (direct fetch from browser, user's own key)
**Test command**: `curl -s -I https://api.youversion.com/v1/bibles`
**Sample output**: HTTP 401 without key (expected — endpoint live, requires X-YVP-App-Key header)
**Processing**: Client fetches GET /bibles?language_ranges[]=eng (and spa when Spanish library selected) to list versions, GET /bibles/{id}/passages/{USFM_REF}?format=text for passage text. Key stored via saveSettings action in app DB settings table only; never hardcoded, never logged. USFM ref built from current book/chapter (e.g. JHN.3).
**Verified live 2026-11-03** (parent-agent handoff, working regenerated App Key): GET /bibles?language_ranges[]=eng returns the app's licensed set — 20 English Bibles incl. NASB2020 id 2692 and NIV as "NIV11" id 111; KJV/ESV/NLT are NOT licensed. GET /bibles/{id}/passages/{USFM}?format=text returns clean plain text {id, content, reference}. Verse of the day: GET /verse-of-the-days/{day} with {day} = day of year 1–366 (the literal "today" fails validation, 422) returns {day, passage_id (USFM), image_id}; the passage text is then fetched from the preferred compare Bible (fallback id 111). Client implements exactly these shapes.
**Save/verification split (2026-11-03 fix)**: the Settings save is only the saveSettings storage write and settles as soon as the key persists; key verification is the separate versions query, keyed on a fingerprint of the saved key so a changed key re-verifies, with retry off and a 15s fetch timeout — a slow or failing verification can never leave the UI on "Saving…", and a failed save now shows an error instead of spinning.

### Corpus update 2026-11-03
- es-1-pedro.json added to ~/workspace/fwt-app/data/ with its index.json entry (index now 87 entries; Spanish library 21 books). Verified via getLibrary: es/1-pedro "1 Pedro", 5 chapters, order 59 (after Santiago), picked up by the dynamic loader with no code change — same path as every Spanish book.

## TLC expansion 2026-11-03 (verses, study builder, AI helper, plans, devotional, highlighting & notes)
- **Highlighting (headline)**: exactly six colours — yellow, green, blue, pink, orange, purple — stored per highlight in the existing `highlights.color` column (no migration needed for colour); reader shows the colour wash, My Study → Marks & Notes lists highlights with colour preserved, filterable by colour and recolourable. Single-verse highlight in the verse sheet, run highlight (verse→verse) in the sheet, and multi-verse “Select verses” mode in the reader — all write the same per-verse rows, so v1 data keeps working. Notes: full create/edit/delete in the verse sheet and inline in My Study; ✎ badge in the reader; bookmarks unchanged.
- **Verses**: `getVersesBulk` + `getPassage` read FWT text via the same privileged corpus reader; Verses tab merges bookmarks/highlights/notes refs with their FWT text + a verse lookup.
- **Study builder**: `studies` table (migration 0003) — title/topic, passages JSON (refs), Observation/Interpretation/Application (Precept pattern, matching the user's workbook shape), questions JSON. Passage text fetched live from the corpus; document view exports .md/.txt downloads.
- **Bible plans**: `plans` table + server templates (Psalms 30, Proverbs 31, Gospels, NT 90, Psalm-a-day) generated as chapter readings; progress = completed day numbers JSON.
- **Daily devotional**: `devotionals` table cached per date_key. Client resolves the YouVersion verse-of-the-day USFM ref (existing key flow) and passes it to `getDevotional`; with no key, server rotates FALLBACK_VOTD refs. Server resolves the FWT text from the corpus (never substitutes another translation for the Scripture quote) and generates the body via `ctx.inference.complete` with the user's morning-devotional shape — bold headings Scripture / Historical Context / Devotional / Hebrew/Greek Key Terms (2 terms) / Application (measurable steps) / Prayer, direct tone for Christian men, ~2,400 chars — cached for the day.
- **AI helper**: `askHelper` / `explainPassage` via `ctx.inference.complete`, answers saved to `ai_notes` for history. No external web source; grounded in the FWT passage text passed in.
- **Maintenance**: reader text-size control (localStorage), corpus read fresh per visit, save/verification split from the earlier fix retained.
- **Verse navigation (2026-11-03)**: Library picker is now book → chapter → verse (chapter tap selects the chapter and shows its verses from the same `getBook` corpus data, plus a “Read whole chapter” action preserving the old one-tap chapter flow); the reader has a “Go to verse” control. Choosing a verse scrolls it into view (scroll-margin under the sticky header) and flashes it (gold pulse, reduced-motion safe). Search results and saved verses now also land on their verse, not just their chapter. No data-model change.

## Verse-fragment consolidation (2026-11-03 fix)
- **Bug**: verses split across printed lines land in the corpus as one single-verse para block per line, each repeating the verse number (Hosea 9:1 = five blocks; ~15,182 cross-block same-verse boundaries corpus-wide, mostly poetry). The reader printed the number on every line, glued to the text on copy ("1The days…").
- **Fix (server)**: `consolidateBlocks` in `normalizeBook` (actions.ts) merges a para block's first verse into the previous para block's last verse when label and shading signature match — same rule `mergeVerseFragments` already applied within a block. Headings break the chain; Daniel 3's two verse-24 sequences (different shading, non-consecutive) stay distinct. Because every surface (reader, `getVersesBulk`/Verses collection, `getPassage`/study & devotional views) reads through `normalizeBook`, all inherit the whole-verse text; search already merged fragments in the privileged reader.
- **Fix (reader)**: defence-in-depth continuation tracking suppresses the number button on any consecutive same-label/same-shading fragment, and the number button is followed by a real space plus its margin so the superscript number is visibly set off from the first word and copies with a space.
- **Verified**: getPassage Hosea 9:1 returns the full five-line verse as one; getVersesBulk Psalm 1:1 and Genesis 1:27 (three blocks) return whole; Daniel 3:24 shaded Greek text intact.

## Long-term data behavior
- **Refresh policy**: Corpus read from disk per request (no stale cache beyond react-query); YouVersion data fetched live per Compare open.
- **Growth**: Bookmarks/highlights/notes/settings/reading position rows grow with user use only.
- **Ordering**: Library follows index.json order (canonical); notes/bookmarks newest first.
- **Time semantics**: created_at/updated_at are instants rendered viewer-local.

## Rejected approaches
- **Tried**: Expecting corpus files present at build time
  **Why rejected**: Folder verified empty; bundling at build time would ship an empty app permanently. Runtime disk-read in actions lets the prepared JSON populate without rebuild of client bundle.
- **Tried**: Substituting public-domain Bible text for FWT
  **Why rejected**: Handoff explicitly forbids substituting any other Bible text for the Fresh Water Translation.
- **Imagery**: Not needed — text-first study reader; no photographic subjects. Decorative styling is typographic (water-toned palette, serif text).
