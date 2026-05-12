# Project Memory: Physics Papers Hub

Last updated: 2026-05-12
Workspace: `D:\Users\Jay\Desktop\Paper_Tracker`

## Conversation Memory (Latest)

- The project started as a Next.js + TypeScript public paper aggregator for physics papers.
- You requested robust source-level soft refresh cache semantics to avoid large result fluctuation when some sources fail.
- We introduced source status visibility (`success`, `stale cache`, `failed no cache`, `partial data`) and clearer warning semantics.
- You repeatedly reported two practical issues:
  - Nature Physics often showed 0 articles.
  - New Journal of Physics often showed 0 articles.
- Latest source expansion added PRX and PRX Quantum using APS RSS plus Crossref fallback ISSNs.
- Latest UI expansion added a left sidebar with three views:
  - Physics Papers Hub
  - Weekly Source Trends
  - Favorites
- Latest interaction polish added a Back to Top button and homepage scroll restoration when moving between sidebar views.

## Root Causes and Fixes Applied

### 1) Nature Physics zero results

Root cause:

- Nature RSS feed format can be RDF RSS 1.0 (`rdf:RDF`), but parser initially only consumed RSS 2.0/Atom paths.

Fix:

- `lib/fetchers/rss.ts` now extracts items from:
  - `rss.channel.item`
  - `rdf:RDF.item`
  - `feed.entry`
- Added `fallbackCrossrefIssn: 1745-2473` for `nature-physics` in `sources.json`.

### 2) New Journal of Physics zero results

Root cause:

- NJP configured as Crossref-only could return empty within specific windows despite official feed having recent entries.

Fix:

- Switched `new-journal-of-physics` to official IOP RSS:
  - `https://iopscience.iop.org/journal/rss/1367-2630`
- Kept Crossref fallback:
  - `fallbackCrossrefIssn: 1367-2630`

## Current Functional Baseline

- UTC-consistent 7-day window per refresh attempt.
- User-selectable display window over the cached 7-day baseline:
  - past 7 UTC days
  - past 3 UTC days
  - past 1 UTC day
- Switchable Light/Dark Quantum Background:
  - CSS gradients, subtle wave/circuit/node decorations, and theme variables
  - No change to crawler/API/search/filtering logic
- Sidebar navigation:
  - fixed left sidebar on desktop
  - mobile hamburger menu with overlay
  - all views keep the existing light/dark quantum background
- Weekly Source Trends:
  - data comes from `sourceDailyCounts` in the existing aggregate/cache response
  - counts cached source articles per UTC day for the current 7-day window
  - `arxiv-quant-ph` is plotted in its own chart
  - all non-arXiv journal sources are plotted in a separate chart with an independent integer y-axis scale
  - does not trigger new external API requests
- Favorites:
  - local-only minimal implementation using browser `localStorage`
  - storage key: `physics-paper-hub-favorites`
  - paper cards show Save/Saved, and Favorites displays only saved papers
- Reading-position UX:
  - Back to Top appears after 300px of page scroll
  - homepage scroll is saved separately in `sessionStorage`
  - storage key: `physics-paper-hub-home-scroll-y`
  - switching from Favorites or Weekly Source Trends back to the home view restores the previous homepage scroll position
- Stable dedupe and deterministic sorting.
- Source-level soft refresh with stale cache retention on failure.
- PRX and PRX Quantum are configured like the other APS journals:
  - PRX: APS RSS + Crossref fallback ISSN `2160-3308`
  - PRX Quantum: APS RSS + Crossref fallback ISSN `2691-3399`
- Search scope filter by field (all/title/authors/abstract).
- Missing metadata is explicitly labeled in UI instead of silently dropping records.
- Abstract extraction is now centralized in `lib/abstract.ts`:
  - cleans "Abstract/Summary/Background" prefixes and common HTML/entity noise
  - reads JSON-LD description/abstract, `citation_abstract`, `description`, `og:description`, `dc.description`, and abstract-like containers
  - enriches DOI records through Crossref, OpenAlex, Semantic Scholar, then publisher/DOI landing pages
  - logs `[abstract-debug]` in development with matched strategy and failure reason

## Interpretation Guide

- `source_returned_empty`:
  - Upstream returned no papers in current UTC 7-day window.
  - Not necessarily a local parsing/fetch failure.
- `partial_data`:
  - Papers exist but a share of records lacks abstract/authors from upstream metadata.
- `GET /api/papers?days=7|3|1`:
  - Narrows displayed/API-returned papers by UTC day window.
  - Does not change the 7-day refresh/cache baseline.

## Open Risk Notes

- Upstream metadata quality is uneven.
- Even after enrichment, some papers may still have no abstract.
- In-memory cache is instance-local; serverless cold starts lose cache.
- Direct publisher pages can still return 403/429 or JavaScript-only content, but those failures are isolated and should fall back to metadata APIs when possible.

## Suggested Next Actions

1. Optional "7-day empty -> auto-check 14-day" mode with clear badge.
2. Persistent distributed cache for deployment stability.
3. Add small e2e regression tests for RDF feeds, sidebar navigation, favorites persistence, and source window edge cases.
