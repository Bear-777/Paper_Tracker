import { NextResponse } from "next/server";

import { getAggregatedPapers } from "@/lib/cache";
import { SOURCE_OPTIONS } from "@/lib/sources";
import type { Paper } from "@/lib/types";
import { isWithinUtcDayWindow } from "@/lib/utils";

export const runtime = "nodejs";
type SearchField = "all" | "title" | "authors" | "abstract";
type TimeWindowDays = 1 | 3 | 7;

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

function parseTimeWindowDays(raw: string | null): TimeWindowDays {
  if (raw === "1" || raw === "3") {
    return Number(raw) as TimeWindowDays;
  }

  return 7;
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

function parseTopicFilter(raw: string | null): Set<string> | null {
  return parseSourceFilter(raw);
}

export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const sourceFilter = parseSourceFilter(searchParams.get("source"));
  const topicFilter = parseTopicFilter(searchParams.get("topic"));
  const classificationStatus = searchParams.get("classificationStatus");
  const query = searchParams.get("q")?.trim() ?? "";
  const searchField = parseSearchField(searchParams.get("field"));
  const sort = searchParams.get("sort") === "asc" ? "asc" : "desc";
  const timeWindowDays = parseTimeWindowDays(searchParams.get("days"));
  const aggregated = await getAggregatedPapers();
  const refreshAnchorMs = new Date(
    aggregated.currentRefreshAttemptAt ?? aggregated.lastSuccessfulRefreshAt ?? Date.now()
  ).getTime();
  let papers = [...aggregated.papers];

  if (!Number.isNaN(refreshAnchorMs)) {
    papers = papers.filter((paper) => isWithinUtcDayWindow(paper.publishedAt, refreshAnchorMs, timeWindowDays));
  }

  if (sourceFilter) {
    papers = papers.filter((paper) => sourceFilter.has(paper.sourceId));
  }

  if (topicFilter) {
    papers = papers.filter((paper) => paper.topics.some((topic) => topicFilter.has(topic.topicId)));
  }

  if (
    classificationStatus === "pending" ||
    classificationStatus === "low_confidence" ||
    classificationStatus === "failed"
  ) {
    papers = papers.filter((paper) => paper.classificationStatus === classificationStatus);
  }

  if (query) {
    papers = papers.filter((paper) => paperMatchesQuery(paper, query, searchField));
  }

  papers.sort((left, right) => {
    const direction = sort === "asc" ? 1 : -1;
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

  return NextResponse.json({
    updatedAt: aggregated.lastSuccessfulRefreshAt,
    currentRefreshAttemptAt: aggregated.currentRefreshAttemptAt,
    lastSuccessfulRefreshAt: aggregated.lastSuccessfulRefreshAt,
    totalBeforeDedupe: aggregated.totalBeforeDedupe,
    total: papers.length,
    searchField,
    timeWindowDays,
    papers,
    sourceViews: aggregated.sourceViews,
    sourceDailyCounts: aggregated.sourceDailyCounts,
    topics: aggregated.topics,
    latestRefreshRun: aggregated.latestRefreshRun,
    nextScheduledRefreshAt: aggregated.nextScheduledRefreshAt,
    persistenceMode: aggregated.persistenceMode,
    sources: SOURCE_OPTIONS
  });
}
