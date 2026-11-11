import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { z } from "zod";
import { ClassificationEvidenceArchive, PostgresClassificationEvidenceStore } from "./classification-evidence-store";
import type { ClassificationEvidenceRecord } from "./classification-evidence";
import { ReplayDatabase } from "./preview-evidence-replay-db";
import { ProcessedBusJourneys, type ProcessedBusJourney } from "./processed-bus-journeys";
import { buildTimetable } from "./scheduled-departures";
import type { Record as TransitRecord } from "./transit-data";
import { VehicleProgressHistory } from "./vehicle-progress-history";

export const replayInput = z.object({
  requestId: z.string().uuid(),
  fixtureId: z.enum(["phase-1-6q", "feeder", "penang-early", "penang-delayed"]),
  mode: z.enum(["disabled", "synchronous", "deferred"]),
  fault: z.enum(["none", "rejection", "outage-once", "lost-ack", "duplicate", "concurrent-duplicate", "before-commit", "after-commit"]).default("none"),
}).strict().refine(input => input.mode !== "disabled" || input.fault === "none");

type Input = z.infer<typeof replayInput>;
type Capture = {
  source: string; vehicleId: string; tripId: string;
  table: Omit<Parameters<typeof buildTimetable>[0], "mode"> & { updated: string; maxSeconds: number };
  path: [number, number][]; shapeDistances: number[] | null;
  rounds: { at: string; records: TransitRecord[] }[];
  expectedArchive: [recordId: string, checksum: string][];
};
type JourneyReplay = { source: string; vehicleId: string; rounds: ProcessedBusJourney[][] };
const selections = ["feeder", "penang-early", "penang-delayed"] as const;
const fixtureChecksum = "1880a8b03c3d021366ab85042df0d196417e93f8da83245204647adc3b1fad2b";
const baselineChecksum = "10906d28bcfe3bd5cc227061ff7c3348d635f98a18bae59afd5cc00ad330bf01";

function freezeFixture(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  Object.freeze(value);
  for (const child of Object.values(value)) freezeFixture(child);
}

function load<T>(name: "official-2026-11-08" | "disabled-baseline", limit: number, checksum: string): T {
  const file = join(process.cwd(), "tests", "fixtures", "journey-parity", name + ".json.gz");
  const bytes = gunzipSync(readFileSync(file), { maxOutputLength: limit });
  if (createHash("sha256").update(bytes).digest("hex") !== checksum) throw new Error("Replay fixture checksum mismatch");
  const value: T = JSON.parse(bytes.toString("utf8"));
  freezeFixture(value);
  return value;
}

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
type Trace = {
  candidateId: string; checksum: string; journeyId: string; generatedAt: string | null;
  staged: boolean; admissionAttemptCount: number; rejection: string | null;
  observations: string[];
};
type Manifest = {
  version: 1; fixtureId: Input["fixtureId"]; fixtureChecksum: string; baselineChecksum: string;
  executionMode: Input["mode"]; fault: Input["fault"]; finalTime: number; expectedCandidateCount: number;
  candidates: Pick<Trace, "candidateId" | "checksum" | "journeyId">[];
};
type Journal = {
  fixtureId: Input["fixtureId"]; executionMode: Input["mode"]; fault: Input["fault"];
  journeysProcessed: number; journeyDigest: string | null; matchesBaseline: boolean | null;
  error: "EXECUTION_INTERRUPTED" | null; candidates: Trace[]; finalTime: number;
};

class ReplayAdmissionStore extends PostgresClassificationEvidenceStore {
  private ready?: Promise<boolean>;
  private faultInjected = false;

  constructor(
    query: ConstructorParameters<typeof PostgresClassificationEvidenceStore>[0],
    private readonly fault: Input["fault"],
    private readonly journal: Map<string, Trace>,
    private readonly save: () => Promise<void>,
  ) { super(query); }

  override isReady() { return this.ready ??= super.isReady(); }

  override claim(now?: number, signal?: AbortSignal) {
    return super.claim(now, signal, this.journalScope());
  }

