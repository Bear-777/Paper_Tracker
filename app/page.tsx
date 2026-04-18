import PaperDashboard from "@/components/paper-dashboard";
import { getAggregatedPapers } from "@/lib/cache";
import { SOURCE_OPTIONS } from "@/lib/sources";

export const dynamic = "force-dynamic";

export default async function HomePage(): Promise<JSX.Element> {
  const aggregated = await getAggregatedPapers();

  return (
    <PaperDashboard
      initialPapers={aggregated.papers}
      initialUpdatedAt={aggregated.lastSuccessfulRefreshAt ?? ""}
      initialCurrentRefreshAttemptAt={aggregated.currentRefreshAttemptAt ?? ""}
      initialSourceViews={aggregated.sourceViews}
      initialTotalBeforeDedupe={aggregated.totalBeforeDedupe}
      sources={SOURCE_OPTIONS}
    />
  );
}
