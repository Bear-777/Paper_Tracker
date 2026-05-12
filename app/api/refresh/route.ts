import { NextResponse } from "next/server";

import { refreshAndGetAggregatedPapers } from "@/lib/cache";
import { SOURCE_OPTIONS } from "@/lib/sources";

export const runtime = "nodejs";

function isAuthorized(request: Request): boolean {
  const expectedToken = process.env.REFRESH_TOKEN;

  if (!expectedToken) {
    return true;
  }

  const authHeader = request.headers.get("authorization");

  return authHeader === `Bearer ${expectedToken}`;
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const aggregated = await refreshAndGetAggregatedPapers();

  return NextResponse.json({
    updatedAt: aggregated.lastSuccessfulRefreshAt,
    currentRefreshAttemptAt: aggregated.currentRefreshAttemptAt,
    lastSuccessfulRefreshAt: aggregated.lastSuccessfulRefreshAt,
    totalBeforeDedupe: aggregated.totalBeforeDedupe,
    total: aggregated.papers.length,
    papers: aggregated.papers,
    sourceViews: aggregated.sourceViews,
    sourceDailyCounts: aggregated.sourceDailyCounts,
    sources: SOURCE_OPTIONS
  });
}
