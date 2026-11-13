export const LINKBIKE_PORTAL = "https://mm.linkbike.my/";
export const LINKBIKE_CONSUMER = "https://www.linkbike.my/linkbike_api/api_update_stationinfo.php";
export const LINKBIKE_REFRESH_SECONDS = 300;

export type LinkBikeStation = {
  source: "LinkBike";
  station_id: string;
  station_name: string;
  total_docks: number;
  available_bikes: number;
  available_docks: null;
  latitude: number | null;
  longitude: number | null;
  source_coordinates: { latitude: string; longitude: string } | null;
  upstream_updated_at: null;
  upstream_updated_at_raw: string;
  fetched_at: string;
  data_status: "UNVERIFIED";
  is_public_station: null;
  coordinate_status: "VALIDATED_CANDIDATE" | "QUARANTINED" | "UNAVAILABLE";
  validation_warnings: string[];
};

export type LinkBikeResponse = {
  source: "LinkBike";
  status: "UNVERIFIED" | "UNAVAILABLE";
  fetched_at: string | null;
  upstream_updated_at: null;
  upstream_updated_at_raw: string | null;
  stations: LinkBikeStation[];
  source_health: Record<"portal" | "consumer_json", {
    status: "HEALTHY" | "DEGRADED" | "UNAVAILABLE";
    fetched_at: string | null;
    warning: string | null;
  }>;
  refresh_seconds: number;
  excluded_stations: number;
  warnings: string[];
};
