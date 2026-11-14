import { rapidRailMeta, mergeRailStations, type RailLine } from "@/lib/rail-model";
import { distanceM, indexShape, type GeoPoint } from "@/lib/route-projection";
import type { Mode, Record as TransitRecord } from "@/lib/transit-data";
import { SIMULATED, SIMULATION_SOURCE } from "./clock";

export type SimulatedStop = { id: string; name: string; position: GeoPoint };
type RouteDefinition = {
  id: string;
  name: string;
  mode: Exclude<Mode, "Shared bike">;
  operator: string;
  colour: string;
  stops: SimulatedStop[];
  fleetSize: number;
  speedKmh: number;
  seed: number;
};

const stop = (name: string, lat: number, lng: number): SimulatedStop => ({
  id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), name, position: [lat, lng],
});
const kwasa = stop("Kwasa Damansara", 3.176, 101.574);
const trx = stop("Tun Razak Exchange", 3.142, 101.720);
const pasar = stop("Pasar Seni", 3.143, 101.696);
const masjid = stop("Masjid Jamek", 3.1493, 101.6961);
const sentral = stop("KL Sentral", 3.134, 101.686);
const titiwangsa = stop("Titiwangsa", 3.173, 101.695);
const putraHeights = stop("Putra Heights", 2.999, 101.576);
const chanSowLin = stop("Chan Sow Lin", 3.128, 101.715);
const sentulTimur = stop("Sentul Timur", 3.186, 101.695);
const bandarTasikSelatan = stop("Bandar Tasik Selatan", 3.076, 101.712);
const putrajaya = stop("Putrajaya Sentral", 2.931, 101.671);
const bukitBintang = stop("Bukit Bintang", 3.147, 101.711);
const kajang = stop("Kajang", 2.983, 101.791);
const maluri = stop("Maluri", 3.123, 101.728);
const hangTuah = stop("Hang Tuah", 3.140, 101.706);
const pasarRakyat = stop("Pasar Rakyat", 3.142, 101.723);
const klcc = stop("KLCC", 3.159, 101.713);
const gombak = stop("Gombak", 3.231, 101.724);
const ampang = stop("Ampang", 3.150, 101.761);
const chowKit = stop("Chow Kit", 3.167, 101.698);
const kotaDamansara = stop("Kota Damansara", 3.149, 101.579);
const rajaChulan = stop("Raja Chulan", 3.1507, 101.7061);
const universiti = stop("Universiti", 3.115, 101.662);
const terminalPenang = stop("Pengkalan Weld", 5.412, 100.341);
const komtar = stop("Komtar", 5.414, 100.330);
const airItam = stop("Air Itam", 5.401, 100.280);
const jelutong = stop("Jelutong", 5.392, 100.319);

function rapid(code: string, stops: SimulatedStop[], fleetSize: number, seed: number): RouteDefinition {
  const meta = rapidRailMeta[code];
  return { ...meta, stops, fleetSize, seed, operator: "Rapid KL", speedKmh: 45 };
}

function ktm(id: string, name: string, stops: SimulatedStop[], fleetSize: number, seed: number): RouteDefinition {
  return { id: `KTM:${id}`, name, mode: "KTM", colour: "#24558A", operator: "KTMB", stops, fleetSize, seed, speedKmh: 56 };
}

