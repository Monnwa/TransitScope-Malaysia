import { linkBikeSnapshot, type SimulatedBikeStation } from "./simulation/scenarios";
import { EPOCH } from "./simulation/clock";
import { MICROMOBILITY_DISCLAIMER, MICROMOBILITY_OPERATORS, NEW_MICROMOBILITY_OPERATORS, OPERATOR_STYLE, micromobilityStationSchema, type MicromobilityResponse, type MicromobilityStation } from "./micromobility";

// Hand-selected public landmark surroundings, NOT parking coordinates. Each tuple
// contains independent representative points for HelloRide, TRYKE, and Beam.
// No randomness, viewport trimming, office locations, or operational inference.
const places = [
  ["klcc", "KLCC Park surroundings", "Kuala Lumpur City Centre", "Kuala Lumpur", [[3.153700,101.712400],[3.154300,101.712800],[3.154900,101.713100]]],
  ["bukit-bintang", "Bukit Bintang pedestrian area", "Bukit Bintang", "Kuala Lumpur", [[3.146400,101.710100],[3.146800,101.710600],[3.147200,101.711100]]],
  ["trx", "TRX public plaza surroundings", "TRX", "Kuala Lumpur", [[3.142500,101.718700],[3.142900,101.719100],[3.143300,101.719500]]],
  ["kl-sentral", "KL Sentral forecourt surroundings", "KL Sentral", "Kuala Lumpur", [[3.132800,101.686000],[3.133200,101.686400],[3.133600,101.686800]]],
  ["bangsar", "Bangsar community area", "Bangsar", "Kuala Lumpur", [[3.130000,101.671000],[3.130400,101.671400],[3.130800,101.671800]]],
  ["pj", "Taman Jaya park surroundings", "Petaling Jaya", "Selangor", [[3.104000,101.647800],[3.104400,101.648200],[3.104800,101.648600]]],
  ["subang", "SS15 community surroundings", "Subang Jaya", "Selangor", [[3.075400,101.586500],[3.075800,101.586900],[3.076200,101.587300]]],
  ["sunway", "Sunway public access surroundings", "Sunway", "Selangor", [[3.073400,101.606800],[3.073800,101.607200],[3.074200,101.607600]]],
  ["cyberjaya", "Cyberjaya town centre surroundings", "Cyberjaya", "Selangor", [[2.922800,101.650200],[2.923200,101.650600],[2.923600,101.651000]]],
  ["ayer8", "Ayer@8 promenade surroundings", "Putrajaya", "Putrajaya", [[2.919100,101.674700],[2.919500,101.675100],[2.919900,101.675500]]],
  ["millennium", "Millennium Monument surroundings", "Putrajaya", "Putrajaya", [[2.920400,101.681000],[2.920800,101.681400],[2.921200,101.681800]]],
  ["george-town", "Armenian Street surroundings", "George Town", "Penang", [[5.414300,100.336800],[5.414700,100.337200],[5.415100,100.337600]]],
  ["gurney", "Gurney public promenade surroundings", "Gurney Drive", "Penang", [[5.437000,100.309000],[5.437400,100.309400],[5.437800,100.309800]]],
  ["tanjung-tokong", "Tanjung Tokong community surroundings", "Tanjung Tokong", "Penang", [[5.456000,100.304000],[5.456400,100.304400],[5.456800,100.304800]]],
  ["bayan-lepas", "Bayan Baru public plaza surroundings", "Bayan Lepas", "Penang", [[5.325000,100.281000],[5.325400,100.281400],[5.325800,100.281800]]],
  ["esplanade", "Esplanade public grounds surroundings", "George Town", "Penang", [[5.420800,100.342700],[5.421200,100.343100],[5.421600,100.343500]]],
] as const;

const putrajayaSource = "https://smart.putrajaya.my/en/initiatives/tryke-micromobility/";
export const newMicromobilityStations: MicromobilityStation[] = NEW_MICROMOBILITY_OPERATORS.flatMap((operator, index) =>
  places.map(([slug, name, area, state, positions]) => {
    const sourceBacked = operator === "TRYKE" && (slug === "ayer8" || slug === "millennium");
    return micromobilityStationSchema.parse({
      id: `${operator.toLowerCase()}:coverage:${slug}`, operator, name: `${OPERATOR_STYLE[operator].name} · ${name}`,
      latitude: positions[index][0], longitude: positions[index][1], area, state,
      dataOrigin: sourceBacked ? "SOURCE_VERIFIED" : "SYNTHETIC",
      verificationStatus: sourceBacked ? "APPROXIMATE_LOCATION" : "DEMONSTRATION_ONLY",
      isSimulation: true, availableBikes: null, availableDocks: null, operationalStatus: "UNVERIFIED",
      ...(sourceBacked ? { sourceName: "Perbadanan Putrajaya · Smart Putrajaya", sourceUrl: putrajayaSource,
        sourceDescription: `The authority names ${slug === "ayer8" ? "Ayer@8 in Phase 1" : "Millennium Monument in Phase 2"} as a TRYKE virtual parking station. Reviewed 19 November 2026. The page does not publish exact parking coordinates or live status.`,
        notes: "Source-backed named location; representative public-area position only. Exact parking position and current operation are unverified." } : {
        notes: `Synthetic demonstration location only. This point does not confirm current ${OPERATOR_STYLE[operator].name} operations or approved parking.` }),
    });
  }));

// Isolated read-only adapter: preserve the existing API, original coordinates,
// station identities, popup, and its separate simulated inventory unchanged.
export function adaptLinkBikeStation(station: SimulatedBikeStation): MicromobilityStation {
  return micromobilityStationSchema.parse({ id: station.station_id, operator: "LINKBIKE", name: station.station_name,
    latitude: station.latitude, longitude: station.longitude, area: "George Town", state: "Penang",
    dataOrigin: "SYNTHETIC", verificationStatus: "DEMONSTRATION_ONLY", isSimulation: true,
    availableBikes: null, availableDocks: null, operationalStatus: "UNVERIFIED",
    notes: "Existing LinkBike simulation scenario. Location is synthetic; the original LinkBike API and simulated inventory remain separate.",
  });
}

export function micromobilitySnapshot(): MicromobilityResponse {
  const stations = [...linkBikeSnapshot(EPOCH).stations.map(adaptLinkBikeStation), ...newMicromobilityStations];
  return { status: "SIMULATED", coverage: ["Klang Valley", "Penang"], operators: [...MICROMOBILITY_OPERATORS], stations,
    metadata: { isSimulation: true, realTimeAvailability: false, syntheticLocationsIncluded: true, dataMode: "HYBRID", disclaimer: MICROMOBILITY_DISCLAIMER } };
}
