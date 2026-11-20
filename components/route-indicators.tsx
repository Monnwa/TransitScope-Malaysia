import type { RailLine } from "@/lib/rail-model";
import { brtSunway, expandedServiceById } from "@/lib/expanded-services";
import "@/app/rail-routes.css";

const railModes: RailLine["mode"][] = ["MRT", "LRT", "Monorail", "KTM", "ERL"];

function routeName(line: RailLine) {
  if (line.mode === "MRT") return line.name.replace(` (${line.id})`, "");
  if (line.mode === "Monorail" && !line.name.endsWith(" Line")) return `${line.name} Line`;
  return line.name;
}

export default function RouteIndicators({ lines, showBrt, onFocus }: {
  lines: RailLine[];
  showBrt: boolean;
  onFocus: (line: RailLine) => void;
}) {
  if (!lines.length && !showBrt) return null;
  return <section className="route-indicators" aria-label="Map route indicators">
    {lines.length > 0 && <div className="route-indicator-group">
      <h3 id="rail-indicators-heading">Rail</h3>
      <ul aria-labelledby="rail-indicators-heading">
        {railModes.flatMap(mode => lines.filter(line => line.mode === mode)).map(line => {
          const name = routeName(line);
          const label = <><i aria-hidden="true" style={{ backgroundColor: line.colour }}/>{name}</>;
          return <li key={line.id} data-route-id={line.id}>
            {expandedServiceById.has(line.id)
              ? <button type="button" aria-label={`Focus ${name}`} onClick={() => onFocus(line)}>{label}</button>
              : label}
          </li>;
        })}
      </ul>
    </div>}
    {showBrt && <div className="route-indicator-group">
      <h3 id="brt-indicators-heading">BRT</h3>
      <ul aria-labelledby="brt-indicators-heading">
        <li data-route-id={brtSunway.id}>
          <i aria-hidden="true" style={{ backgroundColor: brtSunway.colour }}/>{brtSunway.name}
        </li>
      </ul>
    </div>}
  </section>;
}
