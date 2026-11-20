"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RailNetwork } from "@/lib/rail-model";
import type { Record as TransitRecord } from "@/lib/transit-data";
import { resolveStationResult, STATION_SEARCH_COMPLETION_MS, type AlertStationNavigation, type SearchEntity, type StationSearchRequest } from "@/lib/station-search";

/** Exact completion and explicit selection share one cancellable station intent. */
export default function useStationSearch(network: RailNetwork, query: string, exactStation: TransitRecord | undefined,
  onSelect: (record: TransitRecord | null) => void) {
  const [request, setRequest] = useState<StationSearchRequest | null>(null);
  const revision = useRef(0), timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancel = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    setRequest(null);
  }, []);
  const select = useCallback((record: TransitRecord, alert?: AlertStationNavigation, nearby?: boolean) => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    const station = resolveStationResult(record, network);
    onSelect(nearby && station ? null : station ?? record);
    setRequest(station ? { type: "RAIL_STATION", stationId: station.id, revision: ++revision.current,
      ...(alert && { alert }), ...(nearby && { nearby }) } : null);
  }, [network, onSelect]);

  const selectEntity = (entity: SearchEntity, alert?: AlertStationNavigation, nearby?: boolean) => {
    if (entity.type === "RAIL_STATION") {
      select(entity.record, alert, nearby);
      return;
    }
    cancel();
    const next = ++revision.current;
    onSelect(null);
    setRequest(entity.type === "BUS_STOP"
      ? { type: entity.type, stationId: entity.stop.id, stop: entity.stop, revision: next, ...(alert && { alert }), ...(nearby && { nearby }) }
      : { type: entity.type, stationId: entity.station.id, operator: entity.station.operator, revision: next });
  };

  const dismiss = useCallback((closed: StationSearchRequest) => {
    setRequest(current => current?.revision === closed.revision ? null : current);
  }, []);

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
  return { request, select, selectEntity, cancel, dismiss };
}
