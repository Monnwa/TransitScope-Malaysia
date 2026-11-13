import type { Alert, Mode } from "@/lib/transit-data";
export type OfficialAlert = Alert & {
  category: "DISRUPTION" | "DELAY" | "CLOSURE" | "MAINTENANCE" | "DIVERSION" | "SCHEDULE_CHANGE" | "RESTORATION" | "GENERAL";
  classificationSeverity: "HIGH" | "MEDIUM" | "LOW" | "INFO" | "UNKNOWN";
  affectedModes: Mode[]; affectedLineIds: string[];
  sourceName: string; sourceType: "OFFICIAL_WEBSITE"; sourceUrl: string;
  publishedAt: string | null; retrievedAt: string; validUntil?: string;
  alertStatus: "ACTIVE" | "RESOLVED" | "EXPIRED" | "UNKNOWN"; stale: boolean; incidentId?: string;
};
export type AlertSource = { name: string; url: string; status: "healthy" | "stale" | "unavailable"; lastSuccessAt: string | null; message: string | null; serviceStatus?: "NORMAL" | "DISRUPTED" };
export type AlertPayload = { alerts: OfficialAlert[]; sources: AlertSource[]; retrievedAt: string };
export function isOfficialAlert(alert: Alert): alert is OfficialAlert { return "sourceUrl" in alert; }
export function safeOfficialUrl(value: string): boolean {
  try { const url = new URL(value); return url.protocol === "https:" && ["myrapid.com.my", "www.myrapid.com.my", "www.prasarana.com.my", "prasarana.com.my", "www.ktmb.com.my", "ktmb.com.my", "www.mymrt.com.my", "mymrt.com.my", "www.kliaekspres.com", "kliaekspres.com"].includes(url.hostname) && !url.username && !url.password; } catch { return false; }
}
