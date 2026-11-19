"use client";

import L from "leaflet";
import { useLayoutEffect, useRef, type ReactNode } from "react";
import { Popup, useMap } from "react-leaflet";
import type { Record as TransitRecord } from "@/lib/transit-data";
import { SIMULATED } from "@/lib/simulation/clock";
import type { StationSearchRequest } from "@/lib/station-search";
import useStationSearchNavigation from "./use-station-search-navigation";

function nativeAnchor(value: unknown): value is { lat: number; lng: number } {
  return typeof value === "object" && value !== null && "lat" in value && "lng" in value &&
    typeof value.lat === "number" && typeof value.lng === "number" &&
    Number.isFinite(value.lat) && Number.isFinite(value.lng) &&
    value.lat >= -90 && value.lat <= 90 && value.lng >= -180 && value.lng <= 180;
}
function finitePoint(value: unknown): value is { x: number; y: number } {
  return typeof value === "object" && value !== null && "x" in value && "y" in value &&
    typeof value.x === "number" && typeof value.y === "number" && Number.isFinite(value.x) && Number.isFinite(value.y);
}

type Box = { left: number; right: number; top: number; bottom: number };
const intersects = (a: Box, b: Box) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
  Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));

/** A layout effect runs when the real portal content arrives, not the empty shell. */
function RailContent({ layout, children }: { layout: React.RefObject<() => void>; children: ReactNode }) {
  useLayoutEffect(() => { layout.current(); });
  return <div className="rail-station-popup">{children}</div>;
}

