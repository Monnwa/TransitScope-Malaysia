import { safeOfficialUrl, type AlertPayload, type AlertSource, type OfficialAlert } from "@/lib/official-alert-model";
import { rapidRailMeta } from "@/lib/rail-model";
import type { Mode, Record as TransitRecord } from "@/lib/transit-data";

type Operator = "rapid" | "ktm" | "erl" | "tbs";
type Service = { id: string; label: string; operator: Operator; mode?: Mode; directions?: string[] };
type Scope = "At this station" | "Station mentioned" | "Line notice" | "Operator notice";
type Notice = {
  alert: OfficialAlert;
  scope: Scope;
  direction?: string;
  alternative?: string;
  current: boolean;
};

const day = 86_400_000;
const sourceMaxAge = 20 * 60_000;
const operatorLinks: Record<Operator, { label: string; href: string }> = {
  rapid: { label: "MyRapid updates", href: "https://myrapid.com.my/" },
  ktm: { label: "KTM timetables", href: "https://www.ktmb.com.my/traintime.html" },
  erl: { label: "ERL updates", href: "https://www.kliaekspres.com/happenings/service-updates/" },
  tbs: { label: "TBS departures", href: "https://tbsbts.gohub.com.my/" },
};
const airportService: Service = {
  id: "ERL-TRANSIT", label: "KLIA Transit", operator: "erl", directions: ["KL Sentral", "KLIA T1 / T2"],
};
const btsServices: Service[] = [
  { id: "LRT-PH", label: "LRT Sri Petaling Line", mode: "LRT", operator: "rapid", directions: ["Sentul Timur", "Putra Heights"] },
  { id: "KTM:KC05_KB18", label: "KTM Komuter", mode: "KTM", operator: "ktm", directions: ["Batu Caves", "Pulau Sebang"] },
  airportService,
  { id: "TBS", label: "TBS express buses", operator: "tbs" },
];

export const bandarTasikSelatan: TransitRecord = {
  id: "station-operations:bandar-tasik-selatan", name: "Bandar Tasik Selatan", station: "Bandar Tasik Selatan",
  recordKind: "stop", mode: "LRT", operator: "Rapid KL / KTMB / ERL / TBS", route: null, position: null,
  status: "Station available", dataMode: "STATIC", reportedAt: null, source: "ERL station guide",
};

