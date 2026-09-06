"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type {
  Paper,
  RefreshRun,
  SourceDailyCount,
  SourceView,
  TopicDefinition
} from "@/lib/types";
import { isWithinUtcDayWindow } from "@/lib/utils";
import { activePaperTopics } from "@/lib/topics";

type SortOrder = "desc" | "asc";
type SearchScope = "all" | "title" | "authors" | "abstract";
type TimeWindowDays = 1 | 3 | 7;
type BackgroundTheme = "light" | "dark";
type ActiveView = "home" | "trends" | "favorites";
type ClassificationFilter = "all" | "uncertain";

const BACKGROUND_THEME_STORAGE_KEY = "physics-paper-hub-background-theme";
const FAVORITES_STORAGE_KEY = "physics-paper-hub-favorites";
const HOME_SCROLL_STORAGE_KEY = "physics-paper-hub-home-scroll-y";
const BACK_TO_TOP_THRESHOLD_PX = 300;
const ARXIV_SOURCE_ID = "arxiv-quant-ph";

const TIME_WINDOW_OPTIONS: { days: TimeWindowDays; label: string }[] = [
  { days: 7, label: "Past 7 UTC days" },
  { days: 3, label: "Past 3 UTC days" },
  { days: 1, label: "Past 1 UTC day" }
];

const NAV_ITEMS: { id: ActiveView; label: string }[] = [
  { id: "home", label: "Physics Papers Hub" },
  { id: "trends", label: "Weekly Source Trends" },
  { id: "favorites", label: "Favorites" }
];

const TREND_COLORS = [
  "#2f6f8f",
  "#7b61a8",
  "#317a5e",
  "#b06c3d",
  "#516fbc",
  "#9a5e7b",
  "#598f9f",
  "#8b7a3d",
  "#5e7190",
  "#9b6f54",
  "#4f8a83",
  "#8067b2"
];

interface SourceOption {
  id: string;
  label: string;
}

interface PaperDashboardProps {
  initialPapers: Paper[];
  initialUpdatedAt: string;
  initialCurrentRefreshAttemptAt: string;
  initialSourceViews: SourceView[];
  initialSourceDailyCounts: SourceDailyCount[];
  initialTotalBeforeDedupe: number;
  initialTopics: TopicDefinition[];
  initialLatestRefreshRun?: RefreshRun;
  initialNextScheduledRefreshAt: string;
  initialPersistenceMode: "postgres" | "memory";
  sources: SourceOption[];
}

interface TrendChartOptions {
  title: string;
  note: string;
  emptyMessage: string;
  ariaLabel: string;
  sources: SourceDailyCount[];
  colorOffset?: number;
  topicColors?: boolean;
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

function getRefreshAnchorMs(currentRefreshAttemptAt: string, lastSuccessfulRefreshAt: string): number {
  const anchor = currentRefreshAttemptAt || lastSuccessfulRefreshAt;
  const parsed = anchor ? new Date(anchor).getTime() : Number.NaN;

  return Number.isNaN(parsed) ? Date.now() : parsed;
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

function parseStoredFavorites(raw: string | null): Record<string, Paper> {
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as unknown;

    if (!Array.isArray(parsed)) {
      return {};
    }

    return parsed.reduce<Record<string, Paper>>((accumulator, item) => {
      if (item && typeof item === "object" && "id" in item) {
        const paper = item as Paper;

        if (typeof paper.id === "string") {
          accumulator[paper.id] = {
            ...paper,
            topics: Array.isArray(paper.topics) ? activePaperTopics(paper.topics) : [],
            classificationStatus: paper.topics?.some((topic) => !activePaperTopics([topic]).length) ? "pending" : paper.classificationStatus ?? "pending"
          };
        }
      }

      return accumulator;
    }, {});
  } catch {
    return {};
  }
}

function sortPapersByDateDesc(left: Paper, right: Paper): number {
  const publishedDiff = new Date(right.publishedAt).getTime() - new Date(left.publishedAt).getTime();

  if (publishedDiff !== 0) {
    return publishedDiff;
  }

  const sourceDiff = left.sourceLabel.localeCompare(right.sourceLabel);

  if (sourceDiff !== 0) {
    return sourceDiff;
  }

  return left.title.localeCompare(right.title);
}

function getTrendDates(sourceDailyCounts: SourceDailyCount[]): string[] {
  return sourceDailyCounts[0]?.counts.map((entry) => entry.date) ?? [];
}

function getTrendMaxCount(sourceDailyCounts: SourceDailyCount[]): number {
  return Math.max(
    0,
    ...sourceDailyCounts.flatMap((source) => source.counts.map((entry) => entry.count))
  );
}

function getNiceTrendInterval(maxCount: number): number {
  if (maxCount <= 5) {
    return 1;
  }

  if (maxCount <= 10) {
    return 2;
  }

  const roughInterval = maxCount / 7;
  const magnitude = 10 ** Math.floor(Math.log10(roughInterval));
  const normalized = roughInterval / magnitude;

  if (normalized <= 1) {
    return Math.max(1, magnitude);
  }

  if (normalized <= 2) {
    return Math.max(1, 2 * magnitude);
  }

  if (normalized <= 5) {
    return Math.max(1, 5 * magnitude);
  }

  return Math.max(1, 10 * magnitude);
}

function buildTrendTicks(maxCount: number): number[] {
  const roundedMax = Math.max(0, Math.ceil(maxCount));
  const interval = getNiceTrendInterval(roundedMax);
  const domainMax = Math.max(interval, Math.ceil(roundedMax / interval) * interval);
  const tickCount = Math.floor(domainMax / interval) + 1;

  return Array.from({ length: tickCount }, (_, index) => index * interval);
}

function formatTrendDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);

  if (Number.isNaN(parsed.getTime())) {
    return date;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC"
  }).format(parsed);
}

