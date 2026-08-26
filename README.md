# Catalog Autofill

Internal tool for the efood (Delivery Hero Greece) catalog team. Turns raw, unstructured material from new restaurant and retail partners into a structured, review-ready product catalog — cutting down the manual data-entry work of onboarding a store that isn't in the efood system yet.

> **Scope note:** this tool works exclusively with external, publicly available source material (vendor websites, delivery platforms, photographed menus, PDFs, emails). It does not read from or write to internal efood/Salesforce systems.

---

## What it does

A catalog specialist gets a new store to onboard. Instead of typing every category, item, price, description, and option group by hand, they feed the store's raw material into Catalog Autofill:

- a menu photo, a PDF, a screenshot
- a plain-text paste (an email, a copied menu, a pasted spreadsheet)
- a `.docx` / `.xlsx` / `.xls` / `.txt` file
- a Wolt or Box.gr store URL
- a generic vendor website URL
- a catalog JSON produced by the companion Chrome extension

The tool extracts a structured catalog — categories, items, prices, descriptions, option groups — via Claude for anything unstructured (photos, PDFs, generic URLs, free text), or via the companion Chrome extension for Wolt/Box, which reads their own APIs directly and needs no AI at all. A human reviewer then checks, corrects, and approves the result before it's saved.

**Structured sources skip the AI.** For Wolt/Box, the frontend opens the store page in a new tab and hands off to the companion Chrome extension, which scrapes the platform's own API and hands the result back — no LLM involved, no interpretation risk. Claude is only invoked for genuinely unstructured input, or when applying a vendor's follow-up instructions to an already-extracted catalog.

---

## Features

### Extraction

