// UI-test server only. Synthetic state is never used by the production entry point.
import { createServer } from "node:http";
import next from "next";
import { reconcileSourceState } from "@/lib/cache";
import { ENABLED_SOURCES } from "@/lib/sources";

async function main() {
  const app = next({ dev: false });
  await app.prepare();
  delete process.env.DATABASE_URL;
  delete process.env.POSTGRES_URL;
  delete process.env.OPENAI_API_KEY;
  const now = new Date().toISOString();
  const state = reconcileSourceState({ refreshVersion: 1, currentRefreshAttemptAt: now, lastSuccessfulRefreshAt: now, sources: {} });
  for (const source of ENABLED_SOURCES) {
    Object.assign(state.sources[source.id], { lastAttemptAt: now, lastSuccessAt: now, sourceStatus: "success" });
  }
  const fixtures = [
    ["quantum", "Quantum switch protocols for indefinite causal order"],
    ["npj-quantum-information", "Quantum metrology with squeezed light"],
    ["prx-quantum", "Quantum computing with trapped ions"],
    ["pra", "Quantum communication through a quantum switch"]
  ];
  for (const [id, title] of fixtures) {
    const source = state.sources[id];
    source.articles.push({ title, authors: ["Test Researcher"], abstract: `We investigate ${title.toLowerCase()}. Analytical bounds are derived and verified numerically in the presence of experimental noise.`,
      sourceId: id, sourceLabel: source.sourceLabel, sourceType: source.sourceType,
      publishedAt: now, url: `https://example.org/${id}` });
  }
  Object.assign(state.sources["arxiv-quant-ph"], { sourceStatus: "failed_no_cache", failureStreak: 2,
    lastError: { kind: "source_fetch_failed", message: "Synthetic upstream failure for UI checks.", at: now } });
  global.__sourceCacheState = state;
  global.__sourceStateLoadPromise = undefined;
  createServer(app.getRequestHandler())
    .on("error", (error) => { console.error(error); process.exitCode = 1; })
    .listen(Number(process.env.UI_TEST_PORT ?? 3107), "127.0.0.1", () => console.log("UI fixture server ready"));
}
void main();
