import { expect, test } from "@playwright/test";

async function containedPopup(page: import("@playwright/test").Page, popup: import("@playwright/test").Locator) {
  await page.locator(".leaflet-container").scrollIntoViewIfNeeded();
  await expect(page.locator(".micromobility-popup-shell").filter({has:popup})).toHaveCSS("opacity", "1");
  await expect.poll(() => popup.evaluate(section => {
    const element = section.closest(".leaflet-popup")!;
    const p = element.getBoundingClientRect(), m = element.closest(".leaflet-container")!.getBoundingClientRect();
    const zoom = element.closest(".leaflet-container")!.querySelector(".leaflet-control-zoom")!.getBoundingClientRect();
    return { inside: p.left >= m.left && p.right <= m.right && p.top >= m.top && p.bottom <= m.bottom,
      zoomOverlap: Math.max(0, Math.min(p.right,zoom.right)-Math.max(p.left,zoom.left)) * Math.max(0,Math.min(p.bottom,zoom.bottom)-Math.max(p.top,zoom.top)),
      popup: { left:p.left, right:p.right, top:p.top, bottom:p.bottom }, map:{left:m.left,right:m.right,top:m.top,bottom:m.bottom} };
  })).toMatchObject({ inside:true, zoomOverlap:0 }).catch(async error => {
    console.log(await popup.evaluate(section => { const e=section.closest(".leaflet-popup")!,p=e.getBoundingClientRect(),m=e.closest(".leaflet-container")!.getBoundingClientRect();
      return {popup:p.toJSON(), map:m.toJSON(), style:e.getAttribute("style"),camera:{...(e.closest(".leaflet-container") as HTMLElement).dataset}}; }));
    await page.screenshot({path:test.info().outputPath("containment-failure.png")});
    throw error;
  });
}

test("all micromobility layers and popup provenance work without the coverage panel", async ({ page, request, isMobile }, info) => {
  await page.setViewportSize(isMobile ? { width:375, height:844 } : { width:1440, height:1000 });
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  const panel = page.locator("#map > .panel").first();
  await expect(panel.getByRole("heading", { name: "Transport map" })).toBeVisible();
  await expect(panel.getByText(/\d+ results/)).toBeVisible();
  await expect(panel.getByRole("button", { name: "Fit to region" })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Bandar Tasik Selatan status" })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Refresh train positions" })).toBeVisible();
  await expect(panel.getByText("Availability by line", { exact: true })).toBeVisible();
  await expect(panel.locator(".micromobility-coverage, .linkbike-controls, .linkbike-map-status")).toHaveCount(0);
  await expect(panel.getByRole("button", { name: /Zoom to (LinkBike|HelloRide|TRYKE|Beam Mobility)/ })).toHaveCount(0);
  await expect(panel).not.toContainText(/Micromobility coverage|coverage locations|simulated LinkBike stations on the map|Dashed markers|Live vehicle availability|used for demonstration and coverage visualization/);
  await expect(page.locator(".linkbike-marker")).toHaveCount(27);
  for (const operator of ["helloride", "tryke", "beam"]) await expect(page.locator(`.micromobility-${operator}`)).toHaveCount(16);
  await expect(page.locator(".micromobility-marker.synthetic")).toHaveCount(46);
  await expect(page.locator(".micromobility-marker.source-backed")).toHaveCount(2);
  await expect(panel.locator(".rail-alignment")).toHaveCount(8);
  const controlGap = await panel.locator(".estimated-train-controls + .map-camera-frame").evaluate(frame =>
    frame.getBoundingClientRect().top - frame.previousElementSibling!.getBoundingClientRect().bottom);
  expect(controlGap).toBeLessThanOrEqual(8);
  await expect(page.locator('[title="HelloRide · Penang Times Square surroundings"]')).toHaveCount(1);
  // Keyboard selection works even when the all-coverage view has dense points.
  const synthetic = page.locator('[title="HelloRide · Penang Times Square surroundings"]');
  await synthetic.focus(); await synthetic.press("Enter");
  const popup = page.getByRole("region", { name:"HelloRide location details" });
  // section with accessible name has region semantics.
  await expect(popup).toBeVisible(); await expect(popup).toContainText("SYNTHETIC DEMONSTRATION LOCATION");
  await expect(popup).toContainText("DEMONSTRATION_ONLY"); await expect(popup).toContainText("Not available");
  await expect(popup).toContainText("Available bicycles");
  await expect(popup).toContainText("Total docks");
  await expect(popup).toContainText("SIMULATED INVENTORY");
  await containedPopup(page, popup);
  await page.screenshot({ path:info.outputPath("synthetic-popup.png") });
  await page.getByRole("button", {name:"Close popup",exact:true}).click();
  await expect(popup).toHaveCount(0);
  const backed = page.locator('[title="TRYKE · Millennium Monument surroundings"]');
  await backed.focus(); await backed.press("Enter");
  const sourcePopup = page.getByRole("region", {name:"TRYKE location details"});
  await expect(sourcePopup).toContainText("SOURCE-BACKED LOCATION · APPROXIMATE POSITION");
  await expect(sourcePopup.getByRole("link")).toHaveAttribute("href", "https://smart.putrajaya.my/en/initiatives/tryke-micromobility/");
  await containedPopup(page, sourcePopup);
  await page.screenshot({path:info.outputPath("source-popup.png")});
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const api = await request.get("/api/micromobility/stations?operator=BEAM&state=Penang");
  expect(api.status()).toBe(200); expect((await api.json()).stations).toHaveLength(5);
  const linkbike = await request.get("/api/micromobility/linkbike");
  expect((await linkbike.json()).stations).toHaveLength(27);
  expect(errors).toEqual([]);
});

