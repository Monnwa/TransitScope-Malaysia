import { expect,test,type Page } from "@playwright/test";
import { buildTimetable } from "@/lib/scheduled-departures";
import { calculateBusJourney } from "@/lib/bus-journey";
import type { Record as TransitRecord } from "@/lib/transit-data";
import type { GpsFix } from "@/lib/vehicle-progress";
const stamp=Date.parse("2026-11-07T06:00:00Z"),point=(m:number):[number,number]=>[3.14,101.69+m/(111195.08*Math.cos(3.14*Math.PI/180))],path=[0,300,600,900,1200,1500].map(point);
const bus:TransitRecord={id:"motion-fixture",feedId:"rapid-bus-kl",name:"Motion fixture bus",operator:"Synthetic fixture",mode:"Bus",route:"T700",routeId:"R",tripId:"T",position:point(400),bearing:90,speed:5,recordKind:"vehicle",dataMode:"LIVE",status:"In service",station:null,reportedAt:new Date(stamp).toISOString(),observation:{positionTimestamp:new Date(stamp).toISOString(),tripStartDate:"20261107"},source:"Synthetic fixture only"};
function payload(count=3,missingStop=false,departure:string|null=null,now=stamp,measurementOffsetMs=0,missingClock=false){
  const table=buildTimetable({routes:[{route_id:"R",route_short_name:"T700",route_long_name:"Motion fixture route"}],trips:["T","later"].map(trip_id=>({trip_id,route_id:"R",shape_id:"shape",service_id:"D",direction_id:"0",trip_headsign:"Fixture Terminus"})),stopTimes:["T","later"].flatMap(trip_id=>[0,1,2].map(i=>({trip_id,stop_id:`S${i}`,stop_sequence:String(i+1),arrival_time:`${trip_id==="T"?"13":"15"}:${String(i*5).padStart(2,"0")}:00`,departure_time:`${trip_id==="T"?"13":"15"}:${String(i*5).padStart(2,"0")}:00`}))),stops:[100,900,1500].map((m,i)=>({stop_id:`S${i}`,stop_name:["Fixture Origin","Fixture Next","Fixture Terminus"][i],stop_lat:missingStop&&i===1?"":String(point(m)[0]),stop_lon:String(point(m)[1])})),calendars:[{service_id:"D",saturday:"1",start_date:"20261107",end_date:"20261107"}],exceptions:[],frequencies:[],source:"Synthetic timetable fixture only",mode:()=>"Bus"});
  const measuredAt=stamp-measurementOffsetMs,record={...bus,reportedAt:missingClock?null:new Date(measuredAt).toISOString(),observation:{...bus.observation,positionTimestamp:missingClock?undefined:new Date(measuredAt).toISOString()}},fixes:GpsFix[]=[100,250].slice(3-count).map((m,i)=>({position:point(m),timestamp:measuredAt-(count-1-i)*30000,bearing:90,speed:5,accuracyM:null}));
  return calculateBusJourney(table,record,{now,paths:new Map([["T",path],["later",path]]),history:{token:"motion-session",fixes},departure});
}
async function setup(page:Page,options:{count?:number;missingStop?:boolean;failRefresh?:boolean;measurementOffsetMs?:number;missingClock?:boolean}={}){
  await page.clock.install({time:new Date(stamp-60000)});
  const record=options.missingClock?{...bus,reportedAt:null,observation:{tripStartDate:"20261107"}}:bus;
  await page.route("**/api/transit?*",route=>route.fulfill({json:{records:route.request().url().includes("includeStatic")?[]:[record],alerts:[],feeds:[],fetchedAt:new Date(stamp).toISOString(),demo:false}}));
  await page.route("**/api/rail-network?*",route=>route.fulfill({json:{lines:[],stations:route.request().url().includes("ktmb")?[]:[{id:"rail",name:"Preserved railway station",mode:"MRT",recordKind:"stop",position:[3.144,101.71],dataMode:"STATIC",status:"Station available",source:"Synthetic fixture only"}],available:true,source:"Synthetic fixture only"}}));
  await page.route("**/api/alerts",route=>route.fulfill({json:{alerts:[],sources:[],retrievedAt:new Date(stamp).toISOString()}}));
  let calls=0;await page.route("**/api/bus-journey?*",async route=>{calls++;if(options.failRefresh&&calls>1)return route.fulfill({status:503,json:{error:"Synthetic outage"}});const departure=new URL(route.request().url()).searchParams.get("departure"),now=await page.evaluate(()=>Date.now());return route.fulfill({json:payload(options.count??3,options.missingStop,departure,now,options.measurementOffsetMs,options.missingClock)});});
  await page.goto("/");await expect(page.getByTitle(bus.name,{exact:true})).toBeVisible();await page.clock.pauseAt(new Date(stamp));await page.getByTitle(bus.name,{exact:true}).click();await expect(page.getByLabel("Bus journey detail").locator(".bus-stop").first()).toBeVisible();return {calls:()=>calls};
}
const board=(page:Page)=>page.getByLabel("Bus journey detail"),estimate=(page:Page)=>page.getByRole("region",{name:"Estimated next-stop arrival"});
test("a multi-observation GPS estimate is separate from scheduled clocks and never claims actual arrival",async({page})=>{
  await setup(page);await expect(estimate(page)).toContainText("Estimated arrival");await expect(estimate(page)).toContainText("Next stop: Fixture Next");await expect(estimate(page)).toContainText("About 2–3 min");await expect(estimate(page)).toContainText("Based on recent movement");await expect(board(page).locator(".bus-stop-times time").nth(1)).toHaveText("1:05 PM");await expect(board(page).locator(".bus-time-label").filter({hasText:"Scheduled"})).toHaveCount(3);
  expect(await estimate(page).innerText()).not.toMatch(/GPS|tripId|confidence|projection|LIVE|Actual|Arrived/);await expect(page.locator(".rail-station")).toHaveCount(1);
});
for(const count of [1,2])test(`${count} observation${count===1?"":"s"} cannot create a next-stop ETA`,async({page})=>{
  await setup(page,{count});await expect(estimate(page)).toHaveCount(0);await expect(board(page)).toContainText("Arrival estimate unavailable");await expect(board(page)).not.toContainText("Arrived");await expect(board(page).locator(".bus-stop-times time").nth(1)).toHaveText("1:05 PM");
});
test("wall-clock ageing and refresh failure withdraw ETA while preserving scheduled stop times",async({page})=>{
  const state=await setup(page,{failRefresh:true});await expect(estimate(page)).toBeVisible();const times=await board(page).locator(".bus-stop-times").allTextContents();await page.clock.fastForward(30000);await expect.poll(state.calls).toBeGreaterThan(1);await expect(estimate(page)).toContainText("About 1–2 min");await page.clock.fastForward(15000);await expect(estimate(page)).toHaveCount(0);await expect(board(page)).toContainText("Arrival estimate unavailable");expect(await board(page).locator(".bus-stop-times").allTextContents()).toEqual(times);await page.clock.fastForward(90000);await expect(page.locator(".gps-route-completed")).toHaveCount(0);await expect(board(page)).not.toContainText("Arrived");
});
test("a future timetable preview does not inherit the current bus GPS estimate",async({page})=>{
  await setup(page);await expect(estimate(page)).toBeVisible();await board(page).getByRole("button",{name:/Scheduled departure/}).first().click();await expect(estimate(page)).toHaveCount(0);await expect(page.locator(".gps-route-completed")).toHaveCount(0);await board(page).getByRole("button",{name:/Vehicle journey/}).click();await expect(estimate(page)).toBeVisible();
});
test("ETA expires between regular clock ticks without changing stops or adding a network request",async({page})=>{
  const state=await setup(page,{measurementOffsetMs:5000,failRefresh:true});await expect(estimate(page)).toBeVisible();const stops=await board(page).locator(".bus-stop").evaluateAll(nodes=>nodes.map(node=>[node.getAttribute("data-sequence"),node.className]));
  await page.clock.fastForward(30000);await expect.poll(state.calls).toBe(2);await page.clock.fastForward(9999);await expect(estimate(page)).toBeVisible();
  await page.clock.fastForward(1);await expect(estimate(page)).toHaveCount(0);await expect(board(page).getByText("Arrival estimate unavailable",{exact:true})).toBeVisible();expect(state.calls()).toBe(2);
  expect(await board(page).locator(".bus-stop").evaluateAll(nodes=>nodes.map(node=>[node.getAttribute("data-sequence"),node.className]))).toEqual(stops);
});
test("a missing official next-stop coordinate keeps the timetable without inventing an ETA",async({page})=>{
  await setup(page,{missingStop:true});await expect(estimate(page)).toHaveCount(0);await expect(board(page)).toContainText("Arrival estimate unavailable");await expect(board(page)).toContainText("Map location unavailable");await expect(board(page).locator(".bus-stop-times time").nth(1)).toHaveText("1:05 PM");
});
test("a fresh feed publication cannot turn an untimed GPS reference into a current location or ETA",async({page})=>{
  await setup(page,{missingClock:true});await expect(estimate(page)).toHaveCount(0);await expect(board(page).getByText("Arrival estimate unavailable",{exact:true})).toBeVisible();
  await expect(board(page).locator(".bus-observation")).toHaveText("Location unavailable");await expect(page.getByTitle(bus.name,{exact:true})).toHaveCSS("opacity","0.5");
  await expect(page.locator(".gps-route-completed")).toHaveCount(0);await expect(page.locator(".leaflet-popup")).toContainText("Location time unavailable");
});
for(const width of [390,1440])test(`${width}px estimated arrival panel preserves map navigation without horizontal overflow`,async({page})=>{
  await page.setViewportSize({width,height:900});await setup(page);await expect(estimate(page)).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await board(page).getByRole("button",{name:"Show Fixture Next on map",exact:true}).click();await expect(page.locator(".journey-stop-selected")).toHaveCount(1);await expect(page.locator(".rail-station")).toHaveCount(1);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
