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

test("all micromobility layers, independent toggles, coverage and popup provenance", async ({ page, request, isMobile }, info) => {
  await page.setViewportSize(isMobile ? { width:375, height:844 } : { width:1440, height:1000 });
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  const controls = page.getByRole("group", { name: "Micromobility coverage · SIMULATED" });
  await expect(controls).toContainText("75 coverage locations · 2 source-backed");
  for (const name of ["LinkBike", "HelloRide", "TRYKE", "Beam Mobility"]) await expect(page.getByRole("checkbox", { name:`Show ${name}`, exact:true })).toBeChecked();
  await expect(page.locator(".linkbike-marker")).toHaveCount(27);
  for (const operator of ["helloride", "tryke", "beam"]) await expect(page.locator(`.micromobility-${operator}`)).toHaveCount(16);
  await expect(page.locator(".micromobility-marker.synthetic")).toHaveCount(46);
  await expect(page.locator(".micromobility-marker.source-backed")).toHaveCount(2);
  const map = page.locator(".leaflet-container");
  const before = await map.getAttribute("data-camera-zoom");
  const railCount = await page.locator(".rail-station").count();
  for (const [name, selector, count] of [["HelloRide", ".micromobility-helloride",16], ["TRYKE", ".micromobility-tryke",16], ["Beam Mobility", ".micromobility-beam",16], ["LinkBike", ".linkbike-marker",27]] as const) {
    await page.getByRole("checkbox", {name:`Show ${name}`,exact:true}).uncheck();
    await expect(page.locator(selector)).toHaveCount(0);
    await expect(page.locator(".rail-station")).toHaveCount(railCount);
    expect(await map.getAttribute("data-camera-zoom")).toBe(before);
    await page.getByRole("checkbox", {name:`Show ${name}`,exact:true}).check();
    await expect(page.locator(selector)).toHaveCount(count);
  }
  await page.getByRole("button", {name:"Zoom to HelloRide",exact:true}).click();
  await expect(page.locator('[title="HelloRide · Armenian Street surroundings"]')).toHaveCount(1);
  // Keyboard selection works even when the all-coverage view has dense points.
  const synthetic = page.locator('[title="HelloRide · Armenian Street surroundings"]');
  await synthetic.focus(); await synthetic.press("Enter");
  const popup = page.getByRole("region", { name:"HelloRide location details" });
  // section with accessible name has region semantics.
  await expect(popup).toBeVisible(); await expect(popup).toContainText("SYNTHETIC DEMONSTRATION LOCATION");
  await expect(popup).toContainText("DEMONSTRATION_ONLY"); await expect(popup).toContainText("Not available");
  await expect(popup).not.toContainText("Available bicycles");
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
  const controls = page.getByRole("group", {name:"Micromobility coverage · SIMULATED"});
  await expect(controls).toContainText("Loading micromobility coverage");
  const before = await controls.boundingBox();
  release();
  await expect(controls).toContainText("75 coverage locations");
  const after = await controls.boundingBox();
  expect(after?.height).toBe(before?.height);
  expect(after?.y).toBe(before?.y);
});
