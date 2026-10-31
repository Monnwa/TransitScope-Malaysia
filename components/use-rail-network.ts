"use client";
import { useEffect, useMemo, useState } from "react";
import { mergeRailStations, type RailNetwork } from "@/lib/rail-model";
export function useRailNetwork(enabled: boolean) {
  const [sources, setSources] = useState<Record<string, RailNetwork>>({});
  const [errors, setErrors] = useState<Record<string, string>>({}); const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let disposed = false; const controllers: AbortController[] = [];
    for (const source of ["rapid-rail-kl", "ktmb"]) {
      const controller = new AbortController(); controllers.push(controller);
      const timer = setTimeout(() => controller.abort(), source === "ktmb" ? 45000 : 25000);
      fetch(`/api/rail-network?source=${source}`, { signal: controller.signal }).then(async response => {
        if (!response.ok) throw new Error();
        const network = await response.json() as RailNetwork;
        if (disposed) return;
        setSources(current => ({ ...current, [source]: network }));
        setErrors(current => ({ ...current, [source]: "" }));
      }).catch(() => { if (!disposed) setErrors(current => ({ ...current, [source]: `${source} railway data could not be loaded.` })); }).finally(() => clearTimeout(timer));
    }
    return () => { disposed = true; controllers.forEach(controller => controller.abort()); };
  }, [enabled, retry]);
  return useMemo(() => ({ lines: enabled ? Object.values(sources).flatMap(source => source.lines) : [], stations: enabled ? mergeRailStations(Object.values(sources).flatMap(source => source.stations)) : [], messages: enabled ? Object.values(errors).filter(Boolean) : [], retry: () => setRetry(value => value + 1) }), [sources, errors, enabled]);
}
