import assert from "node:assert/strict";
import test from "node:test";
import { parseRssFeed } from "@/lib/fetchers/rss";
import { fetchBySource } from "@/lib/fetchers";
import { ENABLED_SOURCES } from "@/lib/sources";
import { getAggregatedPapers, reconcileSourceState } from "@/lib/cache";
import { GET } from "@/app/api/papers/route";
import type { FetchedPaper, SourceCacheState } from "@/lib/types";

const quantum = ENABLED_SOURCES.find((source) => source.id === "quantum")!;
const npj = ENABLED_SOURCES.find((source) => source.id === "npj-quantum-information")!;
const abstract = "We study quantum metrology and quantum sensing with noisy probes, deriving precision bounds and verifying them numerically.";
const date = new Date().toISOString();
// Synthetic feeds following the publishers' RSS2 and RDF1 field layouts, not copied abstracts.
const rss = `<rss xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><item><title>Quantum metrology</title><link>https://quantum-journal.org/papers/q-test/</link><dc:creator>A. Alpha, B. Beta, and C. Gamma</dc:creator><pubDate>${date}</pubDate><description><![CDATA[<a href="https://doi.org/10.22331/q-test">https://doi.org/10.22331/q-test</a><p>${abstract}</p>]]></description></item><item><title>Journal news</title><link>https://quantum-journal.org/news/</link><pubDate>${date}</pubDate></item></channel></rss>`;
const rdf = `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:prism="http://prismstandard.org/namespaces/basic/2.0/"><item><title>Quantum switches for quantum sensing</title><link>https://www.nature.com/articles/test</link><dc:creator>A. Alpha</dc:creator><dc:creator>B. Beta</dc:creator><dc:date>${date}</dc:date><prism:doi>10.1038/test</prism:doi><description>${abstract}</description></item></rdf:RDF>`;

test("replaced journals have publisher feeds and verified Crossref ISSNs", () => {
  assert.equal(ENABLED_SOURCES.length, 10);
  assert.equal(quantum.fallbackCrossrefIssn, "2521-327X");
  assert.equal(npj.fallbackCrossrefIssn, "2056-6387");
  assert.ok(!ENABLED_SOURCES.some((source) => ["communications-physics", "journal-of-physics-a"].includes(source.id)));
});
test("Quantum RSS parses DOI, authors and dates and excludes news", () => {
  const papers = parseRssFeed(rss, quantum);
  assert.equal(papers.length, 1);
  assert.equal(papers[0].doi, "10.22331/q-test");
  assert.deepEqual(papers[0].authors, ["A. Alpha", "B. Beta", "C. Gamma"]);
  assert.equal(papers[0].publishedAt, date);
  assert.ok(papers[0].abstract.includes("quantum sensing"));
});
test("npj RDF parses repeated authors and prism DOI", () => {
  const [paper] = parseRssFeed(rdf, npj);
  assert.deepEqual(paper.authors, ["A. Alpha", "B. Beta"]);
  assert.equal(paper.doi, "10.1038/test");
  assert.equal(paper.sourceId, npj.id);
});

test("npj publication notice plus repeated title is not an abstract", () => {
  const notice = rdf.replace(`<description>${abstract}</description>`, `<description><![CDATA[<p>npj Quantum Information, Published online: 05 September 2026; <a>doi:10.1038/test</a></p>Quantum switches for quantum sensing]]></description>`);
  assert.equal(parseRssFeed(notice, npj)[0].abstract, "");
  const actual = rdf.replace(`<description>${abstract}</description>`, `<description><![CDATA[<p>npj Quantum Information, Published online: 05 September 2026; <a>doi:10.1038/test</a></p>${abstract}]]></description>`);
  assert.equal(parseRssFeed(actual, npj)[0].abstract, abstract);
});

