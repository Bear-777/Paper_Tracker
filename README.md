# Physics Papers Hub (Next.js + TypeScript)

A public-ready physics paper aggregation site focused on a consistent UTC 7-day window across arXiv and selected journals.

## Core Features

- Home page shows papers from the latest 7-day UTC window.
- Multi-source ingestion (official APIs/RSS first):
  - arXiv API (`export.arxiv.org/api/query`)
  - Journal RSS feeds
  - Crossref REST fallback by ISSN when configured
- Source filter (checkboxes):
  - arXiv quant-ph
  - PRL
  - PRA
  - Nature Physics
  - Physical Review Research
  - Communications Physics
  - New Journal of Physics
  - Journal of Physics A
- Keyword search scope selector:
  - Title + authors + abstract
  - Title only
  - Authors only
  - Abstract only
- Sort by publication time (newest/oldest).
- Each paper card shows title, authors, abstract, source, date, DOI/arXiv ID, and missing metadata hints.
- `POST /api/refresh` soft refresh with source-level independent cache.
- Source status panel:
  - `success`
  - `stale cache`
  - `failed no cache`
  - `partial data`
- Stable dedupe + stable sorting.

## Latest Stability Improvements

- Source-level independent cache (`articles`, `lastSuccessAt`, `lastAttemptAt`, `lastError`, `sourceStatus`).
- Soft refresh: failed source keeps previous successful data.
- Request timeout/retry/backoff/concurrency/User-Agent.
- Unified UTC refresh timestamp for all sources in one refresh cycle.
- Better source warning/error classification.
- Metadata enrichment via DOI (Crossref + OpenAlex) to improve missing abstract/authors and clean malformed titles.
- RSS parser now supports RSS 2.0, Atom, and RDF RSS 1.0 (`rdf:RDF`).
  - This is important for Nature-family and IOP feeds.

## Current Source Configuration Notes

Configured in [`sources.json`](./sources.json):

- `nature-physics` uses RSS + Crossref fallback:
  - RSS: `https://www.nature.com/nphys.rss`
  - fallback ISSN: `1745-2473`
- `new-journal-of-physics` uses official IOP RSS + Crossref fallback:
  - RSS: `https://iopscience.iop.org/journal/rss/1367-2630`
  - fallback ISSN: `1367-2630`

This avoids frequent zero-result fluctuation caused by using Crossref-only for NJP.

## Project Structure

```text
.
|- app/
|  |- api/
|  |  |- papers/route.ts
|  |  |- refresh/route.ts
|  |- globals.css
|  |- layout.tsx
|  |- page.tsx
|- components/
|  |- paper-dashboard.tsx
|- lib/
|  |- fetchers/
|  |  |- arxiv.ts
|  |  |- crossref.ts
|  |  |- doi-resolver.ts
|  |  |- index.ts
|  |  |- openalex.ts
|  |  |- rss.ts
|  |- cache.ts
|  |- dedupe.ts
|  |- errors.ts
|  |- http.ts
|  |- paper-service.ts
|  |- sources.ts
|  |- types.ts
|  |- utils.ts
|- sources.json
|- .env.example
|- package.json
|- next.config.mjs
|- vercel.json
```

## Install and Run

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Production:

```bash
npm run build
npm run start
```

## Environment Variables

Copy `.env.example` to `.env.local`.

```bash
# macOS/Linux
cp .env.example .env.local

# PowerShell
Copy-Item .env.example .env.local
```

Main vars:

- `CROSSREF_MAILTO`
- `OPENALEX_MAILTO`
- `CACHE_TTL_MS`
- `REQUEST_TIMEOUT_MS`
- `REQUEST_MAX_RETRIES`
- `REQUEST_BACKOFF_BASE_MS`
- `REQUEST_USER_AGENT`
- `SOURCE_REFRESH_CONCURRENCY`
- `METADATA_ENRICH_CONCURRENCY`
- `REFRESH_TOKEN` (optional)

## API

### `GET /api/papers`

Query params:

- `source=prl,pra`
- `q=quantum`
- `field=all|title|authors|abstract`
- `sort=desc|asc`

Response includes:

- `papers`
- `sourceViews`
- `lastSuccessfulRefreshAt`
- `currentRefreshAttemptAt`
- `totalBeforeDedupe`

### `POST /api/refresh`

- Soft refresh all sources.
- Successful sources overwrite their own cache.
- Failed sources keep stale cache if available.
- If `REFRESH_TOKEN` is set, call with:
  - `Authorization: Bearer <REFRESH_TOKEN>`

## Dedupe and Ordering

Dedupe priority:

1. DOI
2. arXiv ID
3. canonical URL
4. normalized title fallback

Stable ordering:

1. `publishedAt desc`
2. `sourceLabel asc`
3. `title asc`

## Expected "0 articles" Cases

If a source has no papers in the current UTC 7-day window, `articles: 0` can be valid.

Check source status and warning text:

- `source_returned_empty`: upstream returned no papers in that window (not a local crash).
- `failed no cache`: source failed and has no prior cache.
- `stale cache`: source failed now but prior cache is kept.

## Vercel Deployment

1. Push repo to GitHub.
2. Import into Vercel.
3. Configure env vars (at least `CROSSREF_MAILTO`; optional `REFRESH_TOKEN`).
4. Deploy with default Next.js settings.

## Notes

- This project avoids direct HTML scraping by design.
- In-memory cache is per running instance. On serverless restarts, cache is rebuilt by next refresh.
