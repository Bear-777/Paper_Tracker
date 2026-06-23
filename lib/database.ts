import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

import { TOPICS } from "@/lib/topics";
import type {
  ClassificationStatus,
  Paper,
  PaperTopic,
  RefreshRun,
  SourceCacheRecord,
  SourceCacheState
} from "@/lib/types";

declare global {
  var __paperTrackerSchemaPromise: Promise<void> | undefined;
}

type SqlClient = NeonQueryFunction<false, false>;
type DatabaseRow = Record<string, unknown>;

function connectionString(): string | undefined {
  return process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
}

function getSql(): SqlClient | null {
  const url = connectionString();

  return url ? neon(url) : null;
}

export function isDatabaseConfigured(): boolean {
  return Boolean(connectionString());
}

async function ensureSchema(sql: SqlClient): Promise<void> {
  if (!global.__paperTrackerSchemaPromise) {
    global.__paperTrackerSchemaPromise = (async () => {
      await sql.query(`
        CREATE TABLE IF NOT EXISTS papers (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          authors JSONB NOT NULL DEFAULT '[]'::jsonb,
          abstract TEXT NOT NULL DEFAULT '',
          source_id TEXT NOT NULL,
          source_label TEXT NOT NULL,
          source_type TEXT NOT NULL,
          published_at TIMESTAMPTZ NOT NULL,
          doi TEXT,
          arxiv_id TEXT,
          url TEXT NOT NULL DEFAULT '',
          classification_status TEXT NOT NULL DEFAULT 'pending',
          classifier_version TEXT,
          classified_at TIMESTAMPTZ,
          first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await sql.query(`
        CREATE TABLE IF NOT EXISTS topics (
          id TEXT PRIMARY KEY,
          label TEXT NOT NULL,
          description TEXT NOT NULL,
          color TEXT NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await sql.query(`
        CREATE TABLE IF NOT EXISTS paper_topics (
          paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
          topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
          confidence DOUBLE PRECISION NOT NULL,
          method TEXT NOT NULL,
          reason TEXT,
          is_manual BOOLEAN NOT NULL DEFAULT FALSE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (paper_id, topic_id)
        )
      `);
      await sql.query(`
        CREATE TABLE IF NOT EXISTS source_states (
          source_id TEXT PRIMARY KEY,
          source_label TEXT NOT NULL,
          source_type TEXT NOT NULL,
          articles JSONB NOT NULL DEFAULT '[]'::jsonb,
          last_success_at TIMESTAMPTZ,
          last_attempt_at TIMESTAMPTZ,
          last_error JSONB,
          source_status TEXT NOT NULL,
          using_stale_cache BOOLEAN NOT NULL DEFAULT FALSE,
          failure_streak INTEGER NOT NULL DEFAULT 0,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await sql.query(
        "ALTER TABLE source_states ADD COLUMN IF NOT EXISTS failure_streak INTEGER NOT NULL DEFAULT 0"
      );
      await sql.query(`
        CREATE TABLE IF NOT EXISTS refresh_runs (
          id TEXT PRIMARY KEY,
          trigger TEXT NOT NULL,
          status TEXT NOT NULL,
          started_at TIMESTAMPTZ NOT NULL,
          completed_at TIMESTAMPTZ,
          source_success_count INTEGER NOT NULL DEFAULT 0,
          source_failure_count INTEGER NOT NULL DEFAULT 0,
          paper_count INTEGER NOT NULL DEFAULT 0,
          new_paper_count INTEGER NOT NULL DEFAULT 0,
          error_message TEXT
        )
      `);
      await sql.query("CREATE INDEX IF NOT EXISTS papers_published_at_idx ON papers (published_at DESC)");
      await sql.query("CREATE INDEX IF NOT EXISTS paper_topics_topic_id_idx ON paper_topics (topic_id)");

      for (const topic of TOPICS) {
        await sql.query(
          `INSERT INTO topics (id, label, description, color)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (id) DO UPDATE SET
             label = EXCLUDED.label,
             description = EXCLUDED.description,
             color = EXCLUDED.color,
             updated_at = NOW()`,
          [topic.id, topic.label, topic.description, topic.color]
        );
      }
    })().catch((error) => {
      global.__paperTrackerSchemaPromise = undefined;
      throw error;
    });
  }

  return global.__paperTrackerSchemaPromise;
}

async function readySql(): Promise<SqlClient | null> {
  const sql = getSql();

  if (sql) {
    await ensureSchema(sql);
  }

  return sql;
}

function iso(value: unknown): string | undefined {
  if (!value) {
    return undefined;
  }

  const date = value instanceof Date ? value : new Date(String(value));

  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) {
    return fallback;
  }

  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }

  return value as T;
}

export async function loadPersistedState(): Promise<SourceCacheState | null> {
  const sql = await readySql();

  if (!sql) {
    return null;
  }

  const rows = (await sql.query("SELECT * FROM source_states")) as DatabaseRow[];

  if (rows.length === 0) {
    return null;
  }

  const sources: Record<string, SourceCacheRecord> = {};
  let latestAttempt: string | undefined;
  let latestSuccess: string | undefined;

  for (const row of rows) {
    const sourceId = String(row.source_id);
    const lastAttemptAt = iso(row.last_attempt_at);
    const lastSuccessAt = iso(row.last_success_at);

    sources[sourceId] = {
      sourceId,
      sourceLabel: String(row.source_label),
      sourceType: row.source_type as SourceCacheRecord["sourceType"],
      articles: parseJson(row.articles, []),
      lastSuccessAt,
      lastAttemptAt,
      lastError: parseJson(row.last_error, undefined),
      sourceStatus: row.source_status as SourceCacheRecord["sourceStatus"],
      usingStaleCache: Boolean(row.using_stale_cache),
      failureStreak: Number(row.failure_streak ?? 0)
    };

    if (lastAttemptAt && (!latestAttempt || lastAttemptAt > latestAttempt)) {
      latestAttempt = lastAttemptAt;
    }

    if (lastSuccessAt && (!latestSuccess || lastSuccessAt > latestSuccess)) {
      latestSuccess = lastSuccessAt;
    }
  }

  return {
    refreshVersion: 0,
    currentRefreshAttemptAt: latestAttempt,
    lastSuccessfulRefreshAt: latestSuccess,
    sources
  };
}

export async function persistSourceState(state: SourceCacheState): Promise<void> {
  const sql = await readySql();

  if (!sql) {
    return;
  }

  for (const source of Object.values(state.sources)) {
    await sql.query(
      `INSERT INTO source_states (
        source_id, source_label, source_type, articles, last_success_at,
        last_attempt_at, last_error, source_status, using_stale_cache, failure_streak
      ) VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7::jsonb, $8, $9, $10)
      ON CONFLICT (source_id) DO UPDATE SET
        source_label = EXCLUDED.source_label,
        source_type = EXCLUDED.source_type,
        articles = EXCLUDED.articles,
        last_success_at = EXCLUDED.last_success_at,
        last_attempt_at = EXCLUDED.last_attempt_at,
        last_error = EXCLUDED.last_error,
        source_status = EXCLUDED.source_status,
        using_stale_cache = EXCLUDED.using_stale_cache,
        failure_streak = EXCLUDED.failure_streak,
        updated_at = NOW()`,
      [
        source.sourceId,
        source.sourceLabel,
        source.sourceType,
        JSON.stringify(source.articles),
        source.lastSuccessAt ?? null,
        source.lastAttemptAt ?? null,
        JSON.stringify(source.lastError ?? null),
        source.sourceStatus,
        source.usingStaleCache,
        source.failureStreak
      ]
    );
  }
}

export async function loadStoredClassifications(
  paperIds: string[]
): Promise<Map<string, Pick<Paper, "topics" | "classificationStatus" | "classifierVersion" | "classifiedAt">>> {
  const sql = await readySql();
  const result = new Map<
    string,
    Pick<Paper, "topics" | "classificationStatus" | "classifierVersion" | "classifiedAt">
  >();

  if (!sql || paperIds.length === 0) {
    return result;
  }

  const rows = (await sql.query(
    `SELECT p.id, p.classification_status, p.classifier_version, p.classified_at,
      COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'topicId', pt.topic_id,
            'topicLabel', t.label,
            'confidence', pt.confidence,
            'method', pt.method,
            'reason', pt.reason,
            'isManual', pt.is_manual
          )
        ) FILTER (WHERE pt.topic_id IS NOT NULL),
        '[]'::jsonb
      ) AS topics
     FROM papers p
     LEFT JOIN paper_topics pt ON pt.paper_id = p.id
     LEFT JOIN topics t ON t.id = pt.topic_id
     WHERE p.id = ANY($1::text[])
     GROUP BY p.id`,
    [paperIds]
  )) as DatabaseRow[];

  for (const row of rows) {
    result.set(String(row.id), {
      topics: parseJson<PaperTopic[]>(row.topics, []),
      classificationStatus: row.classification_status as ClassificationStatus,
      classifierVersion: row.classifier_version ? String(row.classifier_version) : undefined,
      classifiedAt: iso(row.classified_at)
    });
  }

  return result;
}

export async function persistPapers(papers: Paper[]): Promise<number> {
  const sql = await readySql();

  if (!sql || papers.length === 0) {
    return 0;
  }

  let newPaperCount = 0;

  for (const paper of papers) {
    const inserted = (await sql.query(
      `INSERT INTO papers (
        id, title, authors, abstract, source_id, source_label, source_type,
        published_at, doi, arxiv_id, url, classification_status,
        classifier_version, classified_at
      ) VALUES (
        $1, $2, $3::jsonb, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14
      )
      ON CONFLICT (id) DO UPDATE SET
        title = EXCLUDED.title,
        authors = EXCLUDED.authors,
        abstract = EXCLUDED.abstract,
        source_id = EXCLUDED.source_id,
        source_label = EXCLUDED.source_label,
        source_type = EXCLUDED.source_type,
        published_at = EXCLUDED.published_at,
        doi = EXCLUDED.doi,
        arxiv_id = EXCLUDED.arxiv_id,
        url = EXCLUDED.url,
        classification_status = EXCLUDED.classification_status,
        classifier_version = EXCLUDED.classifier_version,
        classified_at = EXCLUDED.classified_at,
        last_seen_at = NOW()
      RETURNING (xmax = 0) AS inserted`,
      [
        paper.id,
        paper.title,
        JSON.stringify(paper.authors),
        paper.abstract,
        paper.sourceId,
        paper.sourceLabel,
        paper.sourceType,
        paper.publishedAt,
        paper.doi ?? null,
        paper.arxivId ?? null,
        paper.url,
        paper.classificationStatus,
        paper.classifierVersion ?? null,
        paper.classifiedAt ?? null
      ]
    )) as DatabaseRow[];

    if (inserted[0]?.inserted === true) {
      newPaperCount += 1;
    }

    const hasManualTopics = paper.topics.some((topic) => topic.isManual);

    if (!hasManualTopics) {
      await sql.query("DELETE FROM paper_topics WHERE paper_id = $1 AND is_manual = FALSE", [paper.id]);

      for (const topic of paper.topics) {
        await sql.query(
          `INSERT INTO paper_topics (
            paper_id, topic_id, confidence, method, reason, is_manual
          ) VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (paper_id, topic_id) DO UPDATE SET
            confidence = EXCLUDED.confidence,
            method = EXCLUDED.method,
            reason = EXCLUDED.reason,
            is_manual = EXCLUDED.is_manual,
            updated_at = NOW()
          WHERE paper_topics.is_manual = FALSE`,
          [
            paper.id,
            topic.topicId,
            topic.confidence,
            topic.method,
            topic.reason ?? null,
            topic.isManual
          ]
        );
      }
    }
  }

  return newPaperCount;
}

export async function saveManualTopics(paperId: string, topicIds: string[]): Promise<PaperTopic[]> {
  const sql = await readySql();

  if (!sql) {
    throw new Error("Manual topic corrections require DATABASE_URL.");
  }

  const validIds = Array.from(new Set(topicIds)).filter((id) => TOPICS.some((topic) => topic.id === id));

  await sql.query("DELETE FROM paper_topics WHERE paper_id = $1", [paperId]);

  for (const topicId of validIds) {
    await sql.query(
      `INSERT INTO paper_topics (
        paper_id, topic_id, confidence, method, reason, is_manual
      ) VALUES ($1, $2, 1, 'manual', 'Manually assigned.', TRUE)`,
      [paperId, topicId]
    );
  }

  await sql.query(
    `UPDATE papers SET
      classification_status = 'classified',
      classified_at = NOW(),
      classifier_version = 'manual'
     WHERE id = $1`,
    [paperId]
  );

  return validIds.map((topicId) => ({
    topicId,
    topicLabel: TOPICS.find((topic) => topic.id === topicId)?.label ?? topicId,
    confidence: 1,
    method: "manual",
    reason: "Manually assigned.",
    isManual: true
  }));
}

export async function createRefreshRun(run: RefreshRun): Promise<void> {
  const sql = await readySql();

  if (!sql) {
    return;
  }

  await sql.query(
    `INSERT INTO refresh_runs (
      id, trigger, status, started_at, source_success_count,
      source_failure_count, paper_count, new_paper_count
    ) VALUES ($1, $2, $3, $4, 0, 0, 0, 0)`,
    [run.id, run.trigger, run.status, run.startedAt]
  );
}

export async function completeRefreshRun(run: RefreshRun): Promise<void> {
  const sql = await readySql();

  if (!sql) {
    return;
  }

  await sql.query(
    `UPDATE refresh_runs SET
      status = $2,
      completed_at = $3,
      source_success_count = $4,
      source_failure_count = $5,
      paper_count = $6,
      new_paper_count = $7,
      error_message = $8
     WHERE id = $1`,
    [
      run.id,
      run.status,
      run.completedAt ?? null,
      run.sourceSuccessCount,
      run.sourceFailureCount,
      run.paperCount,
      run.newPaperCount,
      run.errorMessage ?? null
    ]
  );
}

export async function loadLatestRefreshRun(): Promise<RefreshRun | undefined> {
  const sql = await readySql();

  if (!sql) {
    return undefined;
  }

  const rows = (await sql.query(
    "SELECT * FROM refresh_runs ORDER BY started_at DESC LIMIT 1"
  )) as DatabaseRow[];
  const row = rows[0];

  if (!row) {
    return undefined;
  }

  return {
    id: String(row.id),
    trigger: row.trigger as RefreshRun["trigger"],
    status: row.status as RefreshRun["status"],
    startedAt: iso(row.started_at) ?? new Date().toISOString(),
    completedAt: iso(row.completed_at),
    sourceSuccessCount: Number(row.source_success_count),
    sourceFailureCount: Number(row.source_failure_count),
    paperCount: Number(row.paper_count),
    newPaperCount: Number(row.new_paper_count),
    errorMessage: row.error_message ? String(row.error_message) : undefined
  };
}
