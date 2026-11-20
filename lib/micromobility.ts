import { z } from "zod";
import { inStationLocality } from "./micromobility-localities";
import type { SimulatedBikeStation } from "./simulation/scenarios";

export const MICROMOBILITY_OPERATORS = ["LINKBIKE", "HELLORIDE", "TRYKE", "BEAM"] as const;
export const NEW_MICROMOBILITY_OPERATORS = ["HELLORIDE", "TRYKE", "BEAM"] as const;
export type MicromobilityOperator = typeof MICROMOBILITY_OPERATORS[number];
export const OPERATOR_STYLE = {
  LINKBIKE: { name: "LinkBike", letter: "B" },
  HELLORIDE: { name: "HelloRide", letter: "H" },
  TRYKE: { name: "TRYKE", letter: "T" },
  BEAM: { name: "Beam Mobility", letter: "B" },
} as const;
export const MICROMOBILITY_DISCLAIMER = "These locations are used for demonstration and coverage visualization only. They do not confirm active operator stations, designated parking areas or real-time vehicle availability.";
export const SIMULATED_INVENTORY_DISCLAIMER = "Available bicycles and total docks are simulated for demonstration purposes and do not represent actual operator inventory or real-time availability.";

export const simulatedInventorySchema = z.object({
  availableBicycles: z.number().int().min(0), totalDocks: z.number().int().min(10).max(30), inventoryOrigin: z.literal("SIMULATED"),
}).refine(inventory => inventory.availableBicycles <= inventory.totalDocks, "Bicycles exceed simulated dock capacity");

/** FNV-1a over the stable station ID. No clock, network, or request-time randomness. */
export function generateInventory(stationId: string): z.infer<typeof simulatedInventorySchema> {
  let hash = 0x811c9dc5;
  for (let index = 0; index < stationId.length; index++) hash = Math.imul(hash ^ stationId.charCodeAt(index), 0x01000193) >>> 0;
  const totalDocks = 10 + hash % 21;
  const availableBicycles = hash % 6 === 0 ? 0 : (hash >>> 8) % (totalDocks + 1);
  return { availableBicycles, totalDocks, inventoryOrigin: "SIMULATED" };
}

export function inMicromobilityCoverage(latitude: number, longitude: number) {
  return Number.isFinite(latitude) && Number.isFinite(longitude) && (
    latitude >= 2.85 && latitude <= 3.30 && longitude >= 101.45 && longitude <= 101.85 ||
    latitude >= 5.25 && latitude <= 5.50 && longitude >= 100.18 && longitude <= 100.53);
}

export const micromobilityStationSchema = z.object({
  id: z.string().min(1), operator: z.enum(MICROMOBILITY_OPERATORS), name: z.string().min(1),
  latitude: z.number().finite().min(-90).max(90), longitude: z.number().finite().min(-180).max(180),
  area: z.string().min(1), state: z.enum(["Kuala Lumpur", "Selangor", "Putrajaya", "Penang"]),
  dataOrigin: z.enum(["SOURCE_VERIFIED", "SYNTHETIC"]),
  verificationStatus: z.enum(["VERIFIED_LOCATION", "APPROXIMATE_LOCATION", "DEMONSTRATION_ONLY"]),
  isSimulation: z.literal(true), availableBikes: z.null(), availableDocks: z.null(), operationalStatus: z.literal("UNVERIFIED"),
  simulatedInventory: simulatedInventorySchema.optional(),
  sourceName: z.string().optional(), sourceUrl: z.string().url().optional(), sourceDescription: z.string().optional(),
  notes: z.string().min(1),
}).superRefine((station, context) => {
  if (!inMicromobilityCoverage(station.latitude, station.longitude)) context.addIssue({ code: "custom", message: "Outside demonstration coverage" });
  if (!inStationLocality(station.area, station.state, station.latitude, station.longitude)) context.addIssue({ code: "custom", message: "Station does not match its named locality and state" });
  if (station.operator !== "LINKBIKE" && !station.simulatedInventory) context.addIssue({ code: "custom", message: "New operators require explicitly simulated inventory" });
  if (station.dataOrigin === "SYNTHETIC" && station.verificationStatus !== "DEMONSTRATION_ONLY") {
    context.addIssue({ code: "custom", message: "Synthetic locations must be demonstration only" });
  }
  if (station.dataOrigin === "SOURCE_VERIFIED" && (!station.sourceName || !station.sourceUrl || !station.sourceDescription || station.verificationStatus === "DEMONSTRATION_ONLY")) {
    context.addIssue({ code: "custom", message: "Source-backed locations require evidence and location precision" });
  }
});
export type MicromobilityStation = z.infer<typeof micromobilityStationSchema>;

export function adaptLinkBikeStation(station: SimulatedBikeStation): MicromobilityStation {
  return micromobilityStationSchema.parse({ id: station.station_id, operator: "LINKBIKE", name: station.station_name,
    latitude: station.latitude, longitude: station.longitude, area: "George Town", state: "Penang",
    dataOrigin: "SYNTHETIC", verificationStatus: "DEMONSTRATION_ONLY", isSimulation: true,
    availableBikes: null, availableDocks: null, operationalStatus: "UNVERIFIED",
    notes: "Existing LinkBike simulation scenario. Location is synthetic; the original LinkBike API and simulated inventory remain separate.",
  });
}

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
