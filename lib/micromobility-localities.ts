// Representative locality envelopes for this curated demonstration dataset,
// not cadastral boundaries or evidence of operator infrastructure.
// [state, south, north, west, east], WGS84 degrees.
export const MICROMOBILITY_LOCALITIES = {
  "Kuala Lumpur City Centre": ["Kuala Lumpur",3.150,3.165,101.705,101.720],
  "Bukit Bintang": ["Kuala Lumpur",3.138,3.153,101.700,101.717],
  TRX: ["Kuala Lumpur",3.135,3.148,101.714,101.726],
  "KL Sentral": ["Kuala Lumpur",3.128,3.140,101.680,101.693],
  Bangsar: ["Kuala Lumpur",3.120,3.145,101.660,101.680],
  Titiwangsa: ["Kuala Lumpur",3.170,3.190,101.695,101.720],
  "Chow Kit": ["Kuala Lumpur",3.160,3.175,101.690,101.705],
  "Merdeka Square": ["Kuala Lumpur",3.142,3.155,101.685,101.700],
  "Mid Valley": ["Kuala Lumpur",3.110,3.125,101.670,101.685],
  "Mont Kiara": ["Kuala Lumpur",3.155,3.185,101.640,101.665],
  Brickfields: ["Kuala Lumpur",3.120,3.135,101.675,101.692],
  "Bangsar South": ["Kuala Lumpur",3.100,3.120,101.655,101.675],
  "Petaling Jaya": ["Selangor",3.090,3.130,101.625,101.655],
  "Subang Jaya": ["Selangor",3.055,3.090,101.575,101.600],
  SS2: ["Selangor",3.110,3.130,101.610,101.630],
  "Damansara Utama": ["Selangor",3.125,3.145,101.615,101.635],
  "Shah Alam": ["Selangor",3.060,3.090,101.505,101.535],
  Sunway: ["Selangor",3.060,3.085,101.595,101.620],
  Puchong: ["Selangor",3.025,3.055,101.605,101.635],
  Cyberjaya: ["Selangor",2.910,2.940,101.625,101.660],
  Putrajaya: ["Putrajaya",2.880,2.960,101.660,101.730],
  "George Town": ["Penang",5.400,5.445,100.295,100.350],
  "Gurney Drive": ["Penang",5.425,5.445,100.300,100.320],
  "Batu Ferringhi": ["Penang",5.465,5.485,100.235,100.260],
  Queensbay: ["Penang",5.325,5.345,100.295,100.315],
  Butterworth: ["Penang",5.385,5.425,100.355,100.390],
  "Karpal Singh Drive": ["Penang",5.390,5.405,100.320,100.335],
  "Youth Park": ["Penang",5.425,5.440,100.290,100.305],
  "Tanjung Bungah": ["Penang",5.455,5.475,100.275,100.295],
  "Bayan Lepas": ["Penang",5.295,5.340,100.260,100.295],
  "Bukit Mertajam": ["Penang",5.350,5.380,100.445,100.480],
  Jelutong: ["Penang",5.375,5.400,100.300,100.330],
  "Botanic Gardens": ["Penang",5.430,5.450,100.280,100.300],
  "Tanjung Tokong": ["Penang",5.445,5.465,100.295,100.320],
  "Seberang Jaya": ["Penang",5.385,5.410,100.385,100.415],
} as const;

export function inStationLocality(area: string, state: string, latitude: number, longitude: number) {
  const envelope = MICROMOBILITY_LOCALITIES[area as keyof typeof MICROMOBILITY_LOCALITIES];
  return !!envelope && state === envelope[0] && latitude >= envelope[1] && latitude <= envelope[2] && longitude >= envelope[3] && longitude <= envelope[4];
}
