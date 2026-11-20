import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { setMapZoom } from "./map-zoom";

const start = Date.parse("2026-11-17T09:41:25Z");
async function frames(page: Page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function prepare(page: Page, width: number) {
  await page.setViewportSize({ width, height: width === 1101 ? 830 : 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.clock.setFixedTime(new Date(start));
  const external: string[] = [];
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.hostname === "tile.openstreetmap.org") return route.fulfill({
      contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><path fill="#eef1f2" d="M0 0h256v256H0z"/></svg>',
    });
    if (["127.0.0.1", "localhost"].includes(url.hostname)) return route.continue();
    external.push(url.href); return route.abort();
  });
  await page.goto("/");
  const map = page.locator(".leaflet-container");
  await expect(map.locator(".bus-vehicle-icon")).toHaveCount(8);
  await page.getByRole("group", { name: "Map camera" }).getByRole("button", { name: "Overview", exact: true }).click();
  await frames(page);
  return { map, external };
}
async function bus(page: Page, route: string, mobile: boolean) {
  await page.getByRole("row").filter({ has: page.getByRole("cell", { name: "Bus " + route + "-01", exact: true }) })
    .getByRole("button", { name: "View details" }).click();
  if (mobile) await page.getByRole("button", { name: "Collapse journey", exact: true }).click();
  await frames(page);
}
const camera = (map: Locator) => map.evaluate(element => Object.fromEntries([...element.attributes]
  .filter(a => /^data-camera-(state|intent|vehicle|latitude|longitude|zoom)$/.test(a.name)).map(a => [a.name, a.value])));
