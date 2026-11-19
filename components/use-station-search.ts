"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RailNetwork } from "@/lib/rail-model";
import type { Record as TransitRecord } from "@/lib/transit-data";
import { resolveStationResult, STATION_SEARCH_COMPLETION_MS, type StationSearchRequest } from "@/lib/station-search";

/** Exact completion and explicit selection share one cancellable station intent. */
export default function useStationSearch(network: RailNetwork, query: string, exactStation: TransitRecord | undefined,
  onSelect: (record: TransitRecord) => void) {
  const [request, setRequest] = useState<StationSearchRequest | null>(null);
  const revision = useRef(0), timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancel = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    setRequest(null);
  }, []);
  const select = useCallback((record: TransitRecord) => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    const station = resolveStationResult(record, network);
    onSelect(station ?? record);
    setRequest(station ? { stationId: station.id, revision: ++revision.current } : null);
  }, [network, onSelect]);

  useEffect(() => {
    if (!exactStation) return;
    const pending = setTimeout(() => {
      if (timer.current !== pending) return;
      timer.current = null;
      select(exactStation);
    }, STATION_SEARCH_COMPLETION_MS);
    timer.current = pending;
    return () => {
      clearTimeout(pending);
      if (timer.current === pending) timer.current = null;
    };
  }, [query, exactStation, select]);
  return { request, select, cancel };
}
