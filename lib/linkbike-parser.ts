import { defaultTreeAdapter as tree, parse, type DefaultTreeAdapterTypes } from "parse5";
import { z } from "zod";
import type { LinkBikeStation } from "./linkbike-data";

type Node = DefaultTreeAdapterTypes.Node;
type Element = DefaultTreeAdapterTypes.Element;
const children = (node: Node) => "childNodes" in node ? node.childNodes : [];
const text = (node: Node): string => tree.isTextNode(node) ? node.value : children(node).map(text).join("");
const clean = (value: string) => value.trim().replace(/\s+/g, " ");
const elements = (node: Node): Element[] => children(node).flatMap(child =>
  tree.isElementNode(child) ? [child, ...elements(child)] : []);
const hasClass = (element: Element, name: string) =>
  element.attrs.some(attr => attr.name === "class" && attr.value.split(/\s+/).includes(name));
const stationLabel = /^Station:\s*(\S+)$/;
const stationId = z.string().regex(/^\d{1,32}$/);
const count = (value: string) => /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null;
const excludedIds = new Set(["28", "29", "80", "1023"]);
const excludedName = /\b(?:private|mobile\d*|test)\b/i;
type PortalRow = { id: string; name: string; docks: number; bikes: number };
type PortalSnapshot = { updated: string; rows: PortalRow[]; excluded: number; warnings: string[] };

function parseCard(card: Element) {
  const paragraphs = elements(card).filter(element => element.tagName === "p");
  const headings = paragraphs.filter(p => stationLabel.test(clean(text(p))));
  const names = paragraphs.filter(p => hasClass(p, "stationInfo"));
  if (headings.length !== 1 || names.length !== 1 || paragraphs.length !== 8) {
    throw new Error("Unexpected LinkBike station card structure.");
  }
  const id = stationLabel.exec(clean(text(headings[0])))![1];
  const name = clean(text(names[0]));
  const values = ["Dock", "Bike", "Volt"].map(label => {
    const labels = paragraphs.filter(p => clean(text(p)) === label);
    const siblings = labels[0]?.parentNode?.childNodes.filter(tree.isElementNode) ?? [];
    const value = siblings[siblings.indexOf(labels[0]) + 1];
    if (labels.length !== 1 || value?.tagName !== "p" || !clean(text(value))) {
      throw new Error("Unexpected LinkBike station field structure.");
    }
    return clean(text(value));
  });
  return { id, name, docks: count(values[0]), bikes: count(values[1]) };
}

function duplicateIds(ids: string[]) {
  const seen = new Set<string>(), duplicates = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
  }
  return duplicates;
}

export function parseLinkBikePortal(html: string): PortalSnapshot {
  const documentElements = elements(parse(html));
  const timestamps = documentElements.filter(p => p.tagName === "p")
    .map(p => text(p).trim()).filter(value => /^Last Updated:/i.test(value));
  const updated = timestamps[0]?.replace(/^Last Updated:\s*/i, "");
  const cards = documentElements.filter(element => element.tagName === "div" && hasClass(element, "pnlstationInfo"));
  const stationHeadings = documentElements.filter(p => p.tagName === "p" && stationLabel.test(clean(text(p))));
  if (timestamps.length !== 1 || !updated || cards.length === 0 || stationHeadings.length !== cards.length) {
    throw new Error("Unexpected LinkBike portal layout.");
  }
  const parsed = cards.map(parseCard);
  const duplicates = duplicateIds(parsed.map(row => row.id));
  const rows: PortalRow[] = [];
  const warnings: string[] = [];
  let excluded = 0;
  for (const { id, name, docks, bikes } of parsed) {
    if (excludedIds.has(id) || excludedName.test(name)) {
      excluded++;
    } else if (!stationId.safeParse(id).success || !name || duplicates.has(id) ||
      docks === null || bikes === null || bikes > docks) {
      warnings.push(stationId.safeParse(id).success ? `Station ${id} inventory quarantined.` : "Invalid station ID quarantined.");
    } else {
      rows.push({ id, name, docks, bikes });
    }
  }
  if (!rows.length) throw new Error("No usable LinkBike station inventory.");
  return { updated, rows, excluded, warnings: [...new Set(warnings)] };
}

const consumerRow = z.object({
  StId: stationId,
  name: z.string().trim().min(1),
  capacity: z.string(),
  availbike: z.string(),
  volt: z.string(),
  lat: z.string(),
  lng: z.string(),
}).refine(row => {
  const docks = count(row.capacity), bikes = count(row.availbike);
  return docks !== null && bikes !== null && bikes <= docks;
});

export function parseLinkBikeConsumer(json: string) {
  const raw = z.array(z.unknown()).nonempty().parse(JSON.parse(json));
  const idOnly = z.object({ StId: stationId });
  const ids = raw.flatMap(row => {
    const id = idOnly.safeParse(row);
    return id.success ? [id.data.StId] : [];
  });
  const duplicates = duplicateIds(ids);
  const rows = new Map<string, z.infer<typeof consumerRow>>();
  let rejected = 0;
  for (const row of raw) {
    const result = consumerRow.safeParse(row);
    if (result.success && !duplicates.has(result.data.StId)) rows.set(result.data.StId, result.data);
    else rejected++;
  }
  if (!rows.size) throw new Error("No usable LinkBike coordinate records.");
  return { rows, rejected };
}

const compareName = (name: string) => clean(name.normalize("NFKC")).toLowerCase();
const coordinate = (value: string) => /^[-+]?\d+(?:\.\d+)?$/.test(value.trim()) ? Number(value) : NaN;

export function linkBikeStations(portal: PortalSnapshot, fetchedAt: string, consumer?: ReturnType<typeof parseLinkBikeConsumer>): LinkBikeStation[] {
  return portal.rows.map(row => {
    const candidate = consumer?.rows.get(row.id);
    const latitude = candidate ? coordinate(candidate.lat) : NaN;
    const longitude = candidate ? coordinate(candidate.lng) : NaN;
    const warnings: string[] = [];
    if (row.id === "16") warnings.push("Station 16 coordinates quarantined after the portal audit.");
    if (candidate && compareName(candidate.name) !== compareName(row.name)) warnings.push("Consumer station name does not match.");
    if (candidate && !(latitude >= 5.1 && latitude <= 5.6 && longitude >= 100.15 && longitude <= 100.42)) {
      warnings.push("Consumer coordinates are outside the expected Penang Island bounds.");
    }
    const quarantined = warnings.length > 0;
    if (candidate && (row.docks !== Number(candidate.capacity) || row.bikes !== Number(candidate.availbike))) {
      warnings.push("Consumer inventory differs. Counts shown come from the Maintenance Portal.");
    }
    const validated = candidate && !quarantined;
    return {
      source: "LinkBike", station_id: row.id, station_name: row.name, total_docks: row.docks,
      available_bikes: row.bikes, available_docks: null, latitude: validated ? latitude : null,
      longitude: validated ? longitude : null,
      source_coordinates: candidate ? { latitude: candidate.lat, longitude: candidate.lng } : null,
      upstream_updated_at: null, upstream_updated_at_raw: portal.updated, fetched_at: fetchedAt,
      data_status: "UNVERIFIED", is_public_station: null,
      coordinate_status: quarantined ? "QUARANTINED" : validated ? "VALIDATED_CANDIDATE" : "UNAVAILABLE",
      validation_warnings: warnings,
    };
  });
}