async function putAt(page: Page, map: Locator, pin: Locator, x: number, y: number) {
  await map.scrollIntoViewIfNeeded(); await frames(page);
  for (let attempt = 0; attempt < 14; attempt++) {
    const m = (await map.boundingBox())!, p = (await pin.boundingBox())!;
    const px = p.x + p.width / 2 - m.x, py = p.y + p.height / 2 - m.y;
    if (Math.abs(px - x) <= 2 && Math.abs(py - y) <= 2) return;
    const from = await map.evaluate(element => {
      const b = element.getBoundingClientRect();
      for (let y = b.top + 125; y < Math.min(b.bottom - 50, innerHeight - 50); y += 20)
        for (let x = b.left + 70; x < b.right - 60; x += 20) {
          const hit = document.elementFromPoint(x, y);
          if (hit?.closest(".leaflet-container") === element &&
            !hit.closest(".leaflet-interactive,.leaflet-control,.leaflet-popup,.transport-icon")) return { x, y };
        }
      throw Error("No bare map surface for a real drag");
    });
    const dx = Math.round(Math.max(-90, Math.min(90, x - px))), dy = Math.round(Math.max(-70, Math.min(70, y - py)));
    await page.mouse.move(from.x, from.y); await page.mouse.down();
    await page.mouse.move(from.x + dx, from.y + dy, { steps: 4 }); await page.mouse.up(); await frames(page);
  }
  throw Error("Real map drag could not achieve requested marker-edge precondition");
}
async function measure(popup: Locator) {
  return popup.evaluate(element => {
    const map = element.closest(".leaflet-container")!, content = element.querySelector(".leaflet-popup-content")!;
    const close = element.querySelector(".leaflet-popup-close-button")!, zoom = map.querySelector(".leaflet-control-zoom")!;
    const rect = (e: Element) => { const b = e.getBoundingClientRect(); return { left: b.left, top: b.top, right: b.right, bottom: b.bottom, width: b.width, height: b.height }; };
    const area = (a: ReturnType<typeof rect>, b: ReturnType<typeof rect>) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
    const p = rect(element), c = rect(close), z = rect(zoom), m = rect(map);
    const clip = { left: Math.max(0, m.left), right: Math.min(innerWidth, m.right), top: Math.max(0, m.top), bottom: Math.min(innerHeight, m.bottom) };
    const ancestors = [];
    for (let ancestor: Element | null = map; ancestor; ancestor = ancestor.parentElement) {
      const css = getComputedStyle(ancestor), box = rect(ancestor);
      ancestors.push({ class: ancestor.className, rect: box, overflowX: css.overflowX, overflowY: css.overflowY, transform: css.transform });
      if (/^(hidden|clip|auto|scroll)$/.test(css.overflowX)) { clip.left = Math.max(clip.left, box.left); clip.right = Math.min(clip.right, box.right); }
      if (/^(hidden|clip|auto|scroll)$/.test(css.overflowY)) { clip.top = Math.max(clip.top, box.top); clip.bottom = Math.min(clip.bottom, box.bottom); }
    }
    const texts = [], badHits: { text: string; target: string | null; x: number; y: number }[] = [];
    const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT); let node: Node | null;
    while ((node = walker.nextNode())) {
      const text = node.textContent?.trim(); if (!text) continue;
      const range = document.createRange(); range.selectNodeContents(node);
      for (const b of range.getClientRects()) {
        const box = { left: b.left, top: b.top, right: b.right, bottom: b.bottom, width: b.width, height: b.height };
        texts.push({ text, rect: box, zoomIntersection: area(box, z), closeIntersection: area(box, c) });
        for (const y of [b.top + b.height * .35, b.top + b.height * .65])
          for (let x = b.left + 1; x < b.right - 1; x += 4) {
            if (x <= clip.left || x >= clip.right || y <= clip.top || y >= clip.bottom) continue;
            const hit = document.elementFromPoint(x, y);
            if (!hit || !content.contains(hit)) badHits.push({ text, target: hit?.tagName + "." + hit?.getAttribute("class"), x, y });
          }
      }
    }
    const tip = element.querySelector(".leaflet-popup-tip");
    return { viewport: { width: innerWidth, height: innerHeight }, popup: p, content: rect(content), close: c, map: m, clip,
      tip: tip ? rect(tip) : null, zoom: z, zoomPosition: zoom.parentElement?.className, pane: element.parentElement?.className,
      shift: (element as HTMLElement).style.getPropertyValue("--bus-popup-shift"), text: content.textContent, texts, badHits, ancestors,
      zoomIntersection: area(p, z), textZoomIntersection: texts.reduce((n, t) => n + t.zoomIntersection, 0),
      textCloseIntersection: texts.reduce((n, t) => n + t.closeIntersection, 0),
      closeHits: [[c.left + 1, c.top + 1], [c.right - 1, c.top + 1], [c.left + 1, c.bottom - 1],
        [c.right - 1, c.bottom - 1], [(c.left + c.right) / 2, (c.top + c.bottom) / 2]]
        .map(([x, y]) => close.contains(document.elementFromPoint(x, y))),
      conflict: (map as HTMLElement).dataset.journeyZoomConflict ?? null };
  });
}
type Measurement = Awaited<ReturnType<typeof measure>>;
async function evidence(page: Page, info: TestInfo, name: string, popup: Locator, extra: object = {}) {
  const data = { ...await measure(popup), ...extra };
  writeFileSync(info.outputPath(name + ".json"), JSON.stringify(data, null, 2));
  await page.screenshot({ path: info.outputPath(name + ".png"), scale: "css", animations: "disabled" });
  return data;
}
function paint(data: Measurement, mobile: boolean) {
  expect(data.closeHits).toEqual([true, true, true, true, true]);
  expect(data.badHits).toEqual([]);
  expect(data.textCloseIntersection).toBe(0);
  expect(data.popup.left).toBeGreaterThanOrEqual(data.clip.left - .5);
  expect(data.popup.right).toBeLessThanOrEqual(data.clip.right + .5);
  expect(data.close.left).toBeGreaterThanOrEqual(data.clip.left - .5);
  expect(data.close.right).toBeLessThanOrEqual(data.clip.right + .5);
  expect(data.close.top).toBeGreaterThanOrEqual(data.clip.top - .5);
  expect(data.close.bottom).toBeLessThanOrEqual(data.clip.bottom + .5);
  if (mobile) { expect(data.close.width).toBe(44); expect(data.close.height).toBe(44); }
}
async function close(popup: Locator) {
  await popup.getByRole("button", { name: "Close popup", exact: true }).click({ timeout: 5000 });
  await expect(popup).toHaveCount(0);
}
for (const route of ["T401", "T402"]) for (const side of ["left", "right"]) {
  test("bus " + route + " contains " + side + " edge without camera movement", async ({ page, isMobile }, info) => {
    test.setTimeout(120_000);
    for (const width of isMobile ? [375, 390] : [1101]) {
      const { map, external } = await prepare(page, width); await bus(page, route, isMobile); await setMapZoom(map, 13);
      const marker = map.getByTitle("Bus " + route + "-01", { exact: true }), box = (await map.boundingBox())!;
      // Stay inside the protected controller's existing zoom-control safe strip.
      // The unadjusted bubble must still cross the left containment inset.
      const zoomBox = (await map.locator(".leaflet-control-zoom").boundingBox())!;
      const targetX = side === "left" ? zoomBox.x + zoomBox.width - box.x + 30 : box.width - 30;
      await putAt(page, map, marker, targetX, box.height - 60);
      await page.clock.setFixedTime(new Date(start + 1000)); await frames(page);
      const before = await camera(map), source = (await marker.boundingBox())!;
      expect(Math.abs(source.x + source.width / 2 - box.x - targetX)).toBeLessThanOrEqual(2);
      await marker.press("Enter");
      const popup = map.locator(".leaflet-popup").filter({ has: page.locator(".bus-vehicle-popup") });
      await expect(popup).toHaveCount(1); await frames(page);
      await expect.poll(async () => (await measure(popup)).badHits.length).toBe(0);
      const after = await camera(map), data = await evidence(page, info, route + "-" + side + "-" + width, popup, { before, after, source });
      paint(data, isMobile); expect(after).toEqual(before);
      expect(Math.abs((data.tip!.left + data.tip!.right) / 2 - source.x - source.width / 2)).toBeLessThanOrEqual(1.5);
      expect(Math.abs(Number.parseFloat(data.shift))).toBeGreaterThan(1);
      if (side === "left") expect(data.popup.left - Number.parseFloat(data.shift)).toBeLessThan(data.clip.left + 6);
      await close(popup); expect(external).toEqual([]);
    }
  });
}
for (const length of ["short", "long"]) for (const expanded of [false, true]) {
  test("journey " + length + (expanded ? " expanded" : " collapsed") + " separates the one zoom control", async ({ page, isMobile }, info) => {
    test.setTimeout(120_000);
    for (const width of isMobile ? [375, 390] : [1101]) {
      const { map, external } = await prepare(page, width); await bus(page, "T402", isMobile); await setMapZoom(map, 13);
      if (isMobile && expanded) { await page.getByRole("button", { name: "Expand journey", exact: true }).click(); await frames(page); }
      const titles = await map.locator(".bus-journey-stop").evaluateAll(pins => pins.map(pin => pin.getAttribute("title")!).sort((a, b) => a.length - b.length));
      const title = length === "short" ? titles[0] : titles.at(-1)!;
      expect(title.length).toBe(length === "short" ? Math.min(...titles.map(t => t.length)) : Math.max(...titles.map(t => t.length)));
      if (length === "long") expect(title.length).toBeGreaterThanOrEqual(30);
      const pin = map.getByRole("button", { name: title, exact: true }), box = (await map.boundingBox())!;
      await expect(pin).toHaveCount(1);
      await putAt(page, map, pin, box.width / 2, Math.min(190, box.height - 60));
      await pin.press("Enter"); await page.clock.setFixedTime(new Date(start + 1000)); await frames(page);
      const popup = map.locator(".leaflet-popup").filter({ has: page.locator(".journey-stop-popup") });
      await expect(popup).toContainText(title);
      const data = await evidence(page, info, (expanded ? "expanded-" : "collapsed-") + title.slice(0, 12).replaceAll(" ", "-") + "-" + width, popup);
      paint(data, isMobile); expect(data.conflict).toBeNull();
      expect(data.zoomIntersection).toBe(0); expect(data.textZoomIntersection).toBe(0);
      await expect(map.locator(".leaflet-control-zoom")).toHaveCount(1);
      const zoom = Number(await map.getAttribute("data-bus-zoom"));
      await map.getByRole("button", { name: "Zoom in", exact: true }).click(); await frames(page);
      await expect(map).toHaveAttribute("data-bus-zoom", String(zoom + 1));
      await map.getByRole("button", { name: "Zoom out", exact: true }).click(); await frames(page);
      await expect(map).toHaveAttribute("data-bus-zoom", String(zoom));
      await map.focus(); await map.press("Minus"); await frames(page);
      await expect(map).toHaveAttribute("data-bus-zoom", String(zoom - 1));
      await expect(map).toHaveAttribute("data-camera-state", "FREE_EXPLORE");
      await close(popup);
      await expect(map.locator(".leaflet-top.leaflet-left .leaflet-control-zoom")).toHaveCount(1);
      expect(external).toEqual([]);
    }
  });
}
for (const name of ["Taman Midah", "Maluri", "KL Sentral"]) {
  test("rail " + name + " reserves its mobile close gutter", async ({ page, isMobile }, info) => {
    test.setTimeout(120_000);
    for (const width of isMobile ? [375, 390] : [1101]) {
      const { map, external } = await prepare(page, width);
      const names = await page.locator("#records tbody tr").evaluateAll(rows => rows.filter(r => {
        const cells = r.querySelectorAll("td"); return ["MRT", "LRT", "Monorail", "KTM"].includes(cells[1]?.textContent?.trim() ?? "") && cells[3]?.textContent?.trim() === "Station available";
      }).map(r => r.querySelector("td")!.textContent!.trim()));
      const index = names.indexOf(name); expect(index).toBeGreaterThanOrEqual(0);
      await page.getByRole("row").filter({ has: page.getByRole("cell", { name, exact: true }) }).getByRole("button", { name: "View details" }).click();
      // View details now opens the native popup. Retire it before testing a separate marker click at zoom 12.
      const automatic = map.locator(".leaflet-popup").filter({ has: page.locator(".rail-station-popup") });
      await expect(automatic).toHaveCount(1); await close(automatic);
      await map.scrollIntoViewIfNeeded(); await setMapZoom(map, 12);
      await map.locator(".rail-station").nth(index).click();
      const popup = map.locator(".leaflet-popup").filter({ has: page.locator(".rail-station-popup") });
      await expect(popup).toContainText(name); await page.clock.setFixedTime(new Date(start + 1000)); await page.waitForTimeout(350); await frames(page);
      const data = await evidence(page, info, name.replaceAll(" ", "-") + "-" + width, popup);
      paint(data, isMobile); expect(data.textCloseIntersection).toBe(0); await close(popup); expect(external).toEqual([]);
    }
  });
}
test("LinkBike station intent, availability popup and train markers remain functional", async ({ page, isMobile }, info) => {
  test.setTimeout(120_000);
  for (const width of isMobile ? [375, 390] : [1101]) {
    const { map, external } = await prepare(page, width);
    await expect(page.getByRole("checkbox", { name: "Show simulated train positions" })).toHaveCount(0);
    await expect(map.locator(".estimated-train-icon")).not.toHaveCount(0);
    const train = map.locator(".estimated-train-icon").first();
    await map.scrollIntoViewIfNeeded();
    const trainName = (await train.getAttribute("title"))!.split(" towards ")[0];
    await page.getByRole("row").filter({has:page.getByRole("cell",{name:trainName,exact:true})}).getByRole("button",{name:"View details"}).click();
    await frames(page);
    const trainMap = (await map.boundingBox())!;
    await putAt(page, map, train, trainMap.width / 2, trainMap.height - 60);
    await train.press("Enter");
    const trainPopup = map.locator(".leaflet-popup").filter({ has: page.locator(".estimated-train-popup") });
    await expect(trainPopup).toContainText("SIMULATED");
    await evidence(page, info, "train-" + width, trainPopup);
    await close(trainPopup);
    await expect(page.getByRole("checkbox", { name: "Show LinkBike stations" })).toHaveCount(0);
    await expect(map.locator(".linkbike-marker")).not.toHaveCount(0);
    const bike = map.locator(".linkbike-marker").first();
    const bikeName = (await bike.getAttribute("title"))!.replace(/^LinkBike: /, "");
    await page.getByRole("textbox", { name: "Search vehicles, routes or stations" }).fill(bikeName);
    await page.getByRole("listbox", { name: "Station search results" }).getByRole("option", { name: new RegExp(bikeName) }).click();
    await expect(map.locator(".linkbike-popup")).toBeVisible();
    await close(map.locator(".leaflet-popup").filter({ has: page.locator(".linkbike-popup") }));
    await page.getByRole("button", { name: "Clear station search" }).click();
    await page.getByRole("row").filter({has:page.getByRole("cell",{name:bikeName,exact:true})}).getByRole("button",{name:"View details"}).click();
    await expect(map).toHaveAttribute("data-camera-intent", "selection");
    await map.scrollIntoViewIfNeeded(); await frames(page);
    await bike.press("Enter");
    const popup = map.locator(".leaflet-popup").filter({ has: page.locator(".linkbike-popup") });
    await expect(popup).toContainText("Available bicycles"); await expect(popup).toContainText("Total docks"); await expect(popup).toContainText("SIMULATED");
    await expect(popup.locator(".rail-station-popup")).toHaveCount(0);
    await page.clock.setFixedTime(new Date(start + 1000)); await page.waitForTimeout(350); await frames(page);
    const bikeLayout = await evidence(page, info, "LinkBike-" + width, popup);
    paint(bikeLayout, isMobile);
    const before = await camera(map);
    await page.evaluate(() => { window.dispatchEvent(new Event("resize")); window.dispatchEvent(new Event("scroll")); }); await frames(page);
    expect(await camera(map)).toEqual(before);
    await expect(map).toHaveAttribute("data-camera-intent", "selection");
    await close(popup);
    const serviceUpdates = page.getByRole("button", { name: "Service updates" });
    await serviceUpdates.click();
    await expect(serviceUpdates).toContainText("Simulated notices");
    await expect(page.getByRole("region", { name: "Service alerts" }).getByRole("listitem").first())
      .toContainText("TransitScope simulation");
    await serviceUpdates.click();
    for (const path of ["/api/transit", "/api/alerts", "/api/train-positions", "/api/micromobility/linkbike"]) {
      const response = await page.request.get(path); expect(response.ok()).toBe(true); expect(await response.text()).toContain("SIMULATED");
    }
    expect(external).toEqual([]);
  }
});
