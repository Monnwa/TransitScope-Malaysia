import type { OverviewRoute } from "@/lib/dashboard-region";
import DashboardIcon from "./dashboard-icon";

export function CategoryIcon({ category }: { category: OverviewRoute["category"] }) {
  const icon = category === "Bus" || category === "BRT" ? "bus" : category === "Shared bike" ? "bike" : "train";
  return <span className="overview-category-icon" data-icon={icon}><DashboardIcon name={icon}/></span>;
}

export function VehicleCategories({ categories }: { categories: ReadonlyMap<OverviewRoute["category"], number> }) {
  return categories.size > 0 ? <ul className="overview-vehicle-categories" aria-label="Vehicle categories">
    {Array.from(categories, ([category, count]) => <li key={category}>
      <CategoryIcon category={category}/>
      <span>{category === "Bus" || category === "Shared bike" ? category : category === "BRT" ? "BRT bus" : `${category} train`}</span>
      <b>{count}</b>
    </li>)}
  </ul> : <small>No matching vehicle records</small>;
}

export function RouteCategories({ routes }: { routes: OverviewRoute[] }) {
  const groups = new Map<OverviewRoute["category"], OverviewRoute[]>();
  for (const route of routes) {
    const group = groups.get(route.category);
    if (group) group.push(route);
    else groups.set(route.category, [route]);
  }
  return routes.length ? <div className="overview-route-groups">
    {Array.from(groups, ([category, services]) => <section className="overview-route-group" key={category}>
      <h3><CategoryIcon category={category}/>{category === "KTM" ? "KTM Komuter" : category}</h3>
      <ul>{services.map(route => <li key={route.id} data-route-id={route.id}>
        {route.colour && <i className="mode-dot" aria-hidden="true" style={{ backgroundColor: route.colour }}/>}
        <span>{route.name}</span>
      </li>)}</ul>
    </section>)}
  </div> : <small>No matching route records</small>;
}
