import { getAggregatedPapers } from "@/lib/cache";
import type { AggregatedResult } from "@/lib/types";

// Backward-compatible shim to avoid breaking older imports.
export async function fetchLatestPapers(): Promise<AggregatedResult> {
  return getAggregatedPapers();
}
