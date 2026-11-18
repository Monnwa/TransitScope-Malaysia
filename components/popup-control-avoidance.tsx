"use client";

import L from "leaflet";
import { useLayoutEffect, useRef } from "react";
import { useMap } from "react-leaflet";

type Lease = { popup: L.Popup; owner: string; kind: "journey" | "rail"; recordId?: string;
  selectionAtOpen?: string; confirmed: boolean; revision: number };

/** One presentation lease for the map's existing control; never a map camera. */
export default function PopupControlAvoidance({ selectedRecordId, journeyVehicleId }: {
  selectedRecordId?: string; journeyVehicleId?: string;
}) {
  const map = useMap(), latest = useRef({ selectedRecordId, journeyVehicleId });
  latest.current = { selectedRecordId, journeyVehicleId };
  const reconcile = useRef<() => void>(() => {});
  useLayoutEffect(() => {
    const control = map.zoomControl;
    if (!control) return;
    let active: Lease | null = null, revision = 0, pending = false, original = control.getPosition();
    let resize: ResizeObserver | undefined, mutation: MutationObserver | undefined;
    const eligible = (popup: L.Popup) => {
      const classes = popup.options.className?.split(" ") ?? [];
      const rail = classes.find(name => name.startsWith("rail-popup-owner-"));
      if (rail) return { kind: "rail" as const, owner: rail, recordId: decodeURIComponent(rail.slice("rail-popup-owner-".length)) };
      if (classes.includes("journey-stop-popup-shell")) return { kind: "journey" as const,
        owner: "journey-stop-" + L.Util.stamp(popup), recordId: latest.current.journeyVehicleId };
      return null;
    };
    const current = (lease: Lease) => active === lease && lease.revision === revision && lease.popup.isOpen() &&
      !!lease.popup.getElement()?.isConnected && eligible(lease.popup)?.owner === lease.owner;
    const position = (next: L.ControlPosition) => {
      if (control.getPosition() === next) return;
      const old = control.getContainer(), focused = document.activeElement;
      const selector = focused instanceof Element && old?.contains(focused)
        ? focused.closest(".leaflet-control-zoom-in") ? ".leaflet-control-zoom-in" :
          focused.closest(".leaflet-control-zoom-out") ? ".leaflet-control-zoom-out" : null : null;
      control.setPosition(next);
      const replacement = selector ? control.getContainer()?.querySelector<HTMLElement>(selector) : null;
      if (replacement?.isConnected) replacement.focus({ preventScroll: true });
    };
    const clearConflict = () => {
      delete map.getContainer().dataset.popupControlConflict;
      delete map.getContainer().dataset.journeyZoomConflict;
    };
    const retire = (restore: boolean) => {
      revision++; pending = false;
      resize?.disconnect(); mutation?.disconnect();
      active?.popup.off("contentupdate", enqueue).off("presentationlayout", measure);
      if (restore && active) position(original);
      active = null; clearConflict();
    };
    function measure() {
      const lease = active;
      if (!lease || !current(lease)) return;
      const element = lease.popup.getElement()!, zoom = control.getContainer();
      if (!zoom || !element.querySelector(lease.kind === "rail" ? ".rail-station-popup" : ".journey-stop-popup")) return;
      if (lease.kind === "journey" && innerWidth > 720) { position(original); clearConflict(); return; }
      const mapBox = map.getContainer().getBoundingClientRect();
      const clip = { left: Math.max(0, mapBox.left), right: Math.min(innerWidth, mapBox.right),
        top: Math.max(0, mapBox.top), bottom: Math.min(innerHeight, mapBox.bottom) };
      for (let parent = map.getContainer().parentElement; parent; parent = parent.parentElement) {
        const c = getComputedStyle(parent), b = parent.getBoundingClientRect();
        if (/^(hidden|clip|auto|scroll)$/.test(c.overflowX)) { clip.left = Math.max(clip.left, b.left); clip.right = Math.min(clip.right, b.right); }
        if (/^(hidden|clip|auto|scroll)$/.test(c.overflowY)) { clip.top = Math.max(clip.top, b.top); clip.bottom = Math.min(clip.bottom, b.bottom); }
      }
      if (clip.right <= clip.left || clip.bottom <= clip.top) return;
      const obstacles = [element, ...Array.from(document.querySelectorAll(".leaflet-control,.bus-journey,header,.map-camera-bar,.map-legend"))]
        .filter(e => e !== zoom && !zoom.contains(e) && !e.contains(zoom))
        .filter(e => { const c = getComputedStyle(e); return c.display !== "none" && c.visibility !== "hidden"; })
        .map(e => e.getBoundingClientRect()).filter(r => r.width > 0 && r.height > 0);
      const overlaps = (a: DOMRect, b: DOMRect) => Math.min(a.right, b.right) > Math.max(a.left, b.left) &&
        Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top);
      const previous = control.getPosition();
      for (const corner of [...new Set([original, "bottomleft", "bottomright", "topright", "topleft"])] as L.ControlPosition[]) {
        position(corner);
        const box = control.getContainer()!.getBoundingClientRect();
        if (box.width > 0 && box.height > 0 && box.left >= clip.left && box.right <= clip.right &&
          box.top >= clip.top && box.bottom <= clip.bottom && !obstacles.some(obstacle => overlaps(box, obstacle))) {
          clearConflict(); return;
        }
      }
      position(previous);
      map.getContainer().dataset.popupControlConflict = "no-safe-corner";
      if (lease.kind === "journey") map.getContainer().dataset.journeyZoomConflict = "no-safe-corner";
      map.fire("popupcontrolconflict", { owner: lease.owner, reason: "no-safe-corner" });
    }
    function enqueue() {
      const lease = active;
      if (!lease || pending) return;
      pending = true;
      queueMicrotask(() => { if (!current(lease)) return; pending = false; measure(); });
    }
    const open = ({ popup }: L.PopupEvent) => {
      const owner = eligible(popup);
      if (!owner) { retire(true); return; }
      if (!active) original = control.getPosition();
      retire(false);
      active = { popup, ...owner, selectionAtOpen: latest.current.selectedRecordId,
        confirmed: !!owner.recordId && owner.recordId === latest.current.selectedRecordId, revision };
      const lease = active, element = popup.getElement();
      resize = new ResizeObserver(() => { if (current(lease)) measure(); });
      mutation = new MutationObserver(() => { if (current(lease)) measure(); });
      [map.getContainer(), element, ...Array.from(document.querySelectorAll(".bus-journey,.map-camera-bar,header"))]
        .forEach(e => { if (e) resize!.observe(e); });
      if (element) mutation.observe(element, { attributes: true, attributeFilter: ["style", "class"], childList: true, characterData: true, subtree: true });
      popup.on("contentupdate", enqueue).on("presentationlayout", measure); measure();
    };
    const close = ({ popup }: L.PopupEvent) => { if (active?.popup === popup) retire(true); };
    reconcile.current = () => {
      if (!active) return;
      const id = latest.current.selectedRecordId;
      if (active.recordId && id === active.recordId) active.confirmed = true;
      else if (active.confirmed || id !== active.selectionAtOpen) retire(true);
    };
    map.on("popupopen", open).on("popupclose", close).on("move zoomend resize", enqueue);
    window.addEventListener("resize", enqueue); window.addEventListener("scroll", enqueue, { passive: true });
    return () => {
      retire(true); map.off("popupopen", open).off("popupclose", close).off("move zoomend resize", enqueue);
      window.removeEventListener("resize", enqueue); window.removeEventListener("scroll", enqueue);
      reconcile.current = () => {};
    };
  }, [map]);
  useLayoutEffect(() => { reconcile.current(); }, [selectedRecordId, journeyVehicleId]);
  return null;
}

