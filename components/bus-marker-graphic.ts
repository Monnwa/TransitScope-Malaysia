// Simulation bearing and SVG rotation both increase clockwise. The SVG forward cue
// points up (north) at rest, so no bearing offset is needed.
export function busHeading(bearing: number | null | undefined) {
  return typeof bearing === "number" && Number.isFinite(bearing) && bearing >= 0 && bearing < 360 ? bearing : 0;
}

export function busMarkerGraphic(bearing: number | null | undefined) {
  return `<span aria-hidden="true"><svg class="bus-vehicle-glyph" width="30" height="30" viewBox="0 0 32 32" fill="currentColor" focusable="false">
    <g transform="rotate(${busHeading(bearing)} 16 16)">
      <path class="bus-forward-cue" d="M16 2l-4 5h8z"/>
      <rect x="8" y="9" width="16" height="16" rx="4"/>
      <path d="M10 23h4v4a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1zm8 0h4v4a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1z"/>
      <rect x="10.5" y="12" width="11" height="6" rx="1.5" fill="#1749a1"/>
      <circle cx="11.5" cy="21.5" r="1.25" fill="#1749a1"/><circle cx="20.5" cy="21.5" r="1.25" fill="#1749a1"/>
    </g></svg></span>`;
}