  private journalScope() {
    return [...this.journal.values()].filter(candidate => candidate.staged)
      .map(({ candidateId, checksum }) => ({ candidateId, checksum }));
  }

  override async enqueue(records: readonly ClassificationEvidenceRecord[], now?: number, signal?: AbortSignal) {
    const candidates = records.map(record => {
      const candidate = this.journal.get(record.recordId);
      if (!candidate || candidate.checksum !== record.checksum) throw new Error("Unregistered replay evidence");
      return candidate;
    });
    const fault = this.faultInjected && this.fault === "outage-once" ? "none" : this.fault;
    this.faultInjected = true;
    const note = (event: string) => { for (const candidate of candidates) candidate.observations.push(event); };
    const submit = async (count = 1) => {
      for (const candidate of candidates) candidate.admissionAttemptCount += count;
      note("ADMISSION_PENDING");
      await this.save();
      signal?.throwIfAborted();
    };
    if (fault === "rejection" || fault === "before-commit" || fault === "outage-once") {
      if (fault === "rejection") for (const candidate of candidates) candidate.rejection = "INJECTED_ADMISSION";
      note(fault === "outage-once" ? "INJECTED_OUTAGE" : "INJECTED_BEFORE_COMMIT");
      await submit();
      throw Object.assign(new Error("Injected admission interruption"), { code: "57014" });
    }
    if (fault === "concurrent-duplicate") {
      await submit(2);
      const [first, second] = await Promise.allSettled([super.enqueue(records, now, signal), super.enqueue(records, now, signal)]);
      if (first.status === "rejected") throw first.reason;
      if (second.status === "rejected") throw second.reason;
      return first.value;
    }
    await submit();
    const result = await super.enqueue(records, now, signal);
    if (fault === "duplicate") {
      await submit();
      await super.enqueue(records, now, signal);
    }
    if (fault === "lost-ack" || fault === "after-commit") {
      note(fault === "lost-ack" ? "INJECTED_LOST_ACK" : "INJECTED_AFTER_COMMIT");
      throw new Error("Injected interruption after the outbox transaction returned");
    }
    return result;
  }
}

