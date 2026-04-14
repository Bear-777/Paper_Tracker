# Agent Context: Physics Papers Hub

Last updated: 2026-04-10
Workspace: `D:\Users\Jay\Desktop\paper`

## 1) Project Goal

Build a public-ready paper aggregation website using Next.js + TypeScript for recent physics papers (last 7 days), with multi-source ingestion, filtering, search, sorting, and server-side refresh/cache.

## 2) Tech Stack

- Next.js 14 (App Router)
- TypeScript
- React 18
- `fast-xml-parser` for RSS/arXiv XML parsing
- Server-side fetch + in-memory cache (Node runtime APIs)

## 3) Current Feature Status

Implemented:

- Home page listing papers from last 7 days
- Multi-source ingestion:
  - arXiv (`export.arxiv.org/api/query`)
  - Journal RSS feeds
  - Crossref REST API
- Source filtering (checkboxes)
- Keyword search (title, abstract, authors)
- Sort by publication time
- Paper card fields:
  - title
  - authors
  - abstract
  - source
  - publication date
  - DOI or arXiv ID
- `POST /api/refresh` endpoint for server-side refresh + cache update
- Fetching logic split into modular fetchers
- Source configuration in `sources.json`
- De-duplication across sources (DOI/arXiv/title+author+day fallback)
- Vercel-oriented project structure/config

## 4) Key Files

- App/UI:
  - `app/page.tsx`
  - `components/paper-dashboard.tsx`
  - `app/globals.css`
- APIs:
  - `app/api/papers/route.ts`
  - `app/api/refresh/route.ts`
- Data pipeline:
  - `lib/paper-service.ts`
  - `lib/cache.ts`
  - `lib/dedupe.ts`
  - `lib/sources.ts`
  - `lib/types.ts`
  - `lib/utils.ts`
  - `lib/http.ts`
- Fetchers:
  - `lib/fetchers/arxiv.ts`
  - `lib/fetchers/rss.ts`
  - `lib/fetchers/crossref.ts`
  - `lib/fetchers/openalex.ts`
  - `lib/fetchers/index.ts`
- Config:
  - `sources.json`
  - `.env.example`
  - `next.config.mjs`
  - `vercel.json`

## 5) Source Strategy

`sources.json` controls enabled sources.

Current selected source labels include:

- arXiv quant-ph
- PRL
- PRA
- Nature Physics
- Physical Review Research
- Communications Physics
- New Journal of Physics
- Journal of Physics A

For some RSS sources (especially APS), `fallbackCrossrefIssn` is configured:

- If RSS fails or returns no data, Crossref is used as fallback.

## 6) Metadata Enrichment Logic

For RSS sources with weak metadata quality:

1. Pull RSS + Crossref (ISSN) in parallel.
2. Merge by DOI first, and by normalized title as fallback.
3. If paper still has missing abstract/authors or dirty title:
   - Query Crossref by DOI (`/works/{doi}`)
   - Then fallback to OpenAlex by DOI if still incomplete.
4. Title/abstract cleanup:
   - strip XML/HTML tags (including MathML fragments)
   - decode common entities

## 7) Time Window Behavior

- Unified time filter: last 7 calendar days (UTC-based boundary logic).
- Crossref query uses `from-pub-date` derived from that window.

## 8) Cache Behavior

- In-memory cache in `globalThis`
- TTL controlled by `CACHE_TTL_MS` (default 30 min)
- `POST /api/refresh` forces refresh
- Optional `REFRESH_TOKEN` bearer auth for refresh endpoint

## 9) Environment Variables

See `.env.example`.

- `CROSSREF_MAILTO`
- `OPENALEX_MAILTO`
- `CACHE_TTL_MS`
- `REQUEST_TIMEOUT_MS`
- `REFRESH_TOKEN`

## 10) Known Issues / Reality Check

- Some papers may still show "No abstract available." when upstream providers do not expose abstracts.
- APS/other publisher feeds may be unstable or incomplete at times.
- Upstream metadata consistency (DOI variants, title formatting) is not guaranteed.
- In serverless environments, memory cache is per warm instance.

## 11) Local Run

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

If `.env.local` does not exist, copy from `.env.example` first.

## 12) Suggested Next Improvements

1. Add structured source-level metrics (count per source, success/failure reason).
2. Persist cache in Redis/Upstash for multi-instance consistency.
3. Add retry/backoff and per-source rate limiting.
4. Add scheduled refresh (cron on Vercel).
5. Add e2e checks for parser regressions (RSS variants, MathML-heavy titles).
