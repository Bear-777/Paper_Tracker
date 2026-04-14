import crypto from "node:crypto";

import type { FetchedPaper, Paper } from "@/lib/types";
import { normalizeDoi, normalizeWhitespace } from "@/lib/utils";

function normalizeAuthor(author: string | undefined): string {
  if (!author) {
    return "unknown";
  }

  return author.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim() || "unknown";
}

function normalizeTitle(title: string): string {
  return normalizeWhitespace(title.toLowerCase().replace(/[^a-z0-9\s]/g, " "));
}

function dedupeKey(paper: FetchedPaper): string {
  const doi = normalizeDoi(paper.doi);

  if (doi) {
    return `doi:${doi}`;
  }

  if (paper.arxivId) {
    return `arxiv:${paper.arxivId.toLowerCase()}`;
  }

  const firstAuthor = normalizeAuthor(paper.authors[0]);
  const day = paper.publishedAt.slice(0, 10);

  return `title:${normalizeTitle(paper.title)}|author:${firstAuthor}|day:${day}`;
}

function qualityScore(paper: FetchedPaper): number {
  let score = 0;

  if (paper.sourceType !== "crossref") {
    score += 4;
  }

  if (paper.abstract.length > 120) {
    score += 2;
  }

  if (paper.authors.length > 0) {
    score += 1;
  }

  if (paper.doi) {
    score += 1;
  }

  if (paper.arxivId) {
    score += 1;
  }

  return score;
}

function pickBetterPaper(current: FetchedPaper, candidate: FetchedPaper): FetchedPaper {
  const currentScore = qualityScore(current);
  const candidateScore = qualityScore(candidate);

  if (candidateScore > currentScore) {
    return candidate;
  }

  if (candidateScore < currentScore) {
    return current;
  }

  return new Date(candidate.publishedAt).getTime() > new Date(current.publishedAt).getTime()
    ? candidate
    : current;
}

function buildStableId(key: string): string {
  return crypto.createHash("sha1").update(key).digest("hex").slice(0, 16);
}

export function dedupePapers(papers: FetchedPaper[]): Paper[] {
  const map = new Map<string, FetchedPaper>();

  for (const paper of papers) {
    const key = dedupeKey(paper);
    const existing = map.get(key);

    if (!existing) {
      map.set(key, paper);
      continue;
    }

    map.set(key, pickBetterPaper(existing, paper));
  }

  return Array.from(map.entries()).map(([key, paper]) => ({
    ...paper,
    id: buildStableId(key)
  }));
}
