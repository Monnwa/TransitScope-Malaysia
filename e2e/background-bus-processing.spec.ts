import { test, expect, type Page } from "@playwright/test";
import { adherenceFixture, adherenceNow, adherencePoint } from "@/tests/fixtures/adherence";
import { ProcessedBusJourneys } from "@/lib/processed-bus-journeys";
import { VehicleProgressHistory } from "@/lib/vehicle-progress-history";
import { createServer } from "node:http";
import { transitResponse } from "@/lib/transit-response";

async function setup(page:Page){
  const f=adherenceFixture(),history=new VehicleProgressHistory(),store=new ProcessedBusJourneys(history),source="rapid-bus-kl";
  const feed={timetable:f.table,tripPaths:new Map([["t",f.path]]),progressPaths:new Map([["t",f.path]]),tripShapeDistances:new Map<string,number[]>()};
  const recordsAt=(position:[number,number],timestamp:number)=>["A","B"].map(id=>({...f.bus,id,name:`Synthetic background bus ${id}`,position,reportedAt:new Date(timestamp).toISOString(),observation:{...f.bus.observation,positionTimestamp:new Date(timestamp).toISOString()}}));
  for(const fix of f.fixes)store.process(source,history.ingest(source,recordsAt(fix.position,fix.timestamp),fix.timestamp),feed,fix.timestamp);
  let records=history.ingest(source,recordsAt(f.bus.position!,adherenceNow),adherenceNow),journeys=store.process(source,records,feed,adherenceNow),fail=false,detailRequests=0,feedRequests=0;
  const before=JSON.stringify(journeys.map(entry=>entry.journey!.stops.map(stop=>stop.adherence)));
  await page.clock.install({time:new Date(adherenceNow)});
  await page.route("**/api/transit?*",async route=>{
    if(route.request().url().includes("includeStatic"))return route.fulfill({json:{records:[],alerts:[],feeds:[],demo:false}});
    feedRequests++;if(fail)return route.fulfill({status:503,json:{error:"Synthetic refresh outage"}});
    return route.fulfill({json:{records,busJourneys:journeys,alerts:[],feeds:[],fetchedAt:new Date(adherenceNow).toISOString(),demo:false}});
  });
  await page.route("**/api/bus-journey?*",route=>{detailRequests++;return route.fulfill({status:500,json:{error:"Opening the panel must not request primary calculation"}});});
  await page.route("**/api/rail-network?*",route=>route.fulfill({json:{lines:[],stations:[],available:true,source:"Synthetic fixture"}}));
  await page.route("**/api/alerts",route=>route.fulfill({json:{alerts:[],sources:[],retrievedAt:new Date(adherenceNow).toISOString()}}));
  await page.goto("/");await expect(page.getByTitle(records[0].name,{exact:true})).toBeVisible();
  await expect(page.getByText("Calculating journey progress and updating transport information…")).toHaveCount(0);
  return {records:()=>records,journeys:()=>journeys,before,detailRequests:()=>detailRequests,feedRequests:()=>feedRequests,fail:()=>{fail=true;},update:()=>{
    const now=adherenceNow+30000;records=history.ingest(source,recordsAt(adherencePoint(1250),now),now);journeys=store.process(source,records,feed,now);
  }};
}
for(const width of [390,1440])test(`${width}px all bus statuses are ready before selection and survive closing, refresh and failure`,async({page},testInfo)=>{
  await page.setViewportSize({width,height:1000});const state=await setup(page);
  expect(state.journeys()).toHaveLength(2);expect(state.journeys().flatMap(entry=>entry.journey!.stops).filter(stop=>stop.adherence?.result)).toHaveLength(6);
  expect(state.detailRequests()).toBe(0);await expect(page.getByLabel("Bus journey detail")).toHaveCount(0);
  const open=async(index:number)=>{if(index===1)await page.getByTitle(state.records()[index].name,{exact:true}).click();else await page.locator("tr").filter({hasText:state.records()[index].name}).getByRole("button",{name:"View details"}).click();const board=page.getByLabel("Bus journey detail");await expect(board.getByLabel("Timetable adherence summary")).toHaveText("4 passed · 1 early · 1 on time · 1 late · 1 unavailable");return board;};
  let board=await open(1);await board.getByRole("button",{name:"Show previous stops"}).click();
  await expect(page.locator(".vehicle-selected")).toHaveAttribute("data-observed-at",String(adherenceNow));
  await expect(page.locator(".gps-route-completed")).toHaveCount(1);
  await expect(board.locator('[data-sequence="30"] .bus-adherence')).toContainText("On time");
  expect(JSON.stringify(state.journeys().map(entry=>entry.journey!.stops.map(stop=>stop.adherence)))).toBe(state.before);
  await board.getByRole("button",{name:"Close bus journey"}).click();board=await open(0);
  await board.getByRole("button",{name:"Close bus journey"}).click();board=await open(1);
  expect(state.detailRequests()).toBe(0);expect(state.feedRequests()).toBe(1);
  state.update();await page.clock.fastForward(30000);
  await expect(page.locator(".vehicle-selected")).toHaveAttribute("data-observed-at",String(adherenceNow+30000));
  await expect(board.getByLabel("Timetable adherence summary")).toContainText("1 on time");expect(state.feedRequests()).toBe(2);
  state.fail();await page.getByRole("button",{name:"Refresh transport information"}).click();
  await expect(page.getByRole("alert").filter({hasText:"Could not update transport information"})).toBeVisible();
  await expect(board.getByLabel("Timetable adherence summary")).toContainText("1 on time");
  await board.getByRole("button",{name:"Show previous stops"}).click();
  await expect(board.locator('[data-sequence="20"] .bus-adherence')).toContainText("9 min late");
  expect(state.detailRequests()).toBe(0);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await board.getByRole("button",{name:"Locate bus"}).click();
  await board.locator(".bus-journey-body").evaluate(container=>{const heading=container.querySelector(".bus-timeline-heading");if(heading)container.scrollTop+=heading.getBoundingClientRect().top-container.getBoundingClientRect().top-12;});
  await page.screenshot({path:testInfo.outputPath(`background-bus-${width}.png`)});
});
test("the browser losslessly decodes the actual compressed HTTP fleet response",async({page})=>{
  const state=await setup(page),payload={records:state.records(),busJourneys:state.journeys(),alerts:[],feeds:[],fetchedAt:new Date(adherenceNow).toISOString(),demo:false};
  const server=createServer(async(request,response)=>{
    const result=await transitResponse(payload,request.headers["accept-encoding"]??null);
    response.writeHead(result.status,{...Object.fromEntries(result.headers),"Access-Control-Allow-Origin":"*","Access-Control-Expose-Headers":"Content-Encoding"});response.end(Buffer.from(await result.arrayBuffer()));
  });
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  try {
    const address=server.address();if(!address||typeof address==="string")throw new Error("Missing local test server address");
    const result=await page.evaluate(async url=>{const response=await fetch(url);return {encoding:response.headers.get("content-encoding"),data:await response.json()};},`http://127.0.0.1:${address.port}`);
    expect(result.encoding).toBe("gzip");expect(result.data).toEqual(payload);expect(state.detailRequests()).toBe(0);
  }finally{server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
});
