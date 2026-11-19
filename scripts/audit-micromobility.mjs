import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// Run the project's TypeScript data modules without adding a script dependency.
const require = createRequire(import.meta.url);
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText, filename);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const stage = process.argv[2];
if (!["before", "after"].includes(stage)) throw new Error("Usage: node scripts/audit-micromobility.mjs before|after");
const target = path.join(root, "docs", `micromobility-audit-${stage}.json`);
if (stage === "before" && fs.existsSync(target)) throw new Error("The original audit is immutable; do not overwrite it.");
const { micromobilitySnapshot } = require(path.join(root, "lib/micromobility-data.ts"));
const { auditStationDistances } = require(path.join(root, "lib/micromobility-geography.ts"));
const all = micromobilitySnapshot().stations;
const stations = all.filter(station => station.operator !== "LINKBIKE");
const audit = auditStationDistances(stations, all);
const rows = stations.map((station, index) => ({ ...station, ...audit.rows[index] }));
const result = { stage, baselineCommit: "447dc59e2c38a030a59e7a2c342d8a442e9c8e6b", units: "metres", method: "Haversine, mean Earth radius 6371008.8 m",
  scope: "48 new-operator stations; nearest cross-operator distances also consider the 27 unchanged LinkBike locations", summary: audit.summary, rows,
  closePairs: audit.pairs.filter(pair => pair.distanceMetres < 300) };
fs.writeFileSync(target, JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify({ file: path.relative(root, target), ...audit.summary }));