// Approximate demonstration alignments between locally authored station points.
const railDefinitions = [
  rapid("KGL", [kwasa, kotaDamansara, stop("Surian", 3.150, 101.594), stop("Mutiara Damansara", 3.155, 101.610),
    stop("Bandar Utama", 3.147, 101.624), stop("TTDI", 3.136, 101.630), stop("Phileo Damansara", 3.128, 101.642),
    stop("Pusat Bandar Damansara", 3.143, 101.661), stop("Semantan", 3.151, 101.665), stop("Muzium Negara", 3.137, 101.688), pasar, bukitBintang,
    trx, stop("Cochrane", 3.132, 101.723), maluri, stop("Taman Midah", 3.104, 101.733), stop("Taman Mutiara", 3.091, 101.740),
    stop("Taman Connaught", 3.080, 101.745), stop("Taman Suntex", 3.070, 101.761), stop("Sri Raya", 3.062, 101.772),
    stop("Bandar Tun Hussein Onn", 3.048, 101.774), stop("Batu 11 Cheras", 3.038, 101.781), stop("Bukit Dukung", 3.026, 101.772),
    stop("Sungai Jernih", 3.000, 101.787), stop("Stadium Kajang", 2.993, 101.787), kajang], 16, 101),
  rapid("PYL", [kwasa, stop("Kampung Selamat", 3.197, 101.579), stop("Sungai Buloh", 3.206, 101.581),
    stop("Sri Damansara Barat", 3.199, 101.608), stop("Sri Damansara Sentral", 3.202, 101.618),
    stop("Sri Damansara Timur", 3.212, 101.629), stop("Metro Prima", 3.214, 101.638), stop("Kepong Baru", 3.208, 101.648),
    stop("Jinjang", 3.210, 101.657), stop("Sri Delima", 3.210, 101.672), stop("Kampung Batu", 3.205, 101.682),
    stop("Kentonmen", 3.193, 101.682), stop("Jalan Ipoh", 3.187, 101.683), stop("Sentul Barat", 3.179, 101.686),
    titiwangsa, stop("Hospital Kuala Lumpur", 3.170, 101.703), stop("Raja Uda", 3.164, 101.712), stop("Ampang Park", 3.161, 101.720),
    stop("Persiaran KLCC", 3.155, 101.719), stop("Conlay", 3.150, 101.719), trx, chanSowLin,
    stop("Kuchai", 3.096, 101.689), stop("Taman Naga Emas", 3.083, 101.694), stop("Sungai Besi", 3.063, 101.707),
    stop("Serdang Raya Utara", 3.054, 101.706), stop("Serdang Raya Selatan", 3.034, 101.715),
    stop("Serdang Jaya", 3.023, 101.716), stop("UPM", 3.004, 101.705), stop("Taman Equine", 2.985, 101.676),
    stop("Putra Permai", 2.977, 101.670), stop("16 Sierra", 2.958, 101.669), stop("Cyberjaya Utara", 2.956, 101.650),
    stop("Cyberjaya City Centre", 2.938, 101.655), putrajaya], 20, 102),
  rapid("KJ", [gombak, stop("Taman Melati", 3.219, 101.721), stop("Wangsa Maju", 3.206, 101.732),
    stop("Sri Rampai", 3.199, 101.737), stop("Setiawangsa", 3.175, 101.735), stop("Jelatek", 3.168, 101.735),
    stop("Dato’ Keramat", 3.165, 101.731), stop("Damai", 3.165, 101.724), stop("Ampang Park", 3.161, 101.720), klcc,
    stop("Kampung Baru", 3.162, 101.707), stop("Dang Wangi", 3.157, 101.701), masjid, pasar, sentral,
    stop("Bangsar", 3.127, 101.679), stop("Abdullah Hukum", 3.118, 101.673), stop("Kerinchi", 3.116, 101.668),
    universiti, stop("Taman Jaya", 3.105, 101.646), stop("Asia Jaya", 3.104, 101.638), stop("Taman Paramount", 3.105, 101.623),
    stop("Taman Bahagia", 3.111, 101.613), stop("Kelana Jaya", 3.113, 101.604), stop("Lembah Subang", 3.113, 101.591),
    stop("Ara Damansara", 3.108, 101.586), stop("Glenmarie", 3.099, 101.587), stop("Subang Jaya", 3.084, 101.588),
    stop("SS15", 3.076, 101.588), stop("SS18", 3.070, 101.585), stop("USJ 7", 3.055, 101.591),
    stop("Taipan", 3.048, 101.590), stop("Wawasan", 3.038, 101.587), stop("USJ 21", 3.031, 101.581),
    stop("Alam Megah", 3.024, 101.572), stop("Subang Alam", 3.016, 101.573), putraHeights], 20, 103),
  ...(() => {
    const trunk = [sentulTimur, stop("Sentul", 3.179, 101.695), titiwangsa, stop("PWTC", 3.166, 101.693),
      stop("Sultan Ismail", 3.161, 101.694), stop("Bandaraya", 3.156, 101.694), masjid,
      stop("Plaza Rakyat", 3.144, 101.702), hangTuah, stop("Pudu", 3.134, 101.711), chanSowLin];
    return [
      rapid("AG", [...trunk, maluri, stop("Pandan Jaya", 3.125, 101.739), stop("Pandan Indah", 3.134, 101.747),
        stop("Cempaka", 3.138, 101.756), stop("Cahaya", 3.144, 101.756), ampang], 10, 104),
      rapid("PH", [...trunk, stop("Cheras", 3.113, 101.714), stop("Salak Selatan", 3.103, 101.706),
        bandarTasikSelatan, stop("Sungai Besi", 3.063, 101.707), stop("Bukit Jalil", 3.057, 101.691),
        stop("Sri Petaling", 3.062, 101.687), stop("Awan Besar", 3.062, 101.670), stop("Muhibbah", 3.062, 101.662),
        stop("Alam Sutera", 3.055, 101.647), stop("Kinrara BK5", 3.051, 101.637), stop("IOI Puchong Jaya", 3.044, 101.620),
        stop("Pusat Bandar Puchong", 3.033, 101.617), stop("Taman Perindustrian Puchong", 3.022, 101.613),
        stop("Bandar Puteri", 3.012, 101.612), stop("Puchong Perdana", 3.007, 101.606),
        stop("Puchong Prima", 3.000, 101.599), putraHeights], 14, 105),
    ];
  })(),
  rapid("MR", [sentral, stop("Tun Sambanthan", 3.131, 101.690), stop("Maharajalela", 3.138, 101.700), hangTuah,
    stop("Imbi", 3.143, 101.710), bukitBintang, rajaChulan, stop("Bukit Nanas", 3.156, 101.704),
    stop("Medan Tuanku", 3.159, 101.699), chowKit, titiwangsa], 8, 106),
  ktm("KA15_KD19", "KTM Tanjung Malim–Port Klang", [stop("Tanjung Malim", 3.685, 101.524), stop("Rawang", 3.321, 101.576),
    stop("Sungai Buloh", 3.206, 101.581), stop("Kepong Sentral", 3.209, 101.628), stop("Kepong", 3.203, 101.638),
    stop("Segambut", 3.186, 101.670), stop("Putra", 3.167, 101.691), stop("Bank Negara", 3.155, 101.693),
    stop("Kuala Lumpur", 3.139, 101.694), sentral, stop("Abdullah Hukum", 3.118, 101.673), stop("Angkasapuri", 3.112, 101.672),
    stop("Pantai Dalam", 3.095, 101.669), stop("Petaling", 3.084, 101.665), stop("Jalan Templer", 3.084, 101.656),
    stop("Kampung Dato Harun", 3.084, 101.639), stop("Seri Setia", 3.084, 101.625), stop("Setia Jaya", 3.084, 101.613),
    stop("Subang Jaya", 3.084, 101.588), stop("Batu Tiga", 3.076, 101.560), stop("Shah Alam", 3.056, 101.525),
    stop("Padang Jawa", 3.051, 101.493), stop("Bukit Badak", 3.036, 101.471), stop("Klang", 3.043, 101.449),
    stop("Teluk Pulai", 3.041, 101.427), stop("Teluk Gadong", 3.034, 101.418),
    stop("Kampung Raja Uda", 3.025, 101.407), stop("Jalan Kastam", 3.021, 101.395), stop("Port Klang", 2.997, 101.392)], 12, 107),
  ktm("KC05_KB18", "KTM Batu Caves–Pulau Sebang", [stop("Batu Caves", 3.238, 101.682), stop("Taman Wahyu", 3.222, 101.671),
    stop("Kampung Batu", 3.205, 101.682), stop("Batu Kentonmen", 3.197, 101.681), stop("Sentul", 3.180, 101.686),
    stop("Putra", 3.167, 101.691), stop("Bank Negara", 3.155, 101.693), stop("Kuala Lumpur", 3.139, 101.694), sentral,
    stop("Mid Valley", 3.118, 101.679), stop("Seputeh", 3.110, 101.681), stop("Salak Selatan", 3.104, 101.706),
    bandarTasikSelatan, stop("Serdang", 3.023, 101.716), kajang, stop("UKM", 2.939, 101.787), stop("Bangi", 2.905, 101.788),
    stop("Batang Benar", 2.830, 101.825), stop("Nilai", 2.817, 101.801), stop("Labu", 2.754, 101.823),
    stop("Tiroi", 2.748, 101.860), stop("Seremban", 2.719, 101.940), stop("Senawang", 2.690, 101.975),
    stop("Sungai Gadut", 2.651, 101.998), stop("Rembau", 2.588, 102.094), stop("Pulau Sebang", 2.464, 102.226)], 14, 108),
];