export default function RailStationPopup({ record, selectedRecordId, searchRequest }: { record: TransitRecord; selectedRecordId?: string; searchRequest?: StationSearchRequest | null }) {
  const map = useMap(), popupRef = useRef<L.Popup>(null), layout = useRef<() => void>(() => {});
  const latest = useRef(selectedRecordId); latest.current = selectedRecordId;
  const reconcile = useRef<() => void>(() => {});
  const owner = "rail-popup-owner-" + encodeURIComponent(record.id);

  useLayoutEffect(() => {
    const popupFromRef = popupRef.current;
    if (!popupFromRef) return;
    const popup: L.Popup = popupFromRef;
    let generation = 0, x = 0, y = 0, pending = false;
    let active: { generation: number; selectionAtOpen?: string; confirmed: boolean } | null = null;
    let resize: ResizeObserver | undefined, mutation: MutationObserver | undefined;
    let source: L.CircleMarker | undefined;
    const current = (lease: NonNullable<typeof active>) => active === lease && lease.generation === generation &&
      popup.isOpen() && !!popup.getElement()?.isConnected;
    const release = () => {
      generation++; active = null; pending = false;
      resize?.disconnect(); mutation?.disconnect();
      resize = undefined; mutation = undefined;
      map.off("move zoom zoomend viewreset resize autopanstart", place);
      window.removeEventListener("resize", place); window.removeEventListener("scroll", place);
      window.visualViewport?.removeEventListener("resize", place);
      window.visualViewport?.removeEventListener("scroll", place);
      popup.off("contentupdate", enqueue);
      // Keep the retired node's last geometry while Leaflet fades it out.
    };
    const conflict = (lease: NonNullable<typeof active>, element: HTMLElement, reason: string) => {
      if (!current(lease) || popup.getElement() !== element) return;
      if (element.dataset.railPresentationConflict !== reason) {
        element.dataset.railPresentationConflict = reason;
        map.fire("railpresentationconflict", { owner, reason, generation: lease.generation });
      }
    };
    function place() {
      const lease = active, element = popup.getElement();
      if (!lease || !current(lease) || !element?.classList.contains(owner) || !element.querySelector(".rail-station-popup")) return;
      const sourceCurrent = () => !!source && map.hasLayer(source) && source.getPopup() === popup;
      const publishable = () => current(lease) && popup.getElement() === element && sourceCurrent();
      if (!sourceCurrent()) { conflict(lease, element, "source-context-mismatch"); return; }
      const native = popup.getLatLng();
      if (!current(lease)) return;
      if (native == null) { conflict(lease, element, "unavailable-native-anchor"); return; }
      if (!nativeAnchor(native)) { conflict(lease, element, "invalid-native-anchor"); return; }
      if (!publishable()) return;
      const projected = map.latLngToContainerPoint(native);
      if (!current(lease)) return;
      if (!finitePoint(projected)) { conflict(lease, element, "invalid-projection"); return; }
      if (!publishable()) return;
      const container = map.getContainer(), mapBox = container.getBoundingClientRect();
      const clip = { left: Math.max(0, mapBox.left), right: Math.min(innerWidth, mapBox.right),
        top: Math.max(0, mapBox.top), bottom: Math.min(innerHeight, mapBox.bottom) };
      for (let parent = container.parentElement; parent; parent = parent.parentElement) {
        const css = getComputedStyle(parent), box = parent.getBoundingClientRect();
        if (/^(hidden|clip|auto|scroll)$/.test(css.overflowX)) { clip.left = Math.max(clip.left, box.left); clip.right = Math.min(clip.right, box.right); }
        if (/^(hidden|clip|auto|scroll)$/.test(css.overflowY)) { clip.top = Math.max(clip.top, box.top); clip.bottom = Math.min(clip.bottom, box.bottom); }
      }
      if (clip.right <= clip.left || clip.bottom <= clip.top) return; // The map is offscreen.
      const sourceBox = source?.getElement()?.getBoundingClientRect();
      const point = sourceBox?.width && sourceBox.height
        ? { x: (sourceBox.left + sourceBox.right) / 2, y: (sourceBox.top + sourceBox.bottom) / 2 }
        : { x: mapBox.left + projected.x, y: mapBox.top + projected.y };
      const box = element.getBoundingClientRect(), base = { left: box.left - x, top: box.top - y, bottom: box.bottom - y };
      if (![mapBox.left, mapBox.right, mapBox.top, mapBox.bottom, clip.left, clip.right, clip.top, clip.bottom,
        point.x, point.y, box.left, box.top, box.bottom, box.width, box.height, base.left, base.top, base.bottom].every(Number.isFinite)) {
        conflict(lease, element, "invalid-screen-geometry"); return;
      }
      const inset = 6, epsilon = .01, gap = Math.max(1, point.y - base.bottom);
      if (box.width <= 0 || box.height <= 0) return;
      if (box.width > clip.right - clip.left - 2 * inset || box.height > clip.bottom - clip.top - 2 * inset) {
        conflict(lease, element, "popup-does-not-fit"); return;
      }
      if (point.x < clip.left - epsilon || point.x > clip.right + epsilon || point.y < clip.top - epsilon || point.y > clip.bottom + epsilon) {
        conflict(lease, element, "source-outside-visible-map"); return;
      }
      const above = point.y - gap - box.height, below = point.y + gap;
      const fits = (top: number) => top >= clip.top + inset - epsilon && top + box.height <= clip.bottom - inset + epsilon;
      const previous = element.dataset.railPlacement;
      const orientation = previous === "below" && fits(below) ? "below" : previous === "above" && fits(above) ? "above" :
        fits(above) ? "above" : fits(below) ? "below" : null;
      if (!orientation) { conflict(lease, element, "no-source-aligned-space"); return; }
      const left = Math.max(clip.left + inset, Math.min(point.x - box.width / 2, clip.right - inset - box.width));
      const top = orientation === "above" ? above : below;
      const nextX = left - base.left, nextY = top - base.top;
      const baseCenter = Math.max(left + 12, Math.min(point.x, left + box.width - 12));
      const tipLeft = Math.min(baseCenter - 12, point.x), tipRight = Math.max(baseCenter + 12, point.x), tipWidth = tipRight - tipLeft;
      if (![nextX, nextY, baseCenter, tipLeft, tipRight, tipWidth, gap].every(Number.isFinite) || tipWidth <= 0 || !publishable()) return;
      let changed = false;
      const set = (name: string, value: string) => {
        if (!publishable()) return false;
        if (element.style.getPropertyValue(name) !== value) { element.style.setProperty(name, value); changed = true; }
        return publishable();
      };
      const px = (value: number) => (Math.round(value * 10000) / 10000) + "px";
      if (!set("--rail-popup-x", px(nextX)) || !set("--rail-popup-y", px(nextY)) ||
        !set("--rail-tip-left", px(tipLeft - left)) || !set("--rail-tip-width", px(tipWidth)) || !set("--rail-tip-height", px(gap)) ||
        !set("--rail-tip-base-left", ((baseCenter - 12 - tipLeft) / tipWidth * 100) + "%") ||
        !set("--rail-tip-base-right", ((baseCenter + 12 - tipLeft) / tipWidth * 100) + "%") ||
        !set("--rail-tip-apex", ((point.x - tipLeft) / tipWidth * 100) + "%")) return;
      // Keep the displacement actually rendered, so the next measurement uses the same base.
      if (changed) {
        const appliedBox = element.getBoundingClientRect();
        if (!publishable()) return;
        if (!Number.isFinite(appliedBox.left) || !Number.isFinite(appliedBox.top)) { conflict(lease, element, "invalid-screen-geometry"); return; }
        x += appliedBox.left - box.left; y += appliedBox.top - box.top;
      }
      if (!publishable()) return;
      if (element.dataset.railPlacement !== orientation) { element.dataset.railPlacement = orientation; changed = true; }
      if (!publishable()) return;
      delete element.dataset.railPresentationConflict;
      // The gutter is verified against real text ranges, not the shell width.
      const close = element.querySelector(".leaflet-popup-close-button")?.getBoundingClientRect();
      const content = element.querySelector(".rail-station-popup")!;
      const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT); let node: Node | null;
      while (close && (node = walker.nextNode())) {
        if (!node.textContent?.trim()) continue;
        const range = document.createRange(); range.selectNodeContents(node);
        for (const text of typeof range.getClientRects === "function" ? range.getClientRects() : []) if (intersects(text, close) > .05) conflict(lease, element, "text-close-overlap");
      }
      if (changed && publishable() && !element.dataset.railPresentationConflict) popup.fire("presentationlayout");
    }
    function enqueue() {
      const lease = active;
      if (!lease || pending) return;
      pending = true;
      queueMicrotask(() => {
        if (!current(lease)) return;
        pending = false; place();
      });
    }
    const open = () => {
      release();
      active = { generation, selectionAtOpen: latest.current, confirmed: latest.current === record.id };
      source = undefined;
      map.eachLayer(layer => { if (layer instanceof L.CircleMarker && layer.getPopup() === popup) source = layer; });
      const lease = active, element = popup.getElement();
      resize = new ResizeObserver(() => { if (current(lease)) place(); });
      mutation = new MutationObserver(() => { if (current(lease)) place(); });
      if (element) {
        resize.observe(element);
        mutation.observe(element, { attributes: true, attributeFilter: ["style", "class"], childList: true, characterData: true, subtree: true });
      }
      resize.observe(map.getContainer());
      map.on("move zoom zoomend viewreset resize autopanstart", place);
      window.addEventListener("resize", place); window.addEventListener("scroll", place, { passive: true });
      window.visualViewport?.addEventListener("resize", place); window.visualViewport?.addEventListener("scroll", place);
      popup.on("contentupdate", enqueue); place();
    };
    reconcile.current = () => {
      if (!active) return;
      if (latest.current === record.id) active.confirmed = true;
      else if (active.confirmed || latest.current !== active.selectionAtOpen) release();
    };
    layout.current = place;
    popup.on("add", open).on("remove", release);
    if (popup.isOpen()) open();
    return () => {
      release(); popup.off("add", open).off("remove", release);
      layout.current = () => {}; reconcile.current = () => {};
    };
  }, [map, owner, record.id]);
  useLayoutEffect(() => { reconcile.current(); }, [selectedRecordId]);
  useStationSearchNavigation(map, popupRef, record, searchRequest);

  return <Popup ref={popupRef} pane="popupPane" className={"rail-station-popup-shell " + owner} autoPan={true}>
    <RailContent layout={layout}><strong>{record.name}</strong><br/>{record.lineNames?.join(" · ") || record.route}<br/>{SIMULATED}
      {record.interchange && <><br/>Interchange</>}
    </RailContent>
  </Popup>;
}

