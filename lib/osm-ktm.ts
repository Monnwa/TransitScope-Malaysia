// Original OSM relations, not an extraction from proprietary map tiles.
// Each route stays separate; only railway way members are rendered.
const relations: Record<string, { id: number; ref: string }> = {
  KA15_KD19: { id: 2565937, ref: "2" },
  KC05_KB18: { id: 8390976, ref: "1" },
};
type Element = { type: string; id: number; lat?: number; lon?: number; nodes?: number[]; tags?: Record<string, string>; members?: { type: string; ref: number; role: string }[] };
type Point = [number, number];
const cache = new Map<string, { paths: Point[][]; expires: number }>();
export async function getKtmOsmPaths(routeId: string): Promise<Point[][]> {
  const relation = relations[routeId]; if (!relation) return [];
  const prior = cache.get(routeId); if (prior && prior.expires > Date.now()) return prior.paths;
  const response = await fetch(`https://www.openstreetmap.org/api/0.6/relation/${relation.id}/full.json`, { signal: AbortSignal.timeout(8000), headers: { "User-Agent": "TransitScope-Malaysia/1.0 (railway-visualization)" }, cache: "no-store" });
  if (!response.ok) return [];
  const body = await response.json() as { elements: Element[] };
  const root = body.elements.find(element => element.type === "relation" && element.id === relation.id);
  if (root?.tags?.route !== "train" || root.tags.network !== "KTM Komuter" || root.tags.ref !== relation.ref) return [];
  const nodes = new Map(body.elements.filter(element => element.type === "node").map(node => [node.id, node]));
  const wayIds = new Set(root.members?.filter(member => member.type === "way" && !/platform|stop/.test(member.role)).map(member => member.ref));
  const paths: Point[][] = [];
  for (const way of body.elements) {
    if (way.type !== "way" || !wayIds.has(way.id) || way.tags?.railway !== "rail") continue;
    const path = way.nodes?.map(id => nodes.get(id));
    if (!path || path.length < 2 || path.some(node => !node || !Number.isFinite(node.lat) || !Number.isFinite(node.lon))) continue;
    paths.push(path.map(node => [node!.lat!, node!.lon!]));
  }
  // Keep all original segments separate, including documented upstream gaps.
  if (paths.length) cache.set(routeId, { paths, expires: Date.now() + 86400000 });
  return paths;
}