test("all new operator popups display deterministic simulated inventory like LinkBike", async ({page,request},info) => {
  await page.goto("/");
  await expect(page.locator(".micromobility-marker")).toHaveCount(48);
  const data=await (await request.get("/api/micromobility/stations")).json();
  for (const operator of ["HELLORIDE","TRYKE","BEAM"]) {
    const station=data.stations.find((s:{operator:string;id:string})=>s.operator===operator && s.id.endsWith(operator==="TRYKE"?":millennium":":george-town"));
    await page.getByTitle(station.name,{exact:true}).press("Enter");
    const popup=page.locator(".micromobility-popup");
    const inventory=popup.getByRole("definition");
    await expect(popup.getByText("Available bicycles",{exact:true})).toBeVisible();
    await expect(inventory.nth(0)).toHaveText(String(station.simulatedInventory.availableBicycles));
    await expect(popup.getByText("Total docks",{exact:true})).toBeVisible();
    await expect(inventory.nth(1)).toHaveText(String(station.simulatedInventory.totalDocks));
    await expect(popup).toContainText("SIMULATED INVENTORY");
    const disclaimer=popup.getByText("Available bicycles and total docks are simulated for demonstration purposes and do not represent actual operator inventory or real-time availability.",{exact:true});
    await disclaimer.scrollIntoViewIfNeeded(); await expect(disclaimer).toBeVisible();
    await expect(popup).toContainText(station.verificationStatus);
    await containedPopup(page,popup);
    await page.screenshot({path:info.outputPath(`${operator.toLowerCase()}-inventory.png`)});
    await page.getByRole("button",{name:"Close popup",exact:true}).click(); await expect(popup).toHaveCount(0);
  }
});

test("a transient stations API failure retries automatically while LinkBike remains available", async ({page}) => {
  await page.route("**/api/micromobility/stations", route => route.fulfill({status:503,body:'{}'}), {times:1});
  const failure = page.waitForResponse(response => response.url().endsWith("/api/micromobility/stations") && response.status() === 503);
  await page.goto("/");
  await failure;
  await expect(page.locator(".linkbike-marker")).toHaveCount(27);
  await expect(page.locator(".micromobility-marker")).toHaveCount(48);
  await expect(page.getByRole("button", {name:"Retry micromobility locations"})).toHaveCount(0);
});

test("loading micromobility markers does not shift the transport map", async ({page}) => {
  let release: () => void = () => {};
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/micromobility/stations", async route => { await pending; await route.continue(); });
  await page.goto("/");
  await expect(page.locator(".linkbike-marker")).toHaveCount(27);
  const map = page.locator(".leaflet-container");
  await expect(map).toBeVisible();
  const before = await map.boundingBox();
  release();
  await expect(map.locator(".micromobility-marker")).toHaveCount(48);
  expect(await map.boundingBox()).toEqual(before);
});
