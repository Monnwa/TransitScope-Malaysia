import { selectVehicle, chooseSearchStation } from "./map-station";
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { railNetwork } from "../lib/simulation/network";
import { setMapZoom } from "./map-zoom";

const start = Date.parse("2026-11-17T09:41:25Z");
type Kind = "T401" | "T402" | "journey-stop" | "rail-station";
type Evidence = Awaited<ReturnType<typeof textEvidence>>;

async function textEvidence(popup: Locator) {
  return popup.locator(".leaflet-popup-content").evaluate(root => {
    const popup = root.closest(".leaflet-popup")!;
    const map = root.closest(".leaflet-container")!;
    const box = (e: Element) => { const r = e.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
    const m = box(map), p = box(popup);
    const samples: { text: string; x: number; y: number; hit: boolean; bus: boolean; stop: boolean; target: string }[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const text = node.textContent?.trim(); if (!text) continue;
      const range = document.createRange(); range.selectNodeContents(node);
      for (const r of range.getClientRects()) {
        if (r.width < 2 || r.height < 2) continue;
        for (const y of [r.top + r.height * .35, r.top + r.height * .65]) {
          for (let x = r.left + 1; x < r.right - 1; x += 4) {
            if (x <= m.left || x >= m.right || y <= m.top || y >= m.bottom || x < 0 || x >= innerWidth || y < 0 || y >= innerHeight) continue;
            const hit = document.elementFromPoint(x, y);
            const underneath = document.elementsFromPoint(x, y);
            samples.push({ text, x, y, hit: !!hit && root.contains(hit),
              bus: underneath.some(e => e.closest(".bus-vehicle-icon")),
              stop: underneath.some(e => e.closest(".bus-journey-stop")),
              target: hit?.tagName + "." + hit?.getAttribute("class") });
          }
        }
      }
    }
    const close = popup.querySelector(".leaflet-popup-close-button")!, c = box(close);
    return { viewport: { width: innerWidth, height: innerHeight }, popup: p, map: m,
      parent: popup.parentElement?.className, samples, close: c,
      closeHits: [[c.left + 1, c.top + 1], [c.right - 1, c.top + 1], [c.left + 1, c.bottom - 1],
        [c.right - 1, c.bottom - 1], [c.left + c.width / 2, c.top + c.height / 2]]
        .map(([x, y]) => close.contains(document.elementFromPoint(x, y))) };
  });
}
async function save(page: Page, info: TestInfo, label: string, evidence?: Evidence) {
  if (evidence) await info.attach(label + "-hit-tests", { body: JSON.stringify(evidence, null, 2), contentType: "application/json" });
  await page.screenshot({ path: info.outputPath(label + ".png"), animations: "disabled" });
}
async function prepare(page: Page, width: number) {
  await page.setViewportSize({ width, height: width === 1101 ? 830 : 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.clock.setFixedTime(new Date(start));
  const forbidden: string[] = [];
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    // Local overlay fixture only; this suite does not claim real-basemap acceptance.
    if (url.hostname === "tile.openstreetmap.org") return route.fulfill({
      contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><path fill="#eef1f2" d="M0 0h256v256H0z"/></svg>',
    });
    if (url.hostname === "127.0.0.1" || url.hostname === "localhost") return route.continue();
    forbidden.push(url.href); return route.abort();
  });
  await page.goto("/");
  const map = page.locator(".leaflet-container");
  await expect(map.locator(".bus-vehicle-icon")).toHaveCount(8);
  await page.getByRole("group", { name: "Map camera" }).getByRole("button", { name: "Overview", exact: true }).click();
  return { map, forbidden };
}
async function selectBus(page: Page, route: "T401" | "T402", mobile: boolean) {
  await selectVehicle(page, "Bus " + route + "-01");
  const detail = page.getByRole("region", { name: "Bus journey detail" });
  await expect(detail).toBeVisible();
  if (mobile) await detail.getByRole("button", { name: "Collapse journey" }).click();
}
async function close(page: Page, popup: Locator, mobile: boolean) {
  if (mobile) await popup.getByRole("button", { name: "Close popup" }).tap();
  else await popup.getByRole("button", { name: "Close popup" }).click();
  await expect(popup).toHaveCount(0);
}
function overlap(e: Evidence, kind: Kind) {
  return e.samples.some(s => s.bus) && (kind === "rail-station" || e.samples.some(s => s.stop));
}
async function assertContent(popup: Locator, kind: Kind) {
  await expect(popup).toContainText("SIMULATED");
  if (kind === "T401" || kind === "T402") {
    await expect(popup).toContainText("Bus " + kind + "-01");
    await expect(popup).toContainText(/At stop|In service/);
    await expect(popup).toContainText("km/h");
  } else if (kind === "journey-stop") await expect(popup).toContainText(/Route T40[12]/);
}
function assertPaint(e: Evidence, mobile: boolean) {
  expect(e.parent).toContain("leaflet-popup-pane");
  expect(e.samples.length).toBeGreaterThan(0);
  expect(e.samples.filter(s => !s.hit)).toEqual([]);
  expect(e.closeHits).toEqual([true, true, true, true, true]);
  expect(e.popup.left).toBeGreaterThanOrEqual(e.map.left - .5);
  expect(e.popup.right).toBeLessThanOrEqual(e.map.right + .5);
  expect(e.popup.top).toBeGreaterThanOrEqual(e.map.top - .5);
  expect(e.popup.bottom).toBeLessThanOrEqual(e.map.bottom + .5);
  if (mobile) { expect(e.close.width).toBe(44); expect(e.close.height).toBe(44); }
}
for (const kind of ["T401", "T402", "journey-stop", "rail-station"] as const) {
  test(kind + " popup paints above real overlapping markers and keeps its close target", async ({ page, isMobile }, info) => {
    test.setTimeout(120_000);
    for (const width of isMobile ? [375, 390] : [1101]) {
      const label = kind + "-" + width;
      let evidence: Evidence | undefined;
      try {
        const { map, forbidden } = await prepare(page, width);
        const popup = map.locator(".leaflet-popup").filter({ has: page.locator(
          kind === "journey-stop" ? ".journey-stop-popup" : kind === "rail-station" ? ".leaflet-popup-content strong" : ".bus-vehicle-popup") });
        let found = false;
        if (kind !== "rail-station") {
          await selectBus(page, kind === "T402" ? "T402" : "T401", isMobile);
          for (const zoom of [13, 12, 14]) {
            await setMapZoom(map, zoom);
            if (kind === "journey-stop") {
              const pins = map.locator(".bus-journey-stop");
              const indices = await pins.evaluateAll(elements => elements.flatMap((e, index) => {
                const r = e.getBoundingClientRect(), m = e.closest(".leaflet-container")!.getBoundingClientRect();
                return r.left >= m.left + 20 && r.right <= m.right - 20 && r.top >= Math.max(m.top + 30, 0) && r.bottom <= Math.min(m.bottom - 20, innerHeight) ? [index] : [];
              }));
              for (const index of indices.slice(0, 24)) {
                await pins.nth(index).press("Enter");
                await expect(popup).toHaveCount(1);
                await assertContent(popup, kind); evidence = await textEvidence(popup);
                if (overlap(evidence, kind)) { found = true; break; }
                await close(page, popup, isMobile);
              }
            } else {
              await map.getByTitle("Bus " + kind + "-01", { exact: true }).click();
              await expect(popup).toHaveCount(1);
              await assertContent(popup, kind); evidence = await textEvidence(popup);
              if (overlap(evidence, kind)) found = true;
              else await close(page, popup, isMobile);
            }
            if (found) break;
          }
        } else {
          // Rail selection removes journey stops by design. Require actual bus
          // overlap here, and cover journey-stop overlap in the bus/stop cases.
          for (const name of ["Taman Midah", "Maluri", "Cochrane", "Salak Selatan"]) {
            const index = railNetwork.stations.filter(station => station.mode !== "Bus").findIndex(station => station.name === name);
            if (index < 0) continue;
            await chooseSearchStation(page, name);
            // Preserve the overlap fixture's native-marker entry point after automatic result popup opening.
            await expect(popup).toHaveCount(1); await close(page, popup, isMobile);
            await page.getByRole("button", { name: "Clear station search" }).click();
            await map.scrollIntoViewIfNeeded(); await setMapZoom(map, 12);
            await map.locator(".rail-station").nth(index).click({ timeout: 5000 });
            await expect(popup).toHaveCount(1); await expect(popup).toContainText(name);
            await assertContent(popup, kind); evidence = await textEvidence(popup);
            if (overlap(evidence, kind)) { found = true; break; }
            await close(page, popup, isMobile);
          }
        }
        await save(page, info, label + "-overlap", evidence);
        expect(found, "Committed fixtures must produce a genuine text/marker overlap; do not infer PASS from pane names").toBe(true);
        assertPaint(evidence!, isMobile);
        await close(page, popup, isMobile);
        expect(forbidden).toEqual([]);
      } finally {
        await save(page, info, label + "-final", evidence);
      }
    }
  });
}