export async function executeReplay(db: ReplayDatabase, input: Input, retain: (work: () => Promise<void>) => void) {
  const signal = AbortSignal.timeout(35_000);
  const replayRunId = randomUUID();
  const fixture = load<{ cases: Capture[] }>("official-2026-11-08", 3_000_000, fixtureChecksum);
  const baseline = load<JourneyReplay[]>("disabled-baseline", 700_000, baselineChecksum);
  const cases = fixture.cases.map((capture, i) => ({ capture, journeyId: selections[i], baseline: baseline[i] }))
    .filter(item => input.fixtureId === "phase-1-6q" || input.fixtureId === item.journeyId);
  if (fixture.cases.length !== 3 || cases.length === 0) throw new Error("Invalid replay fixture package");
  const candidates = new Map<string, Trace>();
  if (input.mode !== "disabled") for (const { capture, journeyId } of cases) {
    for (const [candidateId, checksum] of capture.expectedArchive) candidates.set(candidateId, {
      candidateId, checksum, journeyId, generatedAt: null, staged: false, admissionAttemptCount: 0,
      rejection: null, observations: [],
    });
  }
  const finalTime = Math.max(...cases.map(item => Date.parse(item.capture.rounds.at(-1)!.at)));
  const report: Journal = {
    fixtureId: input.fixtureId, executionMode: input.mode, fault: input.fault, journeysProcessed: 0,
    journeyDigest: null, matchesBaseline: null, error: null, candidates: [...candidates.values()], finalTime,
  };
  const manifest: Manifest = {
    version: 1, fixtureId: input.fixtureId, fixtureChecksum, baselineChecksum, executionMode: input.mode, fault: input.fault,
    finalTime, expectedCandidateCount: candidates.size,
    candidates: report.candidates.map(({ candidateId, checksum, journeyId }) => ({ candidateId, checksum, journeyId })),
  };
  if (!await db.reserve(replayRunId, input.requestId, manifest, report, signal)) return null;
  let revision = 0;
  const save = (finished = false) => db.save(replayRunId, report, ++revision, finished, signal);
  const store = new ReplayAdmissionStore((statement, args, querySignal) => db.runQuery(replayRunId, statement, args,
    querySignal ? AbortSignal.any([signal, querySignal]) : signal), input.fault, candidates, save);
  const archive = input.mode === "disabled" ? undefined : new ClassificationEvidenceArchive(store, 7, input.mode === "deferred",
    (record, state, reason) => {
      const item = candidates.get(record.recordId);
      if (!item || (state !== "GENERATED" && item.checksum !== record.checksum)) throw new Error("Unexpected replay candidate");
      item.generatedAt ??= new Date(record.generatedAtMs).toISOString();
      if (state === "STAGED") item.staged = true;
      if (reason) item.rejection = reason;
      if (!item.observations.includes(state)) item.observations.push(state);
    });
  const work: Promise<void>[] = [];
  const settle = async () => {
    try {
      if ((await Promise.allSettled(work)).some(item => item.status === "rejected")) report.error = "EXECUTION_INTERRUPTED";
      if (report.error === null && input.fault !== "after-commit") await archive?.flush(finalTime + 2_000);
    } catch {
      report.error = "EXECUTION_INTERRUPTED";
    }
    try {
      await save(true);
      await db.finalize(replayRunId, signal);
    } catch {
      report.error = "EXECUTION_INTERRUPTED";
    }
  };
  const result: JourneyReplay[] = [];
  try {
    for (const { capture } of cases) {
      const history = new VehicleProgressHistory();
      const processor = new ProcessedBusJourneys(history, undefined, archive);
      const timetable = buildTimetable({ ...capture.table, mode: () => "Bus" });
      timetable.updated = capture.table.updated;
      timetable.maxSeconds = capture.table.maxSeconds;
      const paths = new Map([[capture.tripId, capture.path]]);
      const feed = { timetable, tripPaths: paths, progressPaths: paths,
        tripShapeDistances: new Map(capture.shapeDistances ? [[capture.tripId, capture.shapeDistances]] : []) };
      const rounds: ProcessedBusJourney[][] = [];
      result.push({ source: capture.source, vehicleId: capture.vehicleId, rounds });
      for (const frame of capture.rounds) {
        signal.throwIfAborted();
        const now = Date.parse(frame.at);
        const records = history.ingest(capture.source, frame.records, now);
        const journeys = await processor.processWithPersistence(capture.source, records, feed, now, task => { work.push(task); });
        rounds.push(journeys);
      }
    }
    report.journeyDigest = digest(result);
    report.matchesBaseline = report.journeyDigest === digest(cases.map(item => item.baseline));
  } catch {
    report.error = "EXECUTION_INTERRUPTED";
  }
  report.journeysProcessed = result.flatMap(item => item.rounds).flat().length;
  if (input.mode === "deferred") retain(settle);
  else await settle();
  return { replayRunId, journeysProcessed: report.journeysProcessed, journeyDigest: report.journeyDigest,
    matchesBaseline: report.matchesBaseline, error: report.error };
}

export async function recoverReplay(db: ReplayDatabase, id: string) {
  return await db.recover(id) ? reconcileReplay(db, id) : null;
}

