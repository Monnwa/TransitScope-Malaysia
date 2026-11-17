/** Existing OSM raster service; no new account, credentials or provider configuration.
 * Terms: https://operations.osmfoundation.org/policies/tiles/
 * The CSS treatment quiets the entire raster image; it cannot remove individual POIs.
 */
export const lightBasemap = {
  url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  className: "transit-light-tiles",
  maxZoom: 18,
  // A failed tile leaves a neutral background, while independent transit layers keep working.
  errorTileUrl: "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><path fill="#eef1f2" d="M0 0h256v256H0z"/></svg>'),
} as const;
