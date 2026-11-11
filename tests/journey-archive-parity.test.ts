// @vitest-environment node
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ClassificationEvidenceArchive, PostgresClassificationEvidenceStore, configuredClassificationArchive,
} from "@/lib/classification-evidence-store";
import type { PassageEvidence } from "@/lib/gps-passage";
import { ProcessedBusJourneys, type ProcessedBusJourney } from "@/lib/processed-bus-journeys";
import { buildTimetable } from "@/lib/scheduled-departures";
import type { Record as TransitRecord } from "@/lib/transit-data";
import { VehicleProgressHistory } from "@/lib/vehicle-progress-history";

type Capture = {
  source: string;
  vehicleId: string;
  tripId: string;
  table: Omit<Parameters<typeof buildTimetable>[0], "mode"> & { updated: string; maxSeconds: number };
  path: [number, number][];
  shapeDistances: number[] | null;
  rounds: { round: number; at: string; records: TransitRecord[] }[];
  crossingHistoryBeforeFinal: PassageEvidence[];
  expectedArchive: [recordId: string, checksum: string][];
};
type Replay = { source: string; vehicleId: string; rounds: ProcessedBusJourney[][] }[];

function loadFixture<T>(name: string): T {
  const file = new URL(`./fixtures/journey-parity/${name}.json.gz`, import.meta.url);
  return JSON.parse(gunzipSync(readFileSync(file)).toString("utf8")) as T;
}

function deepFreeze(value: unknown): void {
  if (!value || typeof value !== "object") return;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
}

const fixture = loadFixture<{ cases: Capture[] }>("official-2026-11-08");
const baseline = loadFixture<Replay>("disabled-baseline");
const originalFixture = JSON.stringify(fixture);
deepFreeze(fixture);
deepFreeze(baseline);

const expectedArchive = fixture.cases.flatMap(capture => capture.expectedArchive)
  .map(([recordId, checksum]) => ({ recordId, checksum }));
const finalTime = Math.max(...fixture.cases.map(capture => Date.parse(capture.rounds.at(-1)!.at)));
const migrations = ["classification-evidence", "classification-outbox"].map(name =>
  readFileSync(new URL(`../database/${name}.sql`, import.meta.url), "utf8"));

async function replay(archive: ClassificationEvidenceArchive | undefined) {
  const result: Replay = [];
  let retainedAdmissions = 0;
  for (const capture of fixture.cases) {
    const history = new VehicleProgressHistory();
    const processor = new ProcessedBusJourneys(history, undefined, archive);
    const timetable = buildTimetable({ ...capture.table, mode: () => "Bus" });
    timetable.updated = capture.table.updated;
    timetable.maxSeconds = capture.table.maxSeconds;
    const paths = new Map([[capture.tripId, capture.path]]);
    const feed = {
      timetable, tripPaths: paths, progressPaths: paths,
      tripShapeDistances: new Map(capture.shapeDistances ? [[capture.tripId, capture.shapeDistances]] : []),
    };
    const rounds: ProcessedBusJourney[][] = [];
    for (const [index, frame] of capture.rounds.entries()) {
      if (index === capture.rounds.length - 1) {
        const crossings = history.get(capture.source, capture.vehicleId)?.previous?.passages;
        expect(JSON.parse(JSON.stringify(crossings))).toStrictEqual(capture.crossingHistoryBeforeFinal);
      }
      const time = Date.parse(frame.at);
      const records = history.ingest(capture.source, frame.records, time);
      const retained: Promise<void>[] = [];
      const journeys = await processor.processWithPersistence(capture.source, records, feed, time,
        work => { retained.push(work); });
      const atResponse = structuredClone(journeys);
      await Promise.all(retained);
      expect(journeys).toStrictEqual(atResponse);
      retainedAdmissions += retained.length;
      rounds.push(journeys);
    }
    result.push({ source: capture.source, vehicleId: capture.vehicleId, rounds });
  }
  return { result, retainedAdmissions };
}

