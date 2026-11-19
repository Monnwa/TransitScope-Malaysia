import { z } from "zod";

export const MICROMOBILITY_OPERATORS = ["LINKBIKE", "HELLORIDE", "TRYKE", "BEAM"] as const;
export const NEW_MICROMOBILITY_OPERATORS = ["HELLORIDE", "TRYKE", "BEAM"] as const;
export type MicromobilityOperator = typeof MICROMOBILITY_OPERATORS[number];
export const OPERATOR_STYLE = {
  LINKBIKE: { name: "LinkBike", colour: "#713f12", letter: "B" },
  HELLORIDE: { name: "HelloRide", colour: "#0369a1", letter: "H" },
  TRYKE: { name: "TRYKE", colour: "#c2410c", letter: "T" },
  BEAM: { name: "Beam Mobility", colour: "#7e22ce", letter: "B" },
} as const;
export const MICROMOBILITY_DISCLAIMER = "These locations are used for demonstration and coverage visualization only. They do not confirm active operator stations, designated parking areas or real-time vehicle availability.";

export function inMicromobilityCoverage(latitude: number, longitude: number) {
  return Number.isFinite(latitude) && Number.isFinite(longitude) && (
    latitude >= 2.85 && latitude <= 3.30 && longitude >= 101.45 && longitude <= 101.85 ||
    latitude >= 5.25 && latitude <= 5.50 && longitude >= 100.24 && longitude <= 100.36);
}

export const micromobilityStationSchema = z.object({
  id: z.string().min(1), operator: z.enum(MICROMOBILITY_OPERATORS), name: z.string().min(1),
  latitude: z.number().finite().min(-90).max(90), longitude: z.number().finite().min(-180).max(180),
  area: z.string().min(1), state: z.enum(["Kuala Lumpur", "Selangor", "Putrajaya", "Penang"]),
  dataOrigin: z.enum(["SOURCE_VERIFIED", "SYNTHETIC"]),
  verificationStatus: z.enum(["VERIFIED_LOCATION", "APPROXIMATE_LOCATION", "DEMONSTRATION_ONLY"]),
  isSimulation: z.literal(true), availableBikes: z.null(), availableDocks: z.null(), operationalStatus: z.literal("UNVERIFIED"),
  sourceName: z.string().optional(), sourceUrl: z.string().url().optional(), sourceDescription: z.string().optional(),
  notes: z.string().min(1),
}).superRefine((station, context) => {
  if (!inMicromobilityCoverage(station.latitude, station.longitude)) context.addIssue({ code: "custom", message: "Outside demonstration coverage" });
  if (station.dataOrigin === "SYNTHETIC" && station.verificationStatus !== "DEMONSTRATION_ONLY") {
    context.addIssue({ code: "custom", message: "Synthetic locations must be demonstration only" });
  }
  if (station.dataOrigin === "SOURCE_VERIFIED" && (!station.sourceName || !station.sourceUrl || !station.sourceDescription || station.verificationStatus === "DEMONSTRATION_ONLY")) {
    context.addIssue({ code: "custom", message: "Source-backed locations require evidence and location precision" });
  }
});
export type MicromobilityStation = z.infer<typeof micromobilityStationSchema>;

export const micromobilityResponseSchema = z.object({
  status: z.literal("SIMULATED"), coverage: z.array(z.string()), operators: z.array(z.enum(MICROMOBILITY_OPERATORS)),
  stations: z.array(micromobilityStationSchema),
  metadata: z.object({ isSimulation: z.literal(true), realTimeAvailability: z.literal(false), syntheticLocationsIncluded: z.boolean(), dataMode: z.literal("HYBRID"), disclaimer: z.string() }),
});
export type MicromobilityResponse = z.infer<typeof micromobilityResponseSchema>;

export function locationLabel(station: MicromobilityStation) {
  return station.dataOrigin === "SYNTHETIC" ? "SIMULATED · SYNTHETIC DEMONSTRATION LOCATION" :
    station.verificationStatus === "APPROXIMATE_LOCATION" ? "SIMULATED · SOURCE-BACKED LOCATION · APPROXIMATE POSITION" : "SIMULATED · SOURCE-VERIFIED LOCATION";
}

export function stationCounts(stations: MicromobilityStation[]) {
  return MICROMOBILITY_OPERATORS.map(operator => ({ operator, total: stations.filter(s => s.operator === operator).length,
    sourceBacked: stations.filter(s => s.operator === operator && s.dataOrigin === "SOURCE_VERIFIED").length,
    synthetic: stations.filter(s => s.operator === operator && s.dataOrigin === "SYNTHETIC").length }));
}