export async function reconcileReplay(db: ReplayDatabase, replayRunId: string) {
  const { run, rows } = await db.read(replayRunId);
  if (!run) return null;
  const manifest = run.manifest as Manifest;
  const journal = run.report as Journal;
  const inProgress = !run.finished && !run.expired;
  const candidates = manifest.candidates.map(expected => {
    const trace = journal.candidates.find(candidate => candidate.candidateId === expected.candidateId && candidate.checksum === expected.checksum)
      ?? { ...expected, generatedAt: null, staged: false, admissionAttemptCount: 0, rejection: null, observations: [] };
    const row = rows.find(item => item.id === trace.candidateId);
    const matchingIntent = row?.intentChecksum === trace.checksum;
    const archived = row?.archiveChecksum === trace.checksum;
    const successfulReceipt = archived && row?.intentChecksum === null &&
      (row.receipt === "PERSISTED" || row.receipt === "RECOVERED");
    const committed = matchingIntent || successfulReceipt;
    const terminal = successfulReceipt || (matchingIntent && row?.receipt === "FAILED" && row.archiveChecksum === null);
    const rejected = !row?.receipt && row?.archiveChecksum == null && trace.generatedAt !== null && trace.rejection !== null;
    const failed = terminal && row?.receipt === "FAILED";
    const evidenceConflict = (row?.intentChecksum != null && !matchingIntent) || (row?.archiveChecksum != null && !archived) ||
      (row?.receipt != null && !matchingIntent && !successfulReceipt) ||
      (archived && (!row?.receipt || row.receipt === "FAILED")) ||
      ((committed || archived) && (!trace.staged || trace.generatedAt === null));
    const pending = !evidenceConflict && ((committed && !terminal) || (inProgress && trace.staged && !committed && !rejected));
    const lifecycleState = evidenceConflict ? "UNRESOLVED" : failed ? "FAILED" : terminal ? "TERMINAL" : archived ? "ARCHIVED" : committed ? "COMMITTED" :
      rejected ? "REJECTED" : !inProgress ? "UNRESOLVED" : trace.admissionAttemptCount ? "ADMISSION_PENDING" :
      trace.staged ? "STAGED" : trace.generatedAt ? "GENERATED" : "UNRESOLVED";
    return { ...trace, replayRunId, executionMode: manifest.executionMode, lifecycleState, evidenceConflict, committed, archived,
      terminal: !evidenceConflict && terminal,
      rejected, failed, pending, outboxId: committed ? trace.candidateId : null, archiveId: archived ? trace.candidateId : null,
      terminalReceiptId: terminal && !evidenceConflict ? trace.candidateId : null, receiptState: committed ? row?.receipt : null,
      deliveryAttempts: committed ? row?.deliveryAttempts : null, deliveryError: failed ? row?.deliveryError : null,
      settledAtMs: terminal && !evidenceConflict ? String(row?.settledAtMs ?? "") : null,
      archiveDisposition: successfulReceipt && !evidenceConflict ? row?.archiveDisposition : null };
  });
  const count = (predicate: (item: typeof candidates[number]) => boolean) => candidates.filter(predicate).length;
  const { evidence: _evidence, ...terminalSummary } = (run.terminalSummary ?? {}) as Record<string, unknown>;
  void _evidence;
  return { ...journal, replayRunId, fixtureId: manifest.fixtureId, executionMode: manifest.executionMode,
    manifestVersion: manifest.version, fixtureChecksum: manifest.fixtureChecksum, expectedCandidateCount: manifest.expectedCandidateCount,
    createdAt: run.createdAt, finalizedAt: run.finalizedAt, lastRecoveryAt: run.lastRecoveryAt, recoveryAttempts: run.recoveryAttempts,
    terminalSummary: run.finalizedAt ? terminalSummary : null,
    executionState: run.finished ? "RECORDED" : run.expired ? "INTERRUPTED" : "RUNNING",
    runState: run.cleaned ? "CLEANED" : run.finalizedAt ? "FINISHED" : run.finished ? "RECONCILING" : run.expired ? "EXPIRED" : "RUNNING", candidates,
    counts: { eligibleGenerated: count(item => item.generatedAt !== null), staged: count(item => item.staged),
      admissionAttempts: candidates.reduce((sum, item) => sum + item.admissionAttemptCount, 0),
      committed: count(item => item.committed), archived: count(item => item.archived), terminal: count(item => item.terminal),
      rejected: count(item => item.rejected), failed: count(item => item.failed),
      unresolved: count(item => item.lifecycleState === "UNRESOLVED"), pending: count(item => item.pending) } };
}