- **Multi-file upload**, combinable in one request: images (jpg/png), PDF, `.docx`, `.xlsx`/`.xls`, `.txt`, free-text paste
- **Native PDF handling** — PDFs are sent to Claude as native document blocks, not rasterized to images. Large PDFs are automatically split into smaller page-range chunks (a few pages each) so the expected output size per request stays within limits; small PDFs go through as a single request
- **Direct GTIN/barcode capture from source material** — if the source explicitly includes a product code column (barcode, EAN, SKU, or an 8–14 digit code next to each item), the extraction captures it into a dedicated field. Never invented when absent.
- **Structured Outputs** (Claude's constrained JSON schema decoding) guarantee syntactically valid JSON on every extraction call — no more "hope the model didn't wrap it in markdown" parsing
- **Prompt caching** on the system prompt for materially lower cost/latency on sequential extraction calls (e.g. a multi-file or multi-page upload processed as several requests)
- **Per-field confidence with evidence** — `name`, `price`, and `description` are each scored independently as `high`/`low`, and a `low` field carries a short explanation of *why* (e.g. "could be 4.50 or 14.50", "cut off at the edge of the photo") rather than just a flag
- **Generic vendor URL extraction** (HTML fetch → Claude) as a fallback for non-Wolt/Box sites — **not yet tested against a real standalone vendor site** (no suitable sample found so far); treat as unverified, not as either working or broken
- **Apply Changes** — a free-text box where you describe follow-up edits in plain language ("change the price of X to €8, add a new category Y") against an *already-extracted* catalog. The whole current catalog JSON plus your instructions go to Claude in one request, and it returns the full revised catalog in the same schema. Undo-able like any other action.

### Extraction reliability engineering

- **Smart text chunking** for large pasted/imported text: splits first on natural file boundaries (`[File: ...]` / `[Αρχείο: ...]` markers from multi-file uploads), then enforces both a character limit (60k) *and* a line-count limit (80 lines) per chunk — because many short lines (a long product list) can blow the output budget even when the character count looks small. Also strips legacy `.xls` export footer lines (`N=494,,,`) that would otherwise confuse the model, and splits any single oversized line.
- **Cross-chunk category merging** — when a large file is split into multiple requests, each chunk is extracted independently and can produce the same category name more than once; these are merged back together (case-insensitive) before deduplication runs
- **Real cancellation** — the Cancel button calls `AbortController.abort()` on the in-flight request, not just "ignore the result." Whatever chunks already completed before cancelling are kept.
- **Image resizing before upload** — images over 1600px on the long edge are downscaled and re-encoded as JPEG (quality 0.85) via canvas; images already under that size are sent with their original format untouched
- **Byte-level duplicate detection** — before adding a file, its base64 content is compared against everything already staged; an exact match prompts a confirmation dialog instead of silently double-processing the same file

### Data quality validation

Every extracted item is run through a validation pass before review, surfacing issues rather than trusting the extraction silently:

- **Category-relative price outliers** — flags an item priced more than 5× or less than 0.2× the *median price within its own category* (falls back to a flat >€80 threshold only when the category has fewer than 3 priced items to build a median from)
- Missing price (error) / zero price (warning)
- Option groups where every option has a zero price delta (likely missed pricing)
- Per-field low-confidence flags, with the specific field(s) named
- **Mixed-script heuristic** for likely OCR errors — flags a single token that mixes Latin and Greek characters (e.g. "Beefάκι"), while correctly ignoring legitimate mixed-language names ("Mini κεφτεδάκια", separate words)

### Review UI

- Tree-style category/item view with inline editing — text fields never re-render on keystroke, so there's no focus loss while typing
- Category deduplication (exact-match removal within a category; fuzzy cross-category flagging via Jaccard similarity on tokenized names, weighted to treat differing numeric tokens like "1.5kg" vs "3kg" as different products even when the rest of the name matches)
- Manual category-merge tool, and a JSON-based "+ Add Items" merge (upload a second catalog JSON; matching category names get their items appended, new ones get added, then dedup runs again)
- "Accept All" marks every item with no low-confidence fields as reviewed in one click; a filter menu isolates unresolved items
- Keyboard shortcuts: `Esc` closes the filter menu, `Ctrl+Z` undoes the last action (disabled while a text field is focused, so it doesn't fight native text-undo), `Ctrl+Enter` saves when the results view is open
- Undo/history stack — every destructive action (delete, merge, overwrite) is reversible
- Options/option-group editor per item
- Barcode/EAN field per item — editable text field, pre-filled by the AI's GTIN capture when the source had one. Persisted to the database (`items.gtin`) and round-trips correctly on save/load. **Not a lookup** — see the separate standalone Barcode Lookup tool for reverse barcode search.
- "Barcode only" filter and export — pulls just `{name, barcode}` pairs for downstream use
- Session browser — lists the last 50 saved sessions from Supabase with store name, timestamp, and status
- Full bilingual UI (Greek/English)

### Data & persistence

- **Duplicate store detection on save.** Before creating a brand-new session, the tool checks for an existing session with the same store name (case-insensitive exact match) and, if found, shows a diff — new / removed / price-changed / unchanged item counts, with a capped preview list per category — before letting you choose: overwrite the existing session, save as a genuinely separate new one, or cancel. A fresh, never-saved-before store skips the check entirely.

- Sessions stored in Supabase (Postgres): `sessions → categories → items → option_groups → options`
- Export to JSON at any point
- Reviewer corrections are captured as override data on every save: the tool diffs the final catalog against the original AI extraction, and for any `name`/`price`/`description` field that started as `confidence:"low"` and was subsequently edited, logs `{store_name, field_name, original_value, corrected_value}` to a `field_overrides` table. This produces a running record of "what the AI got wrong vs. what the human corrected," intended to eventually drive automated prompt improvement. Logging is fail-soft — a failed write never blocks the save itself.

---

## How it fits with the rest of the ecosystem

Catalog Autofill is one of three tools that share a common JSON catalog contract:

| Tool | Role |
|---|---|
| **Catalog Autofill** (this repo) | Review UI — turns raw material into a structured, human-approved catalog |
| **efood Catalog Scraper** (Chrome extension) | Reads Wolt/Box menus directly through their own APIs. Invoked live from inside Catalog Autofill: entering a Wolt/Box URL opens that store's page in a new tab, the extension scrapes it, and the result is handed back via a local polling handshake — or its JSON output can be uploaded manually as a fallback. |
| **Barcode Lookup** | Standalone tool that does the *actual* reverse barcode search (Open Food/Beauty/Products Facts, UPCitemdb, fuzzy matching, AI disambiguation) against a catalog JSON, and can feed the enriched result back in. Distinct from the GTIN field Catalog Autofill captures directly from source material when a code is already present. |

They're independently deployed but interoperable purely through a shared JSON schema — no tight coupling.

---

## Architecture

```
┌──────────────────────┐        ┌────────────────────────────┐
│  catalog_autofill      │◄──────►│  efood Catalog Scraper       │
│  .html (GitHub Pages)  │  local │  (Chrome extension)          │
│  static HTML, no build │Storage │  reads Wolt/Box APIs directly │
└───────────┬─────────────┘ handoff └────────────────────────────┘
            │ images / PDF / text / generic URL / apply-changes prompt
            ▼
┌──────────────────────────────┐
│ Supabase Edge Function          │  Deno runtime, server-side proxy
│ `extract-catalog`               │  keeps the Anthropic API key secret
└───────────┬──────────────────┘
            │
    Claude API (claude-sonnet-4-6)
    · Structured Outputs (guaranteed valid JSON)
    · prompt caching on system prompt
    · native PDF document blocks
    · per-field confidence + evidence
            │
            ▼
    structured catalog JSON
            │
            ▼
    Supabase Postgres (sessions → categories → items → option_groups → options)
```

The Edge Function also still contains a direct Wolt-API fetch path (bypassing Claude entirely) from an earlier iteration, before the extension-based handoff existed. The current frontend no longer routes Wolt/Box URLs to it — worth confirming whether to keep it as a documented fallback or remove it as dead code.

---

## Tech stack

- **Frontend:** single-file static HTML + vanilla JavaScript. No build tooling, no framework — deliberately, since deployment is manual (upload the file to GitHub Pages) and the team has no CLI experience.
- **Backend:** Supabase — Postgres for storage, Edge Functions (Deno/TypeScript) as a server-side proxy so the Anthropic API key never reaches the browser.
- **AI:** Claude API (`claude-sonnet-4-6`), invoked only for unstructured input, using Structured Outputs and prompt caching.
- **Companion:** a Chrome extension (separate repo) that reads Wolt/Box menus through their own APIs and hands results back to this tool.
- **Hosting:** GitHub Pages (frontend), Supabase (backend), deployed manually via each platform's browser UI.

---

## Data model

```
sessions
  └─ categories → items → option_groups → options
```

The live schema has evolved past the original migration file via ad hoc `ALTER TABLE` changes (e.g. a `fields` jsonb column per item for per-field confidence) — treat the schema file as a starting point, not the current source of truth; check the live Supabase schema directly when precision matters.

Note the QC/retail-specific structures described in Anthropic-facing project notes (`qc_categories`, `qc_items`, a `type` field on sessions, `printed_name`, VAT, weight-based pricing) are **not present in the live schema or frontend** — they remain planned, not built.

---

## Setup

1. **Supabase project** — create one, run the schema migration, deploy the `extract-catalog` Edge Function (`supabase functions deploy extract-catalog`), and set the `ANTHROPIC_API_KEY` secret.
2. **Frontend config** — set `SUPABASE_URL` and the Supabase anon key at the top of `catalog_autofill.html`.
3. **Deploy** — push `catalog_autofill.html` to GitHub Pages. No build step required.
4. **(Optional) Companion extension** — install the efood Catalog Scraper Chrome extension for live Wolt/Box extraction; without it, Wolt/Box URLs can only be handled by manually uploading a JSON export from the extension.

There is currently a static shared password gate rather than per-user authentication — access control is on the roadmap (see below).

---

## Known limitations / roadmap

- **Generic (non-Wolt/Box) URL extraction is unverified**, not confirmed broken — it has not yet been tried against a real standalone vendor site, only Wolt/Box and file/text uploads have real-world usage. Treat results with skepticism until tested, particularly on JavaScript-heavy sites (the HTML-fetch approach can only see server-rendered content).
- **Dead code review needed:** the Edge Function's direct Wolt-API fetch path is no longer called by the current frontend (Wolt/Box now goes through the companion extension instead) — decide whether to keep it as a documented fallback or remove it.
- **Supabase auto-pause (free tier):** if the project sits idle, the free tier pauses it automatically. Everything touching the backend then fails with a generic browser `Failed to fetch` error, indistinguishable at a glance from a real network/CORS bug. **Check the Supabase dashboard first** before debugging any "Failed to fetch" report.
- **Auth:** single shared password, no per-reviewer accounts yet. Planned: Supabase Auth (email/password or magic link), one access level, `user_id` on every session.
- **Concurrency:** no conflict detection between simultaneous edits to the same session — last save wins.
- **QC/retail mode:** a distinct session type for pharmacies, supermarkets, butchers etc. — with VAT, printed name, and weight-based pricing fields — is planned but not built; the schema and UI currently only model restaurant-style catalogs.
- **Retail POS intake:** for retail partners already running third-party POS/ordering systems, direct structured export (CSV/Excel/JSON) is being explored as an alternative to AI extraction — structured feed first, AI fallback second, same principle as the Wolt/Box handoff.

---

## Design principles

- **Preserve information deterministically, interpret semantics probabilistically.** Lossless extraction first; semantic judgment calls are made exclusively by the LLM, not hardcoded in scraping/parsing logic.
- **Never lose information silently.** Ambiguous or partial data is surfaced with a confidence flag and evidence, not dropped or guessed away.
- **Structured sources skip the AI.** If a platform's own API can answer the question deterministically, the LLM is never in the loop for that data.