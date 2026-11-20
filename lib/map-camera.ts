import { distanceM, validPoint, type GeoPoint } from "@/lib/route-projection";
import { visibleMapArea, type Rect } from "@/lib/journey-stop-selection";

export type CameraMode = "OVERVIEW" | "VEHICLE_FOCUS" | "FREE_EXPLORE";
export type CameraCommand = { kind: "overview" } | { kind: "focus" } |
  { kind: "rail-route"; points: GeoPoint[] } |
  { kind: "stop"; point: GeoPoint; id: string; sequence: number };
export type CameraState = { mode: CameraMode; vehicleId: string | null; selectionId: string | null; viewIntent: "bus" | "selection"; request: number; command: CameraCommand };
export type CameraAction =
  | { type: "SELECT"; id: string | null; recordId?: string | null }
  | { type: "FOCUS" | "RETURN"; available: boolean }
  | { type: "MANUAL" | "UNAVAILABLE" | "OVERVIEW" | "ROUTE" }
  | { type: "RAIL_ROUTE"; points: GeoPoint[] }
  | { type: "STOP"; point: GeoPoint; id: string; sequence: number };

export const initialCameraState: CameraState = { mode: "OVERVIEW", vehicleId: null, selectionId: null, viewIntent: "bus", request: 0, command: { kind: "overview" } };
export function cameraReducer(state: CameraState, action: CameraAction): CameraState {
  switch (action.type) {
    case "SELECT": {
      const selectionId = action.recordId === undefined ? action.id : action.recordId;
      if (action.id === state.vehicleId && selectionId === state.selectionId) return state;
      if (!action.id) return { ...state, selectionId, viewIntent: selectionId ? "selection" : "bus", vehicleId: null,
        mode: "OVERVIEW", request: state.request + 1, command: { kind: "overview" } };
      return { ...state, selectionId, viewIntent: "bus", vehicleId: action.id, mode: state.mode === "OVERVIEW" ? "OVERVIEW" : "FREE_EXPLORE" };
    }
    case "FOCUS":
    case "RETURN":
      if (!state.vehicleId || !action.available || action.type === "FOCUS" && state.mode === "FREE_EXPLORE") return state;
      return { ...state, viewIntent: "bus", mode: "VEHICLE_FOCUS", request: state.request + 1, command: { kind: "focus" } };
    case "MANUAL":
      return state.mode === "FREE_EXPLORE" ? state : { ...state, mode: "FREE_EXPLORE" };
    case "UNAVAILABLE":
      return state.vehicleId && state.mode === "VEHICLE_FOCUS" ? { ...state, mode: "FREE_EXPLORE" } : state;
    case "OVERVIEW":
    case "ROUTE":
      return { ...state, viewIntent: "bus", mode: "OVERVIEW", request: state.request + 1, command: { kind: "overview" } };
    case "RAIL_ROUTE":
      return { ...state, mode: "FREE_EXPLORE", request: state.request + 1, command: { kind: "rail-route", points: action.points } };
    case "STOP":
      if (!validPoint(action.point)) return state;
      return { ...state, mode: "FREE_EXPLORE", request: state.request + 1,
        command: { kind: "stop", point: action.point, id: action.id, sequence: action.sequence } };
  }
}

/** Commands are deliberately immediate. A scoped guard covers synchronous Leaflet
 * move/zoom events, including nested popup/layout commands, without timeout guesses. */
export class ProgrammaticCameraGuard {
  private depth = 0;
  get active() { return this.depth > 0; }
  run<T>(operation: () => T): T {
    this.depth++;
    try { return operation(); } finally { this.depth--; }
  }
}

export const FOLLOW_MIN_DISTANCE_M = 12;
export const FOLLOW_MIN_INTERVAL_MS = 1500;
export function followDecision(previous: GeoPoint | null, next: GeoPoint | null, inside: boolean, elapsedMs: number) {
  if (!validPoint(next) || inside || previous && distanceM(previous, next) < FOLLOW_MIN_DISTANCE_M) return { move: false, wait: 0 };
  const wait = Math.max(0, FOLLOW_MIN_INTERVAL_MS - elapsedMs);
  return { move: wait === 0, wait };
}

export function cameraArea(map: Rect, viewport: { width: number; height: number }, obstructions: Rect[]): Rect | null {
  const area = visibleMapArea(map, viewport, obstructions);
  const inset = 16;
  const relative = { left: area.left - map.left + inset, top: area.top - map.top + inset,
    right: area.right - map.left - inset, bottom: area.bottom - map.top - inset };
  return relative.right - relative.left >= 64 && relative.bottom - relative.top >= 64 ? relative : null;
}
export function cameraAnchor(area: Rect, popupHeight = 0) {
  return { x: (area.left + area.right) / 2,
    y: Math.min(area.bottom - 18, Math.max(area.top + (area.bottom - area.top) * .6, area.top + popupHeight + 24)) };
}
export function withinCameraArea(point: { x: number; y: number }, area: Rect, margin = 12) {
  return point.x >= area.left + margin && point.x <= area.right - margin && point.y >= area.top + margin && point.y <= area.bottom - margin;
}

/** Match the installed Leaflet 1.9.4 Keyboard handler's keyCodes, including locale
 * and shifted variants. A character-only fallback would claim unsupported keys. */
export function leafletNavigationKey(event: Pick<KeyboardEvent, "keyCode" | "altKey" | "ctrlKey" | "metaKey">) {
  return !event.altKey && !event.ctrlKey && !event.metaKey &&
    [37, 38, 39, 40, 187, 107, 61, 171, 189, 109, 54, 173].includes(event.keyCode);
}
