import { fetchLatestPapers } from "@/lib/paper-service";
import type { CacheState } from "@/lib/types";

const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS ?? 30 * 60 * 1000);

declare global {
  var __paperCache: CacheState | undefined;
  var __paperCachePromise: Promise<CacheState> | undefined;
}

async function refreshState(): Promise<CacheState> {
  const result = await fetchLatestPapers();
  const updatedAtMs = Date.now();
  const state: CacheState = {
    ...result,
    updatedAt: new Date(updatedAtMs).toISOString(),
    updatedAtMs
  };

  global.__paperCache = state;

  return state;
}

async function loadCache(forceRefresh: boolean): Promise<CacheState> {
  const cached = global.__paperCache;
  const nowMs = Date.now();

  if (!forceRefresh && cached && nowMs - cached.updatedAtMs < CACHE_TTL_MS) {
    return cached;
  }

  if (!global.__paperCachePromise) {
    global.__paperCachePromise = refreshState().finally(() => {
      global.__paperCachePromise = undefined;
    });
  }

  return global.__paperCachePromise;
}

export async function getPaperCache(): Promise<CacheState> {
  return loadCache(false);
}

export async function refreshPaperCache(): Promise<CacheState> {
  return loadCache(true);
}
