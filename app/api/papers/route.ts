import { NextResponse } from "next/server";

import { getPaperCache } from "@/lib/cache";
import { SOURCE_OPTIONS } from "@/lib/sources";
import type { Paper } from "@/lib/types";

export const runtime = "nodejs";
type SearchField = "all" | "title" | "authors" | "abstract";

function parseSourceFilter(raw: string | null): Set<string> | null {
  if (!raw) {
    return null;
  }

  const ids = raw
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  return ids.length > 0 ? new Set(ids) : null;
}

function parseSearchField(raw: string | null): SearchField {
  if (raw === "title" || raw === "authors" || raw === "abstract") {
    return raw;
  }

  return "all";
}

function paperMatchesQuery(paper: Paper, query: string, field: SearchField): boolean {
  const normalizedQuery = query.toLowerCase();
  const searchableByField: Record<SearchField, string> = {
    all: `${paper.title}\n${paper.abstract}\n${paper.authors.join(" ")}`,
    title: paper.title,
    authors: paper.authors.join(" "),
    abstract: paper.abstract
  };
  const searchable = searchableByField[field].toLowerCase();

  return searchable.includes(normalizedQuery);
}

export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const sourceFilter = parseSourceFilter(searchParams.get("source"));
  const query = searchParams.get("q")?.trim() ?? "";
  const searchField = parseSearchField(searchParams.get("field"));
  const sort = searchParams.get("sort") === "asc" ? "asc" : "desc";
  const cache = await getPaperCache();
  let papers = [...cache.papers];

  if (sourceFilter) {
    papers = papers.filter((paper) => sourceFilter.has(paper.sourceId));
  }

  if (query) {
    papers = papers.filter((paper) => paperMatchesQuery(paper, query, searchField));
  }

  papers.sort((left, right) => {
    const direction = sort === "asc" ? 1 : -1;

    return direction * (new Date(left.publishedAt).getTime() - new Date(right.publishedAt).getTime());
  });

  return NextResponse.json({
    updatedAt: cache.updatedAt,
    total: papers.length,
    searchField,
    papers,
    sourceErrors: cache.sourceErrors,
    sources: SOURCE_OPTIONS
  });
}
