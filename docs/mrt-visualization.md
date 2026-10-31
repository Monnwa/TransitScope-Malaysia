# MRT railway visualization

The MRT1 Kajang alignment uses #006B3F; MRT2 Putrajaya uses #F2C500. Railway alignments and stations are STATIC, not live train positions.

## Sources and validation

- Geometry and station membership: Malaysia Official Open API, https://api.data.gov.my/gtfs-static/prasarana?category=rapid-rail-kl . Documentation: https://developer.data.gov.my/realtime-api/gtfs-static . The official feed uses route_id KGL and PYL (both category MRT). trips.txt maps those routes to shape_id in shapes.txt; stop_times.txt maps their trips to stops.txt stations. No station-to-station substitute is drawn.
- Published GTFS shape_pt_lat / shape_pt_lon are WGS84 decimal degrees. Coordinates are rendered as Leaflet [latitude, longitude] without editing the source vertices. Validation rejects out-of-region values, non-finite coordinates, paths with fewer than 50 vertices, jumps exceeding 5 km, implausible total lengths outside 35–80 km, or station coverage greater than 750 m from a segment. These are quality checks, not a survey-grade positional accuracy guarantee.
- MRT Corp confirms Kwasa Damansara as the shared terminal and TRX as the other interchange: https://www.mymrt.com.my/projects/kajang-line/ and https://www.mymrt.com.my/projects/putrajaya-line/stations/ . Name normalization merges each shared station into one record. Neither platform coordinates nor geometry are invented.
- The requested ArcGIS service was examined: https://services5.arcgis.com/2ZRAaoTSJbQ20ceg/arcgis/rest/services/SELANGOR_RAILWAY_MAP/FeatureServer . Station layers 6/8 returned 29/36 stations and EPSG:4326. However, querying line layer 15 returned a first feature named Kelana Jaya, and the item metadata identified owner faizfaizar with blank licenseInfo/accessInformation. Consequently these layers are not used as authoritative geometry. Official GTFS supplies both complete alignments, so no secondary geometry source is needed.
- Apple Maps and Google Maps data are not used.

## Behavior and verification

Clicking a line or its legend highlights it and its stations; selecting an interchange highlights both lines. Other MRT stations are dimmed rather than removed. Non-MRT markers retain their existing mode colors and behavior. A white casing separates the green/yellow paths from the basemap, and Leaflet marker panes keep station markers above the paths.

The MRT endpoint returns partial successful geometry with an explicit unavailable state when validation or retrieval fails. In this state station markers remain independent. A retry control is provided; frontend requests time out after 20 seconds. Successful geometry is cached at the edge for 24 hours. Static station records remain preserved across 30-second vehicle refreshes.

Live verification on 2026-10-31: MRT1 29 stations / 580 vertices; MRT2 36 stations / 714 vertices; 63 distinct stations after merging the two interchanges. Unit tests cover classification, merging and geometry guards; browser tests cover line/legend clicks, station selection, both-line highlighting and fallback, alongside existing bus/bike/alert tests.

## Limitations

The feed is a published operational alignment, not an engineering track survey. Service changes and renamed stations depend on upstream refreshes. Both directions share one selected valid full shape; opposite tracks are not drawn separately. Next departure remains the earliest published scheduled time retained by the existing dashboard, rather than a separate live prediction for each line/direction. If either official shape fails validation, that line is omitted and an explicit fallback is shown. Network-dependent live verification is separate from deterministic tests, whose synthetic fixtures are never production assets.