async function runArchive(deferred: boolean, failAdmission = false) {
  const db = await PGlite.create();
  try {
    for (const migration of migrations) await db.exec(migration);
    let insertAttempts = 0;
    const store = new PostgresClassificationEvidenceStore(async (statement, parameters) => {
      if (statement.includes("INSERT INTO transit_classification_outbox_v1")) {
        insertAttempts++;
        if (failAdmission) throw Object.assign(new Error("Fixture admission cancelled"), { code: "57014" });
      }
      return (await db.query(statement, parameters)).rows as Record<string, unknown>[];
    });
    const archive = new ClassificationEvidenceArchive(store, 7, deferred);
    expect(archive.status().admissionMode).toBe(deferred ? "DEFERRED" : "AWAITED");
    const run = await replay(archive);
    const atResponse = structuredClone(run.result);
    const { rows: intents } = await db.query(`SELECT record_id AS "recordId", state, payload->>'checksum' AS checksum
      FROM transit_classification_outbox_v1`);
    expect(insertAttempts).toBeGreaterThan(0);
    if (failAdmission) {
      expect(intents).toEqual([]);
      expect(archive.status().candidateOutcomes).toMatchObject({ committed: 0 });
      expect(archive.status().staged).toBeGreaterThan(0);
      expect(archive.status().admissionNotCommitted).toBeGreaterThan(0);
    } else {
      expect(intents).toHaveLength(expectedArchive.length);
      expect(intents).toEqual(expect.arrayContaining(expectedArchive.map(entry => ({ ...entry, state: "PENDING" }))));
      await archive.flush(finalTime);
      const { rows: delivered } = await db.query(`SELECT a.record_id AS "recordId", a.payload->>'checksum' AS checksum, q.state
        FROM transit_classification_evidence_v1 a JOIN transit_classification_outbox_v1 q USING (record_id)`);
      expect(delivered).toHaveLength(expectedArchive.length);
      expect(delivered).toEqual(expect.arrayContaining(expectedArchive.map(entry => ({ ...entry, state: "PERSISTED" }))));
    }
    expect(run.result).toStrictEqual(atResponse);
    if (deferred) expect(run.retainedAdmissions).toBeGreaterThan(0);
    else expect(run.retainedAdmissions).toBe(0);
    return run.result;
  } finally {
    await db.close();
  }
}

const disabledArchive = () => configuredClassificationArchive({
  TRANSIT_CLASSIFICATION_ARCHIVE_ENABLED: "false",
  TRANSIT_CLASSIFICATION_DATABASE_URL: "postgresql://user:password@disabled.example/test",
  TRANSIT_CLASSIFICATION_DEFER_ADMISSION: "0",
});

describe("deterministic journey parity with captured official feed evidence", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Replay must run offline"); }));
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    try {
      expect(fetch).not.toHaveBeenCalled();
      expect(JSON.stringify(fixture)).toBe(originalFixture);
    } finally {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  });

  it("repeats the full disabled baseline with immutable inputs", async () => {
    const first = await replay(disabledArchive());
    const second = await replay(disabledArchive());
    expect(first.retainedAdmissions).toBe(0);
    expect(second).toStrictEqual(first);
    expect(JSON.parse(JSON.stringify(first.result))).toStrictEqual(baseline);
  });

  it("returns identical complete journeys across concurrent disabled, awaited and deferred runs", async () => {
    const results = await Promise.allSettled([replay(disabledArchive()), runArchive(false), runArchive(true)] as const);
    for (const result of results) if (result.status === "rejected") throw result.reason;
    const [disabled, awaited, deferred] = results.map(result => result.status === "fulfilled" ? result.value : undefined);
    const complete = (disabled as Awaited<ReturnType<typeof replay>>).result;
    expect(awaited).toStrictEqual(complete);
    expect(deferred).toStrictEqual(complete);
    expect(JSON.parse(JSON.stringify(complete))).toStrictEqual(baseline);
  }, 30_000);

  it.each([false, true])("preserves journeys when PostgreSQL rejects admission (deferred %s)", async deferred => {
    const disabled = await replay(disabledArchive());
    expect(await runArchive(deferred, true)).toStrictEqual(disabled.result);
    expect(JSON.parse(JSON.stringify(disabled.result))).toStrictEqual(baseline);
  }, 30_000);
});
