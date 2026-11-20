"use client";

import React, { memo, useEffect, useMemo, useRef } from "react";
import type { Polyline as LeafletPolyline } from "leaflet";
import { Pane, Polyline, Popup } from "react-leaflet";
import type { RailLine } from "@/lib/rail-model";
import { railMapPaths } from "@/lib/rail-map-geometry";
import { erlSharedTrack, railRouteOpacity, railRouteStyle } from "@/lib/rail-route-style";
import { SIMULATED } from "@/lib/simulation/clock";
import "@/app/rail-routes.css";

/** Keep path updates independent of the simulation clock and moving vehicle layers. */
export default memo(function RailRouteLayers({ lines, highlighted, stationLines, onHighlight }: {
  lines: RailLine[]; highlighted: string[]; stationLines: string[];
  onHighlight: (id: string) => void;
}) {
  const alignments = useMemo(() => lines.map(line => ({ line, paths: railMapPaths(line) }))
    .filter(({ paths }) => paths.length > 0), [lines]);
  const { express, transit, expressWeight, transitWeight } = erlSharedTrack;
  const sharedErl = alignments.some(({ line }) => line.id === express) &&
    alignments.some(({ line }) => line.id === transit);
  const strokes = useRef(new Map<string, LeafletPolyline>());
  const { track, casing, smoothFactor } = railRouteStyle;

  useEffect(() => {
    // Preserve the ERL stack through visibility changes. Raise highlighted
    // routes at crossings without changing their width or remounting paths.
    const rank = (id: string) => {
      if (sharedErl && (id === express || id === transit)) {
        return (highlighted.includes(express) || highlighted.includes(transit) ? 4 : 1) + Number(id === transit);
      }
      return highlighted.includes(id) ? 3 : 0;
    };
    for (const { line } of [...alignments].sort((a, b) => rank(a.line.id) - rank(b.line.id))) {
      strokes.current.get(line.id)?.bringToFront();
    }
  }, [alignments, express, highlighted, sharedErl, transit]);

  return <>
    {/* Keep every casing below the coloured strokes so white borders cannot cut a crossing. */}
    <Pane name="rail-route-casings" style={{ zIndex: 399, pointerEvents: "none" }}>
      {alignments.map(({ line, paths }) => (!sharedErl || line.id !== transit) &&
        <Polyline key={line.id} className="rail-route-casing" positions={paths} smoothFactor={smoothFactor}
          interactive={false} pathOptions={{ ...track, ...casing, opacity: railRouteOpacity(line.id, stationLines) }}/>)}
    </Pane>
    {alignments.map(({ line, paths }) => <Polyline key={line.id}
      ref={stroke => { if (stroke) strokes.current.set(line.id, stroke); else strokes.current.delete(line.id); }}
      className={`rail-alignment ${line.id.replace(/[^a-zA-Z0-9]/g, "-")}`} positions={paths} smoothFactor={smoothFactor}
      pathOptions={{ ...track, color: line.colour, opacity: railRouteOpacity(line.id, stationLines),
        weight: sharedErl && line.id === express ? expressWeight : sharedErl && line.id === transit ? transitWeight : track.weight }}
      eventHandlers={{ click: () => onHighlight(line.id) }}>
      <Popup>{line.name}<br/>{SIMULATED}</Popup>
    </Polyline>)}
  </>;
});