const busCorridors: [string, string, SimulatedStop[]][] = [
  ["D100", "Rapid KL Bus", [sentral, pasar, masjid, stop("Central Market East", 3.146, 101.700), bukitBintang, klcc]],
  ["D200", "Rapid KL Bus", [titiwangsa, chowKit, stop("Medan Tuanku", 3.159, 101.699), masjid, pasar]],
  ["D300", "Rapid KL Bus", [universiti, stop("Kerinchi", 3.116, 101.668), stop("Bangsar", 3.127, 101.679), sentral, pasar]],
  ["D400", "Rapid KL Bus", [bandarTasikSelatan, stop("Salak Selatan", 3.103, 101.706), stop("Cheras", 3.113, 101.714), chanSowLin, hangTuah]],
  ["D500", "Rapid KL Bus", [klcc, stop("Ampang Park", 3.161, 101.720), stop("Dato’ Keramat", 3.165, 101.731), ampang]],
  ["D600", "Rapid KL Bus", [gombak, stop("Taman Melati", 3.219, 101.721), stop("Wangsa Maju", 3.206, 101.732), titiwangsa]],
  ["D700", "Rapid KL Bus", [maluri, stop("Cochrane", 3.132, 101.723), pasarRakyat, bukitBintang, rajaChulan, klcc]],
  ["T801", "MRT Feeder Bus", [kwasa, kotaDamansara, stop("Surian", 3.150, 101.594), stop("Mutiara Damansara", 3.155, 101.610)]],
  ["T802", "MRT Feeder Bus", [kajang, stop("Stadium Kajang", 2.993, 101.787), stop("Sungai Jernih", 3.000, 101.787), stop("Bukit Dukung", 3.026, 101.772)]],
  ["T803", "MRT Feeder Bus", [putrajaya, stop("Cyberjaya City Centre", 2.938, 101.655), stop("Cyberjaya Utara", 2.956, 101.650), stop("16 Sierra", 2.958, 101.669)]],
  ["P101", "Rapid Penang", [terminalPenang, komtar, stop("Jalan Macalister", 5.417, 100.319), airItam]],
  ["P102", "Rapid Penang", [terminalPenang, komtar, jelutong, stop("Gelugor", 5.369, 100.315)]],
];

