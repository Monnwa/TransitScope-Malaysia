import { linkBikeSnapshot, type SimulatedBikeStation } from "./simulation/scenarios";
import { EPOCH } from "./simulation/clock";
import { MICROMOBILITY_DISCLAIMER, MICROMOBILITY_OPERATORS, NEW_MICROMOBILITY_OPERATORS, OPERATOR_STYLE, generateInventory, micromobilityStationSchema, type MicromobilityResponse, type MicromobilityStation } from "./micromobility";
import { MICROMOBILITY_LOCALITIES } from "./micromobility-localities";

// Hand-selected public landmark surroundings, NOT parking coordinates. Layouts
// are independent, not small offsets around the same 16 anchors. Legacy ID keys
// are retained across relocation; displayed names/areas describe the new points.
const places = {
  HELLORIDE: [
    ["klcc", "KLCC Park surroundings", "Kuala Lumpur City Centre",3.153700,101.712400],
    ["bukit-bintang", "Bukit Bintang pedestrian area", "Bukit Bintang",3.146400,101.710100],
    ["trx", "TRX public plaza surroundings", "TRX",3.142500,101.718700],
    ["kl-sentral", "KL Sentral forecourt surroundings", "KL Sentral",3.132800,101.686000],
    ["bangsar", "Bangsar community area", "Bangsar",3.130000,101.671000],
    ["pj", "Taman Jaya park surroundings", "Petaling Jaya",3.104000,101.647800],
    ["subang", "SS15 community surroundings", "Subang Jaya",3.075400,101.586500],
    ["sunway", "SS2 public square surroundings", "SS2",3.118500,101.621500],
    ["cyberjaya", "DPulze public frontage surroundings", "Cyberjaya",2.922800,101.650200],
    ["ayer8", "Putrajaya Sentral forecourt surroundings", "Putrajaya",2.931600,101.671100],
    ["millennium", "Alamanda public entrance surroundings", "Putrajaya",2.938900,101.710900],
    ["george-town", "Penang Times Square surroundings", "George Town",5.413500,100.325000],
    ["gurney", "Gurney Bay park surroundings", "Gurney Drive",5.431500,100.315900],
    ["tanjung-tokong", "Batu Ferringhi town surroundings", "Batu Ferringhi",5.473800,100.248400],
    ["bayan-lepas", "Queensbay public entrance surroundings", "Queensbay",5.333200,100.306100],
    ["esplanade", "Penang Sentral forecourt surroundings", "Butterworth",5.394900,100.366300],
  ],
  TRYKE: [
    ["klcc", "Titiwangsa park entrance surroundings", "Titiwangsa",3.177600,101.706200],
    ["bukit-bintang", "Chow Kit public-area surroundings", "Chow Kit",3.167500,101.698800],
    ["trx", "Merdeka Square surroundings", "Merdeka Square",3.147700,101.693500],
    ["kl-sentral", "Mid Valley forecourt surroundings", "Mid Valley",3.117800,101.677600],
    ["bangsar", "Mont Kiara public-area surroundings", "Mont Kiara",3.165900,101.652900],
    ["pj", "Damansara Uptown public-area surroundings", "Damansara Utama",3.134600,101.622900],
    ["subang", "Shah Alam civic square surroundings", "Shah Alam",3.072400,101.518300],
    ["sunway", "Sunway public access surroundings", "Sunway",3.073800,101.607200],
    ["cyberjaya", "Tamarind Square surroundings", "Cyberjaya",2.918600,101.636700],
    ["ayer8", "Ayer@8 promenade surroundings", "Putrajaya",2.919500,101.675100],
    ["millennium", "Millennium Monument surroundings", "Putrajaya",2.920800,101.681400],
    ["george-town", "Karpal Singh Drive promenade surroundings", "Karpal Singh Drive",5.397900,100.329000],
    ["gurney", "Youth Park public entrance surroundings", "Youth Park",5.431900,100.295700],
    ["tanjung-tokong", "Tanjung Bungah market surroundings", "Tanjung Bungah",5.464400,100.285200],
    ["bayan-lepas", "SPICE forecourt surroundings", "Bayan Lepas",5.329100,100.279600],
    ["esplanade", "Bukit Mertajam town square surroundings", "Bukit Mertajam",5.363300,100.461800],
  ],
  BEAM: [
    ["klcc", "Avenue K public entrance surroundings", "Kuala Lumpur City Centre",3.159300,101.713300],
    ["bukit-bintang", "Jalan Alor public-area surroundings", "Bukit Bintang",3.145000,101.707000],
    ["trx", "TRX southern plaza surroundings", "TRX",3.140200,101.716500],
    ["kl-sentral", "Brickfields Little India surroundings", "Brickfields",3.129300,101.683000],
    ["bangsar", "Bangsar South forecourt surroundings", "Bangsar South",3.110500,101.665000],
    ["pj", "Jaya One public-area surroundings", "Petaling Jaya",3.118500,101.635100],
    ["subang", "SS18 community surroundings", "Subang Jaya",3.063600,101.588200],
    ["sunway", "Puchong Jaya public frontage surroundings", "Puchong",3.044100,101.618900],
    ["cyberjaya", "MMU public entrance surroundings", "Cyberjaya",2.926200,101.642500],
    ["ayer8", "Precinct 2 public-area surroundings", "Putrajaya",2.927700,101.685700],
    ["millennium", "Seri Gemilang promenade surroundings", "Putrajaya",2.889600,101.680600],
    ["george-town", "Jelutong public-area surroundings", "Jelutong",5.387500,100.312300],
    ["gurney", "Botanic Gardens entrance surroundings", "Botanic Gardens",5.439300,100.291000],
    ["tanjung-tokong", "Straits Quay public entrance surroundings", "Tanjung Tokong",5.457500,100.313000],
    ["bayan-lepas", "Bayan Baru community surroundings", "Bayan Lepas",5.324600,100.285700],
    ["esplanade", "Seberang Jaya public frontage surroundings", "Seberang Jaya",5.398900,100.398400],
  ],
} as const;

const putrajayaSource = "https://smart.putrajaya.my/en/initiatives/tryke-micromobility/";
export const newMicromobilityStations: MicromobilityStation[] = NEW_MICROMOBILITY_OPERATORS.flatMap(operator =>
  places[operator].map(([slug, name, area, latitude, longitude]) => {
    const state = MICROMOBILITY_LOCALITIES[area][0];
    const id = `${operator.toLowerCase()}:coverage:${slug}`;
    const sourceBacked = operator === "TRYKE" && (slug === "ayer8" || slug === "millennium");
    return micromobilityStationSchema.parse({
      id, operator, name: `${OPERATOR_STYLE[operator].name} · ${name}`,
      latitude, longitude, area, state,
      dataOrigin: sourceBacked ? "SOURCE_VERIFIED" : "SYNTHETIC",
      verificationStatus: sourceBacked ? "APPROXIMATE_LOCATION" : "DEMONSTRATION_ONLY",
      isSimulation: true, availableBikes: null, availableDocks: null, operationalStatus: "UNVERIFIED",
      simulatedInventory: generateInventory(id),
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
