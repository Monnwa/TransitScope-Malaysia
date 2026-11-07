import { expect, test, type Page } from "@playwright/test";
const now="2026-11-07T06:00:00Z";
const station=(id="A")=>({id,name:`Arrival Fixture ${id}`,mode:"MRT",route:"Kajang Line",lineNames:["Kajang Line","Putrajaya Line"],railLines:["MRT1","MRT2"],interchange:true,position:id==="A"?[3.142,101.699]:[3.16,101.72],recordKind:"stop",stopRefs:[`rapid-rail-kl:${id}`],status:"Station available",dataMode:"STATIC",reportedAt:null,source:"Synthetic fixture only"});
const arrival=(i:number)=>({tripId:`train-${i}`,routeId:i%2?"PYL":"KGL",routeName:i%2?"Putrajaya Line":"Kajang Line",mode:"MRT",stopId:"A",destination:i%2?"Fixture North":"Fixture South",direction:String(i%2),platform:String(i%2+1),arrivalTime:new Date(Date.parse(now)+(5+i*2)*60000).toISOString(),arrivalTimestamp:Date.parse(now)+(5+i*2)*60000,classification:i===1?"SCHEDULED":"ESTIMATED",source:"https://api.data.gov.my/gtfs-static/prasarana?category=rapid-rail-kl",lastUpdated:now,serviceDate:"2026-11-07",basis:i===1?"EXACT_FREQUENCY":"PUBLISHED_FREQUENCY_ANCHOR"});
const payload=()=>({status:"SCHEDULED",message:"Synthetic fixture only",departures:[],frequencies:[],trainArrivals:Array.from({length:10},(_,i)=>arrival(i)),arrivalFrequencyCoverage:[],emptyReason:null,sources:[],retrievedAt:now,liveEta:{available:false,reason:"No verified prediction"}});
async function setup(page:Page,stations=[station()]){
  await page.clock.install({time:new Date(now)});
  await page.route("**/api/transit?*",route=>route.fulfill({json:{records:[],alerts:[],feeds:[],fetchedAt:now,demo:false}}));
  await page.route("**/api/rail-network?*",route=>route.fulfill({json:{lines:[],stations:route.request().url().includes("ktmb")?[]:stations,available:true,source:"Synthetic fixture"}}));
  await page.route("**/api/alerts",route=>route.fulfill({json:{alerts:[],sources:[],retrievedAt:now}}));
}
test("arrival rows show five then ten, global chronology, separate directions, 12h time and honest classifications",async({page})=>{
  await setup(page);let calls=0;await page.route("**/api/departures?*",route=>{calls++;return route.fulfill({json:payload()});});
  await page.goto("/");await page.locator(".rail-station").click();const board=page.getByLabel("Station departure board");
  await expect(board.locator(".train-arrival-row")).toHaveCount(5);await expect(board.locator(".train-arrival-time time").first()).toHaveText("2:05 PM");await expect(board.locator(".train-countdown").first()).toHaveText("About 5 min");
  await expect(board.getByLabel("Departure service status")).toHaveText("Estimated arrivals");await expect(board.locator(".train-arrival-time .board-type")).toHaveText(["Estimated","Scheduled","Estimated","Estimated","Estimated"]);await expect(board).toContainText("Actual train arrival may differ");await expect(board.locator(".board-status-live")).toHaveCount(0);await expect(board).toContainText("Live arrival information unavailable");
  const initial=calls;await board.getByRole("button",{name:"Show all arrivals"}).click();await expect(board.locator(".train-arrival-row")).toHaveCount(10);expect(calls).toBe(initial);
  expect(await board.locator(".train-arrival-time time").evaluateAll(elements=>elements.map(e=>e.getAttribute("datetime")))).toEqual(Array.from({length:10},(_,i)=>arrival(i).arrivalTime));
  await expect(board.locator(".train-arrival-row .board-service-meta").first()).toContainText("Platform 1");await expect(board.locator(".train-arrival-row .board-service-meta").nth(1)).toContainText("Platform 2");
});
test("countdowns advance, cached endpoint refreshes and failure retains valid arrivals",async({page})=>{
  await setup(page);let calls=0;let failing=false;await page.route("**/api/departures?*",route=>{calls++;return failing?route.fulfill({status:503,body:"Fixture outage"}):route.fulfill({json:payload()});});
  await page.goto("/");await page.locator(".rail-station").click();const board=page.getByLabel("Station departure board");await expect(board.locator(".train-countdown").first()).toHaveText("About 5 min");
  const initial=calls;failing=true;await page.clock.fastForward(60000);await expect(board.locator(".train-countdown").first()).toHaveText("About 4 min");await expect(board.getByRole("alert")).toContainText("Previously loaded times are still shown");await expect(board.locator(".train-arrival-row")).toHaveCount(5);expect(calls).toBe(initial+1);
});
test("switching stations ignores a late arrival calculation response",async({page})=>{
  await setup(page,[station(),station("B")]);let release!:()=>void;let started!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});const start=new Promise<void>(resolve=>{started=resolve;});
  await page.route("**/api/departures?*",async route=>{const a=route.request().url().endsWith("%3AA");if(a){started();await gate;}try{await route.fulfill({json:{...payload(),trainArrivals:[{...arrival(0),destination:a?"STALE A TRAIN":"CURRENT B TRAIN"}]}});}catch{}});
  await page.goto("/");await page.locator("tbody tr").filter({hasText:"Arrival Fixture A"}).getByRole("button",{name:"View details"}).click();await start;
  await page.locator("tbody tr").filter({hasText:"Arrival Fixture B"}).getByRole("button",{name:"View details"}).click();const board=page.getByLabel("Station departure board");await expect(board).toContainText("CURRENT B TRAIN");release();await expect(board).not.toContainText("STALE A TRAIN");
});
test("unsupported anchors keep Every N min; covered windows alone are suppressed",async({page})=>{
  await setup(page);const frequency={tripId:"fallback",routeName:"Kajang Line",mode:"MRT",destination:"Unanchored fixture",direction:"1",platform:"1",start:now,end:"2026-11-07T10:00:00Z",headwaySeconds:300,source:arrival(0).source};
  await page.route("**/api/departures?*",route=>route.fulfill({json:{...payload(),trainArrivals:[],frequencies:[frequency,{...frequency,tripId:"covered",destination:"Covered fixture"}],arrivalFrequencyCoverage:[`${frequency.source}|covered|1|${now}|${frequency.end}`]}}));
  await page.goto("/");await page.locator(".rail-station").click();const board=page.getByLabel("Station departure board");await expect(board.getByLabel("Service intervals")).toContainText("Every 5 min");await expect(board).not.toContainText("Covered fixture");await expect(board.locator(".train-arrival-time")).toHaveCount(0);
});
for(const [reason,message] of [["NO_MORE_TODAY","No more services today."],["NO_SERVICE_TODAY","No service today."],["TIMETABLE_UNAVAILABLE","Timetable unavailable."]]){
  test(`train-specific empty state ${reason}`,async({page})=>{await setup(page);await page.route("**/api/departures?*",route=>route.fulfill({json:{...payload(),trainArrivals:[],emptyReason:reason,status:reason==="TIMETABLE_UNAVAILABLE"?"UNAVAILABLE":"SCHEDULED"}}));await page.goto("/");await page.locator(".rail-station").click();await expect(page.locator(".board-empty")).toHaveText(message);});
}
for(const width of [390,1440])test(`${width}px arrival layout wraps long destinations and dates without overlap`,async({page})=>{
  await page.setViewportSize({width,height:900});await setup(page);await page.route("**/api/departures?*",route=>route.fulfill({json:{...payload(),trainArrivals:[{...arrival(0),destination:"Fixture long destination that wraps across multiple lines",arrivalTime:"2026-11-07T16:10:00Z",arrivalTimestamp:Date.parse("2026-11-07T16:10:00Z")}]}}));
  await page.goto("/");await page.locator("tbody tr").getByRole("button",{name:"View details"}).click();const board=page.getByLabel("Station departure board");await expect(board.locator(".train-arrival-time time")).toHaveText("12:10 AM");await expect(board.locator(".board-date")).toContainText("8 Nov");
  const dimensions=await board.locator(".train-arrival-row").evaluate(element=>{const left=element.querySelector(".train-arrival-service")!.getBoundingClientRect(),right=element.querySelector(".train-arrival-time")!.getBoundingClientRect();return {client:element.clientWidth,scroll:element.scrollWidth,overlap:left.right>right.left};});expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client);expect(dimensions.overlap).toBe(false);
});
