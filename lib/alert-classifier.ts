import type { OfficialAlert } from "@/lib/official-alert-model";
import type { Mode } from "@/lib/transit-data";
export function classifyAnnouncement(text: string) {
  let category: OfficialAlert["category"] = "GENERAL", severity: OfficialAlert["classificationSeverity"] = "UNKNOWN";
  if (/service (?:fully )?restored|perkhidmatan (?:telah )?pulih|kembali normal/i.test(text)) { category = "RESTORATION"; severity = "INFO"; }
  else if (/service suspend|perkhidmatan digantung|gangguan perkhidmatan|service disruption/i.test(text)) { category = "DISRUPTION"; severity = "HIGH"; }
  else if (/station (?:temporarily )?clos|penutupan stesen/i.test(text)) { category = "CLOSURE"; severity = "HIGH"; }
  else if (/train delay|delayed service|kelewatan (?:tren|perkhidmatan)/i.test(text)) { category = "DELAY"; severity = "HIGH"; }
  else if (/maintenance|penyelenggaraan|menaik taraf landasan|KVDT/i.test(text)) { category = "MAINTENANCE"; severity = "MEDIUM"; }
  else if (/diversion|route divert|lencongan/i.test(text)) { category = "DIVERSION"; severity = "MEDIUM"; }
  const lineMatchers: [RegExp, string, string, Mode][] = [[/kajang (?:line|mrt)|laluan kajang/i,"MRT1","MRT Kajang Line","MRT"],[/putrajaya (?:line|mrt)|laluan putrajaya/i,"MRT2","MRT Putrajaya Line","MRT"],[/kelana jaya line|laluan kelana jaya/i,"LRT-KJ","LRT Kelana Jaya Line","LRT"],[/ampang line|laluan ampang/i,"LRT-AG","LRT Ampang Line","LRT"],[/sri petaling line|laluan sri petaling/i,"LRT-PH","LRT Sri Petaling Line","LRT"],[/monorail|monorel/i,"MONORAIL","KL Monorail","Monorail"],[/seremban (?:line)|laluan seremban/i,"KTM:KC05_KB18","KTM Seremban Line","KTM"],[/port klang line|laluan pelabuhan klang/i,"KTM:KA15_KD19","KTM Port Klang Line","KTM"]];
  const matched = lineMatchers.filter(([pattern]) => pattern.test(text));
  const modes = new Set<Mode>(matched.map(([, , , mode]) => mode));
  if (/\bKTM(?:B)?\b|komuter/i.test(text)) modes.add("KTM"); if (/\bMRT\b/.test(text)) modes.add("MRT"); if (/\bLRT\b/.test(text)) modes.add("LRT"); if (/\bbus\b|\bbas\b/i.test(text)) modes.add("Bus");
  return { category, severity, affectedModes: [...modes], affectedLineIds: matched.map(([, id]) => id), lines: matched.map(([, , name]) => name), planned: category === "MAINTENANCE" };
}
export function updateAlertStatuses(alerts: OfficialAlert[], now = Date.now()): OfficialAlert[] {
  const updated = alerts.map(alert => ({ ...alert, stale: alert.stale || !alert.publishedAt || now - Date.parse(alert.publishedAt) > 7 * 86400000, alertStatus: alert.validUntil && Date.parse(alert.validUntil) < now ? "EXPIRED" as const : alert.category === "RESTORATION" ? "RESOLVED" as const : alert.alertStatus }));
  for (const alert of updated) if (alert.incidentId && updated.some(other => other !== alert && other.incidentId === alert.incidentId && other.sourceName === alert.sourceName && other.category === "RESTORATION" && other.publishedAt && alert.publishedAt && other.publishedAt > alert.publishedAt)) alert.alertStatus = "RESOLVED";
  return updated;
}