function leg(stops: SimulatedStop[], speedKmh: number, dwellMs: number) {
  const path: GeoPoint[] = [stops[0].position];
  const vertices = [0];
  for (let index = 1; index < stops.length; index++) {
    const from = stops[index - 1].position;
    const to = stops[index].position;
    const steps = Math.ceil(distanceM(from, to) / 2_000);
    for (let step = 1; step < steps; step++) {
      path.push([from[0] + (to[0] - from[0]) * step / steps, from[1] + (to[1] - from[1]) * step / steps]);
    }
    path.push(to);
    vertices.push(path.length - 1);
  }
  const shape = indexShape(path);
  if (!shape) throw new Error("Invalid simulation route geometry");
  const timings = stops.map((station, index) => {
    const distance = shape.cumulative[vertices[index]];
    const arrival = Math.round(distance / (speedKmh / 3.6) * 1_000) + dwellMs * index;
    return { ...station, distance, arrival, departure: arrival + dwellMs };
  });
  return { shape, stops: timings, duration: timings.at(-1)!.departure };
}

function prepareRoute(definition: RouteDefinition) {
  const dwell = definition.mode === "Bus" ? 25_000 : 40_000;
  const legs = [leg(definition.stops, definition.speedKmh, dwell), leg([...definition.stops].reverse(), definition.speedKmh, dwell)] as const;
  return { ...definition, legs, period: legs[0].duration + legs[1].duration };
}

