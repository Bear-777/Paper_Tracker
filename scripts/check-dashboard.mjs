import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const port = process.env.UI_TEST_PORT ?? "3107";
const url = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["--import", "tsx", "scripts/dashboard-fixture-server.ts"], { stdio: ["ignore", "pipe", "inherit"] });
let browser;
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Fixture server startup timeout")), 30000);
    server.once("exit", (code) => { clearTimeout(timer); reject(new Error(`Fixture server exited ${code}`)); });
    server.stdout.on("data", (chunk) => { if (String(chunk).includes("UI fixture server ready")) { clearTimeout(timer); resolve(); } });
  });
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(url, { waitUntil: "networkidle" });
  const details = page.locator("details.status-card");
  assert.equal(await details.getAttribute("open"), null);
  assert.equal(await page.locator(".status-grid").isVisible(), false);
  assert.ok((await details.boundingBox()).height < 100);
  await details.locator("summary").focus();
  await page.keyboard.press("Enter");
  assert.equal(await page.locator(".status-grid").isVisible(), true);
  assert.equal(await page.locator(".status-item").count(), 10);
  await page.keyboard.press("Space");
  assert.equal(await page.locator(".status-grid").isVisible(), false);
  const labels = await page.locator(".topic-options .topic-option").allTextContents();
  assert.equal(labels[0], "Indefinite Causal Order & Quantum Switch");
  assert.equal(labels[1], "Quantum Metrology");
  assert.equal(labels.length, 7);
  assert.ok(!/Condensed Matter|Fields, Particles|Statistical Physics|Communications Physics|Journal of Physics A/.test(await page.locator("body").innerText()));
  assert.equal(await page.locator(".paper-card").count(), 4);
  await page.getByRole("checkbox", { name: "Indefinite Causal Order & Quantum Switch", exact: true }).check();
  assert.equal(await page.locator(".paper-card").count(), 2);
  await page.getByRole("checkbox", { name: "Quantum Metrology", exact: true }).check();
  assert.equal(await page.locator(".paper-card").count(), 3);
  await page.getByRole("button", { name: "All topics", exact: true }).click();
  await page.getByPlaceholder("Search title, abstract, authors").fill("squeezed light");
  assert.equal(await page.locator(".paper-card").count(), 1);
  await page.getByPlaceholder("Search title, abstract, authors").fill("");
  const output = process.env.UI_SCREENSHOT_DIR ?? "/tmp/paper-tracker-ui";
  await mkdir(output, { recursive: true });
  await page.screenshot({ path: `${output}/desktop.png`, fullPage: true });
  await page.getByRole("button", { name: "Weekly Source Trends", exact: true }).click();
  assert.ok((await page.locator("body").innerText()).includes("Quantum Metrology"));
  await page.screenshot({ path: `${output}/trends.png`, fullPage: true });
  await page.getByRole("button", { name: "Physics Papers Hub", exact: true }).click();
  for (const width of [390, 320, 768]) {
    await page.setViewportSize({ width, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `Overflow at ${width}`);
    await details.locator("summary").click();
    assert.equal(await page.locator(".status-grid").isVisible(), true);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `Expanded overflow at ${width}`);
    await details.locator("summary").click();
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.screenshot({ path: `${output}/mobile-${width}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "Dark", exact: true }).click();
  await page.screenshot({ path: `${output}/dark.png`, fullPage: true });
  await page.reload({ waitUntil: "networkidle" });
  assert.equal(await page.locator("details.status-card").getAttribute("open"), null);
  assert.deepEqual(errors, []);
  console.log(`PASS dashboard: collapse, keyboard, topic order, multi-label filter, search, trends, responsive layout. Screenshots: ${output}`);
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
