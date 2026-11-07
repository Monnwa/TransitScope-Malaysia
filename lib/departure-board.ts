import type { ScheduledDeparture, FrequencyWindow } from "@/lib/scheduled-departures";
export type DeparturePayload = {
  status: string; message: string; departures: ScheduledDeparture[]; frequencies: FrequencyWindow[]; retrievedAt: string;
  emptyReason?: "NO_MORE_TODAY" | "NO_SERVICE_TODAY" | "TIMETABLE_UNAVAILABLE" | null;
  liveEta: { available: boolean; reason: string; predictions?: { tripId: string; estimatedDeparture: string; source: string; verified: boolean }[] };
  sources: { source: string; lastUpdated: string | null; error: string | null }[];
};
export const malaysiaDay = (value: string | number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuala_Lumpur", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
export const boardTime = (value: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kuala_Lumpur", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(value));
export const boardDate = (value: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kuala_Lumpur", day: "numeric", month: "short", weekday: "short" }).format(new Date(value));
export function safeTimetableSource(value: string) {
  try { const url = new URL(value); return url.protocol === "https:" && ["api.data.gov.my", "myrapid.com.my", "www.myrapid.com.my", "www.ktmb.com.my", "www.mymrt.com.my"].includes(url.hostname) && !url.username && !url.password; } catch { return false; }
}
export function availableDepartures(items: ScheduledDeparture[], now: number) {
  return items.filter(item => Number.isFinite(Date.parse(item.scheduledDeparture)) && Date.parse(item.scheduledDeparture) >= now).sort((a, b) => Date.parse(a.scheduledDeparture) - Date.parse(b.scheduledDeparture)).slice(0, 10);
}
export function emptyBoardMessage(data: DeparturePayload) {
  if (data.emptyReason === "NO_SERVICE_TODAY" || data.message === "No scheduled service for today.") return "No scheduled service for today.";
  if (data.emptyReason === "NO_MORE_TODAY" || data.message === "No more scheduled departures today.") return "No more scheduled departures today.";
  return "Scheduled departure information is currently unavailable.";
}
