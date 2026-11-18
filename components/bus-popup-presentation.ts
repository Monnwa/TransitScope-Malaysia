"use client";

import type L from "leaflet";
import { useEffect, type RefObject } from "react";
import { useMap } from "react-leaflet";

/** Move only the bus bubble. Leaflet retains its transform, anchor and camera policy. */
export function useBusPopupPresentation(popupRef: RefObject<L.Popup | null>, markerRef: RefObject<L.Marker | null>, owner: string) {
  const map = useMap();
  useEffect(() => {
    let active: L.Popup | null = null, frame = 0, revision = 0, shift = 0;
    let observer: ResizeObserver | undefined;
    const reset = () => {
      revision++;
      cancelAnimationFrame(frame); frame = 0;
      observer?.disconnect(); observer = undefined;
      active?.getElement()?.style.removeProperty("--bus-popup-shift");
      active?.getElement()?.style.removeProperty("--bus-popup-max-content");
      active = null; shift = 0;
    };
    const schedule = () => {
      if (!active || frame) return;
      const popup = active, ticket = revision;
      frame = requestAnimationFrame(() => {
        if (ticket !== revision) return;
        frame = 0;
        const element = popup.getElement();
        if (ticket !== revision || active !== popup || popupRef.current !== popup || !popup.isOpen() ||
          !element?.isConnected || !element.classList.contains(owner)) return;
        const container = map.getContainer(), bounds = container.getBoundingClientRect();
        let left = Math.max(0, bounds.left), right = Math.min(window.innerWidth, bounds.right);
        for (let ancestor = container.parentElement; ancestor; ancestor = ancestor.parentElement) {
          if (!/^(hidden|clip|auto|scroll)$/.test(getComputedStyle(ancestor).overflowX)) continue;
          const clip = ancestor.getBoundingClientRect();
          left = Math.max(left, clip.left); right = Math.min(right, clip.right);
        }
        const box = element.getBoundingClientRect(), baseLeft = box.left - shift;
        const inset = 6, available = right - left - 2 * inset;
        if (box.width <= 0 || available <= 0) return;
        // Content can wrap if a container becomes narrower than the natural bubble.
        element.style.setProperty("--bus-popup-max-content", Math.max(1, available - 46) + "px");
        const width = element.getBoundingClientRect().width;
        const next = Math.max(left + inset, Math.min(baseLeft, right - inset - width)) - baseLeft;
        if (Math.abs(next - shift) > .01) {
          shift = next;
          element.style.setProperty("--bus-popup-shift", shift + "px");
        }
      });
    };
    const open = ({ popup }: L.PopupEvent) => {
      if (popup !== popupRef.current) { reset(); return; }
      reset(); active = popup;
      observer = new ResizeObserver(schedule);
      observer.observe(map.getContainer());
      const element = popup.getElement(); if (element) observer.observe(element);
      schedule();
    };
    const close = ({ popup }: L.PopupEvent) => { if (popup === active) reset(); };
    const marker = markerRef.current, popup = popupRef.current;
    map.on("popupopen", open).on("popupclose", close).on("move zoomend resize", schedule);
    marker?.on("move", schedule); popup?.on("contentupdate", schedule);
    window.addEventListener("resize", schedule); window.addEventListener("scroll", schedule, { passive: true });
    window.visualViewport?.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("scroll", schedule);
    if (popup?.isOpen()) open({ popup } as L.PopupEvent);
    return () => {
      reset();
      map.off("popupopen", open).off("popupclose", close).off("move zoomend resize", schedule);
      marker?.off("move", schedule); popup?.off("contentupdate", schedule);
      window.removeEventListener("resize", schedule); window.removeEventListener("scroll", schedule);
      window.visualViewport?.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("scroll", schedule);
    };
  }, [map, markerRef, owner, popupRef]);
}