export const busRoutes = busCorridors.map(([id, operator, stops], index) => prepareRoute({
  id, operator, stops, name: `${stops[0].name} – ${stops.at(-1)!.name}`,
  mode: "Bus", colour: "#2563eb", fleetSize: 27, speedKmh: 26 + index % 4 * 2, seed: 201 + index,
}));
export const railRoutes = railDefinitions.map(prepareRoute);
export type SimulatedRoute = ReturnType<typeof prepareRoute>;

const railLines: RailLine[] = railRoutes.map(route => ({
  id: route.id, name: route.name, mode: route.mode, colour: route.colour,
  paths: [route.legs[0].shape.path], source: SIMULATION_SOURCE, dataMode: SIMULATED, geometryStatus: "available",
}));

const railStops = railRoutes.flatMap(route => route.stops.map((station): TransitRecord => ({
  id: `${station.id}:${route.id}`, name: station.name, station: station.name, position: station.position, mode: route.mode,
  railLines: [route.id], lineNames: [route.name], mrtLines: route.id === "MRT1" || route.id === "MRT2" ? [route.id] : undefined,
  operator: route.operator, route: route.name, routeId: route.id, recordKind: "stop",
  stopRefs: [`sim:${route.id}:${station.id}`], dataMode: SIMULATED, status: "Station available", reportedAt: null, source: SIMULATION_SOURCE,
})));

export const railNetwork = { lines: railLines, stations: mergeRailStations(railStops), available: true, source: SIMULATION_SOURCE, dataMode: SIMULATED };
export function railNetworkFor(source: "rapid-rail-kl" | "ktmb") {
  const lines = railLines.filter(line => (line.mode === "KTM") === (source === "ktmb"));
  const ids = new Set(lines.map(line => line.id));
  return { ...railNetwork, lines, stations: mergeRailStations(railStops.filter(station => ids.has(station.routeId!))) };
}

export const busStops = busRoutes.flatMap(route => route.stops.map((station): TransitRecord => ({
  id: `bus-stop:${route.id}:${station.id}`, name: station.name, station: station.name, position: station.position, mode: "Bus",
  operator: route.operator, route: route.id, routeId: route.id, recordKind: "stop",
  stopRefs: [`sim:${route.id}:${station.id}`], dataMode: SIMULATED, status: "Station available", reportedAt: null, source: SIMULATION_SOURCE,
})));

export const stationServices = new Map<string, { route: SimulatedRoute; station: SimulatedStop }>([...busRoutes, ...railRoutes].flatMap(route => route.stops.map(station =>
  [`sim:${route.id}:${station.id}`, { route, station }] as const)));
