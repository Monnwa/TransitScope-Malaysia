import React from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MapContainer } from "react-leaflet";
import { railNetwork } from "@/lib/simulation/network";
import { rapidRailMeta } from "@/lib/rail-model";
import { railRouteOpacity, stationRailLines } from "@/lib/rail-route-style";
import RailRouteLayers from "@/components/rail-route-layers";
import type { Record as TransitRecord } from "@/lib/transit-data";

const station = (name: string) => railNetwork.stations.find(record => record.name === name)!;
const linesFor = (record?: TransitRecord) => stationRailLines(record, railNetwork.lines);

describe("station-driven rail styling", () => {
  it("keeps every route fully opaque before selection and after clearing", () => {
    for (const line of railNetwork.lines) expect(railRouteOpacity(line.id, linesFor())).toBe(1);
  });
  it.each([['Raja Chulan', 'MONORAIL'], ['Sri Petaling', 'LRT-PH'], ['KLCC', 'LRT-KJ']])("highlights %s using its stable route ID", (name, id) => {
    expect(linesFor(station(name))).toEqual([id]);
    for (const line of railNetwork.lines) expect(railRouteOpacity(line.id, linesFor(station(name)))).toBe(line.id === id ? 1 : .18);
  });
  it("highlights every interchange route, including both Putra Heights lines", () => {
    expect(linesFor(station('Putra Heights')).sort()).toEqual(['LRT-KJ', 'LRT-PH']);
    expect(linesFor(station('Tun Razak Exchange')).sort()).toEqual(['MRT1', 'MRT2']);
    for (const id of linesFor(station('KL Sentral'))) expect(railRouteOpacity(id, linesFor(station('KL Sentral')))).toBe(1);
  });
  it("replaces old highlights on another selection", () => {
    expect(railRouteOpacity('MONORAIL', linesFor(station('Raja Chulan')))).toBe(1);
    expect(railRouteOpacity('MONORAIL', linesFor(station('KLCC')))).toBe(.18);
  });
  it.each([
    { mode: 'Bus', railLines: ['MONORAIL'] }, { mode: 'Shared bike', railLines: ['MONORAIL'] },
    { railLines: undefined }, { railLines: ['unknown'] }, { recordKind: 'vehicle', railLines: ['MONORAIL'] },
  ] as Partial<TransitRecord>[])('ignores non-stations and missing/invalid rail associations: %j', overrides => {
    const selected = { ...station('Raja Chulan'), ...overrides };
    expect(linesFor(selected)).toEqual([]);
    for (const line of railNetwork.lines) expect(railRouteOpacity(line.id, linesFor(selected))).toBe(1);
  });
  it("filters invalid route IDs and deduplicates valid IDs without using names", () => {
    expect(linesFor({ ...station('Raja Chulan'), name: 'Unrelated name', railLines: ['MONORAIL', 'invalid', 'MONORAIL'] })).toEqual(['MONORAIL']);
  });
  it("uses the canonical corrected colours and preserves all other line colours", () => {
    expect(Object.fromEntries(Object.entries(rapidRailMeta).map(([key, line]) => [key, line.colour]))).toEqual({
      KGL: '#006B3F', PYL: '#F2C500', KJ: '#E75480', AG: '#E87524', PH: '#8B5A3C', MR: '#8BCB88',
    });
    for (const meta of Object.values(rapidRailMeta)) expect(railNetwork.lines.find(line => line.id === meta.id)?.colour).toBe(meta.colour);
    expect(railNetwork.lines.filter(line => line.mode === 'KTM').every(line => line.colour === '#24558A')).toBe(true);
  });
});

describe("actual React-Leaflet rail paths", () => {
  let svgDescriptor: PropertyDescriptor | undefined;
  beforeEach(() => {
    svgDescriptor = Object.getOwnPropertyDescriptor(SVGSVGElement.prototype, 'createSVGRect');
    Object.defineProperty(SVGSVGElement.prototype, 'createSVGRect', { configurable: true, value: () => ({}) });
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  });
  afterEach(() => {
    cleanup(); vi.unstubAllGlobals();
    if (svgDescriptor) Object.defineProperty(SVGSVGElement.prototype, 'createSVGRect', svgDescriptor);
    else delete (SVGSVGElement.prototype as unknown as { createSVGRect?: unknown }).createSVGRect;
  });
  it("updates both casing and coloured strokes without remounting paths or losing canonical colours", () => {
    const onHighlight = vi.fn();
    const tree = (selected?: TransitRecord, quietRail = true) => <MapContainer center={[3.14, 101.7]} zoom={12}>
      <RailRouteLayers lines={railNetwork.lines} hidden={[]} highlighted={linesFor(selected)} stationLines={linesFor(selected)} quietRail={quietRail} onHighlight={onHighlight}/>
    </MapContainer>;
    const view = render(tree());
    const routes = () => [...view.container.querySelectorAll('path.rail-alignment')];
    const casings = () => [...view.container.querySelectorAll('path.rail-route-casing')];
    const initial = routes(); expect(initial.length).toBeGreaterThan(0);
    for (const path of [...initial, ...casings()]) expect(path).toHaveAttribute('stroke-opacity', '1');
    view.rerender(tree(station('Raja Chulan'), false));
    expect(routes()[0]).toBe(initial[0]);
    for (const path of routes()) {
      const line = railNetwork.lines.find(line => path.classList.contains(line.id.replace(/[^a-zA-Z0-9]/g, '-')))!;
      expect(path).toHaveAttribute('stroke', line.colour);
      expect(path).toHaveAttribute('stroke-opacity', line.id === 'MONORAIL' ? '1' : '0.18');
    }
    expect(casings().some(path => path.getAttribute('stroke-opacity') === '0.18')).toBe(true);
    view.rerender(tree(station('Putra Heights'), false));
    for (const id of ['LRT-KJ', 'LRT-PH']) expect(view.container.querySelector('.' + id)).toHaveAttribute('stroke-opacity', '1');
    expect(view.container.querySelector('.MONORAIL')).toHaveAttribute('stroke-opacity', '0.18');
    view.rerender(tree());
    for (const path of [...routes(), ...casings()]) expect(path).toHaveAttribute('stroke-opacity', '1');
  });
});
