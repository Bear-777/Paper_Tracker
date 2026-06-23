import { NextResponse } from "next/server";

import { refreshAndGetAggregatedPapers } from "@/lib/cache";

export const runtime = "nodejs";
export const maxDuration = 300;

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    return process.env.NODE_ENV !== "production";
  }

  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: Request): Promise<NextResponse> {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const aggregated = await refreshAndGetAggregatedPapers("automatic");

  return NextResponse.json({
    ok: true,
    total: aggregated.papers.length,
    latestRefreshRun: aggregated.latestRefreshRun,
    lastSuccessfulRefreshAt: aggregated.lastSuccessfulRefreshAt
  });
}

