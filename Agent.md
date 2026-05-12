# Agent Context: Physics Papers Hub

Last updated: 2026-05-11
Workspace: `D:\Users\Jay\Desktop\Paper_Tracker`

## 1) Project Goal

Public-ready paper aggregation website (Next.js + TypeScript) for physics papers in a unified UTC 7-day window, with reliable multi-source refresh and stable output.

## 2) Tech Stack

- Next.js 14 (App Router)
- TypeScript + React 18
- `fast-xml-parser` for XML feeds
- Server-side Node runtime fetch pipeline
- In-memory source-level cache

## 3) Current Implemented Features

- Multi-source ingestion:
  - arXiv API
  - RSS journals
  - Crossref REST for fallback/source types
- UI:
  - fixed desktop sidebar and mobile hamburger navigation:
    - Physics Papers Hub
    - Weekly Source Trends
    - Favorites
  - source multi-select filter
  - keyword search with scope selection:
    - all
    - title
    - authors
    - abstract
  - sort by published time
  - display time window selector:
    - past 7 UTC days
    - past 3 UTC days
    - past 1 UTC day
  - Light/Dark Quantum Background toggle:
    - CSS-only quantum-inspired background decorations
    - persisted in localStorage
  - Weekly Source Trends view:
    - reads `sourceDailyCounts` from the server response
    - displays per-source daily article counts across the current 7-day UTC cache window
    - uses cached source articles only; no extra external API calls
  - Favorites view:
    - paper cards have a Save/Saved toggle
    - saved papers persist in browser `localStorage` under `physics-paper-hub-favorites`
  - source status cards + warnings
- Data quality:
  - dedupe priority: DOI > arXiv ID > canonical URL > normalized title fallback
  - stable sort: published desc, source asc, title asc
  - DOI metadata enrichment via Crossref + OpenAlex + Semantic Scholar
  - publisher/DOI landing-page abstract fallback via JSON-LD, meta tags, Dublin Core, Open Graph, and common abstract containers
  - short DOI canonicalization for APS cases
  - malformed title cleanup (HTML/MathML stripping)

## 4) Refresh and Cache Model

- Source-level independent cache record per source:
  - `articles`
  - `lastSuccessAt`
  - `lastAttemptAt`
  - `lastError`
  - `sourceStatus`
  - `usingStaleCache`
- Soft refresh behavior:
  - source success -> replace only this source cache
  - source fail + previous cache -> keep stale cache
  - source fail + no cache -> `failed_no_cache`
- Fetch/cache baseline remains a UTC 7-day window; the 3-day and 1-day options are display/API filters over cached 7-day data.
- Weekly trend counts are computed from the same per-source cached `articles` arrays before UI rendering.
- Request robustness:
  - timeout
  - retries
  - exponential backoff
  - concurrency control
  - explicit User-Agent

## 5) Current Sources and Key Notes

From `sources.json`:

- arXiv quant-ph (arXiv API)
- PRL (RSS + Crossref fallback ISSN)
- PRA (RSS + Crossref fallback ISSN)
- PRX (APS RSS + Crossref fallback ISSN: `2160-3308`)
- PRX Quantum (APS RSS + Crossref fallback ISSN: `2691-3399`)
- Physical Review Research (RSS + Crossref fallback ISSN)
- Communications Physics (RSS + Crossref fallback ISSN)
- Nature Physics (RSS + Crossref fallback ISSN: `1745-2473`)
- New Journal of Physics (official IOP RSS + Crossref fallback ISSN: `1367-2630`)
- Journal of Physics A (Crossref)

Important parser detail:

- RSS fetcher supports RSS 2.0, Atom, and RDF RSS 1.0 (`rdf:RDF`).
- This specifically fixed the "Nature Physics always 0" parsing issue.

## 6) Operational Interpretation

- `source_returned_empty` means no papers in current UTC 7-day window from upstream for this attempt.
- It is not necessarily a local error.
- `partial_data` means fetched records are present, but a noticeable share lacks abstract/authors from upstream metadata.
- UI and `GET /api/papers?days=7|3|1` can narrow displayed papers to shorter UTC windows without changing refresh semantics.
- Missing abstracts should not fail the paper item. The enrichment order is source field -> Crossref DOI -> OpenAlex DOI -> Semantic Scholar DOI -> publisher/DOI landing page HTML.
- Development logs use `[abstract-debug]` and include strategy, URL/final URL, status code, and failure reason. Production stays quiet unless `ABSTRACT_DEBUG=1`.

## 7) Files Most Relevant for Future Work

- UI:
  - `app/page.tsx`
  - `components/paper-dashboard.tsx`
- API:
  - `app/api/papers/route.ts`
  - `app/api/refresh/route.ts`
- Pipeline:
  - `lib/cache.ts`
  - `lib/fetchers/index.ts`
  - `lib/fetchers/rss.ts`
  - `lib/fetchers/crossref.ts`
  - `lib/fetchers/openalex.ts`
  - `lib/http.ts`
  - `lib/utils.ts`
  - `lib/dedupe.ts`
  - `lib/types.ts`
  - `lib/sources.ts`
  - `sources.json`

## 8) Known Constraints

- Some upstream feeds/APIs do not include full abstracts/authors.
- Crossref availability and freshness vary by journal and time.
- In-memory cache is per-process/per-instance, not globally persistent.

## 9) Recommended Next Improvements

1. Add optional "fallback to 14-day view when 7-day is empty" with clear label.
2. Add persistent cache (Redis/Upstash) for multi-instance consistency.
3. Add structured health endpoint and persisted source metrics history.
4. Add regression tests for RDF feed parsing and time-window edge cases.
