import PaperDashboard from "@/components/paper-dashboard";
import { getPaperCache } from "@/lib/cache";
import { SOURCE_OPTIONS } from "@/lib/sources";

export const dynamic = "force-dynamic";

export default async function HomePage(): Promise<JSX.Element> {
  const cache = await getPaperCache();

  return (
    <PaperDashboard
      initialPapers={cache.papers}
      initialUpdatedAt={cache.updatedAt}
      initialSourceErrors={cache.sourceErrors}
      sources={SOURCE_OPTIONS}
    />
  );
}
