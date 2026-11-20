# Rail station alignment audit

## Scope and sources

The dashboard previously drew eight established routes from published rail alignments while their station markers still used hand-authored simulation points. The same legacy points also became the marker anchors for some ERL, Shah Alam and BRT interchanges. Some points were more than a kilometre from the associated route and a few projected in the wrong station order. The audit compares the map at commit `71a8ccc` with the corrected station records. It covers all eleven lines and 238 station–rail-route memberships. Five BRT-only markers are outside the rail count.

| Railway | Station positions | Track geometry |
| --- | --- | --- |
| MRT Kajang and Putrajaya, LRT Kelana Jaya, Ampang and Sri Petaling, KL Monorail | Prasarana Rapid Rail GTFS `stops.txt`, matched using the stop IDs and sequence in the same trips used for the map | Existing Prasarana GTFS shapes associated by `trips.txt` and `shape_id` |
| KTM Port Klang and Seremban | KTMB GTFS stop IDs from full-length trips `weekday_2106` (reversed for the display direction) and `weekday_2041`. Seri Setia uses a named OSM route stop where the feed duplicates Setia Jaya | Existing connected OpenStreetMap relations 2565937 and 8390976 |
| ERL Ekspres and Transit | Existing Selangor Railway Map stop points | Existing shared OpenStreetMap alignment |
| LRT Shah Alam | Existing Prasarana stop points and source codes SA1–SA26 | Existing `shp_SA_0` alignment |

The GTFS archives were captured on 20 November 2026 and published under CC BY 4.0. Their SHA-256 fingerprints are `45c134f991b955eff801d35a45d9bdbeca83ae780bfc29dcac142665146c4533` (Prasarana) and `c7eafdb22de9ff433e657f0e97d6dc39395dd881ca96b788a10cdfd7265dcbc7` (KTMB). Both feeds use flat stop lists with coordinates and IDs. The KTMB archive supplies trip and stop time data. Source stop records preserve their own coordinate, route and code, including stops with offset platforms. [Malaysia Official GTFS](https://developer.data.gov.my/realtime-api/gtfs-static) · [Prasarana archive](https://api.data.gov.my/gtfs-static/prasarana?category=rapid-rail-kl) · [KTMB archive](https://api.data.gov.my/gtfs-static/ktmb) · [Selangor Railway Map stops](https://services5.arcgis.com/2ZRAaoTSJbQ20ceg/arcgis/rest/services/SELANGOR_RAILWAY_MAP/FeatureServer/4) · [OSM contributors, ODbL](https://www.openstreetmap.org/copyright)

## Measurements

The [per-station audit](rail-station-alignment-audit.json) records WGS84 `[latitude, longitude]`, the matched source and stop order, baseline and corrected marker coordinates, both track projections, and the reason for each correction. Distance is measured in metres to the closest point on the associated route. The corresponding source stops were checked for monotonically increasing distance along that route in the display direction. Shared complexes are assessed on each member route using the same published marker anchor. For selected complexes, an alternate published anchor reduces the largest gap across their member tracks. Source coordinates retain their published precision. Projections are diagnostic and zero markers were snapped.

| Measurement | PASS (≤15 m) | WARNING (>15–30 m) | FAIL (>30 m) | UNVERIFIED |
| --- | ---: | ---: | ---: | ---: |
| 238 route memberships before | 33 (13.9%) | 24 | 181 | 0 |
| 238 route memberships after | 154 (64.7%) | 44 | 40 | 0 |
| 194 markers after, worst associated route per marker | 124 (63.9%) | 33 | 37 | 0 |

173 markers moved and the Salak Selatan correction increased the rail marker count from 193 to 194. The previous simulation already omitted twelve stops found in the audited trip patterns. The route rows enumerate those stops. The counts apply to markers in the dashboard, and the distance classes describe alignment with the displayed tracks.

## Notable corrections and remaining review

- 16 Sierra, Jalan Kastam, and Serdang Raya Selatan moved to their matched stops. Their track gaps fell from about 1,520 m, 1,202 m, and 1,029 m to about 2 m, 13 m, and less than 1 m respectively. The audit records the full set of corrections.
- KTMB gives Seri Setia (53500) and Setia Jaya (53600) identical GTFS coordinates. The route relation identifies Seri Setia as a mapped train stop between Kampung Dato Harun and Setia Jaya. Setia Jaya retains its KTMB point and its BRT association. [OSM node 6762842359](https://www.openstreetmap.org/node/6762842359)
- Salak Selatan (LRT SP13) and Salak Selatan (KTM 19400) are separate stations roughly 440 m apart. Each marker now owns its own route, search result, and departures. The integrated transit map distinguishes the two stops. [Ministry of Transport integrated transit map](https://www.mot.gov.my/en/Statistik%20Tahunan%20Pengangkutan/Transport%20Statistics%20Malaysia%202021.pdf)
- KL Sentral, Bandar Tasik Selatan, Putrajaya Sentral, Bandar Utama, Glenmarie/Glenmarie 2, USJ 7 and Sunway–Setia Jaya keep a single marker for each verified connection. Their platforms retain distinct source coordinates in the audit. The single marker is 199 m from the Shah Alam track at Glenmarie, 180 m from the Monorail track at KL Sentral, and 121 m from the MRT track at Bandar Utama. The corresponding route-specific source points are within 16 m of their own tracks. [Prasarana on the Shah Alam connections](https://www.prasarana.com.my/mobiliti/prasarana-komited-dalam-transformasi-pengangkutan-awam-tingkat-mutu-perkhidmatan-dan-sasar-lonjakan-penumpang/) · [MRT Corp on Putrajaya Sentral](https://www.mymrt.com.my/projects/putrajaya-line/stations/putrajaya-sentral/)
- The Kelana Jaya shape ends about 105 m from its published Putra Heights point. On Putrajaya, the line continues roughly 412 m past the route’s last published stop projection. Both geometries remain as published. The audit separates cross-platform offsets from cases where a route’s own published station is over 30 m off its track, including Putra Heights, Johan Setia, KLCC and several KTM stops. Those cases warrant source review. The Seremban corridor has the most failing memberships (10), followed by Port Klang (5).

### Published positions requiring source review

These locations exceed 30 m even when measured from the route’s own stop coordinate. The detailed audit also lists the shared markers whose other platforms are offset.

| Route | Published stop and distance to its track |
| --- | --- |
| MRT Kajang | Tun Razak Exchange (33 m), Phileo Damansara (31 m) |
| MRT Putrajaya | Chan Sow Lin (37 m), Tun Razak Exchange (33 m), Taman Naga Emas (32 m) |
| LRT Kelana Jaya | Putra Heights (105 m), KLCC (49 m), KL Sentral (38 m), USJ 7 (31 m), Ara Damansara (31 m) |
| LRT Ampang | Ampang (33 m) |
| LRT Sri Petaling | Muhibbah (34 m) |
| KTM Port Klang | Jalan Templer (59 m), Tanjung Malim (45 m), Kampung Dato Harun (39 m), Kepong (38 m), KL Sentral (34 m) |
| KTM Seremban | Labu (58 m), Pulau Sebang (53 m), Bangi (52 m), Seremban (51 m), Senawang (44 m), Nilai (41 m), Sentul (34 m), Sungai Gadut (31 m) |
| LRT Shah Alam | Johan Setia (45 m), Klang Jaya (33 m), Bandar Bukit Tinggi (32 m) |
| ERL Transit | Salak Tinggi (38 m) |
