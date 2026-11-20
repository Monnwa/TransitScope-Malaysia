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

test("all micromobility layers, coverage, zoom and popup provenance", async ({ page, request, isMobile }, info) => {
  await page.setViewportSize(isMobile ? { width:375, height:844 } : { width:1440, height:1000 });
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  const coverage = page.getByRole("region", { name: "Micromobility coverage · SIMULATED" });
  await expect(coverage).toContainText("75 coverage locations · 2 source-backed (approximate positions) · 73 synthetic");
  await expect(page.getByRole("group", { name: "Micromobility coverage · SIMULATED" })).toHaveCount(0);
  await expect(page.locator(".rail-map-group").getByRole("checkbox")).toHaveCount(0);
  await expect(coverage.locator(".micromobility-operator strong")).toHaveText([
    "LinkBike: 27", "HelloRide: 16", "TRYKE: 16", "Beam Mobility: 16",
  ]);
  await expect(coverage.locator(".micromobility-operator small")).toHaveText([
    "0 source-backed · 27 synthetic", "0 source-backed · 16 synthetic",
    "2 source-backed · 14 synthetic", "0 source-backed · 16 synthetic",
  ]);
  await expect(page.locator(".linkbike-marker")).toHaveCount(27);
  for (const operator of ["helloride", "tryke", "beam"]) await expect(page.locator(`.micromobility-${operator}`)).toHaveCount(16);
  await expect(page.locator(".micromobility-marker.synthetic")).toHaveCount(46);
  await expect(page.locator(".micromobility-marker.source-backed")).toHaveCount(2);
  const map = page.locator(".leaflet-container");
  for (const [name, selector] of [
    ["LinkBike stations", ".linkbike-marker"], ["TRYKE", ".micromobility-tryke"],
    ["Beam Mobility", ".micromobility-beam"], ["HelloRide", ".micromobility-helloride"],
  ]) {
    await page.getByRole("button", { name: `Zoom to ${name}`, exact: true }).click();
    await expect.poll(() => map.evaluate((element, markerSelector) => {
      const bounds = element.getBoundingClientRect();
      return Array.from(element.querySelectorAll(markerSelector)).every(marker => {
        const box = marker.getBoundingClientRect();
        return box.left >= bounds.left && box.right <= bounds.right && box.top >= bounds.top && box.bottom <= bounds.bottom;
      });
    }, selector)).toBe(true);
  }
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

test("new data failure and retry leave LinkBike functional", async ({page}) => {
  await page.route("**/api/micromobility/stations", route => route.fulfill({status:503,body:'{}'}));
  await page.goto("/");
  await expect(page.getByText("New operator locations unavailable. LinkBike remains independent.")).toBeVisible();
  await expect(page.locator(".linkbike-marker")).toHaveCount(27);
  await page.unroute("**/api/micromobility/stations");
  await page.getByRole("button", {name:"Retry micromobility locations"}).click();
  await expect(page.locator(".micromobility-marker")).toHaveCount(48);
});

test("loading coverage counts does not shift the transport map", async ({page}) => {
  let release: () => void = () => {};
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/micromobility/stations", async route => { await pending; await route.continue(); });
  await page.goto("/");
  await expect(page.locator(".linkbike-marker")).toHaveCount(27);
  const controls = page.getByRole("region", {name:"Micromobility coverage · SIMULATED"});
  await expect(controls).toContainText("Loading micromobility coverage");
  const before = await controls.boundingBox();
  release();
  await expect(controls).toContainText("75 coverage locations");
  const after = await controls.boundingBox();
  expect(after?.height).toBe(before?.height);
  expect(after?.y).toBe(before?.y);
});
