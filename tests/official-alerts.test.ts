import {afterEach,describe,expect,it,vi} from "vitest";
import {classifyAnnouncement,updateAlertStatuses} from "@/lib/alert-classifier";
import {parseOfficialAnnouncements,robotsAllows,getOfficialAlerts} from "@/lib/official-alerts";
import {safeOfficialUrl} from "@/lib/official-alert-model";
vi.mock("node:https", async () => {
  const { EventEmitter } = await import("node:events");
  const get = () => {
    const request = new EventEmitter();
    queueMicrotask(() => request.emit("error", new Error("ERL fixture offline")));
    return request;
  };
  return { get, default: { get } };
});
const rss=`<rss><channel><item><title>Kajang Line service disruption</title><link>https://myrapid.com.my/fixture-notice/</link><pubDate>Sun, 01 Nov 2026 06:00:00 GMT</pubDate><description>Fixture only, not a real incident.</description></item></channel></rss>`;
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
describe("official alerts ingestion and conservative status",()=>{
  it("does not promote procurement notices into service alerts",()=>expect(parseOfficialAnnouncements(rss.replace("fixture-notice/","tenders/fixture/"),"Test","https://myrapid.com.my/feed/","rss",new Date().toISOString())).toHaveLength(0));
  it("parses only safe official notices and preserves publication and source",()=>{
    const a=parseOfficialAnnouncements(rss,"Fixture official source","https://myrapid.com.my/feed/","rss","2026-11-01T06:30:00Z")[0];expect(a.sourceType).toBe("OFFICIAL_WEBSITE");expect(a.affectedLineIds).toEqual(["MRT1"]);expect(a.alertStatus).toBe("ACTIVE");expect(a.classificationSeverity).toBe("HIGH");expect(a.publishedAt).toBe("2026-11-01T06:00:00.000Z");
  });
  it("treats undated notices as unknown and rejects unsafe links",()=>{
    const a=parseOfficialAnnouncements('<html><a href="assets/notice.pdf" title="Notis Perubahan Operasi KTM Komuter">Details</a></html>',"Test","https://www.ktmb.com.my/index.html","html",new Date().toISOString())[0];expect(a.publishedAt).toBeNull();expect(a.alertStatus).toBe("UNKNOWN");expect(safeOfficialUrl("javascript:alert(1)")).toBe(false);expect(safeOfficialUrl("https://myrapid.com.my.attacker.invalid/")).toBe(false);
  });
  it("does not interpret alarming words or station names as a critical incident or line",()=>{
    expect(classifyAnnouncement("Emergency safety campaign at Ampang Park").severity).toBe("UNKNOWN");expect(classifyAnnouncement("Ampang Park information").affectedLineIds).toHaveLength(0);
  });
  it("uses explicit expiry and only matches restorations with a confirmed incident ID",()=>{
    const a=parseOfficialAnnouncements(rss,"Test","https://myrapid.com.my/feed/","rss","2026-11-01T06:30:00Z")[0];
    const restore={...a,id:"restored",category:"RESTORATION" as const,publishedAt:"2026-11-01T07:00:00Z"};
    expect(updateAlertStatuses([a,restore],Date.parse("2026-11-01T08:00Z"))[0].alertStatus).toBe("ACTIVE");
    expect(updateAlertStatuses([{...a,incidentId:"confirmed"},{...restore,incidentId:"confirmed"}])[0].alertStatus).toBe("RESOLVED");
    expect(updateAlertStatuses([{...a,validUntil:"2026-10-31T00:00Z"}],Date.parse("2026-11-01T08:00Z"))[0].alertStatus).toBe("EXPIRED");
  });
  it("rejects access challenges and honors robots disallow rules",()=>{
    expect(()=>parseOfficialAnnouncements("<html>Just a moment</html>","Test","https://myrapid.com.my/feed/","rss",new Date().toISOString())).toThrow();
    expect(robotsAllows("User-agent: *\nDisallow: /private/\nAllow: /private/public/","/private/secret")).toBe(false);expect(robotsAllows("User-agent: *\nDisallow: /private/\nAllow: /private/public/","/private/public/feed")).toBe(true);
  });
  it("retains cached official notices on a later upstream failure",async()=>{
    vi.useFakeTimers();vi.setSystemTime(new Date("2026-11-01T08:00Z"));let failing=false;
    vi.stubGlobal("fetch",vi.fn(async(url:string)=>{if(failing)throw Error("fixture offline");return new Response(url.endsWith("robots.txt")?"User-agent: *\nDisallow:":url.includes("ktmb")?"<html></html>":rss,{status:200});}));
    const first=await getOfficialAlerts();expect(first.alerts).toHaveLength(1);
    vi.setSystemTime(new Date("2026-11-01T09:00Z"));failing=true;const next=await getOfficialAlerts();expect(next.alerts).toHaveLength(1);expect(next.sources[0].status).toBe("stale");expect(next.sources[0].lastSuccessAt).toBe(first.sources[0].lastSuccessAt);
  });
});