function getStoredScrollPosition(): number | null {
  const stored = window.sessionStorage.getItem(HOME_SCROLL_STORAGE_KEY);
  const parsed = stored ? Number(stored) : Number.NaN;

  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function getMaxScrollY(): number {
  return Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
}

interface BackToTopButtonProps {
  visible: boolean;
  onClick: () => void;
}

function BackToTopButton({ visible, onClick }: BackToTopButtonProps): JSX.Element {
  return (
    <button
      type="button"
      className={`back-to-top ${visible ? "is-visible" : ""}`}
      aria-label="Back to top"
      aria-hidden={!visible}
      tabIndex={visible ? 0 : -1}
      onClick={onClick}
    >
      Top
    </button>
  );
}

export default function PaperDashboard(props: PaperDashboardProps): JSX.Element {
  const {
    initialPapers,
    initialUpdatedAt,
    initialCurrentRefreshAttemptAt,
    initialSourceViews,
    initialSourceDailyCounts,
    initialTotalBeforeDedupe,
    initialTopics,
    initialLatestRefreshRun,
    initialNextScheduledRefreshAt,
    initialPersistenceMode,
    sources
  } = props;
  const [papers, setPapers] = useState<Paper[]>(initialPapers);
  const [lastSuccessfulRefreshAt, setLastSuccessfulRefreshAt] = useState(initialUpdatedAt);
  const [currentRefreshAttemptAt, setCurrentRefreshAttemptAt] = useState(initialCurrentRefreshAttemptAt);
  const [sourceViews, setSourceViews] = useState<SourceView[]>(initialSourceViews);
  const [sourceDailyCounts, setSourceDailyCounts] = useState<SourceDailyCount[]>(initialSourceDailyCounts);
  const [totalBeforeDedupe, setTotalBeforeDedupe] = useState(initialTotalBeforeDedupe);
  const [query, setQuery] = useState("");
  const [searchScope, setSearchScope] = useState<SearchScope>("all");
  const [timeWindowDays, setTimeWindowDays] = useState<TimeWindowDays>(7);
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>(sources.map((source) => source.id));
  const [selectedTopicIds, setSelectedTopicIds] = useState<string[]>([]);
  const [classificationFilter, setClassificationFilter] = useState<ClassificationFilter>("all");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [statusText, setStatusText] = useState("");
  const [backgroundTheme, setBackgroundTheme] = useState<BackgroundTheme>("light");
  const [activeView, setActiveView] = useState<ActiveView>("home");
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [favoritePapers, setFavoritePapers] = useState<Record<string, Paper>>({});
  const [favoritesHydrated, setFavoritesHydrated] = useState(false);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [latestRefreshRun, setLatestRefreshRun] = useState<RefreshRun | undefined>(initialLatestRefreshRun);
  const [nextScheduledRefreshAt, setNextScheduledRefreshAt] = useState(initialNextScheduledRefreshAt);
  const [persistenceMode, setPersistenceMode] = useState<"postgres" | "memory">(initialPersistenceMode);
  const [editingPaperId, setEditingPaperId] = useState<string | null>(null);
  const [topicDraft, setTopicDraft] = useState<string[]>([]);
  const [isSavingTopics, setIsSavingTopics] = useState(false);
  const activeViewRef = useRef<ActiveView>("home");
  const homeScrollPositionRef = useRef(0);
  const shouldRestoreHomeScrollRef = useRef(false);

  function saveHomeScrollPosition(): void {
    const scrollY = Math.max(0, Math.round(window.scrollY));

    homeScrollPositionRef.current = scrollY;
    window.sessionStorage.setItem(HOME_SCROLL_STORAGE_KEY, String(scrollY));
  }

  useEffect(() => {
    const storedTheme = window.localStorage.getItem(BACKGROUND_THEME_STORAGE_KEY);

    if (storedTheme === "dark" || storedTheme === "light") {
      setBackgroundTheme(storedTheme);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(BACKGROUND_THEME_STORAGE_KEY, backgroundTheme);
  }, [backgroundTheme]);

  useEffect(() => {
    setFavoritePapers(parseStoredFavorites(window.localStorage.getItem(FAVORITES_STORAGE_KEY)));
    setFavoritesHydrated(true);
  }, []);

  useEffect(() => {
    if (!favoritesHydrated) {
      return;
    }

    window.localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(Object.values(favoritePapers)));
  }, [favoritePapers, favoritesHydrated]);

  useEffect(() => {
    activeViewRef.current = activeView;
  }, [activeView]);

  useEffect(() => {
    let frameId = 0;

    function updateScrollState(): void {
      frameId = 0;

      const scrollY = Math.max(0, Math.round(window.scrollY));

      setShowBackToTop(scrollY > BACK_TO_TOP_THRESHOLD_PX);

      if (activeViewRef.current === "home") {
        homeScrollPositionRef.current = scrollY;
        window.sessionStorage.setItem(HOME_SCROLL_STORAGE_KEY, String(scrollY));
      }
    }

    function onScroll(): void {
      if (frameId !== 0) {
        return;
      }

      frameId = window.requestAnimationFrame(updateScrollState);
    }

    updateScrollState();
    window.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      window.removeEventListener("scroll", onScroll);

      if (frameId !== 0) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, []);

  useEffect(() => {
    if (activeView !== "home" || !shouldRestoreHomeScrollRef.current) {
      return;
    }

    shouldRestoreHomeScrollRef.current = false;

    const storedScrollY = getStoredScrollPosition();
    const targetScrollY = homeScrollPositionRef.current || storedScrollY || 0;
    let frameId = 0;
    let attempts = 0;

    function restoreScrollPosition(): void {
      attempts += 1;

      const maxScrollY = getMaxScrollY();
      window.scrollTo({
        top: Math.min(targetScrollY, maxScrollY),
        behavior: "auto"
      });

      if (attempts < 8 && maxScrollY < targetScrollY) {
        frameId = window.requestAnimationFrame(restoreScrollPosition);
      }
    }

    frameId = window.requestAnimationFrame(restoreScrollPosition);

    return () => {
      if (frameId !== 0) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, [activeView]);

  const filteredPapers = useMemo(() => {
    const sourceSet = new Set(selectedSourceIds);
    const normalizedQuery = query.trim().toLowerCase();
    const refreshAnchorMs = getRefreshAnchorMs(currentRefreshAttemptAt, lastSuccessfulRefreshAt);

    return papers
      .filter((paper) => isWithinUtcDayWindow(paper.publishedAt, refreshAnchorMs, timeWindowDays))
      .filter((paper) => sourceSet.has(paper.sourceId))
      .filter(
        (paper) =>
          selectedTopicIds.length === 0 ||
          paper.topics.some((topic) => selectedTopicIds.includes(topic.topicId))
      )
      .filter(
        (paper) =>
          classificationFilter === "all" ||
          paper.classificationStatus === "pending" ||
          paper.classificationStatus === "low_confidence" ||
          paper.classificationStatus === "failed"
      )
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
  }, [
    currentRefreshAttemptAt,
    lastSuccessfulRefreshAt,
    papers,
    query,
    searchScope,
    selectedTopicIds,
    classificationFilter,
    selectedSourceIds,
    sortOrder,
    timeWindowDays
  ]);

  const favoriteList = useMemo(
    () => Object.values(favoritePapers).map((paper) => papers.find((current) => current.id === paper.id) ?? paper).sort(sortPapersByDateDesc),
    [favoritePapers, papers]
  );

  const trendDates = useMemo(() => getTrendDates(sourceDailyCounts), [sourceDailyCounts]);
  const arxivTrendSources = useMemo(
    () => sourceDailyCounts.filter((source) => source.sourceId === ARXIV_SOURCE_ID),
    [sourceDailyCounts]
  );
  const journalTrendSources = useMemo(
    () => sourceDailyCounts.filter((source) => source.sourceId !== ARXIV_SOURCE_ID),
    [sourceDailyCounts]
  );
  const topicDailyCounts = useMemo<SourceDailyCount[]>(
    () =>
      initialTopics
        .map((topic) => ({
          sourceId: topic.id,
          sourceLabel: topic.label,
          counts: trendDates.map((date) => ({
            date,
            count: papers.filter(
              (paper) =>
                paper.publishedAt.slice(0, 10) === date &&
                paper.topics.some((paperTopic) => paperTopic.topicId === topic.id)
            ).length
          }))
        }))
        .filter((topic) => topic.counts.some((entry) => entry.count > 0)),
    [initialTopics, papers, trendDates]
  );

  function toggleSource(id: string): void {
    setSelectedSourceIds((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id]
    );
  }

  function setAllSources(selected: boolean): void {
    setSelectedSourceIds(selected ? sources.map((source) => source.id) : []);
  }

  function toggleTopic(id: string): void {
    setSelectedTopicIds((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id]
    );
  }

  function applyTopicShortcut(topicIds: string[], uncertain = false): void {
    setSelectedTopicIds(topicIds);
    setClassificationFilter(uncertain ? "uncertain" : "all");
  }

  function selectView(view: ActiveView): void {
    if (activeView === "home" && view !== "home") {
      saveHomeScrollPosition();
    }

    if (activeView !== "home" && view === "home") {
      shouldRestoreHomeScrollRef.current = true;
    }

    activeViewRef.current = view;
    setActiveView(view);
    setIsSidebarOpen(false);
  }

  function scrollToPageTop(): void {
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    window.scrollTo({
      top: 0,
      behavior: prefersReducedMotion ? "auto" : "smooth"
    });
  }

  function toggleFavorite(paper: Paper): void {
    setFavoritePapers((current) => {
      const next = { ...current };

      if (next[paper.id]) {
        delete next[paper.id];

        return next;
      }

      next[paper.id] = paper;

      return next;
    });
  }

  async function onRefresh(): Promise<void> {
    try {
      setIsRefreshing(true);
      setStatusText("");
      let token = window.sessionStorage.getItem("physics-paper-hub-refresh-token") ?? undefined;

      let response = await fetch("/api/refresh", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        }
      });

      if (response.status === 401 && !token) {
        token = window.prompt("Refresh token") ?? undefined;

        if (token) {
          window.sessionStorage.setItem("physics-paper-hub-refresh-token", token);
          response = await fetch("/api/refresh", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`
            }
          });
        }
      }

      const payload = (await response.json()) as {
        papers?: Paper[];
        updatedAt?: string;
        currentRefreshAttemptAt?: string;
        lastSuccessfulRefreshAt?: string;
        sourceViews?: SourceView[];
        sourceDailyCounts?: SourceDailyCount[];
        totalBeforeDedupe?: number;
        latestRefreshRun?: RefreshRun;
        nextScheduledRefreshAt?: string;
        persistenceMode?: "postgres" | "memory";
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
      setSourceDailyCounts(payload.sourceDailyCounts ?? []);
      setTotalBeforeDedupe(payload.totalBeforeDedupe ?? payload.papers?.length ?? 0);
      setLatestRefreshRun(payload.latestRefreshRun);
      setNextScheduledRefreshAt(payload.nextScheduledRefreshAt ?? nextScheduledRefreshAt);
      setPersistenceMode(payload.persistenceMode ?? persistenceMode);
      setStatusText("Data refreshed.");
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : "Refresh failed.");
    } finally {
      setIsRefreshing(false);
    }
  }

  function beginTopicEdit(paper: Paper): void {
    setEditingPaperId(paper.id);
    setTopicDraft(paper.topics.map((topic) => topic.topicId));
  }

  function toggleTopicDraft(topicId: string): void {
    setTopicDraft((current) =>
      current.includes(topicId) ? current.filter((id) => id !== topicId) : [...current, topicId]
    );
  }

  async function saveTopicCorrection(paperId: string, token?: string): Promise<boolean> {
    const response = await fetch(`/api/papers/${paperId}/topics`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify({ topicIds: topicDraft })
    });

    if (response.status === 401 && !token) {
      const provided = window.prompt("Admin token");

      if (provided) {
        window.sessionStorage.setItem("physics-paper-hub-admin-token", provided);

        return saveTopicCorrection(paperId, provided);
      }

      return false;
    }

    const payload = (await response.json()) as {
      topics?: Paper["topics"];
      classificationStatus?: Paper["classificationStatus"];
      classifiedAt?: string;
      error?: string;
    };

    if (!response.ok || !payload.topics) {
      throw new Error(payload.error ?? "Unable to save topics.");
    }

    setPapers((current) =>
      current.map((paper) =>
        paper.id === paperId
          ? {
              ...paper,
              topics: payload.topics ?? paper.topics,
              classificationStatus: payload.classificationStatus ?? "classified",
              classifierVersion: "manual",
              classifiedAt: payload.classifiedAt
            }
          : paper
      )
    );
    setEditingPaperId(null);

    return true;
  }

  async function onSaveTopicCorrection(paperId: string): Promise<void> {
    try {
      setIsSavingTopics(true);
      setStatusText("");
      const token = window.sessionStorage.getItem("physics-paper-hub-admin-token") ?? undefined;
      const saved = await saveTopicCorrection(paperId, token);

      if (saved) {
        setStatusText("Topics updated.");
      }
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : "Unable to save topics.");
    } finally {
      setIsSavingTopics(false);
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

  function renderPaperCard(paper: Paper): JSX.Element {
    const identifier = pickIdentifier(paper);
    const missingFields = getMissingFields(paper);
    const isFavorite = Boolean(favoritePapers[paper.id]);
    const isEditingTopics = editingPaperId === paper.id;

    return (
      <article key={paper.id} className="paper-card card">
        <header className="paper-header">
          <div>
            <h2>
              <a href={paper.url} target="_blank" rel="noreferrer">
                {paper.title}
              </a>
            </h2>
            <p className="meta-line">
              <span>{paper.sourceLabel}</span>
              <span>{formatDate(paper.publishedAt)}</span>
            </p>
          </div>
          <button
            type="button"
            className={`favorite-button ${isFavorite ? "is-active" : ""}`}
            aria-pressed={isFavorite}
            onClick={() => toggleFavorite(paper)}
          >
            {isFavorite ? "Saved" : "Save"}
          </button>
        </header>

        <p className="authors">
          {paper.authors.length > 0
            ? paper.authors.join(", ")
            : "Authors unavailable (upstream source metadata did not provide authors)."}
        </p>
        <div className="paper-topics" aria-label="Paper topics">
          {paper.topics.map((topic) => {
            const definition = initialTopics.find((candidate) => candidate.id === topic.topicId);

            return (
              <span
                key={topic.topicId}
                className="topic-badge"
                style={{ borderColor: definition?.color, color: definition?.color }}
                title={`${Math.round(topic.confidence * 100)}% ${topic.isManual ? "manual assignment" : "heuristic score (not a calibrated probability)"} via ${topic.method}${topic.reason ? `: ${topic.reason}` : ""}`}
              >
                {topic.topicLabel}
                <span>{Math.round(topic.confidence * 100)}%</span>
              </span>
            );
          })}
          <span className={`classification-state state-${paper.classificationStatus}`}>
            {paper.classificationStatus === "low_confidence"
              ? "Review suggested"
              : paper.classificationStatus}
          </span>
          <button type="button" className="topic-edit-button" onClick={() => beginTopicEdit(paper)}>
            Edit topics
          </button>
        </div>

        {isEditingTopics ? (
          <div className="topic-editor">
            <div className="topic-editor-grid">
              {initialTopics.map((topic) => (
                <label key={topic.id}>
                  <input
                    type="checkbox"
                    checked={topicDraft.includes(topic.id)}
                    onChange={() => toggleTopicDraft(topic.id)}
                  />
                  <span>{topic.label}</span>
                </label>
              ))}
            </div>
            <div className="topic-editor-actions">
              <button
                type="button"
                onClick={() => onSaveTopicCorrection(paper.id)}
                disabled={isSavingTopics}
              >
                {isSavingTopics ? "Saving..." : "Save topics"}
              </button>
              <button type="button" onClick={() => setEditingPaperId(null)}>
                Cancel
              </button>
            </div>
          </div>
        ) : null}
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
  }

  function renderTrendSeriesChart(options: TrendChartOptions): JSX.Element {
    const { title, note, emptyMessage, ariaLabel, sources: trendSources, colorOffset = 0 } = options;
    const chartWidth = 840;
    const chartHeight = 320;
    const padding = { top: 24, right: 28, bottom: 52, left: 42 };
    const plotWidth = chartWidth - padding.left - padding.right;
    const plotHeight = chartHeight - padding.top - padding.bottom;
    const maxCount = getTrendMaxCount(trendSources);
    const hasData = trendSources.length > 0 && maxCount > 0;
    const yTicks = buildTrendTicks(maxCount);
    const yAxisMax = yTicks[yTicks.length - 1] ?? 1;
    const safeMax = Math.max(1, yAxisMax);
    const xForIndex = (index: number) =>
      padding.left + (trendDates.length <= 1 ? plotWidth / 2 : (plotWidth / (trendDates.length - 1)) * index);
    const yForCount = (count: number) => padding.top + plotHeight - (count / safeMax) * plotHeight;
    const colorForSource = (sourceId: string, index: number) =>
      (options.topicColors ? initialTopics.find((topic) => topic.id === sourceId)?.color : undefined) ??
      TREND_COLORS[(index + colorOffset) % TREND_COLORS.length];

    return (
      <section className="card trends-card">
        <div className="section-heading">
          <div>
            <h2>{title}</h2>
            <p>Daily article counts by source from the current 7-day UTC cache window.</p>
          </div>
        </div>

        {!hasData ? (
          <p className="empty-state">{emptyMessage}</p>
        ) : (
          <>
            <div className="trend-chart-wrap" aria-label={ariaLabel}>
              <svg className="trend-chart" viewBox={`0 0 ${chartWidth} ${chartHeight}`} role="img">
                <title>{title}</title>
                {yTicks.map((tick) => {
                  const y = yForCount(tick);

                  return (
                    <g key={tick}>
                      <line className="trend-grid-line" x1={padding.left} x2={chartWidth - padding.right} y1={y} y2={y} />
                      <text className="trend-axis-label" x={padding.left - 10} y={y + 4} textAnchor="end">
                        {tick}
                      </text>
                    </g>
                  );
                })}

                {trendDates.map((date, index) => (
                  <text
                    key={date}
                    className="trend-axis-label"
                    x={xForIndex(index)}
                    y={chartHeight - 18}
                    textAnchor="middle"
                  >
                    {formatTrendDate(date)}
                  </text>
                ))}

                {trendSources.map((source, sourceIndex) => {
                  const color = colorForSource(source.sourceId, sourceIndex);
                  const points = source.counts
                    .map((entry, index) => `${xForIndex(index)},${yForCount(entry.count)}`)
                    .join(" ");

                  return (
                    <g key={source.sourceId}>
                      <polyline className="trend-line" points={points} stroke={color} />
                      {source.counts.map((entry, index) => (
                        <circle
                          key={`${source.sourceId}-${entry.date}`}
                          className="trend-point"
                          cx={xForIndex(index)}
                          cy={yForCount(entry.count)}
                          r={entry.count > 0 ? 3.6 : 2.4}
                          fill={color}
                        >
                          <title>
                            {formatTrendDate(entry.date)} - {source.sourceLabel}: {entry.count}{" "}
                            {entry.count === 1 ? "article" : "articles"}
                          </title>
                        </circle>
                      ))}
                    </g>
                  );
                })}
              </svg>
            </div>

            <div className="trend-legend">
              {trendSources.map((source, index) => (
                <span key={source.sourceId} className="trend-legend-item">
                  <span
                    className="trend-swatch"
                    style={{ backgroundColor: colorForSource(source.sourceId, index) }}
                  />
                  {source.sourceLabel}
                </span>
              ))}
            </div>
          </>
        )}

        <p className="trend-note">{note}</p>
      </section>
    );
  }

  function renderTrendChart(): JSX.Element {
    if (sourceDailyCounts.length === 0) {
      return (
        <section className="card trends-card">
          <div className="section-heading">
            <div>
              <h2>Weekly Source Trends</h2>
              <p>Daily article counts by source from the current 7-day UTC cache window.</p>
            </div>
          </div>
          <p className="empty-state">No cached source trend data is available yet. Refresh data to populate trends.</p>
        </section>
      );
    }

    return (
      <section className="trends-view">
        {renderTrendSeriesChart({
          title: "arXiv quant-ph Trend",
          note: "arXiv usually has a larger daily volume, so it is shown separately.",
          emptyMessage: "No arXiv data in the current cache window.",
          ariaLabel: "arXiv quant-ph 7-day trend chart",
          sources: arxivTrendSources
        })}

        {renderTrendSeriesChart({
          title: "Journal Sources Trend",
          note: "Journal sources are plotted on a separate scale for easier comparison.",
          emptyMessage: "No journal data in the current cache window.",
          ariaLabel: "Journal sources 7-day trend chart",
          sources: journalTrendSources,
          colorOffset: 1
        })}

        {renderTrendSeriesChart({
          title: "Topic Trends",
          note: "Multi-label papers are counted once in every assigned topic.",
          emptyMessage: "No classified topic data is available in the current window.",
          ariaLabel: "Paper topic 7-day trend chart",
          sources: topicDailyCounts,
          topicColors: true
        })}
      </section>
    );
  }

  return (
    <div className={`quantum-app quantum-theme-${backgroundTheme}`}>
      <div className="quantum-backdrop" aria-hidden="true">
        <span className="quantum-wave quantum-wave-one" />
        <span className="quantum-wave quantum-wave-two" />
        <span className="quantum-node-field" />
      </div>

      <button
        type="button"
        className={`sidebar-scrim ${isSidebarOpen ? "is-open" : ""}`}
        aria-label="Close navigation"
        onClick={() => setIsSidebarOpen(false)}
      />

      <header className="mobile-topbar">
        <button
          type="button"
          className="menu-button"
          aria-label="Open navigation"
          aria-expanded={isSidebarOpen}
          onClick={() => setIsSidebarOpen(true)}
        >
          <span />
          <span />
          <span />
        </button>
        <span>Physics Papers Hub</span>
      </header>

      <aside className={`app-sidebar ${isSidebarOpen ? "is-open" : ""}`} aria-label="Primary navigation">
        <div className="sidebar-brand">
          <p>Physics Papers Hub</p>
          <span>Quantum paper tracker</span>
        </div>
        <nav className="sidebar-nav">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`sidebar-nav-item ${activeView === item.id ? "is-active" : ""}`}
              aria-current={activeView === item.id ? "page" : undefined}
              onClick={() => selectView(item.id)}
            >
              {item.label}
              {item.id === "favorites" ? <span className="nav-count">{favoriteList.length}</span> : null}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <span>Cache window</span>
          <strong>7 UTC days</strong>
        </div>
      </aside>

      <BackToTopButton visible={showBackToTop} onClick={scrollToPageTop} />

      <main className="page-shell">
        <section className="hero">
          <div className="hero-copy">
            <h1>Physics Papers Hub</h1>
            <p>
              Aggregated papers from the last 7 days across arXiv and selected journals, with source filtering, keyword
              search, and refreshable server-side cache.
            </p>
          </div>
          <div className="theme-toggle" aria-label="Background theme">
            <button
              type="button"
              className={`theme-option ${backgroundTheme === "light" ? "is-active" : ""}`}
              aria-pressed={backgroundTheme === "light"}
              onClick={() => setBackgroundTheme("light")}
            >
              Light
            </button>
            <button
              type="button"
              className={`theme-option ${backgroundTheme === "dark" ? "is-active" : ""}`}
              aria-pressed={backgroundTheme === "dark"}
              onClick={() => setBackgroundTheme("dark")}
            >
              Dark
            </button>
          </div>
        </section>

        {activeView === "home" ? (
          <>
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
              <span>Time window</span>
              <select
                value={timeWindowDays}
                onChange={(event) => setTimeWindowDays(Number(event.target.value) as TimeWindowDays)}
              >
                {TIME_WINDOW_OPTIONS.map((option) => (
                  <option key={option.days} value={option.days}>
                    {option.label}
                  </option>
                ))}
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
            <p>Next automatic refresh: {nextScheduledRefreshAt ? formatDate(nextScheduledRefreshAt) : "N/A"}</p>
            <p>
              Storage: {persistenceMode === "postgres" ? "Postgres" : "temporary memory"}
            </p>
            <p>Current refresh attempt: {currentRefreshAttemptAt ? formatDate(currentRefreshAttemptAt) : "N/A"}</p>
            <p>
              Showing {filteredPapers.length} / {papers.length} papers in selected window (raw: {totalBeforeDedupe})
            </p>
            {statusText ? <p>{statusText}</p> : null}
          </div>

          {latestRefreshRun ? (
            <div className={`refresh-run-summary run-${latestRefreshRun.status}`}>
              <strong>{latestRefreshRun.trigger === "automatic" ? "Automatic" : "Latest"} refresh</strong>
              <span>{latestRefreshRun.status}</span>
              <span>{latestRefreshRun.newPaperCount} new papers</span>
              <span>{latestRefreshRun.sourceFailureCount} degraded sources</span>
            </div>
          ) : null}

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

          <fieldset className="topic-filter">
            <legend>Topics</legend>
            <div className="topic-shortcuts">
              <button type="button" onClick={() => applyTopicShortcut([])}>
                All topics
              </button>
              <button type="button" onClick={() => applyTopicShortcut(["quantum-information"])}>
                Quantum information
              </button>
              <button type="button" onClick={() => applyTopicShortcut(["other"])}>
                Unclassified
              </button>
              <button type="button" onClick={() => applyTopicShortcut([], true)}>
                Low confidence
              </button>
            </div>
            <div className="topic-options">
              {initialTopics.map((topic) => (
                <label key={topic.id} className="topic-option">
                  <input
                    type="checkbox"
                    checked={selectedTopicIds.includes(topic.id)}
                    onChange={() => toggleTopic(topic.id)}
                  />
                  <span className="topic-color" style={{ backgroundColor: topic.color }} />
                  <span>{topic.label}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </section>

        <details className="card status-card">
          <summary>
            Source status
            {warningSources.length > 0 ? <span className="status-warning-count">
              {warningSources.length} {warningSources.length === 1 ? "source needs" : "sources need"} attention
            </span> : null}
          </summary>
          <div className="status-grid">
            {sourceViews.map((source) => (
              <article
                key={source.sourceId}
                className={`status-item ${source.failureStreak >= 2 ? "has-repeated-failures" : ""}`}
              >
                <p>
                  <strong>{source.sourceLabel}</strong>
                </p>
                <p>Status: {sourceStatusLabel(source)}</p>
                <p>Data mode: {dataModeLabel(source)}</p>
                <p>Articles: {source.articleCount}</p>
                {source.failureStreak > 0 ? <p>Consecutive degraded runs: {source.failureStreak}</p> : null}
                <p>Last success: {source.lastSuccessAt ? formatDate(source.lastSuccessAt) : "N/A"}</p>
                <p>Last attempt: {source.lastAttemptAt ? formatDate(source.lastAttemptAt) : "N/A"}</p>
              </article>
            ))}
          </div>
        {warningSources.length > 0 ? (
          <section className="source-warnings">
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
        </details>

        {filteredPapers.length > 0 ? (
          <section className="paper-list">{filteredPapers.map((paper) => renderPaperCard(paper))}</section>
        ) : (
          <section className="card empty-card">
            <h2>No papers match the current filters</h2>
            <p>Try clearing the source filter, broadening the time window, or refreshing the source cache.</p>
          </section>
        )}
          </>
        ) : null}

        {activeView === "trends" ? renderTrendChart() : null}

        {activeView === "favorites" ? (
          <section className="favorites-view">
            <div className="card section-heading">
              <div>
                <h2>Favorites</h2>
                <p>Saved papers are stored locally in this browser for later reading.</p>
              </div>
            </div>
            {favoriteList.length > 0 ? (
              <section className="paper-list">{favoriteList.map((paper) => renderPaperCard(paper))}</section>
            ) : (
              <section className="card empty-card">
                <h2>No favorites yet</h2>
                <p>Use the Save button on any paper card to keep it here after refreshes.</p>
              </section>
            )}
          </section>
        ) : null}
      </main>
    </div>
  );
}
