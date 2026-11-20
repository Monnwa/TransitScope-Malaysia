"use client";

import React, { Fragment, memo } from "react";
import { Polyline, Popup } from "react-leaflet";
import type { RailLine } from "@/lib/rail-model";
import { railRouteOpacity } from "@/lib/rail-route-style";
import { SIMULATED } from "@/lib/simulation/clock";
import "@/app/rail-routes.css";

/** Keep path updates independent of the simulation clock and moving vehicle layers. */
export default memo(function RailRouteLayers({ lines, highlighted, stationLines, quietRail, onHighlight }: {
  lines: RailLine[]; highlighted: string[]; stationLines: string[];
  quietRail: boolean; onHighlight: (id: string) => void;
}) {
  const erlCount = lines.filter(line => line.mode === "ERL").length;
  return lines.flatMap(line => line.paths.map((path, index) => {
    const active = highlighted.includes(line.id);
    const opacity = railRouteOpacity(line.id, stationLines);
    const sharedErl = line.mode === "ERL" && erlCount > 1;
    const erlTransit = sharedErl && line.id === "erl-klia-transit";
    const quiet = quietRail && line.id !== "lrt-shah-alam" && line.mode !== "ERL";
    return <Fragment key={`${line.id}:${index}`}>
      {!erlTransit && <Polyline className="rail-route-casing" positions={path} interactive={false}
        pathOptions={{ color: "#fff", weight: sharedErl || active ? 10 : quiet ? 4 : 7, opacity }}/>}
      <Polyline className={`rail-alignment ${line.id.replace(/[^a-zA-Z0-9]/g, "-")}`} positions={path}
        pathOptions={{ color: line.colour, weight: sharedErl ? erlTransit ? 4 : 7 : active ? 6 : quiet ? 2.5 : 4,
          opacity }}
        eventHandlers={{ click: () => onHighlight(line.id) }}><Popup>{line.name}<br/>{SIMULATED}</Popup></Polyline>
    </Fragment>;
  }));
});
