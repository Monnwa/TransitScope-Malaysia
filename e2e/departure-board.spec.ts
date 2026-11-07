import { expect, test, type Page } from "@playwright/test";
const now = "2026-11-07T06:00:00Z";
const station = (id="A") => ({id, name:`Fixture Station ${id}`, mode:"MRT",operator:"Fixture operator",route:"MRT Kajang Line",lineNames:["MRT Kajang Line (MRT1)","MRT Putrajaya Line (MRT2)"],railLines:["MRT1","MRT2"],interchange:true,station:`Fixture Station ${id}`,position:id==="A"?[3.142,101.699]:[3.16,101.72],recordKind:"stop",stopRefs:[`rapid-rail-kl:${id}`],status:"Station available",dataMode:"STATIC",reportedAt:null,source:"Synthetic UI fixture only"});
const service = (i:number,route="KGL") => ({tripId:`fixture-${route}-${i}`,routeId:route,routeName:route==="KGL"?"Kajang Line":"Putrajaya Line",mode:"MRT",destination:`Fixture Destination ${i}`,direction:"0",platform:"Fixture platform",status:"SCHEDULED",source:"https://api.data.gov.my/gtfs-static/prasarana?category=rapid-rail-kl",lastUpdated:now,scheduledDeparture:new Date(Date.parse(now)+(30+i*3)*60000).toISOString(),scheduledTimestamp:Date.parse(now)+(30+i*3)*60000});
const payload = (departures=Array.from({length:10},(_,i)=>service(i,i<8?"KGL":"PYL"))) => ({status:"SCHEDULED",message:"Clearly labelled synthetic UI test timetable",departures,frequencies:[],sources:[{source:"rapid-rail-kl",lastUpdated:now,error:null}],retrievedAt:now,liveEta:{available:false,reason:"No verified predictions in this fixture"}});
async function setup(page:Page, stations=[station()]) {
  await page.clock.install({time:new Date(now)});
  await page.route("**/api/transit?*",route=>route.fulfill({json:{records:[],alerts:[],feeds:[],fetchedAt:now,demo:false}}));
  await page.route("**/api/rail-network?*",route=>route.fulfill({json:{lines:[],stations:route.request().url().includes("ktmb")?[]:stations,available:true,source:"Synthetic fixture"}}));
  await page.route("**/api/alerts",route=>route.fulfill({json:{alerts:[],sources:[],retrievedAt:now}}));
}
test("five departures, line grouping and ten-service expansion preserve selection and request count",async({page})=>{
  await setup(page);let calls=0;await page.route("**/api/departures?*",route=>{calls++;return route.fulfill({json:payload()});});
  await page.goto("/");await page.locator(".rail-station").click();const board=page.getByRole("region",{name:"Station departure board"});
  await expect(board.getByRole("heading",{name:"Fixture Station A"})).toBeVisible();await expect(board).toContainText("Interchange");await expect(board.locator(".board-sources pre")).not.toBeVisible();
  await expect(board.locator(".board-departure")).toHaveCount(5);await expect(board.locator(".board-line-group h4")).toHaveText(["Kajang Line","Putrajaya Line"]);
  await expect(board.locator(".board-time time").first()).toHaveText("14:30");await expect(board.getByLabel("Departure service status")).toHaveText("Scheduled services");
  const initialCalls=calls;
  await board.getByRole("button",{name:"Show all departures"}).click();await expect(board.locator(".board-departure")).toHaveCount(10);await expect(board.locator(".board-line-group").last().locator(".board-departure")).toHaveCount(2);
  await board.getByRole("button",{name:"Show less"}).click();await expect(board.locator(".board-departure")).toHaveCount(5);expect(calls).toBe(initialCalls);await expect(board.locator(".board-status-live")).toHaveCount(0);
});
test("refresh loading disables repeated requests and a failed refresh retains the board",async({page})=>{
  await setup(page);let calls=0;let refreshing=false;let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
  await page.route("**/api/departures?*",async route=>{calls++;if(!refreshing)return route.fulfill({json:payload()});await gate;await route.fulfill({status:503,body:"Fixture outage"});});
  await page.goto("/");await page.locator(".rail-station").click();const board=page.getByRole("region",{name:"Station departure board"});await expect(board.locator(".board-departure")).toHaveCount(5);
  const initialCalls=calls;refreshing=true;
  await board.getByRole("button",{name:"Refresh departures"}).click();await expect(board.getByRole("button",{name:"Refresh departures"})).toBeDisabled();await expect(board.getByRole("status")).toContainText("Refreshing scheduled services");await expect(board.locator(".board-departure")).toHaveCount(5);
  release();await expect(board.getByRole("alert")).toContainText("Previously loaded times are still shown");await expect(board.locator(".board-departure")).toHaveCount(5);await expect(board).toContainText("Last updated");await expect(board.getByRole("button",{name:"Retry"})).toBeVisible();expect(calls).toBe(initialCalls+1);
});
test("station switching cancels stale responses before the new header receives old departures",async({page})=>{
  await setup(page,[station(),station("B")]);let release!:()=>void;let started!:()=>void;const start=new Promise<void>(resolve=>{started=resolve;});const gate=new Promise<void>(resolve=>{release=resolve;});
  await page.route("**/api/departures?*",async route=>{if(route.request().url().endsWith("%3AA")){started();await gate;try{await route.fulfill({json:payload([{...service(0),destination:"STALE STATION A"}])});}catch{}return;}return route.fulfill({json:payload([{...service(1),destination:"CURRENT STATION B"}])});});
  await page.goto("/");await page.locator("tbody tr").filter({hasText:"Fixture Station A"}).getByRole("button",{name:"View details"}).click();await start;
  await page.locator("tbody tr").filter({hasText:"Fixture Station B"}).getByRole("button",{name:"View details"}).click();const board=page.getByRole("region",{name:"Station departure board"});await expect(board.getByRole("heading",{name:"Fixture Station B"})).toBeVisible();await expect(board).toContainText("CURRENT STATION B");release();await expect(board).not.toContainText("STALE STATION A");
});
for(const [reason,message] of [["NO_MORE_TODAY","No more services today."],["NO_SERVICE_TODAY","No service today."],["TIMETABLE_UNAVAILABLE","Timetable unavailable."]]) {
  test(`empty state: ${reason}`,async({page})=>{await setup(page);await page.route("**/api/departures?*",route=>route.fulfill({json:{...payload([]),status:reason==="TIMETABLE_UNAVAILABLE"?"UNAVAILABLE":"SCHEDULED",emptyReason:reason}}));await page.goto("/");await page.locator(".rail-station").click();const board=page.getByRole("region",{name:"Station departure board"});await expect(board.locator(".board-empty")).toHaveText(message);await expect(board.getByRole("button",{name:"Show all departures"})).toHaveCount(0);});
}
test("frequency-only service is separate, retains line identities, and never becomes a timestamp or live badge",async({page})=>{
  await setup(page);await page.route("**/api/departures?*",route=>route.fulfill({json:{...payload([]),frequencies:[{tripId:"fixture",routeName:"Kajang Line",mode:"MRT",destination:"Fixture terminal",direction:"0",start:"2026-11-07T06:00:00Z",end:"2026-11-07T15:00:00Z",headwaySeconds:300,source:"https://api.data.gov.my/gtfs-static/ktmb"}],liveEta:{available:true,reason:"No actual prediction rows"}}}));
  await page.goto("/");await page.locator(".rail-station").click();const board=page.getByRole("region",{name:"Station departure board"});await expect(board.getByLabel("Service intervals")).toContainText("Every 5 min");await expect(board.getByLabel("Departure service status")).toHaveText("Every 5 min");await expect(board.locator(".board-departure")).toHaveCount(0);await expect(board.locator(".board-status-live")).toHaveCount(0);await expect(board).toContainText("Live arrival information unavailable");
});
test("past services are omitted and overnight times have a date in Malaysia time",async({page})=>{
  await setup(page);await page.route("**/api/departures?*",route=>route.fulfill({json:payload([{...service(0),scheduledDeparture:"2026-11-07T05:00:00Z"},{...service(1),scheduledDeparture:"2026-11-07T16:10:00Z"}])}));await page.goto("/");await page.locator(".rail-station").click();const board=page.getByRole("region",{name:"Station departure board"});await expect(board.locator(".board-departure")).toHaveCount(1);await expect(board.locator(".board-time time")).toHaveText("00:10");await expect(board.locator(".board-date")).toContainText("8 Nov");
});
test("single-line board avoids grouping clutter and remains usable on mobile with long destinations",async({page})=>{
  await page.setViewportSize({width:390,height:844});await setup(page,[{...station(),lineNames:["MRT Kajang Line (MRT1)"],railLines:["MRT1"],interchange:false}]);await page.route("**/api/departures?*",route=>route.fulfill({json:payload([{...service(0),destination:"Fixture very long destination that wraps without overlapping the scheduled time"}])}));await page.goto("/");await page.locator("tbody tr").getByRole("button",{name:"View details"}).click();const board=page.getByRole("region",{name:"Station departure board"});await expect(board.locator(".board-departure")).toHaveCount(1);await expect(board.locator(".board-line-group h4")).toHaveCount(0);await expect(board.locator(".board-time time")).toBeVisible();const widths=await board.evaluate(element=>({client:element.clientWidth,scroll:element.scrollWidth}));expect(widths.scroll).toBeLessThanOrEqual(widths.client);await board.getByRole("button",{name:"Refresh departures"}).focus();await expect(board.getByRole("button",{name:"Refresh departures"})).toBeFocused();
});
