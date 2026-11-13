// @vitest-environment node
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { captureClassificationEvidence, inspectClassificationEvidence } from "@/lib/classification-evidence";
import { ClassificationEvidenceArchive, PostgresClassificationEvidenceStore, configuredClassificationArchive } from "@/lib/classification-evidence-store";
import { ProcessedBusJourneys } from "@/lib/processed-bus-journeys";
import { applyJourneyAdherence, assessStopAdherence } from "@/lib/timetable-adherence";
import { VehicleProgressHistory } from "@/lib/vehicle-progress-history";
import { adherenceFixture, adherencePoint } from "@/tests/fixtures/adherence";

const table = "transit_classification_evidence_v1";
const outbox = "transit_classification_outbox_v1";
const source = "rapid-bus-kl";
const writerUrl = "postgresql://user:password@disabled.example/test";
const storeFor = (db: PGlite) => new PostgresClassificationEvidenceStore(async (statement, parameters) =>
  (await db.query(statement, parameters)).rows as Record<string, unknown>[]);

function accepted() {
  const fixture = adherenceFixture();
  const stop = fixture.journey.stops[2];
  const record = captureClassificationEvidence(source, fixture.journey, stop, fixture.now, 7);
  if (!record) throw new Error("Expected a directly classified fixture");
  return { ...fixture, stop, record };
}

describe("archive activation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it.each([undefined, "false", "", "1", "TRUE", " true ", "unexpected"])(
    "fails closed for flag %s even with a writer and Deferred Admission",
    flag => {
      expect(configuredClassificationArchive({
        TRANSIT_CLASSIFICATION_ARCHIVE_ENABLED: flag,
        TRANSIT_CLASSIFICATION_DATABASE_URL: writerUrl,
        TRANSIT_CLASSIFICATION_DEFER_ADMISSION: "1",
      })).toBeUndefined();
    },
  );

  it.each([undefined, "  ", "invalid", "https://disabled.example/test", "postgresql://disabled.example/test"])(
    "requires a valid writer URL when enabled (%s)", url => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      expect(configuredClassificationArchive({
        TRANSIT_CLASSIFICATION_ARCHIVE_ENABLED: "true",
        TRANSIT_CLASSIFICATION_DATABASE_URL: url,
      })).toBeUndefined();
    },
  );

  it.each([[undefined, "AWAITED"], ["0", "AWAITED"], ["1", "DEFERRED"]] as const)(
    "selects the admission mode independently when enabled (%s)",
    (defer, mode) => {
      expect(configuredClassificationArchive({
        VERCEL_ENV: "preview",
        TRANSIT_CLASSIFICATION_ARCHIVE_ENABLED: "true",
        TRANSIT_CLASSIFICATION_DATABASE_URL: writerUrl,
        TRANSIT_CLASSIFICATION_DEFER_ADMISSION: defer,
      })?.status().admissionMode).toBe(mode);
    },
  );

  it("defaults off and blocks Production even with explicit opt-in and a writer", () => {
    expect(configuredClassificationArchive({})).toBeUndefined();
    expect(configuredClassificationArchive({
      VERCEL_ENV: "production",
      TRANSIT_CLASSIFICATION_ARCHIVE_ENABLED: "true",
      TRANSIT_CLASSIFICATION_DATABASE_URL: writerUrl,
      TRANSIT_CLASSIFICATION_DEFER_ADMISSION: "1",
    })).toBeUndefined();
  });

  it("uses the flag of the initialized server environment", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("TRANSIT_CLASSIFICATION_DATABASE_URL", writerUrl);
    vi.stubEnv("TRANSIT_CLASSIFICATION_RETENTION_DAYS", "7");
    vi.stubEnv("TRANSIT_CLASSIFICATION_ARCHIVE_ENABLED", undefined);
    vi.resetModules();
    const build = await import("@/lib/classification-evidence-store");
    expect(build.classificationArchive).toBeUndefined();

    vi.stubEnv("TRANSIT_CLASSIFICATION_ARCHIVE_ENABLED", "true");
    vi.resetModules();
    const runtime = await import("@/lib/classification-evidence-store");
    expect(runtime.classificationArchive).toBeDefined();
  });
});

