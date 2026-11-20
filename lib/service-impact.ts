import type { Mode } from "./transit-data";

export const serviceImpactLevels = ["high", "medium", "low"] as const;
export type ServiceImpactSeverity = typeof serviceImpactLevels[number];

export const serviceImpact = {
  high: { label: "High", tone: "danger" },
  medium: { label: "Medium", tone: "warning" },
  low: { label: "Low", tone: "info" },
} as const satisfies Record<ServiceImpactSeverity, { label: string; tone: string }>;

type SeverityMetadata = { severity?: string; impact?: string; classificationSeverity?: string; category?: string };

export function resolveServiceImpact(alert: SeverityMetadata): ServiceImpactSeverity {
  for (const value of [alert.severity, alert.impact, alert.classificationSeverity]) {
    const level = value?.trim().toLowerCase();
    if (level === "high" || level === "medium" || level === "low") return level;
    if (level === "info" || level === "informational") return "low";
  }
  // Only established delay, diversion and maintenance categories imply moderate impact.
  // Unclassified notices are informational. High requires explicit severity metadata.
  return /^(delay|diversion|maintenance)$/i.test(alert.category ?? "") ? "medium" : "low";
}

export function serviceAlertMatchesTransport(
  alert: { modes: readonly Mode[]; routeIds: readonly string[] },
  modes: readonly Mode[],
  showsBusRoute: (routeId?: string) => boolean,
) {
  return !alert.modes.length || alert.modes.some(mode => modes.includes(mode) &&
    (mode !== "Bus" || !alert.routeIds.length || alert.routeIds.some(showsBusRoute)));
}

export function serviceAlertTime(value?: string | null) {
  const timestamp = value ? Date.parse(value) : NaN;
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

export function summarizeServiceAlerts<T extends SeverityMetadata & { startedAt?: string; updatedAt?: string }>(alerts: readonly T[]) {
  const counts: Record<ServiceImpactSeverity, number> = { high: 0, medium: 0, low: 0 };
  const groups = { high: [], medium: [], low: [] } as Record<ServiceImpactSeverity, Array<{ alert: T; severity: ServiceImpactSeverity; time: number }>>;
  for (const alert of alerts) {
    const severity = resolveServiceImpact(alert);
    counts[severity] += 1;
    groups[severity].push({ alert, severity, time: serviceAlertTime(alert.updatedAt) ?? serviceAlertTime(alert.startedAt) ?? -Infinity });
  }
  // Stable sorting preserves source order for ties and undated notices.
  const ordered = serviceImpactLevels.flatMap(level => groups[level].sort((a, b) => a.time === b.time ? 0 : b.time - a.time));
  return { counts, ordered };
}