function normalise(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function stationKey(value: string) {
  return normalise(value).replace(/^(?:(?:stesen|station|hentian|mrt|lrt|ktm|komuter) )+/, "")
    .replace(/ (?:stesen|station|hentian)$/, "");
}

export function isBandarTasikSelatan(record: TransitRecord) {
  return record.recordKind === "stop" && [record.station, record.name].some(name =>
    name && ["bandar tasik selatan", "terminal bersepadu selatan", "tbs"].includes(stationKey(name)));
}

function stationAliases(record: TransitRecord) {
  const names = [record.name, record.station ?? ""].map(stationKey);
  if (isBandarTasikSelatan(record)) names.push("bandar tasik selatan", "terminal bersepadu selatan", "tbs");
  if (names.includes("putrajaya sentral")) names.push("putrajaya cyberjaya", "putrajaya and cyberjaya");
  return [...new Set(names.filter(name => name.length >= 3 && !name.includes("unavailable")))];
}

function servicesAt(record: TransitRecord): Service[] {
  const lines = Object.values(rapidRailMeta);
  const mapped = (record.railLines ?? []).map((id, index): Service => {
    const line = lines.find(item => item.id === id);
    return { id, label: line?.name ?? record.lineNames?.[index] ?? record.route ?? "KTM Komuter",
      operator: id.startsWith("KTM:") ? "ktm" : "rapid", mode: line?.mode ?? "KTM" };
  });
  if (isBandarTasikSelatan(record)) {
    const localBus = record.mode === "Bus" && record.route
      ? [{ id: record.routeId ?? record.route, label: record.route, operator: "rapid" as const, mode: "Bus" as const }] : [];
    return [...new Map([...mapped, ...btsServices, ...localBus].map(service => [service.id, service])).values()];
  }
  if (stationAliases(record).includes("putrajaya sentral") && mapped.some(service => service.id === "MRT2")) return [...mapped, airportService];
  if (mapped.length) return mapped;
  if (record.mode === "Shared bike") return [];
  return [{ id: record.routeId ?? record.mode, label: record.route ?? (record.mode === "Bus" ? "Local buses" : record.mode),
    operator: record.mode === "KTM" ? "ktm" : "rapid", mode: record.mode }];
}

function operatorForSource(name: string): Operator | undefined {
  if (/^(Rapid KL|Prasarana|MRT Corp)\b/i.test(name)) return "rapid";
  if (/^KTMB\b/i.test(name)) return "ktm";
  if (/^ERL\b/i.test(name)) return "erl";
}

function hasPhrase(text: string, phrase: string) {
  return !!phrase && (" " + text + " ").includes(" " + phrase + " ");
}

function stationScope(alert: OfficialAlert, aliases: string[]): Scope | undefined {
  const title = normalise(alert.title);
  const description = normalise(alert.description);
  if (alert.stations.some(name => aliases.includes(stationKey(name)))) return "At this station";
  const named = aliases.filter(alias => hasPhrase(title, alias) || hasPhrase(description, alias));
  if (!named.length) return;
  const direct = named.some(name => new RegExp("(?:^| )(?:closure of (?:the )?|penutupan (?:stesen )?)(?:station )?" + name +
    "(?: station)?(?: |$)|(?:^| )" + name + "(?: station)? (?:temporarily closed|is closed|closed|ditutup|will be skipped)(?: |$)").test(title));
  return direct ? "At this station" : "Station mentioned";
}

function directionInNotice(alert: OfficialAlert, service: Service) {
  const text = normalise(alert.title + " " + alert.description);
  const matches = service.directions?.filter(direction => {
    const destinations = direction.split(" / ").map(normalise);
    return destinations.some(destination => ["towards", "toward", "arah", "bound for"].some(prefix =>
      hasPhrase(text, prefix + " " + destination)));
  });
  return matches?.length === 1 ? matches[0] : undefined;
}

function alternativeInNotice(description: string) {
  return description.split(/(?<=[.!?])\s+/).find(sentence =>
    /\b(?:shuttle (?:bus|train)|replacement (?:bus|service)|bas perantara|tren perantara)\b/i.test(sentence) &&
    /\b(?:board|boarding|pickup|pick.up|platform|from|dari|menaiki|berlepas)\b/i.test(sentence))?.slice(0, 240);
}

function fresh(source: AlertSource, now: number) {
  const age = now - Date.parse(source.lastSuccessAt ?? "");
  return source.status === "healthy" && age >= -60_000 && age < sourceMaxAge;
}

function noticeFor(service: Service, alert: OfficialAlert, aliases: string[], sources: AlertSource[], now: number): Notice | undefined {
  if (!safeOfficialUrl(alert.sourceUrl) || operatorForSource(alert.sourceName) !== service.operator ||
      ["EXPIRED", "RESOLVED"].includes(alert.alertStatus) || ["RESTORATION", "GENERAL"].includes(alert.category)) return;
  const published = Date.parse(alert.publishedAt ?? "");
  const until = Date.parse(alert.validUntil ?? alert.endsAt ?? "");
  const age = now - published;
  if (until <= now || age < 0 || (age > 14 * day && !Number.isFinite(until))) return;
  const namedScope = stationScope(alert, aliases);
  const exactLine = alert.affectedLineIds.includes(service.id) ||
    (service.mode === "Bus" && alert.routes.some(route => hasPhrase(normalise(service.label), normalise(route))));
  // A rail notice mentioning replacement buses does not affect an unrelated bus route.
  const compatibleMode = service.mode && alert.affectedModes.length === 1 && alert.affectedModes[0] === service.mode &&
    alert.affectedLineIds.length === 0;
  if (!exactLine && !compatibleMode) return;
  const source = sources.find(item => item.name === alert.sourceName);
  const current = !!source && fresh(source, now) && !alert.stale && Number.isFinite(age) && age < 2 * day;
  return { alert, scope: namedScope ?? (exactLine ? "Line notice" : "Operator notice"), current,
    direction: directionInNotice(alert, service), alternative: alternativeInNotice(alert.description) };
}

export function getStationOperations(record: TransitRecord, payload: AlertPayload | null, refreshFailed: boolean, now: number) {
  const aliases = stationAliases(record);
  const sources = payload?.sources ?? [];
  return servicesAt(record).map(service => {
    const checkedSources = refreshFailed ? [] : sources.filter(source => operatorForSource(source.name) === service.operator &&
      !source.name.startsWith("MRT Corp") && fresh(source, now));
    const notices = (payload?.alerts ?? []).flatMap(alert => {
      const notice = noticeFor(service, alert, aliases, refreshFailed ? [] : sources, now);
      return notice ? [notice] : [];
    }).sort((a, b) => Number(b.current) - Number(a.current) ||
      Number(b.scope === "At this station") - Number(a.scope === "At this station") ||
      (b.alert.publishedAt ?? "").localeCompare(a.alert.publishedAt ?? ""));
    return { ...service, official: operatorLinks[service.operator], notices, lastChecked: checkedSources
      .map(source => source.lastSuccessAt).sort().at(-1) ?? null,
      networkStatus: checkedSources.find(source => source.serviceStatus)?.serviceStatus };
  });
}

export function stationServiceLabel(service: ReturnType<typeof getStationOperations>[number], notices: Notice[]) {
  const confirmed = notices.find(notice => notice.current && notice.scope === "At this station" && notice.alert.alertStatus === "ACTIVE");
  if (confirmed) {
    if (confirmed.alert.category === "CLOSURE") return "Station closure reported";
    if (confirmed.alert.category === "DIVERSION") return "Diversion reported";
    if (confirmed.alert.category === "DELAY") return "Delay reported at this station";
    return "Disruption reported at this station";
  }
  if (notices.some(notice => notice.current)) return "Check service notice";
  if (service.networkStatus === "DISRUPTED") return "Operator network disruption";
  if (service.networkStatus === "NORMAL") return "Operator network reports normal";
  return service.lastChecked ? "No current notice found" : "Station status unavailable";
}