describe("immutable historical classification archive", () => {
  let directory: string;
  let db: PGlite;
  let store: PostgresClassificationEvidenceStore;

  beforeAll(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "transitscope-classification-"));
    db = await PGlite.create(directory);
    await db.exec(await readFile(path.join(process.cwd(), "database/classification-evidence.sql"), "utf8"));
    await db.exec(await readFile(path.join(process.cwd(), "database/classification-outbox.sql"), "utf8"));
    store = storeFor(db);
  }, 20_000);

  afterEach(async () => {
    vi.restoreAllMocks();
    await db.exec(`DROP TRIGGER IF EXISTS test_outbox_ack_failure ON ${outbox}; TRUNCATE ${table}, ${outbox}`);
  });

  afterAll(async () => {
    if (db) await db.close();
    if (!directory) return;
    const resolved = await realpath(directory);
    if (path.dirname(resolved) !== await realpath(tmpdir()) || !path.basename(resolved).startsWith("transitscope-classification-"))
      throw new Error("Unexpected PostgreSQL test directory");
    await rm(resolved, { recursive: true, force: true });
  });

  it("snapshots the original accepted proof and reads it after the live tracking buffer disappears", async () => {
    const { journey, stop, now, record } = accepted();
    expect(record).toMatchObject({
      vehicleId: journey.vehicle.id, tripId: "t", stopId: stop.id, stopSequence: stop.sequence,
      generatedAtMs: now, scheduledDeparture: stop.departure,
      classification: "ON_TIME", toleranceSeconds: 120,
      proof: { pair: stop.adherence!.result!.evidence },
    });
    expect(await store.append([record], now)).toEqual({ inserted: 1, alreadyExists: 0 });
    journey.tracking!.passages = [];
    expect(assessStopAdherence(journey, stop, now).result).toBeNull();
    expect(captureClassificationEvidence(source, journey, stop, now, 7)).toBeNull();
    expect(await store.read(record.recordId, now + 2 * 3_600_000)).toEqual({
      state: "VALID_HISTORICAL", record, supersededBy: null,
    });
  });

  it("survives database reopen and deduplicates the same original crossing across generations and concurrent calls", async () => {
    const { journey, now, stop, record } = accepted();
    const results = await Promise.all([
      store.append([record, record], now),
      storeFor(db).append([record], now),
    ]);
    expect(results.reduce((total, result) => total + result.inserted, 0)).toBe(1);
    await db.close();
    db = await PGlite.create(directory);
    store = storeFor(db);

    journey.retrievedAt = new Date(now + 1_000).toISOString();
    const pair = stop.adherence!.result!.evidence;
    pair.confirmedAt = new Date(pair.to.timestamp).toISOString();
    const duplicate = captureClassificationEvidence(source, journey, stop, now + 1_000, 7)!;
    expect(duplicate.generatedAtMs).not.toBe(record.generatedAtMs);
    expect(duplicate.recordId).toBe(record.recordId);
    expect(await store.append([duplicate], now + 1_000)).toEqual({ inserted: 0, alreadyExists: 1 });
    expect(await store.read(record.recordId, now + 1_000)).toMatchObject({ record: { generatedAtMs: now, proof: record.proof } });
  }, 20_000);

  it("keeps distinct valid versions and orders out-of-order writes by the measured fix", async () => {
    const { journey, now, stop, record } = accepted();
    stop.departure = new Date(Date.parse(stop.departure!) + 60_000).toISOString();
    journey.retrievedAt = new Date(now + 30_000).toISOString();
    journey.tracking!.vehicleTimestamp = journey.retrievedAt;
    applyJourneyAdherence(journey, now + 30_000);
    const newer = captureClassificationEvidence(source, journey, journey.stops[2], now + 30_000, 7)!;
    expect(newer.runStopId).toBe(record.runStopId);
    expect(newer.recordId).not.toBe(record.recordId);
    await store.append([newer], now + 30_000);
    await store.append([record], now + 30_000);
    expect(await store.list(record.runStopId, now + 30_000)).toEqual({
      state: "AVAILABLE", records: [
        { state: "VALID_HISTORICAL", record: newer, supersededBy: null },
        { state: "SUPERSEDED", record, supersededBy: newer.recordId },
      ],
    });
  });

  it("expires proof under the archive policy and rejects an expired retry", async () => {
    const { now, record } = accepted();
    await store.append([record], now);
    const expired = await store.read(record.recordId, record.expiresAtMs);
    expect(expired).toMatchObject({ state: "EXPIRED_EVIDENCE", summary: { recordId: record.recordId } });
    expect(expired).not.toHaveProperty("summary.proof");
    await expect(store.append([record], record.expiresAtMs)).rejects.toThrow("not admissible");
  });

  it("distinguishes missing proof from corrupt proof and never overwrites either on a retry", async () => {
    const { now, record } = accepted();
    await store.append([record], now);
    await db.query(`UPDATE ${table} SET payload = payload - 'proof' WHERE record_id = $1`, [record.recordId]);
    expect(await store.read(record.recordId, now)).toEqual({ state: "UNREPRODUCIBLE" });
    expect(await store.append([record], now)).toEqual({ inserted: 0, alreadyExists: 1 });
    expect(await store.read(record.recordId, now)).toEqual({ state: "UNREPRODUCIBLE" });
    expect(inspectClassificationEvidence({ ...record, deviationSeconds: record.deviationSeconds + 1 }, now))
      .toEqual({ state: "INVALID_EVIDENCE" });
    expect(await store.read("f".repeat(64), now)).toEqual({ state: "NOT_FOUND" });
  });

  it("requires the normal fresh, exact and confirmed crossing assessment before archiving", () => {
    const { journey, stop, now } = accepted();
    stop.classification = "ESTIMATED";
    expect(captureClassificationEvidence(source, journey, stop, now, 7)).toBeNull();
    stop.classification = "SCHEDULED";
    journey.tracking!.vehicleTimestamp = new Date(now - 120_001).toISOString();
    expect(captureClassificationEvidence(source, journey, stop, now, 7)).toBeNull();
  });

  it.each(["0", "1"])("skips staging and SQL with a writer configured and archive disabled (defer %s)", async defer => {
    const capture = vi.spyOn(ClassificationEvidenceArchive.prototype, "capture");
    const request = vi.spyOn(globalThis, "fetch");
    const { now, path, table, fixes, bus, record } = accepted();
    const archive = configuredClassificationArchive({
      TRANSIT_CLASSIFICATION_ARCHIVE_ENABLED: "false",
      TRANSIT_CLASSIFICATION_DATABASE_URL: writerUrl,
      TRANSIT_CLASSIFICATION_DEFER_ADMISSION: defer,
    });
    const history = new VehicleProgressHistory();
    for (const fix of fixes) history.ingest(source, [{
      ...bus, position: fix.position, observation: { ...bus.observation, positionTimestamp: new Date(fix.timestamp).toISOString() },
    }], fix.timestamp);
    const feed = { timetable: table, tripPaths: new Map([["t", path]]),
      progressPaths: new Map([["t", path]]), tripShapeDistances: new Map() };
    const retain = vi.fn();
    const result = await new ProcessedBusJourneys(history, archive)
      .processWithArchive(source, history.ingest(source, [bus], now), feed, now, retain);
    expect(result[0].journey?.stops[2].adherence?.result).toBeTruthy();
    expect(capture).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
    expect(retain).not.toHaveBeenCalled();
    expect(await store.outboxStatus(record.recordId)).toEqual({ state: "NOT_FOUND" });
  });

  it("keeps journeys available and skips staging and writes when a migration is missing", async () => {
    const { now, path, table, fixes, bus } = accepted();
    const query = vi.fn(async (statement: string, parameters: unknown[]) =>
      (await db.query(statement, parameters)).rows as Record<string, unknown>[]);
    const archive = new ClassificationEvidenceArchive(new PostgresClassificationEvidenceStore(query), 7, true);
    const history = new VehicleProgressHistory();
    for (const fix of fixes) history.ingest(source, [{
      ...bus, position: fix.position, observation: { ...bus.observation, positionTimestamp: new Date(fix.timestamp).toISOString() },
    }], fix.timestamp);
    const records = history.ingest(source, [bus], now);
    const feed = { timetable: table, tripPaths: new Map([["t", path]]),
      progressPaths: new Map([["t", path]]), tripShapeDistances: new Map() };
    const expected = new ProcessedBusJourneys(history).process(source, records, feed, now);
    await db.exec("ALTER FUNCTION transit_deliver_classification_outbox_v1(uuid,bigint) RENAME TO withheld_delivery");
    try {
      const retain = vi.fn();
      const result = await new ProcessedBusJourneys(history, archive)
        .processWithArchive(source, records, feed, now, retain);
      expect(result).toEqual(expected);
      expect(result[0].journey?.stops[2].adherence?.result).toBeTruthy();
      await archive.flushWhenReady();
      expect(archive.status()).toMatchObject({ captured: 0, staged: 0, queued: 0 });
      expect(retain).not.toHaveBeenCalled();
      expect(query).toHaveBeenCalledTimes(2);
      expect(query.mock.calls.every(([statement]) => statement.trimStart().startsWith("WITH migration AS"))).toBe(true);
    } finally {
      await db.exec("ALTER FUNCTION withheld_delivery(uuid,bigint) RENAME TO transit_deliver_classification_outbox_v1");
    }
    expect(await archive.isReady()).toBe(true);
  });

  it("requires a database connection and writer privileges for readiness", async () => {
    const unavailable = new PostgresClassificationEvidenceStore(async () => { throw new Error("Unavailable"); });
    expect(await unavailable.isReady()).toBe(false);

    await db.exec(`CREATE ROLE archive_read_only; GRANT SELECT ON ${table}, ${outbox} TO archive_read_only; SET ROLE archive_read_only`);
    try {
      expect(await store.isReady()).toBe(false);
    } finally {
      await db.exec(`RESET ROLE; REVOKE SELECT ON ${table}, ${outbox} FROM archive_read_only; DROP ROLE archive_read_only`);
    }
    expect(await store.isReady()).toBe(true);
  });

  it("keeps a failed handoff explicitly staged until PostgreSQL acknowledges the intent", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { journey, stop, now, record } = accepted();
    let failed = true;
    const unreliable = new PostgresClassificationEvidenceStore(async (statement, parameters) => {
      if (failed) throw new Error("Datastore unavailable");
      return (await db.query(statement, parameters)).rows as Record<string, unknown>[];
    });
    const archive = new ClassificationEvidenceArchive(unreliable, 7);
    archive.capture(source, journey, new Set([stop.adherence!.result!]), now);
    await archive.flush(now);
    expect(archive.status()).toMatchObject({ staged: 1, queued: 0, inserted: 0, enqueueFailures: 1 });
    expect(await store.read(record.recordId, now)).toEqual({ state: "NOT_FOUND" });
    expect(await store.outboxStatus(record.recordId)).toEqual({ state: "NOT_FOUND" });
    expect(await unreliable.read(record.recordId, now)).toEqual({ state: "UNAVAILABLE" });
    failed = false;
    await archive.flush(now + 1_000);
    expect(archive.status().staged).toBe(1);
    await archive.flush(now + 2_000);
    expect(archive.status()).toMatchObject({ staged: 0, queued: 1, inserted: 1, enqueueFailures: 1 });
    expect(await store.read(record.recordId, now + 2_000)).toMatchObject({ record });
  });

  it.each([
    { mode: "default", deferred: false, scheduler: true, early: false },
    { mode: "retained deferred", deferred: true, scheduler: true, early: true },
    { mode: "deferred without scheduler", deferred: true, scheduler: false, early: false },
  ])("uses the $mode admission boundary and keeps archive delivery separate", async ({ deferred, scheduler, early }) => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const { now, path, table, fixes, bus, record } = accepted();
    let release!: () => void, started!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const dispatched = new Promise<void>(resolve => { started = resolve; });
    const delayedStore = new PostgresClassificationEvidenceStore(async (statement, parameters) => {
      if (statement.includes("INSERT INTO " + outbox)) {
        started();
        await blocked;
      }
      return (await db.query(statement, parameters)).rows as Record<string, unknown>[];
    });
    const archive = new ClassificationEvidenceArchive(delayedStore, 7, deferred);
    const history = new VehicleProgressHistory();
    for (const fix of fixes) history.ingest(source, [{
      ...bus, position: fix.position, observation: { ...bus.observation, positionTimestamp: new Date(fix.timestamp).toISOString() },
    }], fix.timestamp);
    const processor = new ProcessedBusJourneys(history, archive);
    const feed = { timetable: table, tripPaths: new Map([["t", path]]),
      progressPaths: new Map([["t", path]]), tripShapeDistances: new Map() };
    let returned = false;
    const retained: Promise<void>[] = [];
    const results = processor.processWithArchive(source, history.ingest(source, [bus], now), feed, now,
      scheduler ? work => { retained.push(work); } : undefined)
      .then(value => { returned = true; return value; });
    try {
      await Promise.race([dispatched, results]);
      await new Promise<void>(resolve => { setImmediate(resolve); });
      expect(returned).toBe(early);
      expect(retained).toHaveLength(early ? 1 : 0);
      expect(archive.status().candidateOutcomes).toMatchObject({ pending: expect.any(Number), committed: 0 });
      expect(archive.status().candidateOutcomes.pending).toBeGreaterThan(0);
      expect(await store.list(record.runStopId, now)).toEqual({ state: "AVAILABLE", records: [] });
    } finally {
      release();
    }
    expect((await results)[0].journey?.stops[2].adherence?.result).toBeTruthy();
    await Promise.all(retained);
    expect(archive.status()).toMatchObject({ lastAdmissionOutcome: "COMMITTED", staged: 0, inserted: 0 });
    const { rows: pending } = await db.query<{ count: number }>(`SELECT count(*)::int AS count FROM ${outbox} WHERE state = 'PENDING'`);
    expect(pending[0].count).toBeGreaterThan(0);
    expect(await store.list(record.runStopId, now)).toEqual({ state: "AVAILABLE", records: [] });
    await new ClassificationEvidenceArchive(store, 7).flush(now);
    expect((await store.list(record.runStopId, now)).state).toBe("AVAILABLE");
  });

  it("reports expiry without counting a candidate as durably committed", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { journey, stop, now, record } = accepted();
    const archive = new ClassificationEvidenceArchive(store, 7, true);
    archive.capture(source, journey, new Set([stop.adherence!.result!]), now);
    await archive.admit(record.expiresAtMs);
    expect(archive.status().candidateOutcomes).toEqual({
      pending: 0, committed: 0, rejected: 0, unrecoverable: 1, expiredCommitUnknown: 0,
    });
    expect(warn).toHaveBeenCalledWith("Classification evidence expired before confirmed admission", { count: 1, unconfirmed: 0 });
    expect(await store.outboxStatus(record.recordId)).toEqual({ state: "NOT_FOUND" });
  });

  it("coalesces concurrent deferred handoffs for the same candidate", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const { journey, stop, now, record } = accepted();
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    let writes = 0;
    const delayed = new PostgresClassificationEvidenceStore(async (statement, parameters) => {
      if (statement.includes("INSERT INTO " + outbox)) {
        writes++;
        await blocked;
      }
      return (await db.query(statement, parameters)).rows as Record<string, unknown>[];
    });
    const archive = new ClassificationEvidenceArchive(delayed, 7, true);
    const work: Promise<void>[] = [];
    const retain = (task: Promise<void>) => { work.push(task); };
    try {
      for (let i = 0; i < 2; i++) {
        archive.capture(source, journey, new Set([stop.adherence!.result!]), now);
        expect(archive.finishFeed(now, retain)).toBeUndefined();
      }
      expect(work).toHaveLength(2);
      expect(writes).toBe(1);
      expect(info).toHaveBeenCalledOnce();
      expect(archive.status().candidateOutcomes).toMatchObject({ pending: 1, committed: 0 });
    } finally {
      release();
      await Promise.all(work);
    }
    expect(archive.status().candidateOutcomes).toMatchObject({ pending: 0, committed: 1 });
    await archive.flush(now);
    expect(await store.read(record.recordId, now)).toMatchObject({ record });
    expect(await store.outboxStatus(record.recordId)).toMatchObject({ state: "PERSISTED", attempts: 1 });
  });

  it("reconciles a committed enqueue whose response was lost and leaves the original lifecycle intact", async () => {
    const { journey, stop, now, record } = accepted();
    let writes = 0;
    const lossy = new PostgresClassificationEvidenceStore(async (statement, parameters) => {
      const response = await db.query(statement, parameters);
      if (statement.includes("INSERT INTO " + outbox)) {
        writes++;
        throw Object.assign(new Error("Neon response unavailable"), { sourceError: new DOMException("Lost response", "TimeoutError") });
      }
      return response.rows as Record<string, unknown>[];
    });
    const archive = new ClassificationEvidenceArchive(lossy, 7);
    archive.capture(source, journey, new Set([stop.adherence!.result!]), now);
    await archive.admit(now);
    expect(archive.status()).toMatchObject({
      admissionUnknown: 1, reconciled: 1, pendingUnknown: 0, staged: 0, lastAdmissionOutcome: "COMMITTED",
    });
    expect(writes).toBe(1);
    await new ClassificationEvidenceArchive(store, 7).flush(now);
    const receipt = await store.outboxStatus(record.recordId);
    expect(receipt).toMatchObject({ state: "PERSISTED", attempts: 1 });
    for (let i = 0; i < 3; i++) expect(await store.enqueue([record], now)).toEqual({ queued: 0, alreadyQueued: 1 });
    expect(await store.outboxStatus(record.recordId)).toEqual(receipt);
    expect(await store.read(record.recordId, now)).toMatchObject({ record });
  });

  it("treats absent receipts after an uncertain write as unknown and reconciles the same ID on retry", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { journey, stop, now, record } = accepted();
    const attempted: string[] = [];
    let first = true;
    const unreliable = new PostgresClassificationEvidenceStore(async (statement, parameters) => {
      if (statement.includes("INSERT INTO " + outbox)) {
        attempted.push(JSON.parse(parameters[0] as string)[0].recordId);
        if (first) {
          first = false;
          throw Object.assign(new Error("Network request failed"), { sourceError: new DOMException("Timed out", "TimeoutError") });
        }
      }
      return (await db.query(statement, parameters)).rows as Record<string, unknown>[];
    });
    const archive = new ClassificationEvidenceArchive(unreliable, 7);
    archive.capture(source, journey, new Set([stop.adherence!.result!]), now);
    await archive.admit(now);
    expect(archive.status()).toMatchObject({ pendingUnknown: 1, lastAdmissionOutcome: "COMMIT_OUTCOME_UNKNOWN" });
    expect(warn).toHaveBeenCalledWith("Classification evidence admission unconfirmed",
      expect.objectContaining({ state: "COMMIT_OUTCOME_UNKNOWN", category: "TIMEOUT" }));
    // The first write commits after the initial reconciliation read.
    expect(await store.enqueue([record], now)).toMatchObject({ queued: 1 });
    await archive.admit(now + 2_000);
    expect(attempted).toEqual([record.recordId, record.recordId]);
    expect(archive.status()).toMatchObject({ staged: 0, alreadyQueued: 1, lastAdmissionOutcome: "COMMITTED" });
  });

  it("reports confirmed non-commit separately for a cancellation before dispatch and a server cancellation", async () => {
    const { now, record } = accepted();
    const query = vi.fn(async () => { throw Object.assign(new Error("PostgreSQL cancelled statement"), { code: "57014" }); });
    const cancelled = new PostgresClassificationEvidenceStore(query);
    expect(await cancelled.attemptAdmission([record], now, AbortSignal.abort()))
      .toEqual({ state: "NOT_COMMITTED", category: "NOT_SUBMITTED" });
    expect(query).not.toHaveBeenCalled();
    expect(await cancelled.attemptAdmission([record], now, new AbortController().signal))
      .toEqual({ state: "NOT_COMMITTED", category: "TIMEOUT" });
    expect(query).toHaveBeenCalledOnce();
  });

  it("resolves a lost commit acknowledgement idempotently without counting a second insert", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { journey, stop, now, record } = accepted();
    let first = true;
    const unreliable = new PostgresClassificationEvidenceStore(async (statement, parameters) => {
      const response = await db.query(statement, parameters);
      if (first && statement.includes("SELECT * FROM transit_deliver_classification_outbox_v1")) {
        first = false;
        throw new Error("Commit acknowledgement lost");
      }
      return response.rows as Record<string, unknown>[];
    });
    const archive = new ClassificationEvidenceArchive(unreliable, 7);
    archive.capture(source, journey, new Set([stop.adherence!.result!]), now);
    await archive.flush(now);
    expect(archive.status()).toMatchObject({ queued: 1, inserted: 0, staged: 0, recoveryFailures: 1 });
    expect(await store.outboxStatus(record.recordId)).toMatchObject({ state: "PERSISTED", disposition: "INSERTED" });
    await new ClassificationEvidenceArchive(store, 7).flush(now + 2_000);
    expect(await store.list(record.runStopId, now + 2_000)).toEqual({
      state: "AVAILABLE", records: [{ state: "VALID_HISTORICAL", record, supersededBy: null }],
    });
  });

  it("recovers a committed pending intent after reopening the database with an empty runtime buffer", async () => {
    const { now, record } = accepted();
    expect(await store.enqueue([record, record], now)).toEqual({ queued: 1, alreadyQueued: 0 });
    expect(await store.outboxStatus(record.recordId)).toMatchObject({ state: "PENDING", attempts: 0 });
    expect(await store.read(record.recordId, now)).toEqual({ state: "NOT_FOUND" });
    await db.close();
    db = await PGlite.create(directory);
    store = storeFor(db);
    const restarted = new ClassificationEvidenceArchive(store, 7);
    await restarted.flush(now);
    expect(restarted.status()).toMatchObject({ staged: 0, queued: 0, persisted: 1, inserted: 1 });
    expect(await store.read(record.recordId, now)).toMatchObject({ state: "VALID_HISTORICAL", record });
  }, 20_000);

  it("fences expired claims and recovers on the next due attempt with the original proof", async () => {
    const { now, record } = accepted();
    await store.enqueue([record], now);
    const claims = await Promise.all([store.claim(now), storeFor(db).claim(now)]);
    const original = claims.find(claim => claim.claimed === 1)!;
    expect(claims.reduce((sum, claim) => sum + claim.claimed, 0)).toBe(1);
    expect(await store.claim(now + 1_999)).toMatchObject({ claimed: 0 });
    const replacement = await store.claim(now + 2_000);
    expect(replacement.claimed).toBe(1);
    expect(await store.deliver(original.token, now + 2_000)).toMatchObject({ inserted: 0, persisted: 0, recovered: 0 });
    expect(await store.deliver(replacement.token, now + 2_000)).toMatchObject({ inserted: 1, recovered: 1 });
    expect(await store.read(record.recordId, now + 2_000)).toMatchObject({ record });
  });

  it("rolls back an insert when its acknowledgement fails and commits the healthy peer", async () => {
    const { journey, now, record } = accepted();
    const peer = captureClassificationEvidence(source, journey, journey.stops[1], now, 7)!;
    await store.enqueue([record, peer], now);
    await db.exec(`
      CREATE OR REPLACE FUNCTION test_reject_outbox_ack() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.record_id = '${record.recordId}' AND NEW.state IN ('PERSISTED', 'RECOVERED') THEN
          RETURN NULL;
        END IF;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER test_outbox_ack_failure BEFORE UPDATE ON ${outbox}
      FOR EACH ROW EXECUTE FUNCTION test_reject_outbox_ack();
    `);
    const claim = await store.claim(now);
    expect(await store.deliver(claim.token, now)).toMatchObject({ inserted: 1, persisted: 1, failed: 1 });
    expect(await store.read(record.recordId, now)).toEqual({ state: "NOT_FOUND" });
    expect(await store.outboxStatus(record.recordId)).toMatchObject({ state: "FAILED", errorKind: "ARCHIVE_REJECTED" });
    expect(await store.read(peer.recordId, now)).toMatchObject({ record: peer });
  });

  it("caps exponential retries and retains an explicitly failed intent at exhaustion", async () => {
    const { now, record } = accepted();
    await store.enqueue([record], now);
    await db.exec(`
      CREATE OR REPLACE FUNCTION test_reject_outbox_ack() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.state IN ('PERSISTED', 'RECOVERED') THEN
          RAISE insufficient_privilege;
        END IF;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER test_outbox_ack_failure BEFORE UPDATE ON ${outbox}
      FOR EACH ROW EXECUTE FUNCTION test_reject_outbox_ack();
    `);
    let current = now;
    for (const [index, delay] of [2_000, 4_000, 8_000, 16_000, 32_000, 60_000].entries()) {
      const claim = await store.claim(current);
      expect(claim.claimed).toBe(1);
      await expect(store.deliver(claim.token, current)).rejects.toMatchObject({ code: "42501" });
      expect(await store.read(record.recordId, current)).toEqual({ state: "NOT_FOUND" });
      expect(await store.outboxStatus(record.recordId)).toMatchObject({
        state: "RETRYING", attempts: index + 1, nextAttemptMs: current + delay,
      });
      current += delay;
    }
    expect(await store.claim(current)).toMatchObject({ claimed: 0, failed: 1 });
    expect(await store.outboxStatus(record.recordId)).toMatchObject({ state: "FAILED", errorKind: "RETRIES_EXHAUSTED" });
    expect(await store.enqueue([record], current)).toEqual({ queued: 0, alreadyQueued: 1 });
    expect(await store.read(record.recordId, current)).toEqual({ state: "NOT_FOUND" });
  });

  it("acknowledges an existing Phase 1.6A record without replacing any stored fields", async () => {
    const { record, now } = accepted();
    await store.append([record], now);
    await store.enqueue([record], now);
    const claim = await store.claim(now);
    expect(await store.deliver(claim.token, now)).toMatchObject({ inserted: 0, alreadyExists: 1, persisted: 1 });
    expect(await store.read(record.recordId, now)).toMatchObject({ record });
    expect(await store.outboxStatus(record.recordId)).toMatchObject({ state: "PERSISTED", disposition: "ALREADY_EXISTS" });
  });

  it("captures directly classified fleet stops while leaving returned journeys identical with out-of-order GPS", async () => {
    const fixture = adherenceFixture();
    const archive = new ClassificationEvidenceArchive(store, 7);
    const history = new VehicleProgressHistory(), reference = new VehicleProgressHistory();
    const archivedProcessor = new ProcessedBusJourneys(history, archive);
    const existingProcessor = new ProcessedBusJourneys(reference);
    const feed = {
      timetable: fixture.table, tripPaths: new Map([["t", fixture.path]]),
      progressPaths: new Map([["t", fixture.path]]), tripShapeDistances: new Map(),
    };
    for (const [metres, ago, receivedAfter] of [[90, 120], [200, 90], [600, 60], [900, 30], [1100, 0], [900, 30, 1], [1100, 0, 2]]) {
      const measured = fixture.now - ago * 1_000;
      const now = receivedAfter ? fixture.now + receivedAfter * 1_000 : measured;
      const record = {
        ...fixture.bus, position: adherencePoint(metres), reportedAt: new Date(measured).toISOString(),
        observation: { ...fixture.bus.observation, positionTimestamp: new Date(measured).toISOString() },
      };
      const actual = await archivedProcessor.processWithArchive(source, history.ingest(source, [record], now), feed, now);
      expect(actual).toEqual(existingProcessor.process(source, reference.ingest(source, [record], now), feed, now));
      await archive.flush(now);
    }
    expect(archive.status()).toMatchObject({ inserted: 3, enqueueFailures: 0, recoveryFailures: 0, staged: 0 });
  });
});
