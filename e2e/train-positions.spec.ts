import { expect,test,type Page } from "@playwright/test";
import { trainFixture,trainTime } from "../tests/fixtures/train-positions";
import { calculateTrainPositionModels,positionsFromPayload,prepareTrainPositions,type TrainPositionPayload } from "../lib/train-positions";
import { rapidRailMeta } from "../lib/rail-model";
const start=trainTime(),routes=Object.keys(rapidRailMeta),marker=".estimated-train-icon";
function fixtures(now=start,overlap=false){
  const models:TrainPositionPayload[]=[],lines=[];
  for(const [i,route]of routes.entries())for(const direction of ["0","1"] as const){
    const f=trainFixture({route,direction}),offset=overlap?0:i*.012;
    f.paths.set("T",f.path.map(p=>[p[0]+offset,p[1]]));for(const stop of f.table.stops.values())stop.stop_lat=String(+stop.stop_lat+offset);
    const p=calculateTrainPositionModels(prepareTrainPositions(f.table,f.paths),now);models.push(p);
    if(direction==="0")lines.push({...rapidRailMeta[route],paths:[f.paths.get("T")!],geometryStatus:"available",dataMode:"STATIC",source:"Synthetic browser fixture only"});
  }
  const base=models[0],payload={...base,runs:models.flatMap(p=>p.runs),geometries:models.flatMap(p=>p.geometries),lines:routes.map(route=>models.find(p=>p.runs[0]?.routeId===route)!.lines.find(l=>l.routeId===route)!)};
  return {payload,lines};
}
async function setup(page:Page,options:{unavailable?:boolean;overlap?:boolean;expires?:boolean}={}){
  await page.clock.install({time:new Date(start-60000)});let calls=0;
  await page.route("**/api/transit?*",route=>route.fulfill({json:{records:route.request().url().includes("includeStatic")?[]:[{id:"B",name:"Fixture Bus",mode:"Bus",route:"T1",recordKind:"vehicle",position:[3.138,101.705],dataMode:"LIVE",status:"In service",reportedAt:new Date(start).toISOString(),source:"Synthetic fixture only"}],alerts:[],feeds:[],fetchedAt:new Date(start).toISOString(),demo:false}}));
  await page.route("**/api/alerts",route=>route.fulfill({json:{alerts:[],sources:[],retrievedAt:new Date(start).toISOString()}}));
  const network=fixtures();await page.route("**/api/rail-network?*",route=>route.fulfill({json:{available:true,lines:route.request().url().includes("ktmb")?[]:network.lines,stations:route.request().url().includes("ktmb")?[]:[{id:"S",name:"Fixture Station",mode:"MRT",route:"Kajang Line",recordKind:"stop",railLines:["MRT1"],lineNames:["MRT Kajang Line (MRT1)"],position:[3.14,101.7],dataMode:"STATIC",status:"Station available",source:"Synthetic fixture only"}],source:"Synthetic fixture only"}}));
  await page.route("**/api/train-positions",async route=>{
    calls++;if(options.expires&&calls>1)return route.fulfill({status:503,json:{error:"Fixture outage"}});
    const now=await page.evaluate(()=>Date.now()),payload=fixtures(now,options.overlap).payload;
    if(options.unavailable){payload.runs=[];payload.geometries=[];payload.status="UNAVAILABLE";payload.message="Individual train positions are unavailable from the current service information. Choose a station for departure times.";payload.lines=payload.lines.map(l=>({...l,status:"FREQUENCY_ONLY",message:"Only service intervals are published; individual train positions are unavailable."}));}
    return route.fulfill({json:payload});
  });
  await page.goto("/");await expect(page.locator(".vehicle-icon")).toHaveCount(1);await expect(page.locator(".rail-station")).toHaveCount(1);await page.clock.pauseAt(new Date(start));
  return {calls:()=>calls};
}
const toggle=(page:Page)=>page.getByRole("checkbox",{name:"Estimated train positions",exact:true});
const first=(page:Page)=>page.locator(`${marker}[data-train-line="MRT1"][data-train-direction="0"]`);
test("six eligible lines and both directions appear with distinct estimated train icons and original colours",async({page})=>{
  const state=await setup(page);expect(state.calls()).toBe(0);await toggle(page).check();await expect(page.locator(marker)).toHaveCount(12);
  for(const meta of Object.values(rapidRailMeta))for(const direction of ["0","1"]){const train=page.locator(`${marker}[data-train-line="${meta.id}"][data-train-direction="${direction}"]`);await expect(train).toHaveAttribute("data-train-status","ESTIMATED");expect(await train.locator("span").evaluate(el=>(el as HTMLElement).style.getPropertyValue("--train-colour"))).toBe(meta.colour);}
  await expect(page.locator(".vehicle-icon")).toHaveCount(1);await expect(page.locator(".rail-station")).toHaveCount(1);
});
test("15-second movements use the curved shape and absolute time without repeated timetable requests or map recentering",async({page})=>{
  const state=await setup(page);await toggle(page).check();await expect(page.locator(marker)).toHaveCount(12);
  const before=await first(page).getAttribute("data-longitude"),mapTransform=await page.locator(".leaflet-map-pane").getAttribute("style");
  await page.clock.fastForward(15000);
  const expected=positionsFromPayload(fixtures().payload,start+15000).find(p=>p.lineId==="MRT1"&&p.direction==="0")!;
  await expect.poll(async()=>Number(await first(page).getAttribute("data-longitude"))).toBeCloseTo(expected.position[1],8);
  expect(await first(page).getAttribute("data-longitude")).not.toBe(before);expect(state.calls()).toBe(1);expect(await page.locator(".leaflet-map-pane").getAttribute("style")).toBe(mapTransform);
  await page.clock.fastForward(45000);await expect.poll(state.calls).toBe(2);await expect(page.locator(".rail-station")).toHaveCount(1);
});
test("selecting a train displays passenger information, honest estimated status, and no raw identifiers",async({page})=>{
  await setup(page);await toggle(page).check();await first(page).click();const panel=page.getByRole("region",{name:"Estimated train information"});
  await expect(panel).toContainText("MRT Kajang Line (MRT1)");await expect(panel).toContainText("Towards Fixture Terminus");await expect(panel).toContainText("Fixture Origin");await expect(panel).toContainText("Fixture Bend");await expect(panel).toContainText("About 2 min");await expect(panel.getByText("Estimated",{exact:true})).toHaveCount(2);
  const visible=await panel.innerText();expect(visible).not.toMatch(/tripId|geometryId|stop_sequence|GPS|LIVE/);await expect(panel.getByText("Technical information",{exact:true})).toBeVisible();
  await panel.getByRole("button",{name:"Close estimated train"}).click();await expect(panel).toHaveCount(0);
});
test("visibility toggle, line controls, mode and information-type filters hide trains and preserve other markers",async({page})=>{
  const state=await setup(page);await toggle(page).check();await expect(page.locator(marker)).toHaveCount(12);
  await page.getByLabel("Show MRT Kajang Line (MRT1)",{exact:true}).uncheck();await expect(page.locator(`${marker}[data-train-line="MRT1"]`)).toHaveCount(0);
  await page.getByLabel("Show MRT Kajang Line (MRT1)",{exact:true}).check();await expect(page.locator(marker)).toHaveCount(12);
  await page.getByRole("button",{name:"MRT",exact:true}).click();await expect(page.locator(marker)).toHaveCount(4);await page.getByRole("button",{name:"MRT",exact:true}).click();
  await page.getByRole("button",{name:"Estimated trains",exact:true}).click();await expect(page.locator(marker)).toHaveCount(0);await expect(page.locator(".vehicle-icon")).toHaveCount(1);await expect(page.locator(".rail-station")).toHaveCount(1);
  await page.getByRole("button",{name:"Estimated trains",exact:true}).click();await expect(page.locator(marker)).toHaveCount(12);
  await toggle(page).uncheck();await expect(page.locator(marker)).toHaveCount(0);const calls=state.calls();await page.clock.fastForward(65000);expect(state.calls()).toBe(calls);
  await toggle(page).check();
  await expect.poll(state.calls).toBe(calls+1);
  await expect(page.getByRole("region",{name:"Estimated train positions",exact:true}).getByRole("status")).toContainText("12 estimated trains");
  // At +65s the two directions on each line converge inside the grouping radius.
  const expectedGroups=Object.values(rapidRailMeta).map(line=>`${line.id}:2`).sort();
  await expect.poll(()=>page.locator(marker).evaluateAll(icons=>icons.map(icon=>{
    const {trainLine,trainCount}=(icon as HTMLElement).dataset;
    return `${trainLine}:${trainCount}`;
  }).sort())).toEqual(expectedGroups);
  await page.clock.fastForward(60000);await expect.poll(state.calls).toBe(calls+2);
});
test("headway-only service shows clear per-line unavailable messages and never fabricates markers or countdowns",async({page})=>{
  await setup(page,{unavailable:true});await toggle(page).check();const controls=page.getByRole("region",{name:"Estimated train positions",exact:true});await expect(controls).toContainText("Choose a station for departure times");await expect(page.locator(marker)).toHaveCount(0);await controls.getByText("Availability by line",{exact:true}).click();await expect(controls.locator("li")).toHaveCount(6);await expect(controls.locator("li").first()).toContainText("individual train positions are unavailable");await expect(page.locator(".rail-station")).toHaveCount(1);
});
test("failed refresh expires markers and removes the selected next-station countdown",async({page})=>{
  await setup(page,{expires:true});await toggle(page).check();await first(page).click();await expect(page.getByRole("region",{name:"Estimated train information"})).toContainText("About 2 min");
  await page.clock.fastForward(60000);await expect(page.getByRole("button",{name:"Refresh estimates",exact:true})).toBeEnabled();await page.clock.fastForward(30000);
  await expect(page.locator(marker)).toHaveCount(0);const panel=page.getByRole("region",{name:"Estimated train information"});await expect(panel).toContainText("Estimated position unavailable");await expect(panel).not.toContainText("About");
});
test("nearby trains share an icon at an unchanged member coordinate and can be selected independently",async({page})=>{
  await setup(page,{overlap:true});await toggle(page).check();await expect(page.locator(marker)).toHaveCount(2);const grouped=page.locator(`${marker}[data-train-direction="0"]`);await expect(grouped).toHaveAttribute("data-train-count","6");
  const latitude=Number(await grouped.getAttribute("data-latitude")),longitude=Number(await grouped.getAttribute("data-longitude"));expect(positionsFromPayload(fixtures(start,true).payload,start).some(p=>p.position[0]===latitude&&p.position[1]===longitude)).toBe(true);
  await grouped.click();await page.locator(".estimated-train-popup").getByRole("button").filter({hasText:"LRT Ampang Line"}).click();await expect(page.getByRole("region",{name:"Estimated train information"})).toContainText("LRT Ampang Line");await expect(page.locator(".estimated-train-selected")).toHaveAttribute("data-train-line","LRT-AG");
});
test("mobile train selection remains above its responsive sheet, has no overflow, and supports reduced motion",async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:"reduce"});await setup(page);await toggle(page).check();await first(page).click();const panel=page.getByRole("region",{name:"Estimated train information"});await expect(panel).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);const markerBox=await first(page).boundingBox(),panelBox=await panel.boundingBox();expect(markerBox!.y+markerBox!.height).toBeLessThan(panelBox!.y+2);
  await page.clock.fastForward(15000);await expect(panel).toContainText("Estimated");await expect(page.locator(".leaflet-pan-anim")).toHaveCount(0);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
