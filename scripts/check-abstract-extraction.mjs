import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const moduleCache = new Map();

function loadTsModule(relativePath) {
  const absolutePath = path.join(rootDir, relativePath);

  if (moduleCache.has(absolutePath)) {
    return moduleCache.get(absolutePath).exports;
  }

  const source = fs.readFileSync(absolutePath, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022
    },
    fileName: absolutePath
  }).outputText;
  const module = { exports: {} };

  moduleCache.set(absolutePath, module);

const localRequire = (request) => {
    if (request === "@/lib/utils") {
      return loadTsModule("lib/utils.ts");
    }

    if (request === "@/lib/http") {
      return loadTsModule("lib/http.ts");
    }

    if (request === "@/lib/abstract") {
      return loadTsModule("lib/abstract.ts");
    }

    if (request === "@/lib/errors") {
      return loadTsModule("lib/errors.ts");
    }

    throw new Error(`Unsupported fixture import: ${request}`);
  };
  const runner = vm.runInThisContext(`(function(exports, require, module) {\n${compiled}\n})`, {
    filename: absolutePath
  });

  runner(module.exports, localRequire, module);

  return module.exports;
}

const { cleanAbstractText, extractAbstractFromHtml, fetchAbstractFromLandingPage } = loadTsModule("lib/abstract.ts");

const cases = [
  {
    name: "arXiv abstract block",
    url: "https://arxiv.org/abs/quant-ph/9708022",
    html: `
      <blockquote class="abstract mathjax">
        <span class="descriptor">Abstract:</span>
        We discuss a protocol for transferring an unknown quantum state using classical information and shared
        entanglement. The protocol keeps &alpha; phases intact across the reconstructed state.
      </blockquote>
    `,
    shouldHaveAbstract: true,
    expectedStrategy: "selector:arxiv-blockquote"
  },
  {
    name: "APS / Physical Review citation meta",
    url: "https://journals.aps.org/prl/abstract/10.1103/PhysRevLett.116.061102",
    html: `
      <html>
        <head>
          <meta name="citation_abstract" content="We report a direct observation of a transient signal whose waveform is consistent with the prediction of general relativity for a binary black-hole coalescence." />
        </head>
      </html>
    `,
    shouldHaveAbstract: true,
    expectedStrategy: "meta:citation_abstract"
  },
  {
    name: "Nature / Springer JSON-LD description",
    url: "https://www.nature.com/articles/nature14539",
    html: `
      <script type="application/ld+json">
        {
          "@type": "ScholarlyArticle",
          "description": "Summary: This paper presents a structured article description in JSON-LD, which should be preferred before less-specific page text and cleaned before display."
        }
      </script>
    `,
    shouldHaveAbstract: true,
    expectedStrategy: "jsonld:$.description"
  },
  {
    name: "DOI landing page Open Graph fallback",
    url: "https://doi.org/10.1103/PhysRevLett.116.061102",
    html: `
      <meta property="og:description" content="Abstract: A DOI landing page may only expose a publisher summary through Open Graph metadata after redirects have resolved." />
    `,
    shouldHaveAbstract: true,
    expectedStrategy: "meta:og:description"
  },
  {
    name: "Blocked page without abstract",
    url: "https://example.invalid/no-abstract",
    html: "<html><head><title>Access denied</title></head><body>Access denied. Verify you are human.</body></html>",
    shouldHaveAbstract: false,
    expectedFailure: "blocked_or_dynamic_page"
  }
];

let failed = 0;

for (const testCase of cases) {
  const result = extractAbstractFromHtml(testCase.html, testCase.url);
  const startsWithHeading = /^(abstract|summary|background)\b/i.test(result.abstract);
  const hasExpectedStrategy = testCase.expectedStrategy ? result.strategy === testCase.expectedStrategy : true;
  const hasExpectedFailure = testCase.expectedFailure ? result.failureReason === testCase.expectedFailure : true;
  const passed =
    result.abstract.length > 0 === testCase.shouldHaveAbstract &&
    !startsWithHeading &&
    hasExpectedStrategy &&
    hasExpectedFailure;

  if (!passed) {
    failed += 1;
    console.error(`FAIL ${testCase.name}`, {
      result,
      startsWithHeading,
      expectedStrategy: testCase.expectedStrategy,
      expectedFailure: testCase.expectedFailure
    });
  } else {
    console.log(`PASS ${testCase.name}: ${result.strategy}${result.failureReason ? ` (${result.failureReason})` : ""}`);
  }
}

const cleaned = cleanAbstractText("<p>Abstract: Entangled states obey &alpha; + &beta; = 1.</p>");

if (cleaned !== "Entangled states obey \u03b1 + \u03b2 = 1.") {
  failed += 1;
  console.error("FAIL entity cleanup", { cleaned });
} else {
  console.log("PASS entity cleanup");
}

if (process.env.ABSTRACT_LIVE_TEST === "1") {
  const { fetchCrossrefByDoi } = loadTsModule("lib/fetchers/crossref.ts");
  const liveCases = [
    {
      name: "live arXiv page",
      url: "https://arxiv.org/abs/quant-ph/9708022",
      shouldHaveAbstract: true
    },
    {
      name: "live APS page",
      url: "https://journals.aps.org/prl/abstract/10.1103/PhysRevLett.116.061102",
      shouldHaveAbstract: true,
      allowBlocked: true
    },
    {
      name: "live DOI redirect",
      url: "https://doi.org/10.1103/PhysRevLett.116.061102",
      shouldHaveAbstract: true,
      allowBlocked: true
    },
    {
      name: "live no abstract page",
      url: "https://example.com/",
      shouldHaveAbstract: false
    }
  ];

  for (const liveCase of liveCases) {
    const result = await fetchAbstractFromLandingPage(liveCase.url, { sourceId: "live-test" });
    const startsWithHeading = /^(abstract|summary|background)\b/i.test(result.abstract);
    const blockedButHandled =
      liveCase.allowBlocked &&
      !result.abstract &&
      /^request_failed_status:(403|429)$/.test(result.failureReason ?? "");
    const passed = (result.abstract.length > 0 === liveCase.shouldHaveAbstract || blockedButHandled) && !startsWithHeading;

    if (!passed) {
      failed += 1;
      console.error(`FAIL ${liveCase.name}`, { result });
    } else {
      console.log(
        `PASS ${liveCase.name}: ${result.strategy}${result.failureReason ? ` (${result.failureReason})` : ""}`
      );
    }
  }

  const crossrefPaper = await fetchCrossrefByDoi("10.1103/PhysRevLett.116.061102", {
    sourceId: "live-crossref",
    sourceLabel: "Live Crossref",
    sourceType: "crossref"
  });

  if (!crossrefPaper?.abstract || /^(abstract|summary|background)\b/i.test(crossrefPaper.abstract)) {
    failed += 1;
    console.error("FAIL live Crossref DOI metadata", { paper: crossrefPaper });
  } else {
    console.log("PASS live Crossref DOI metadata: crossref:abstract");
  }
}

if (failed > 0) {
  process.exitCode = 1;
}
