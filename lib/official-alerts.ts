import { classifyAnnouncement, updateAlertStatuses } from "@/lib/alert-classifier";
import { safeOfficialUrl, type OfficialAlert, type AlertPayload, type AlertSource } from "@/lib/official-alert-model";
const TTL = 10 * 60000;
const sources = [
  { name: "Prasarana Official RSS", url: "https://www.prasarana.com.my/feed/", kind: "rss" },
  { name: "KTMB Official Notices", url: "https://www.ktmb.com.my/index.html", kind: "html" },
  { name: "Rapid KL Official RSS", url: "https://myrapid.com.my/feed/", kind: "rss" },
  { name: "MRT Corp Official RSS", url: "https://www.mymrt.com.my/feed/", kind: "rss" },
] as const;
const cache = new Map<string, { alerts: OfficialAlert[]; lastSuccessAt: string; expires: number }>();
let inflight: Promise<AlertPayload> | null = null;
let snapshot: {value: AlertPayload; expires: number} | null = null;
export function plainText(value: string) {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<script\b[\s\S]*?<\/script>/gi, "").replace(/<style\b[\s\S]*?<\/style>/gi, "").replace(/<[^>]*>/g, " ").replace(/&#(x[0-9a-f]+|\d+);/gi, (_, code) => { const value = code[0].toLowerCase() === "x" ? parseInt(code.slice(1),16) : +code; return value <= 0x10ffff && value >= 0 ? String.fromCodePoint(value) : ""; }).replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
}
export function parseOfficialAnnouncements(body: string, sourceName: string, sourceUrl: string, kind: "rss" | "html", retrievedAt: string): OfficialAlert[] {
  const candidates: {title:string;url:string;date:string|null;body:string;until?:string;incident?:string}[] = [];
  if (kind === "rss") {
    if (!/<rss\b|<feed\b/i.test(body)) throw new Error("Official feed is unavailable or access-protected.");
    for (const item of body.match(/<item\b[^>]*>[\s\S]*?<\/item>/gi) ?? []) {
      const tag = (name:string) => plainText(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`,"i").exec(item)?.[1] ?? "");
      const title = tag("title"), url = tag("link"), date = tag("pubDate");
      if (/\/tenders?\/|<category[^>]*>[^<]*tender/i.test(item)) continue;
      if (!/service|perkhidmatan|gangguan|penyelenggaraan|lencongan|operasi|maintenance|disruption|closure|delay|suspend/i.test(title)) continue;
      const expiry = tag("expires");
      candidates.push({title,url,date:Number.isFinite(Date.parse(date))?new Date(date).toISOString():null,body:tag("description"),until:Number.isFinite(Date.parse(expiry))?new Date(expiry).toISOString():undefined,incident:tag("incidentId")||undefined});
    }
  } else {
    if (!/<html|<!doctype html/i.test(body) || /Incapsula_Resource|Just a moment/i.test(body)) throw new Error("Official notice page is access-protected.");
    const activeHtml = body.replace(/<!--[\s\S]*?-->/g, "");
    for (const anchor of activeHtml.match(/<a\b[^>]*>[\s\S]*?<\/a>/gi) ?? []) {
      const title = plainText(/\btitle="([^"]*)"/i.exec(anchor)?.[1] ?? "");
      const href = /\bhref="([^"]*)"/i.exec(anchor)?.[1];
      if (!href || !/notis|perubahan operasi|menaik taraf landasan|service disrupt|maintenance|perubahan platform/i.test(title)) continue;
      const url = new URL(href, sourceUrl).href;
      // Publication dates are not inferred from asset directory names or retrieval time.
      candidates.push({title,url,date:null,body:""});
    }
  }
  return candidates.filter(item => safeOfficialUrl(item.url)).map(item => {
    const classification = classifyAnnouncement(item.title + " " + item.body);
    if (sourceName.startsWith("KTMB") && !classification.affectedModes.includes("KTM")) classification.affectedModes.push("KTM");
    const recent = item.date && Date.parse(retrievedAt) - Date.parse(item.date) < 2 * 86400000;
    return { id: item.url, title: item.title, description: "Official operator announcement. Open the original notice for complete details and any effective dates.", severity: classification.severity === "HIGH" ? "High" : classification.severity === "MEDIUM" ? "Medium" : "Low", routes: classification.lines, stations: [], startedAt: item.date ?? retrievedAt, endsAt: item.until ?? null, validUntil:item.until, incidentId:item.incident, source: sourceName, dataMode: "STATIC", category: classification.category, classificationSeverity: classification.severity, affectedModes: classification.affectedModes, affectedLineIds: classification.affectedLineIds, sourceName, sourceType: "OFFICIAL_WEBSITE", sourceUrl: item.url, publishedAt: item.date, retrievedAt, alertStatus: classification.category === "RESTORATION" ? "RESOLVED" : recent && ["DISRUPTION","DELAY","CLOSURE"].includes(classification.category) ? "ACTIVE" : "UNKNOWN", stale: !recent } satisfies OfficialAlert;
  });
}
async function text(url: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(10000), redirect: "error", headers: { "User-Agent": "TransitScope-Malaysia/1.0 (official-announcements)" }, cache: "no-store" });
  if (!response.ok) throw new Error(`Official source returned HTTP ${response.status}`);
  const body = await response.text(); if (body.length > 2_000_000) throw new Error("Official response exceeds size limit"); return body;
}
export function robotsAllows(robots:string, path:string) {
  let applies = false; const rules: {allow:boolean;prefix:string}[] = [];
  for (const raw of robots.split(/\r?\n/)) { const line=raw.split("#")[0].trim(); const [key,...rest]=line.split(":"); const value=rest.join(":").trim(); if (/^user-agent$/i.test(key)) applies=value === "*"; else if (applies && /^(disallow|allow)$/i.test(key) && value) rules.push({allow:/^allow$/i.test(key),prefix:value.replace(/\*.*$/,"")}); }
  const matching=rules.filter(rule=>path.startsWith(rule.prefix)).sort((a,b)=>b.prefix.length-a.prefix.length || Number(b.allow)-Number(a.allow)); return !matching.length || matching[0].allow;
}
async function retrieveAlerts(): Promise<AlertPayload> {
  const now = Date.now(), retrievedAt = new Date(now).toISOString();
  const results = await Promise.all(sources.map(async source => {
    const prior = cache.get(source.url); let meta: AlertSource;
    if (prior && prior.expires > now) return { alerts: prior.alerts, meta: { name:source.name,url:source.url,status:"healthy" as const,lastSuccessAt:prior.lastSuccessAt,message:null } };
    try {
      const origin = new URL(source.url).origin; const robots = await text(origin + "/robots.txt");
      if (!robotsAllows(robots,new URL(source.url).pathname)) throw new Error("Access disallowed by official robots policy");
      const alerts = parseOfficialAnnouncements(await text(source.url), source.name, source.url, source.kind, retrievedAt);
      const merged = [...new Map([...(prior?.alerts ?? []), ...alerts].map(alert => [alert.sourceUrl, alert])).values()];
      cache.set(source.url,{alerts:merged,lastSuccessAt:retrievedAt,expires:now+TTL});
      meta = { name:source.name,url:source.url,status:"healthy",lastSuccessAt:retrievedAt,message:null }; return {alerts:merged,meta};
    } catch(error) { meta = {name:source.name,url:source.url,status:prior?"stale":"unavailable",lastSuccessAt:prior?.lastSuccessAt??null,message:error instanceof Error?error.message:"Official source unavailable"}; return {alerts:(prior?.alerts??[]).map(alert=>({...alert,stale:true})),meta}; }
  }));
  return { alerts:updateAlertStatuses([...new Map(results.flatMap(result=>result.alerts).map(alert=>[alert.sourceUrl,alert])).values()]), sources: [...results.map(result=>result.meta), ...["Official X","Official Facebook"].map(name=>({name,url:"",status:"unavailable" as const,lastSuccessAt:null,message:"No authorised API connection configured; protected social pages are not scraped."}))], retrievedAt };
}
export async function getOfficialAlerts() { if(snapshot && snapshot.expires>Date.now())return snapshot.value; if(inflight)return inflight; inflight=retrieveAlerts().then(value=>{snapshot={value,expires:Date.now()+TTL};return value;}).finally(()=>{inflight=null;}); return inflight; }