for (const source of [quantum, npj]) {
  for (const mode of ["rss-down", "crossref-down", "both-up"] as const) {
    test(`${source.label}: ${mode} still returns deduplicated papers`, async () => {
      const original = global.fetch;
      global.fetch = async (input) => {
        const url = String(input);
        if (url === source.url) return new Response(mode === "rss-down" ? "Unavailable" : source.id === "quantum" ? rss : rdf, { status: mode === "rss-down" ? 404 : 200 });
        assert.ok(url.startsWith("https://api.crossref.org/works?"), `Unexpected enrichment: ${url}`);
        assert.ok(new URL(url).searchParams.get("filter")?.includes(source.fallbackCrossrefIssn!));
        if (mode === "crossref-down") return new Response("Unavailable", { status: 404 });
        return Response.json({ message: { items: [{ title: [source.id === "quantum" ? "Quantum metrology" : "Quantum switches for quantum sensing"], DOI: source.id === "quantum" ? "10.22331/q-test" : "10.1038/test", abstract, author: [{ given: "A.", family: "Alpha" }], "published-online": { "date-parts": [[2026, 9, 5]] } }] } });
      };
      try { assert.equal((await fetchBySource(source, "2026-08-30")).length, 1); }
      finally { global.fetch = original; }
    });
  }
}

test("restored caches remove retired sources and initialize new ones", () => {
  const state = reconcileSourceState({ refreshVersion: 1, sources: { "journal-of-physics-a": {
    sourceId: "journal-of-physics-a", sourceLabel: "Journal of Physics A", sourceType: "crossref", articles: [], sourceStatus: "success", usingStaleCache: false, failureStreak: 0
  } } });
  assert.deepEqual(Object.keys(state.sources), ENABLED_SOURCES.map((source) => source.id));
  assert.equal(state.sources.quantum.lastAttemptAt, undefined);
});

test("aggregation and API combine new topics, sources, keywords and time without retired cache leaks", async () => {
  const oldDb = process.env.DATABASE_URL;
  const oldPostgres = process.env.POSTGRES_URL;
  const oldKey = process.env.OPENAI_API_KEY;
  delete process.env.DATABASE_URL;
  delete process.env.POSTGRES_URL;
  delete process.env.OPENAI_API_KEY;
  const now = new Date().toISOString();
  const makePaper = (sourceId: string, title: string, age = 0): FetchedPaper => ({ sourceId, sourceLabel: sourceId, sourceType: "rss", title, abstract, authors: ["Test Author"], url: `https://example.org/${sourceId}/${age}`, publishedAt: new Date(Date.now() - age * 86400000).toISOString() });
  const state: SourceCacheState = reconcileSourceState({ refreshVersion: 1, currentRefreshAttemptAt: now, lastSuccessfulRefreshAt: now, sources: {} });
  for (const record of Object.values(state.sources)) Object.assign(record, { lastAttemptAt: now, lastSuccessAt: now, sourceStatus: "success" });
  state.sources.quantum.articles = [makePaper("quantum", "Quantum metrology today"), makePaper("quantum", "Quantum metrology older", 4)];
  state.sources[npj.id].articles = [makePaper(npj.id, "A quantum switch for quantum sensing")];
  state.sources["communications-physics"] = { ...state.sources.quantum, sourceId: "communications-physics", articles: [makePaper("communications-physics", "Retired paper")] };
  global.__sourceCacheState = state;
  global.__sourceStateLoadPromise = undefined;
  global.__paperClassifications = undefined;
  try {
    const result = await getAggregatedPapers();
    assert.equal(result.papers.length, 3);
    assert.equal(result.sourceViews.length, 10);
    assert.ok(!result.sourceDailyCounts.some((source) => source.sourceId === "communications-physics"));
    const response = await GET(new Request("http://localhost/api/papers?source=quantum&topic=quantum-metrology&days=1&q=today&field=title"));
    const data = await response.json();
    assert.equal(data.total, 1);
    assert.equal(data.papers[0].title, "Quantum metrology today");
    assert.equal((await (await GET(new Request("http://localhost/api/papers?topic=condensed-matter"))).json()).total, 0);
    assert.equal((await getAggregatedPapers()).papers.length, 3);
  } finally {
    if (oldDb !== undefined) process.env.DATABASE_URL = oldDb;
    if (oldPostgres !== undefined) process.env.POSTGRES_URL = oldPostgres;
    if (oldKey !== undefined) process.env.OPENAI_API_KEY = oldKey;
    global.__sourceCacheState = undefined; global.__sourceStateLoadPromise = undefined; global.__paperClassifications = undefined;
  }
});
