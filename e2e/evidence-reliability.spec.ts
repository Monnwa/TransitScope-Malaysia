import { test, expect } from "@playwright/test";
import { adherenceFixture, adherencePoint } from "@/tests/fixtures/adherence";
import { VehicleProgressHistory } from "@/lib/vehicle-progress-history";
import { ProcessedBusJourneys } from "@/lib/processed-bus-journeys";
import { BusEvidencePersistence } from "@/lib/bus-evidence";
import { TestEvidenceBackend } from "@/tests/fixtures/evidence-store";
import { RedisRestEvidenceBackend } from "@/lib/redis-evidence-store";
import type { EvidenceWrite } from "@/lib/bus-evidence";

for (const width of [390, 1440]) test(`${width}px restored evidence is processed before selection and diagnostic codes remain technical-only`, async ({ page }) => {
  const f = adherenceFixture(); let now = f.now - 120000;
  const backend = new TestEvidenceBackend(() => now), feed = { timetable: f.table, tripPaths: new Map([["t", f.path]]), progressPaths: new Map([["t", f.path]]), tripShapeDistances: new Map<string, number[]>() };
  const fresh = () => { const history = new VehicleProgressHistory(), persistence = new BusEvidencePersistence(backend, 60, "TEST"); return { history, persistence, store: new ProcessedBusJourneys(history, persistence) }; };
  let processor = fresh(), records = [f.bus], entries: Awaited<ReturnType<ProcessedBusJourneys["processWithPersistence"]>> = [];
  for (const [metres, offset] of [[90, -120000], [200, -90000], [600, -60000], [900, -30000], [1100, 0], [1150, 30000], [1250, 60000]]) {
    now = f.now + offset; if (offset === 30000) processor = fresh();
    records = ["A", "B"].map(id => ({ ...f.bus, id, name: `Synthetic persisted bus ${id}`, position: adherencePoint(metres), reportedAt: new Date(now).toISOString(), feedPublishedAt: new Date(now + 1000).toISOString(), lastUpdatedAt: new Date(now + 2000).toISOString(), observation: { ...f.bus.observation, positionTimestamp: new Date(now).toISOString() } }));
    records = processor.history.ingest("rapid-bus-kl", records, now); entries = await processor.store.processWithPersistence("rapid-bus-kl", records, feed, now);
  }
  expect(entries.flatMap(e => e.journey!.stops).filter(s => s.adherence?.result)).toHaveLength(6);
  await page.setViewportSize({ width, height: 1000 }); await page.clock.install({ time: new Date(now) }); let detailRequests = 0;
  await page.route("**/api/transit?*", route => route.fulfill({ json: { records: route.request().url().includes("includeStatic") ? [] : records, busJourneys: entries, busEvidence: processor.persistence.status(), alerts: [], feeds: [], demo: false, fetchedAt: new Date(now).toISOString() } }));
  await page.route("**/api/bus-journey?*", route => { detailRequests++; return route.fulfill({ status: 500, json: { error: "Primary processing must not depend on panel opening" } }); });
  await page.route("**/api/rail-network?*", route => route.fulfill({ json: { lines: [], stations: [], available: true, source: "Synthetic fixture" } }));
  await page.route("**/api/alerts", route => route.fulfill({ json: { alerts: [], sources: [], retrievedAt: new Date(now).toISOString() } }));
  await page.goto("/"); await expect(page.getByTitle("Synthetic persisted bus B", { exact: true })).toBeVisible(); expect(detailRequests).toBe(0);
  await page.getByTitle("Synthetic persisted bus B", { exact: true }).click(); const board = page.getByLabel("Bus journey detail");
  await expect(board.getByLabel("Timetable adherence summary")).toHaveText("4 passed · 1 early · 1 on time · 1 late · 1 unavailable");
  expect(await board.innerText()).not.toMatch(/NO_GPS_HISTORY|GPS_GAP_TOO_LARGE|REDIS_REST|feedPublishedAt|receivedAt/);
  await board.getByRole("button", { name: "Show previous stops" }).click(); await expect(board.locator('[data-sequence="30"] .bus-adherence')).toContainText("On time");
  await board.locator(".bus-technical > summary").click(); await expect(board.locator(".bus-technical pre")).toContainText('"primary": "NO_GPS_HISTORY"');
  expect(detailRequests).toBe(0); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("one corrupt persisted vehicle does not remove another vehicle's restored passenger classifications", async ({ page }) => {
  const f = adherenceFixture(); let now = f.now - 120000;
  const backend = new TestEvidenceBackend(() => now), feed = { timetable: f.table, tripPaths: new Map([["t", f.path]]), progressPaths: new Map([["t", f.path]]), tripShapeDistances: new Map<string, number[]>() };
  const makeRecords = (metres: number) => ["B", "A"].map(id => ({ ...f.bus, id, name: `Partially restored bus ${id}`, position: adherencePoint(metres), reportedAt: new Date(now).toISOString(), observation: { ...f.bus.observation, positionTimestamp: new Date(now).toISOString() } }));
  const seedHistory = new VehicleProgressHistory(), seed = new ProcessedBusJourneys(seedHistory, new BusEvidencePersistence(backend, 60, "TEST"));
  for (const [metres, offset] of [[90, -120000], [200, -90000], [600, -60000], [900, -30000], [1100, 0]]) { now = f.now + offset; await seed.processWithPersistence("rapid-bus-kl", seedHistory.ingest("rapid-bus-kl", makeRecords(metres), now), feed, now); }
  const rest = new RedisRestEvidenceBackend("https://redis.test", "test-only", async (url, options) => {
    const body = JSON.parse(String(options?.body));
    if (!String(url).endsWith("/pipeline")) { const docs = await backend.read(body.slice(1)); return new Response(JSON.stringify({ result: body.slice(1).map((key: string) => { const doc = docs.get(key) as { scope?: { vehicleId?: string } } | undefined; return doc?.scope?.vehicleId === "B" ? "corrupt test document" : doc ? JSON.stringify(doc) : null; }) })); }
    const result = await backend.compareAndSet(body.map((c: string[]): EvidenceWrite => ({ key: c[3], expectedRevision: Number(c[4]), document: JSON.parse(c[5]), expiresAt: Number(c[6]), ttlMs: 3600000 })));
    return new Response(JSON.stringify(result.map(ok => ({ result: ok ? 1 : 0 }))));
  });
  const history = new VehicleProgressHistory(), persistence = new BusEvidencePersistence(rest, 60, "TEST"), processor = new ProcessedBusJourneys(history, persistence);
  let records: ReturnType<VehicleProgressHistory["ingest"]> = makeRecords(1100), entries: Awaited<ReturnType<ProcessedBusJourneys["processWithPersistence"]>> = [];
  for (const [metres, offset] of [[1150, 30000], [1250, 60000]]) { now = f.now + offset; records = history.ingest("rapid-bus-kl", makeRecords(metres), now); entries = await processor.processWithPersistence("rapid-bus-kl", records, feed, now); }
  expect(entries.find(e => e.vehicleId === "A")!.journey!.stops.filter(s => s.adherence?.result)).toHaveLength(3);
  expect(entries.find(e => e.vehicleId === "B")!.journey!.stops.every(s => !s.adherence?.result)).toBe(true); expect(persistence.status().state).toBe("DEGRADED");
  await page.clock.install({ time: new Date(now) }); let details = 0;
  await page.route("**/api/transit?*", route => route.fulfill({ json: { records: route.request().url().includes("includeStatic") ? [] : records, busJourneys: entries, busEvidence: persistence.status(), alerts: [], feeds: [], demo: false, fetchedAt: new Date(now).toISOString() } }));
  await page.route("**/api/bus-journey?*", route => { details++; return route.fulfill({ status: 500, json: {} }); });
  await page.route("**/api/rail-network?*", route => route.fulfill({ json: { lines: [], stations: [], available: true, source: "Synthetic partial success fixture" } }));
  await page.route("**/api/alerts", route => route.fulfill({ json: { alerts: [], sources: [], retrievedAt: new Date(now).toISOString() } }));
  await page.goto("/"); await page.getByTitle("Partially restored bus A", { exact: true }).click(); const board = page.getByLabel("Bus journey detail");
  await expect(board.getByLabel("Timetable adherence summary")).toHaveText("4 passed · 1 early · 1 on time · 1 late · 1 unavailable");
  expect(await board.innerText()).not.toMatch(/REDIS|TIMEOUT|corrupt test document|CONNECTION/); expect(details).toBe(0);
});
