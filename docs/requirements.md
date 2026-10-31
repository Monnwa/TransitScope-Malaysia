# TransitScope Malaysia requirements

## User context

Daily commuters need a quick way to locate a service and understand its freshness. University students may compare modes or find shared bicycles. Transport observers need source and availability information. The interface supports desktop, tablet and mobile use in noisy, time-constrained settings. Users may vary in technical familiarity and may use keyboards or assistive technology. The assumed preference for a unified dashboard requires validation through the planned usability study.

## Functional requirements

| ID | Requirement | Priority | User justification | Implementation evidence |
| --- | --- | --- | --- | --- |
| FR1 | Search vehicles, routes and stations. | High | Find a known service quickly. | Global search input filters all views. |
| FR2 | Filter services by mode. | High | Compare or isolate a travel option. | Mode buttons update map, KPIs, chart and table. |
| FR3 | Filter records by supported status. | Medium | Avoid unavailable services. | Status filter controls. |
| FR4 | Display locations on an interactive map. | High | Understand a service location. | Leaflet map with selectable markers. |
| FR5 | Display available record details. | High | Assess the selected service. | Detail panel with explicit unavailable values. |
| FR6 | Display alerts and affected services. | High | Investigate disruption context. | Alert panel and detail dialog. |
| FR7 | Present charts and tables. | Medium | Scan coverage and audit individual records. | Recharts charts and accessible table. |
| FR8 | Restore the default view. | Medium | Recover from accidental filtering. | Reset dashboard control. |

## Usability requirements

| ID | Requirement | Support for users |
| --- | --- | --- |
| UR1 | Responsive desktop, tablet and mobile interface. | Supports commute-time device changes. |
| UR2 | Consistent labels and navigation. | Reduces learning effort. |
| UR3 | Readable text and contrast. | Supports quick scanning and low vision. |
| UR4 | Immediate, understandable feedback. | Confirms filtering and selection. |
| UR5 | Error prevention and recovery. | Empty state offers reset action. |
| UR6 | Keyboard accessibility. | Supports keyboard-only use. |
| UR7 | Clear freshness and source attribution. | Prevents a demo record being mistaken for live data. |
