# Inventory and station distribution refinement

19 November 2026. Baseline: `447dc59e2c38a030a59e7a2c342d8a442e9c8e6b`. Preview only, on `codex/micromobility-multi-operator`.

## Inventory

All 48 HelloRide, TRYKE and Beam records have `simulatedInventory: { availableBicycles, totalDocks, inventoryOrigin: "SIMULATED" }`. FNV-1a over the stable station ID derives a capacity of 10–30 and stock of 0–capacity. Values are static across requests/reloads, varied and include zero-stock examples. There is no random, clock or external API input. Real availability remains null and operation remains UNVERIFIED.

Popups use the actual LinkBike labels **Available bicycles** and **Total docks**, two equal definition-list columns, and bare integer values. They show **SIMULATED INVENTORY** and the exact disclosure: “Available bicycles and total docks are simulated for demonstration purposes and do not represent actual operator inventory or real-time availability.” Location provenance remains separate. The two source-backed TRYKE locations still have simulated inventory. LinkBike source, API, calculation, popup and selection behavior are unchanged.

## Geographic audit

The immutable [before audit](micromobility-audit-before.json) and reproducible [after audit](micromobility-audit-after.json) contain all 48 IDs, operators, names, states, areas, coordinates, location provenance, and nearest same/cross-operator IDs and distances. Run `node scripts/audit-micromobility.mjs after` to refresh the latter. Haversine uses mean Earth radius 6,371,008.8 m. Pair counts below concern the 48 new-operator records; per-record nearest cross-operator checks additionally include all 27 unchanged LinkBike points.

| Metric | Before | After |
| --- | ---: | ---: |
| Exact coordinate duplicates | 0 | 0 |
| Pairs under 100 m | 32 | 0 |
| Pairs under 200 m | 48 | 0 |
| Pairs under 300 m | 48 | 0 |
| Minimum same-operator distance | 714.4 m | 714.4 m |
| Minimum cross-operator distance, new operators | 62.8 m | 353.7 m |
| Minimum cross-operator distance, including LinkBike | 21.7 m | 310.2 m |

Original layouts placed all three operators beside the same 16 anchors, often tens of metres apart. Coverage lacked Mainland Penang, Shah Alam, Puchong, Mont Kiara, Titiwangsa and Batu Ferringhi. Synthetic points now use distinct named public-area surroundings across those districts. Stable IDs are retained even where their old locality suffix no longer matches a relocated point; consumers must use the name and area fields. No markers were hidden or removed, and no clustering dependency was needed. `MICROMOBILITY_SPACING_EXCEPTIONS` is explicitly empty: all new points meet the 300 m target, including distance to LinkBike.

| Operator | Klang Valley | Penang Island | Mainland Penang | Total |
| --- | ---: | ---: | ---: | ---: |
| HelloRide | 11 | 4 | 1 | 16 |
| TRYKE | 11 | 4 | 1 | 16 |
| Beam Mobility | 11 | 4 | 1 | 16 |

HelloRide: KLCC, Bukit Bintang, TRX, KL Sentral, Bangsar, Taman Jaya/Petaling Jaya, SS15/Subang Jaya, SS2, DPulze/Cyberjaya, Putrajaya Sentral, Alamanda, Penang Times Square/George Town, Gurney Bay, Batu Ferringhi, Queensbay, and Penang Sentral/Butterworth.

TRYKE: Titiwangsa, Chow Kit, Merdeka Square, Mid Valley, Mont Kiara, Damansara Uptown, Shah Alam, Sunway, Tamarind Square/Cyberjaya, Ayer@8, Millennium Monument, Karpal Singh Drive, Youth Park, Tanjung Bungah, SPICE/Bayan Lepas, and Bukit Mertajam.

Beam: Avenue K/KLCC, Jalan Alor/Bukit Bintang, southern TRX, Brickfields, Bangsar South, Jaya One/Petaling Jaya, SS18/Subang Jaya, Puchong Jaya, MMU/Cyberjaya, Precinct 2, Seri Gemilang, Jelutong, Botanic Gardens, Straits Quay/Tanjung Tokong, Bayan Baru, and Seberang Jaya.

TRYKE Ayer@8 (2.919500, 101.675100) and Millennium Monument (2.920800, 101.681400) retain their original coordinates, authority evidence and SOURCE_VERIFIED / APPROXIMATE_LOCATION classification. They were not displaced to meet spacing targets.

## Coordinate quality and limitations

Automated validation checks finite latitude/longitude, Malaysia/intended coverage bounds, named locality/state envelopes, duplicate coordinates, all same/cross-operator separation targets (including LinkBike), both regions and each operator's Mainland coverage. Invalid state/locality combinations are rejected. The locality envelopes are curated geographic checks, not authoritative administrative polygons. Broad regional boxes alone do not establish accessibility.

Representative landmark surroundings were selected using geographic judgement; public destination context is supported by the [Penang tourism authority's island/mainland map](https://www.mypenang.gov.my/uploads/downloads/PTM-ENG2026-1.pdf), its [tourist map](https://www.mypenang.gov.my/uploads/downloads/Penang-Tourist-Map_EN.pdf), and [Penang Sentral's official site](https://penangsentral.com.my/). These are context sources, not evidence of operator parking locations. The old audit did not establish any off-land point conclusively; its measurable defect was repeated near-identical layouts and insufficient coverage. The new points are representative public-landmark positions, not surveyed dock placements. Exact entrances, access permission and riding suitability are not verified. No synthetic point is claimed as an actual operator station. Source-backed approximate positions remain subject to their existing precision limitation.

## Validation

TypeScript, ESLint and the optimized production build pass. The focused data/API/geography suite passes 59 tests. The full unit suite passes 630 of 633, with the same three pre-existing rail-popup native-anchor contract failures listed in [the original implementation notes](micromobility-multi-operator.md). All 21 LinkBike unit tests pass. The focused browser suite passes all eight checks; the complete active desktop/mobile Playwright suite passes 97 tests with seven existing device-specific skips, zero failures and no retries needed. Browser checks cover inventory values against the API, the disclosure, location provenance, popup/control containment, independent layers and existing transit behavior on desktop and mobile. Final hosted deployment results are recorded in the completion report.

Production baseline: `dpl_Grt4ubTkzzdLwHzw4UhxzGhUwNRa`, `master` commit `5792a10eb51400bc089e4f18e658dbdf7b4ac18c`, Ready / Production / Current, domain `transit-scope-malaysia.vercel.app`. No Production setting, alias, environment or branch is changed.
