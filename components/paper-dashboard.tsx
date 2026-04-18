"use client";

import { useMemo, useState } from "react";

import type { Paper, SourceView } from "@/lib/types";

type SortOrder = "desc" | "asc";
type SearchScope = "all" | "title" | "authors" | "abstract";

interface SourceOption {
  id: string;
  label: string;
}

interface PaperDashboardProps {
  initialPapers: Paper[];
  initialUpdatedAt: string;
  initialCurrentRefreshAttemptAt: string;
  initialSourceViews: SourceView[];
  initialTotalBeforeDedupe: number;
  sources: SourceOption[];
}

function formatDate(isoDate: string): string {
  const date = new Date(isoDate);

  if (Number.isNaN(date.getTime())) {
    return isoDate;
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function pickIdentifier(paper: Paper): { label: string; value: string; href: string } | null {
  if (paper.doi) {
    return {
      label: "DOI",
      value: paper.doi,
      href: `https://doi.org/${paper.doi}`
    };
  }

  if (paper.arxivId) {
    return {
      label: "arXiv",
      value: paper.arxivId,
      href: `https://arxiv.org/abs/${paper.arxivId}`
    };
  }

  return null;
}

function getMissingFields(paper: Paper): string[] {
  const missing: string[] = [];

  if (!paper.authors || paper.authors.length === 0) {
    missing.push("authors");
  }

  if (!paper.abstract || paper.abstract.trim().length === 0) {
    missing.push("abstract");
  }

  if (!paper.doi && !paper.arxivId) {
    missing.push("identifier");
  }

  return missing;
}

function sourceStatusLabel(source: SourceView): string {
  if (source.sourceStatus === "stale_cache") {
    return "stale cache";
  }

  if (source.sourceStatus === "failed_no_cache") {
    return "failed no cache";
  }

  if (source.sourceStatus === "partial_data") {
    return "partial data";
  }

  return "success";
}

function errorKindLabel(kind: string | undefined): string {
  if (kind === "source_fetch_failed") {
    return "source fetch failed";
  }

  if (kind === "source_returned_empty") {
    return "no new articles in window";
  }

  if (kind === "source_parsing_failed") {
    return "source parsing failed";
  }

  if (kind === "source_temporarily_unavailable") {
    return "source temporarily unavailable";
  }

  return kind ?? "unknown";
}

function dataModeLabel(source: SourceView): string {
  if (source.sourceStatus === "failed_no_cache") {
    return "no data";
  }

  if (source.usingStaleCache) {
    return "stale cache";
  }

  return "fresh data";
}

export default function PaperDashboard(props: PaperDashboardProps): JSX.Element {
  const {
    initialPapers,
    initialUpdatedAt,
    initialCurrentRefreshAttemptAt,
    initialSourceViews,
    initialTotalBeforeDedupe,
    sources
  } = props;
  const [papers, setPapers] = useState<Paper[]>(initialPapers);
  const [lastSuccessfulRefreshAt, setLastSuccessfulRefreshAt] = useState(initialUpdatedAt);
  const [currentRefreshAttemptAt, setCurrentRefreshAttemptAt] = useState(initialCurrentRefreshAttemptAt);
  const [sourceViews, setSourceViews] = useState<SourceView[]>(initialSourceViews);
  const [totalBeforeDedupe, setTotalBeforeDedupe] = useState(initialTotalBeforeDedupe);
  const [query, setQuery] = useState("");
  const [searchScope, setSearchScope] = useState<SearchScope>("all");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>(sources.map((source) => source.id));
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [statusText, setStatusText] = useState("");

  const filteredPapers = useMemo(() => {
    const sourceSet = new Set(selectedSourceIds);
    const normalizedQuery = query.trim().toLowerCase();

    return papers
      .filter((paper) => sourceSet.has(paper.sourceId))
      .filter((paper) => {
        if (!normalizedQuery) {
          return true;
        }

        const searchableByScope: Record<SearchScope, string> = {
          all: `${paper.title}\n${paper.abstract}\n${paper.authors.join(" ")}`,
          title: paper.title,
          authors: paper.authors.join(" "),
          abstract: paper.abstract
        };
        const searchable = searchableByScope[searchScope].toLowerCase();

        return searchable.includes(normalizedQuery);
      })
      .sort((left, right) => {
        const direction = sortOrder === "asc" ? 1 : -1;
        const publishedDiff = new Date(left.publishedAt).getTime() - new Date(right.publishedAt).getTime();

        if (publishedDiff !== 0) {
          return direction * publishedDiff;
        }

        const sourceDiff = left.sourceLabel.localeCompare(right.sourceLabel);

        if (sourceDiff !== 0) {
          return sourceDiff;
        }

        return left.title.localeCompare(right.title);
      });
  }, [papers, query, searchScope, selectedSourceIds, sortOrder]);

  function toggleSource(id: string): void {
    setSelectedSourceIds((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id]
    );
  }

  function setAllSources(selected: boolean): void {
    setSelectedSourceIds(selected ? sources.map((source) => source.id) : []);
  }

  async function onRefresh(): Promise<void> {
    try {
      setIsRefreshing(true);
      setStatusText("");

      const response = await fetch("/api/refresh", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        }
      });

      const payload = (await response.json()) as {
        papers?: Paper[];
        updatedAt?: string;
        currentRefreshAttemptAt?: string;
        lastSuccessfulRefreshAt?: string;
        sourceViews?: SourceView[];
        totalBeforeDedupe?: number;
        error?: string;
      };

      if (!response.ok) {
        setStatusText(payload.error ?? "Refresh failed.");
        return;
      }

      setPapers(payload.papers ?? []);
      setLastSuccessfulRefreshAt(payload.lastSuccessfulRefreshAt ?? payload.updatedAt ?? new Date().toISOString());
      setCurrentRefreshAttemptAt(payload.currentRefreshAttemptAt ?? new Date().toISOString());
      setSourceViews(payload.sourceViews ?? []);
      setTotalBeforeDedupe(payload.totalBeforeDedupe ?? payload.papers?.length ?? 0);
      setStatusText("Data refreshed.");
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : "Refresh failed.");
    } finally {
      setIsRefreshing(false);
    }
  }

  const warningSources = useMemo(
    () =>
      sourceViews.filter((source) => {
        if (source.sourceStatus !== "stale_cache" && source.sourceStatus !== "failed_no_cache") {
          return false;
        }

        return source.lastError?.kind !== "source_returned_empty";
      }),
    [sourceViews]
  );

  return (
    <main className="page-shell">
      <section className="hero">
        <h1>Physics Papers Hub</h1>
        <p>
          Aggregated papers from the last 7 days across arXiv and selected journals, with source filtering, keyword
          search, and refreshable server-side cache.
        </p>
      </section>

      <section className="controls card">
        <div className="controls-row">
          <label className="field">
            <span>Keyword</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search title, abstract, authors"
            />
          </label>

          <label className="field">
            <span>Search in</span>
            <select value={searchScope} onChange={(event) => setSearchScope(event.target.value as SearchScope)}>
              <option value="all">Title + authors + abstract</option>
              <option value="title">Title only</option>
              <option value="authors">Authors only</option>
              <option value="abstract">Abstract only</option>
            </select>
          </label>

          <label className="field">
            <span>Sort</span>
            <select value={sortOrder} onChange={(event) => setSortOrder(event.target.value as SortOrder)}>
              <option value="desc">Newest first</option>
              <option value="asc">Oldest first</option>
            </select>
          </label>

          <button type="button" className="refresh-button" onClick={onRefresh} disabled={isRefreshing}>
            {isRefreshing ? "Refreshing..." : "Refresh data"}
          </button>
        </div>

        <div className="controls-row info-row">
          <p>Last successful refresh: {lastSuccessfulRefreshAt ? formatDate(lastSuccessfulRefreshAt) : "N/A"}</p>
          <p>Current refresh attempt: {currentRefreshAttemptAt ? formatDate(currentRefreshAttemptAt) : "N/A"}</p>
          <p>
            Showing {filteredPapers.length} / {papers.length} papers (raw: {totalBeforeDedupe})
          </p>
          {statusText ? <p>{statusText}</p> : null}
        </div>

        <fieldset className="source-grid">
          <legend>Sources</legend>
          <div className="source-actions">
            <button type="button" onClick={() => setAllSources(true)}>
              Select all
            </button>
            <button type="button" onClick={() => setAllSources(false)}>
              Clear
            </button>
          </div>
          {sources.map((source) => (
            <label key={source.id} className="source-option">
              <input
                type="checkbox"
                checked={selectedSourceIds.includes(source.id)}
                onChange={() => toggleSource(source.id)}
              />
              <span>{source.label}</span>
            </label>
          ))}
        </fieldset>
      </section>

      <section className="card status-card">
        <h2>Source status</h2>
        <div className="status-grid">
          {sourceViews.map((source) => (
            <article key={source.sourceId} className="status-item">
              <p>
                <strong>{source.sourceLabel}</strong>
              </p>
              <p>Status: {sourceStatusLabel(source)}</p>
              <p>Data mode: {dataModeLabel(source)}</p>
              <p>Articles: {source.articleCount}</p>
              <p>Last success: {source.lastSuccessAt ? formatDate(source.lastSuccessAt) : "N/A"}</p>
              <p>Last attempt: {source.lastAttemptAt ? formatDate(source.lastAttemptAt) : "N/A"}</p>
            </article>
          ))}
        </div>
      </section>

      {warningSources.length > 0 ? (
        <section className="card warning-card">
          <h2>Source warnings</h2>
          <ul>
            {warningSources.map((source) => (
              <li key={`${source.sourceId}-${source.lastError?.message ?? "no-error-message"}`}>
                <strong>{source.sourceLabel}</strong>: {errorKindLabel(source.lastError?.kind)} -{" "}
                {source.lastError?.message ?? "No additional detail"}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="paper-list">
        {filteredPapers.map((paper) => {
          const identifier = pickIdentifier(paper);
          const missingFields = getMissingFields(paper);

          return (
            <article key={paper.id} className="paper-card card">
              <header className="paper-header">
                <h2>
                  <a href={paper.url} target="_blank" rel="noreferrer">
                    {paper.title}
                  </a>
                </h2>
                <p className="meta-line">
                  <span>{paper.sourceLabel}</span>
                  <span>{formatDate(paper.publishedAt)}</span>
                </p>
              </header>

              <p className="authors">
                {paper.authors.length > 0
                  ? paper.authors.join(", ")
                  : "Authors unavailable (upstream source metadata did not provide authors)."}
              </p>
              <p className="abstract">
                {paper.abstract || "Abstract unavailable (upstream source metadata did not provide abstract)."}
              </p>

              {identifier ? (
                <p className="identifier">
                  {identifier.label}:{" "}
                  <a href={identifier.href} target="_blank" rel="noreferrer">
                    {identifier.value}
                  </a>
                </p>
              ) : (
                <p className="identifier">Identifier unavailable (upstream source metadata missing DOI/arXiv ID).</p>
              )}

              {missingFields.length > 0 ? (
                <p className="missing-hint">
                  Missing metadata: {missingFields.join(", ")} (from source feeds/APIs, not local filtering error).
                </p>
              ) : null}
            </article>
          );
        })}
      </section>
    </main>
  );
}
