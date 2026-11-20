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
  return lines.flatMap(line => line.paths.map((path, index) => {
    const active = highlighted.includes(line.id);
    const opacity = railRouteOpacity(line.id, stationLines);
    return <Fragment key={`${line.id}:${index}`}>
      <Polyline className="rail-route-casing" positions={path} interactive={false}
        pathOptions={{ color: "#fff", weight: active ? 10 : quietRail ? 4 : 7, opacity }}/>
      <Polyline className={`rail-alignment ${line.id.replace(/[^a-zA-Z0-9]/g, "-")}`} positions={path}
        pathOptions={{ color: line.colour, weight: active ? 6 : quietRail ? 2.5 : 4, opacity, dashArray: quietRail ? "2 5" : undefined }}
        eventHandlers={{ click: () => onHighlight(line.id) }}><Popup>{line.name}<br/>{SIMULATED}</Popup></Polyline>
    </Fragment>;
  }));
});
