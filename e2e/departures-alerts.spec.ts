import {expect,test} from "@playwright/test";
// The existing synthetic API fixtures are dated 1 November; keep their clock deterministic.
test.beforeEach(async({page})=>{await page.clock.install({time:new Date("2026-11-01T06:00:00Z")});});
const empty={records:[],alerts:[],feeds:[],fetchedAt:"2026-11-01T06:00:00Z",demo:false};
for(const mode of ["MRT","LRT","Monorail","KTM","Bus"]){
  test(`${mode} station selection displays official scheduled departures independently of live API`,async({page})=>{
    const station={id:"fixture-stop",name:`${mode} Test Station`,mode,operator:"Fixture",route:"Fixture Line",station:"Fixture Station",position:[3.142,101.699],recordKind:"stop",stopRefs:[`${mode==="Bus"?"rapid-bus-kl":"rapid-rail-kl"}:TEST`],status:"Station available",dataMode:"STATIC",reportedAt:null,source:"Clearly labelled synthetic test fixture"};
    await page.route("**/api/transit?*",route=>route.fulfill({json:route.request().url().includes("includeStatic")?{...empty,records:mode==="Bus"?[station]:[]}:empty}));
    await page.route("**/api/rail-network?*",route=>route.fulfill({json:{lines:[],stations:mode!=="Bus"&&route.request().url().includes("rapid-rail-kl")?[station]:[],available:true,source:"Fixture"}}));
    await page.route("**/api/alerts",route=>route.fulfill({json:{alerts:[],sources:[],retrievedAt:empty.fetchedAt}}));
    await page.route("**/api/departures?*",route=>route.fulfill({json:{status:"SCHEDULED",message:"Synthetic timetable fixture only",departures:[{tripId:"test-trip",routeId:"test-route",routeName:"Fixture Line",mode,destination:"Fixture Destination",direction:"0",scheduledDeparture:"2026-11-01T06:30:00Z",scheduledTimestamp:1793514600000,platform:"A",status:"SCHEDULED",source:"https://api.data.gov.my/gtfs-static/ktmb",lastUpdated:empty.fetchedAt}],frequencies:[],sources:[],retrievedAt:empty.fetchedAt,liveEta:{available:false,reason:"No verified realtime prediction"}}}));
    await page.goto("/");await page.locator(".rail-station").click();
    const departures=page.getByRole("region",{name:"Upcoming Departures"});await expect(departures).toContainText("Fixture Destination");await expect(departures).toContainText("Scheduled");await expect(departures).toContainText("Live arrival information unavailable");await departures.getByRole("button",{name:"Refresh departures"}).click();await expect(departures).toContainText("Fixture Destination");
  });
}
test("official notices preserve source links, filters and precise map association",async({page})=>{
  const station={id:"line-stop",name:"Fixture Station",mode:"MRT",route:"Kajang Line",station:"Fixture Station",position:[3.142,101.699],recordKind:"stop",railLines:["MRT1"],lineNames:["Kajang Line"],dataMode:"STATIC",status:"Station available",source:"Fixture",reportedAt:null};
  await page.route("**/api/transit?*",route=>route.fulfill({json:empty}));
  await page.route("**/api/rail-network?*",route=>route.fulfill({json:{lines:[],stations:route.request().url().includes("ktmb")?[]:[station],available:true,source:"Fixture"}}));
  const alert={id:"fixture-announcement",title:"Fixture: Kajang Line maintenance",description:"Synthetic automated test notice, not a real incident",severity:"Medium",routes:["MRT Kajang Line"],stations:[],startedAt:empty.fetchedAt,endsAt:null,source:"Fixture Official",dataMode:"STATIC",category:"MAINTENANCE",classificationSeverity:"MEDIUM",affectedModes:["MRT"],affectedLineIds:["MRT1"],sourceName:"Fixture Official",sourceType:"OFFICIAL_WEBSITE",sourceUrl:"https://myrapid.com.my/test-notice/",publishedAt:empty.fetchedAt,retrievedAt:empty.fetchedAt,alertStatus:"UNKNOWN",stale:false};
  await page.route("**/api/alerts",route=>route.fulfill({json:{alerts:[alert],sources:[{name:"Fixture Official",status:"healthy",lastSuccessAt:empty.fetchedAt}],retrievedAt:empty.fetchedAt}}));
  await page.goto("/");await page.getByRole("button",{name:/Fixture: Kajang Line maintenance/}).click();await expect(page.getByRole("dialog")).toContainText("UNKNOWN");await expect(page.getByRole("link",{name:"View Original Announcement"})).toHaveAttribute("href",alert.sourceUrl);await expect(page.getByLabel("Selected transport detail")).toContainText("Fixture Station");
  await page.getByLabel("Filter alerts").selectOption("Bus");await expect(page.getByRole("button",{name:/Fixture: Kajang Line maintenance/})).toHaveCount(0);
});
test("missing departures have a clear unavailable state and retain the map",async({page})=>{
  await page.route("**/api/alerts",route=>route.fulfill({json:{alerts:[],sources:[],retrievedAt:empty.fetchedAt}}));
  await page.goto("/?mode=demo");await page.getByPlaceholder("e.g. bus number or station").fill("Bukit Bintang");await page.getByRole("button",{name:"View details"}).click();await expect(page.getByRole("region",{name:"Upcoming Departures"})).toContainText("Timetable unavailable");await expect(page.getByLabel("Interactive transport map")).toBeVisible();
});
test("frequency schedules never appear as precise LIVE ETA or exact departure timestamps",async({page})=>{
  const station={id:"frequency-stop",name:"Fixture Frequency Station",mode:"LRT",route:"Fixture Line",station:"Test",position:[3.142,101.699],recordKind:"stop",stopRefs:["rapid-rail-kl:TEST"],dataMode:"STATIC",status:"Station available",source:"Fixture",reportedAt:null};
  await page.route("**/api/transit?*",route=>route.fulfill({json:empty}));
  await page.route("**/api/rail-network?*",route=>route.fulfill({json:{lines:[],stations:route.request().url().includes("ktmb")?[]:[station],available:true,source:"Fixture"}}));
  await page.route("**/api/alerts",route=>route.fulfill({json:{alerts:[],sources:[],retrievedAt:empty.fetchedAt}}));
  await page.route("**/api/departures?*",route=>route.fulfill({json:{status:"SCHEDULED",message:"Official frequency timetable; exact departure times are not published.",departures:[],frequencies:[{tripId:"fixture",routeName:"Fixture Line",destination:"Fixture terminus",start:"2026-11-01T06:00:00Z",end:"2026-11-01T10:00:00Z",headwaySeconds:300,source:"https://api.data.gov.my/gtfs-static/ktmb"}],sources:[],retrievedAt:empty.fetchedAt,liveEta:{available:false,reason:"No prediction source"}}}));
  await page.goto("/");await page.locator(".rail-station").click();const panel=page.getByRole("region",{name:"Upcoming Departures"});await expect(panel).toContainText(/every 5 min/i);await expect(panel.locator("tbody tr")).toHaveCount(0);await expect(panel).toContainText("Live arrival information unavailable");
});
