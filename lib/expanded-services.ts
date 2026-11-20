import geography from "./data/expanded-service-geography.json";
import type { GeoPoint } from "./route-projection";

const rapidGtfs = "https://api.data.gov.my/gtfs-static/prasarana?category=rapid-rail-kl";
const erlStopsSource = "https://services5.arcgis.com/2ZRAaoTSJbQ20ceg/arcgis/rest/services/SELANGOR_RAILWAY_MAP/FeatureServer/4";
const erlTrackSource = "https://services5.arcgis.com/2ZRAaoTSJbQ20ceg/arcgis/rest/services/SELANGOR_RAILWAY_MAP/FeatureServer/13";

type Station = {
  id: string;
  name: string;
  position: GeoPoint;
  complexId?: string;
  aliases?: string[];
};

type Service = {
  id: string;
  name: string;
  mode: "ERL" | "LRT" | "Bus";
  classification: "ERL" | "LRT" | "BRT";
  operator: string;
  colour: string;
  source: string;
  serviceUrl: string;
  coordinateUrl: string;
  geometryUrl: string;
  sourceRouteId: string;
  shapeIds: string[];
  operatingConfidence: "operator-confirmed";
  stops: Station[];
  paths: [GeoPoint[], GeoPoint[]];
  fleetSize: number;
  speedKmh: number;
  seed: number;
};

const erlStations = [
  ["KT01", "KL Sentral", "kl-sentral:LRT-KJ"],
  ["KT02", "Bandar Tasik Selatan", "bandar-tasik-selatan:LRT-PH"],
  ["KT03", "Putrajaya & Cyberjaya", "putrajaya-sentral:MRT2"],
  ["KT04", "Salak Tinggi"],
  ["KT05", "KLIA Terminal 1"],
  ["KT06", "KLIA Terminal 2"],
] as const;
const erl = {
  mode: "ERL", classification: "ERL", operator: "Express Rail Link (ERL)",
  source: "Selangor Railway Map stop points and OpenStreetMap contributors (ODbL)",
  coordinateUrl: erlStopsSource, geometryUrl: erlTrackSource,
  shapeIds: geography.ERL.shapeIds, operatingConfidence: "operator-confirmed",
  paths: geography.ERL.paths as Service["paths"],
} as const;
const erlStop = (index: number, code?: keyof typeof geography.ERL.stationByCode): Station => {
  const [transitCode, name, complexId] = erlStations[index];
  const id = code ?? transitCode;
  return { id, name, position: geography.ERL.stationByCode[id] as GeoPoint, complexId,
    aliases: index === 4 ? ["KLIA T1", "KLIA"] : index === 5 ? ["KLIA T2", "klia2"] : undefined };
};

const shahAlamNames: Record<string, string> = {
  SA1: "Bandar Utama", SA2: "Kayu Ara", SA3: "BU 11", SA5: "Damansara Idaman", SA6: "Subang",
  SA7: "Glenmarie 2", SA9: "Kerjaya", SA10: "Stadium Shah Alam", SA12: "Dato' Menteri",
  SA14: "UiTM Shah Alam", SA15: "Seksyen 7 Shah Alam", SA17: "Bandar Baru Klang", SA18: "Pasar Klang",
  SA19: "Jalan Meru", SA20: "Jambatan Kota", SA21: "Taman Selatan", SA22: "Seri Andalas", SA23: "Klang Jaya",
  SA24: "Bandar Bukit Tinggi", SA26: "Johan Setia",
};
const sunwayNames: Record<string, string> = {
  BRT1: "Sunway-Setia Jaya", BRT2: "Mentari", BRT3: "Sunway Lagoon", BRT4: "SunMed", BRT5: "SunU-Monash",
  BRT6: "South Quay-USJ 1", BRT7: "USJ 7",
};
const complexes: Record<string, string> = {
  SA1: "bandar-utama:MRT1", SA7: "glenmarie:LRT-KJ",
  BRT1: "setia-jaya:KTM:KA15_KD19", BRT7: "usj-7:LRT-KJ",
};
const rapid = {
  source: "Malaysia Official GTFS Static (Prasarana Rapid Rail)",
  coordinateUrl: rapidGtfs, geometryUrl: rapidGtfs, operatingConfidence: "operator-confirmed",
} as const;

function fromGtfs(id: "SA" | "BRT", names: Record<string, string>) {
  const { stops, paths, shapeIds } = geography[id];
  return {
    sourceRouteId: id, paths: paths as Service["paths"], shapeIds,
    stops: stops.map(stop => ({ id: stop.id, name: names[stop.id], position: stop.position as GeoPoint,
      complexId: complexes[stop.id], aliases: [stop.name] })),
  };
}

export const brtSunway: Service = {
  ...rapid, ...fromGtfs("BRT", sunwayNames), id: "brt-sunway", name: "BRT Sunway Line",
  mode: "Bus", classification: "BRT", operator: "Rapid Bus / Prasarana", colour: "#115740",
  serviceUrl: "https://www.prasarana.com.my/rapid-bus/",
  fleetSize: 4, speedKmh: 38, seed: 0,
};

export const expandedRailServices: Service[] = [
  { ...rapid, ...fromGtfs("SA", shahAlamNames), id: "lrt-shah-alam", name: "LRT Shah Alam Line",
    mode: "LRT", classification: "LRT", operator: "Rapid Rail / Prasarana", colour: "#59B8E6",
    serviceUrl: "https://www.prasarana.com.my/rapid-rail/", fleetSize: 14, speedKmh: 60, seed: 109 },
  { ...erl, id: "erl-klia-ekspres", name: "ERL KLIA Ekspres Line", colour: "#7946A3",
    sourceRouteId: "KE", serviceUrl: "https://www.kliaekspres.com/products-fares/klia-ekspres/",
    stops: [erlStop(0, "KE01"), erlStop(4, "KE02"), erlStop(5, "KE03")], fleetSize: 4, speedKmh: 131, seed: 110 },
  { ...erl, id: "erl-klia-transit", name: "ERL KLIA Transit Line", colour: "#008B8B",
    sourceRouteId: "KT", serviceUrl: "https://www.kliaekspres.com/products-fares/klia-transit/",
    stops: erlStations.map((_, index) => erlStop(index)), fleetSize: 5, speedKmh: 113, seed: 111 },
];

export const expandedServiceById = new Map([...expandedRailServices, brtSunway].map(service => [service.id, service]));

// The Rapid Bus feed duplicates these platforms under route B1000 and numeric IDs.
export const rapidBusBrtStopIds = new Map([
  ["BRT1", "1005840"], ["BRT2", "1005839"], ["BRT3", "1005838"], ["BRT4", "1005837"],
  ["BRT5", "1005836"], ["BRT6", "1005835"], ["BRT7", "1005834"],
]);
