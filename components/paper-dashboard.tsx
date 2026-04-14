"use client";

import { useMemo, useState } from "react";

import type { Paper, SourceError } from "@/lib/types";

type SortOrder = "desc" | "asc";
type SearchScope = "all" | "title" | "authors" | "abstract";

interface SourceOption {
  id: string;
  label: string;
}

interface PaperDashboardProps {
  initialPapers: Paper[];
  initialUpdatedAt: string;
  initialSourceErrors: SourceError[];
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

export default function PaperDashboard(props: PaperDashboardProps): JSX.Element {
  const { initialPapers, initialUpdatedAt, initialSourceErrors, sources } = props;
  const [papers, setPapers] = useState<Paper[]>(initialPapers);
  const [updatedAt, setUpdatedAt] = useState(initialUpdatedAt);
  const [sourceErrors, setSourceErrors] = useState<SourceError[]>(initialSourceErrors);
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

        return direction * (new Date(left.publishedAt).getTime() - new Date(right.publishedAt).getTime());
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
        sourceErrors?: SourceError[];
        error?: string;
      };

      if (!response.ok) {
        setStatusText(payload.error ?? "Refresh failed.");
        return;
      }

      setPapers(payload.papers ?? []);
      setUpdatedAt(payload.updatedAt ?? new Date().toISOString());
      setSourceErrors(payload.sourceErrors ?? []);
      setStatusText("Data refreshed.");
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : "Refresh failed.");
    } finally {
      setIsRefreshing(false);
    }
  }

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
          <p>Last updated: {formatDate(updatedAt)}</p>
          <p>
            Showing {filteredPapers.length} / {papers.length} papers
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

      {sourceErrors.length > 0 ? (
        <section className="card warning-card">
          <h2>Source fetch warnings</h2>
          <ul>
            {sourceErrors.map((error) => (
              <li key={`${error.sourceId}-${error.message}`}>
                <strong>{error.sourceLabel}:</strong> {error.message}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="paper-list">
        {filteredPapers.map((paper) => {
          const identifier = pickIdentifier(paper);

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

              <p className="authors">{paper.authors.length > 0 ? paper.authors.join(", ") : "Authors unavailable"}</p>
              <p className="abstract">{paper.abstract || "No abstract available."}</p>

              {identifier ? (
                <p className="identifier">
                  {identifier.label}:{" "}
                  <a href={identifier.href} target="_blank" rel="noreferrer">
                    {identifier.value}
                  </a>
                </p>
              ) : null}
            </article>
          );
        })}
      </section>
    </main>
  );
}
