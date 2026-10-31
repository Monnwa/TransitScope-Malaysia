# System architecture

```text
Provider adapter (future GTFS / GTFS-RT / GBFS)
                 |
                 v
Common TypeScript record and alert model
                 |
                 v
Filter function -> KPIs, Leaflet markers, Recharts charts, table, detail panel
                 |
                 v
Accessible Next.js App Router interface
```

The current provider is a local deterministic demonstration adapter. It supplies the same dataset to every dashboard surface. Zod defines reusable mode and data-mode schema values. React state controls queries, filters, selected records, map reset and alerts. Leaflet uses OpenStreetMap-compatible tiles. Recharts displays only current record counts and alert severity; the app does not fabricate historical trends.
