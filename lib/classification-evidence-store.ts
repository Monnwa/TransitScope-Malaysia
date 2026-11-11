import { neon } from "@neondatabase/serverless";
import { randomUUID } from "node:crypto";
import type { BusJourney } from "@/lib/bus-journey";
import type { ValidAdherence } from "@/lib/timetable-adherence";
import {
  captureClassificationEvidence, inspectClassificationEvidence,
  type ClassificationEvidenceRecord, type HistoricalClassification,
} from "@/lib/classification-evidence";

type Row = Record<string, unknown>;
type Query = (statement: string, parameters: unknown[], signal?: AbortSignal) => Promise<Row[]>;
const table = "transit_classification_evidence_v1";
const outbox = "transit_classification_outbox_v1";
const batchBytes = 256_000;
const maxPendingBytes = 4_000_000;
const maxPendingRecords = 2_000;
const deliveryLimit = 64;
const maxAttempts = 6;
const retryDelayMs = 2_000;
const operationBudgetMs = 2_500;
const selectRecord = `
  SELECT entry.record_id AS "recordId", entry.run_stop_id AS "runStopId", entry.payload,
    (SELECT newest.record_id FROM ${table} newest WHERE newest.run_stop_id = entry.run_stop_id
     ORDER BY newest.evaluated_fix_ms DESC, newest.record_id DESC LIMIT 1) AS "latestId"
  FROM ${table} entry`;

class UnsubmittedBatch extends Error {}

function prepareBatch(records: readonly ClassificationEvidenceRecord[], now: number) {
  const byId = new Map<string, ClassificationEvidenceRecord>();
  for (const record of records) {
    const previous = byId.get(record.recordId);
    if (!previous || record.generatedAtMs < previous.generatedAtMs) byId.set(record.recordId, record);
  }
  const unique = [...byId.values()];
  if (unique.some(record => inspectClassificationEvidence(record, now).state !== "VALID_HISTORICAL"))
    throw new UnsubmittedBatch("Classification evidence batch is not admissible");
  const serialized = JSON.stringify(unique);
  if (Buffer.byteLength(serialized) > batchBytes) throw new UnsubmittedBatch("Classification evidence batch exceeds size limit");
  return { unique, serialized };
}

function acknowledgedCount(records: readonly ClassificationEvidenceRecord[], rows: Row[]) {
  const requested = new Set(records.map(record => record.recordId));
  if (rows.some(row => typeof row.recordId !== "string" || !requested.delete(row.recordId)))
    throw new Error("Invalid classification write acknowledgement");
  return rows.length;
}

function serverCancelled(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "57014";
}

function timedOut(error: unknown, signal: AbortSignal): boolean {
  if (signal.aborted || serverCancelled(error)) return true;
  if (!(error instanceof Error)) return false;
  const source = "sourceError" in error ? error.sourceError : error.cause;
  return [error, source].some(cause => cause instanceof Error && ["AbortError", "TimeoutError"].includes(cause.name));
}

type AdmissionOutcome =
  | { state: "COMMITTED"; queued: number; alreadyQueued: number }
  | { state: "NOT_COMMITTED" | "COMMIT_OUTCOME_UNKNOWN"; category: "TIMEOUT" | "DATABASE_ERROR" | "NOT_SUBMITTED" };

export type RetainClassificationAdmission = (work: Promise<void>) => void;
export type ClassificationCaptureTrace = (
  record: ClassificationEvidenceRecord,
  state: "GENERATED" | "STAGED" | "REJECTED",
  reason?: "CAPACITY" | "OVERSIZED",
) => void;

export class PostgresClassificationEvidenceStore {
  private readinessCheck?: Promise<boolean>;

  constructor(private readonly query: Query) {}

  isReady(): Promise<boolean> {
    this.readinessCheck ??= this.checkReadiness().finally(() => { this.readinessCheck = undefined; });
    return this.readinessCheck;
  }

  private async checkReadiness(): Promise<boolean> {
    try {
      const [row] = await this.query(`
        WITH migration AS (
          SELECT to_regclass($1) AS evidence, to_regclass($2) AS outbox,
                 to_regprocedure('transit_deliver_classification_outbox_v1(uuid,bigint)') AS delivery
        )
        SELECT has_table_privilege(evidence, 'SELECT') AND has_table_privilege(evidence, 'INSERT')
           AND has_table_privilege(outbox, 'SELECT') AND has_table_privilege(outbox, 'INSERT')
           AND has_table_privilege(outbox, 'UPDATE') AND has_function_privilege(delivery, 'EXECUTE') AS ready
        FROM migration`, [table, outbox], AbortSignal.timeout(1_500));
      return row?.ready === true;
    } catch {
      return false;
    }
  }

  async append(records: readonly ClassificationEvidenceRecord[], now = Date.now(), signal?: AbortSignal) {
    const { unique, serialized } = prepareBatch(records, now);
    if (!unique.length) return { inserted: 0, alreadyExists: 0 };
    const rows = await this.query(`
      INSERT INTO ${table} (record_id, run_stop_id, evaluated_fix_ms, expires_at_ms, payload)
      SELECT item->>'recordId', item->>'runStopId', (item->>'evaluatedFixMs')::bigint,
             (item->>'expiresAtMs')::bigint, item
      FROM jsonb_array_elements($1::jsonb) AS entries(item)
      ORDER BY item->>'recordId'
      ON CONFLICT (record_id) DO NOTHING
      RETURNING record_id AS "recordId"`, [serialized], signal);
    const inserted = acknowledgedCount(unique, rows);
    return { inserted, alreadyExists: unique.length - inserted };
  }

  async enqueue(records: readonly ClassificationEvidenceRecord[], now = Date.now(), signal?: AbortSignal) {
    if (signal?.aborted) throw new UnsubmittedBatch("Classification evidence batch was cancelled before dispatch");
    const { unique, serialized } = prepareBatch(records, now);
    if (!unique.length) return { queued: 0, alreadyQueued: 0 };
    const rows = await this.query(`
      INSERT INTO ${outbox} (record_id, payload, enqueued_at_ms, expires_at_ms, next_attempt_at_ms)
      SELECT item->>'recordId', item, $2::bigint, (item->>'expiresAtMs')::bigint, $2::bigint
      FROM jsonb_array_elements($1::jsonb) AS entries(item)
      ORDER BY item->>'recordId'
      ON CONFLICT (record_id) DO NOTHING
      RETURNING record_id AS "recordId"`, [serialized, now], signal);
    const queued = acknowledgedCount(unique, rows);
    return { queued, alreadyQueued: unique.length - queued };
  }

  async attemptAdmission(records: readonly ClassificationEvidenceRecord[], now: number, signal: AbortSignal): Promise<AdmissionOutcome> {
    try {
      return { state: "COMMITTED", ...await this.enqueue(records, now, signal) };
    } catch (error) {
      if (error instanceof UnsubmittedBatch) return { state: "NOT_COMMITTED", category: "NOT_SUBMITTED" };
      return {
        state: serverCancelled(error) ? "NOT_COMMITTED" : "COMMIT_OUTCOME_UNKNOWN",
        category: timedOut(error, signal) ? "TIMEOUT" : "DATABASE_ERROR",
      };
    }
  }

  async committedIntents(records: readonly ClassificationEvidenceRecord[], signal: AbortSignal) {
    const ids = records.map(record => record.recordId);
    const rows = await this.query(`SELECT record_id AS "recordId" FROM ${outbox} WHERE record_id = ANY($1::text[])`, [ids], signal);
    acknowledgedCount(records, rows);
    return new Set(rows.map(row => row.recordId as string));
  }

  async claim(now?: number, signal?: AbortSignal, scope?: readonly { candidateId: string; checksum: string }[]) {
    const token = randomUUID();
    // Commit the attempt and its retry deadline before starting delivery.
    const rows = await this.query(`
      WITH clock AS (
        SELECT COALESCE($2::bigint, (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::bigint) AS now_ms
      ), due AS (
        SELECT q.record_id, clock.now_ms,
          CASE WHEN q.expires_at_ms <= clock.now_ms THEN 'EVIDENCE_EXPIRED'
               WHEN q.attempts >= $4::integer THEN 'RETRIES_EXHAUSTED' END AS failure
        FROM ${outbox} q CROSS JOIN clock
        WHERE q.state IN ('PENDING', 'RETRYING') AND q.next_attempt_at_ms <= clock.now_ms
          ${scope ? `AND EXISTS (SELECT 1 FROM jsonb_to_recordset($5::jsonb)
            AS owned("candidateId" text, checksum text)
            WHERE q.record_id = owned."candidateId" AND q.payload->>'checksum' = owned.checksum)` : ""}
        ORDER BY q.next_attempt_at_ms, q.record_id
        LIMIT $3 FOR UPDATE OF q SKIP LOCKED
      )
      UPDATE ${outbox} q
      SET state = CASE WHEN due.failure IS NULL THEN 'RETRYING' ELSE 'FAILED' END,
          attempts = q.attempts + CASE WHEN due.failure IS NULL THEN 1 ELSE 0 END,
          claim_token = CASE WHEN due.failure IS NULL THEN $1::uuid END,
          next_attempt_at_ms = CASE WHEN due.failure IS NULL
            THEN due.now_ms + LEAST(60000, 2000 * (1::bigint << q.attempts)) END,
          settled_at_ms = CASE WHEN due.failure IS NOT NULL THEN due.now_ms END,
          error_kind = due.failure
      FROM due WHERE q.record_id = due.record_id
      RETURNING q.state`, [token, now ?? null, deliveryLimit, maxAttempts, ...(scope ? [JSON.stringify(scope)] : [])], signal);
    if (rows.some(row => row.state !== "RETRYING" && row.state !== "FAILED"))
      throw new Error("Invalid classification outbox claim acknowledgement");
    const claimed = rows.filter(row => row.state === "RETRYING").length;
    return { token, claimed, failed: rows.length - claimed };
  }

  async deliver(token: string, now?: number, signal?: AbortSignal) {
    const rows = await this.query(
      "SELECT * FROM transit_deliver_classification_outbox_v1($1::uuid, $2::bigint)", [token, now ?? null], signal,
    );
    if (rows.some(row => !["PERSISTED", "RECOVERED", "FAILED"].includes(String(row.state)) ||
        typeof row.inserted !== "boolean" || row.state === "FAILED" && row.inserted))
      throw new Error("Invalid classification outbox delivery acknowledgement");
    const persisted = rows.filter(row => row.state === "PERSISTED").length;
    const recovered = rows.filter(row => row.state === "RECOVERED").length;
    const inserted = rows.filter(row => row.inserted).length;
    return { persisted, recovered, inserted, alreadyExists: persisted + recovered - inserted,
      failed: rows.length - persisted - recovered };
  }

  async outboxStatus(recordId: string) {
    try {
      const [row] = await this.query(`
        SELECT state, attempts, next_attempt_at_ms AS "nextAttemptMs",
               settled_at_ms AS "settledAtMs", archive_disposition AS disposition, error_kind AS "errorKind"
        FROM ${outbox} WHERE record_id = $1`, [recordId]);
      if (!row) return { state: "NOT_FOUND" };
      return { state: String(row.state), attempts: Number(row.attempts),
        nextAttemptMs: row.nextAttemptMs == null ? null : Number(row.nextAttemptMs),
        settledAtMs: row.settledAtMs == null ? null : Number(row.settledAtMs),
        disposition: row.disposition, errorKind: row.errorKind };
    } catch {
      return { state: "UNAVAILABLE" };
    }
  }

  async read(recordId: string, now = Date.now()): Promise<HistoricalClassification> {
    try {
      const [row] = await this.query(`${selectRecord} WHERE entry.record_id = $1`, [recordId]);
      return row ? this.inspectRow(row, now) : { state: "NOT_FOUND" };
    } catch {
      return { state: "UNAVAILABLE" };
    }
  }

  async list(runStopId: string, now = Date.now()): Promise<{ state: "AVAILABLE"; records: HistoricalClassification[] } | { state: "UNAVAILABLE" }> {
    try {
      const rows = await this.query(`${selectRecord} WHERE entry.run_stop_id = $1
        ORDER BY entry.evaluated_fix_ms DESC, entry.record_id DESC LIMIT 100`, [runStopId]);
      return { state: "AVAILABLE", records: rows.map(row => this.inspectRow(row, now)) };
    } catch {
      return { state: "UNAVAILABLE" };
    }
  }

  private inspectRow(row: Row, now: number): HistoricalClassification {
    const payload = row.payload;
    if (!payload || typeof payload !== "object" || !("recordId" in payload) || payload.recordId !== row.recordId ||
        !("runStopId" in payload) || payload.runStopId !== row.runStopId || typeof row.latestId !== "string")
      return { state: "INVALID_EVIDENCE" };
    return inspectClassificationEvidence(payload, now, row.latestId === row.recordId ? null : row.latestId);
  }
}

/** Bound the retry buffer until an outbox commit is confirmed. */
export class ClassificationEvidenceArchive {
  private readonly staged = new Map<string, {
    record: ClassificationEvidenceRecord; bytes: number; since: number; unknown: boolean;
  }>();
  private readonly durableIds = new Set<string>();
  private stagedBytes = 0;
  private admissionInFlight?: Promise<void>;
  private deliveryInFlight?: Promise<void>;
  private nextAdmissionMs = 0;
  private nextDeliveryMs = 0;
  private nextIdlePollMs = 0;
  private lastAdmissionOutcome: AdmissionOutcome["state"] | null = null;
  private maxStagingResidenceMs = 0;
  private reportedCaptured = 0;
  private reportedRejections = { rejected: 0, capacityRejected: 0, oversized: 0 };
  private counts = {
    queued: 0, alreadyQueued: 0, persisted: 0, recovered: 0, failed: 0, inserted: 0, alreadyExists: 0,
    enqueueFailures: 0, recoveryFailures: 0, rejected: 0, dropped: 0, expired: 0,
    capacityRejected: 0, oversized: 0, expiredUnconfirmed: 0, admissionCommitted: 0,
    admissionNotCommitted: 0, admissionUnknown: 0, reconciled: 0, admissionBudgetStops: 0,
    captured: 0,
  };

  constructor(
    private readonly store: PostgresClassificationEvidenceStore,
    private readonly retentionDays: number,
    private readonly deferAdmission = false,
    private readonly traceCapture?: ClassificationCaptureTrace,
  ) {}

  isReady(): Promise<boolean> {
    return this.store.isReady();
  }

  async flushWhenReady(): Promise<void> {
    if (await this.isReady()) await this.flush();
  }

  status() {
    const oldest = this.staged.values().next().value;
    const oldestPendingMs = oldest ? performance.now() - oldest.since : 0;
    return {
      ...this.counts, staged: this.staged.size, stagedBytes: this.stagedBytes, oldestPendingMs,
      maxStagingResidenceMs: Math.max(oldestPendingMs, this.maxStagingResidenceMs),
      pendingUnknown: [...this.staged.values()].filter(entry => entry.unknown).length,
      lastAdmissionOutcome: this.lastAdmissionOutcome,
      admissionMode: this.deferAdmission ? "DEFERRED" : "AWAITED",
      candidateOutcomes: {
        pending: this.staged.size,
        committed: this.counts.queued + this.counts.alreadyQueued + this.counts.reconciled,
        rejected: this.counts.rejected + this.counts.dropped,
        unrecoverable: this.counts.expired - this.counts.expiredUnconfirmed,
        expiredCommitUnknown: this.counts.expiredUnconfirmed,
      },
    };
  }

  capture(source: string, journey: BusJourney, directResults: ReadonlySet<ValidAdherence>, generatedAtMs: number) {
    for (const stop of journey.stops) {
      const result = stop.adherence?.result;
      if (!result || !directResults.has(result)) continue;
      const record = captureClassificationEvidence(source, journey, stop, generatedAtMs, this.retentionDays);
      if (!record) { this.counts.rejected++; continue; }
      this.traceCapture?.(record, "GENERATED");
      if (this.durableIds.has(record.recordId) || this.staged.has(record.recordId)) continue;
      const bytes = Buffer.byteLength(JSON.stringify(record)) + 1;
      if (bytes + 2 > batchBytes) {
        this.counts.oversized++;
        this.counts.dropped++;
        this.traceCapture?.(record, "REJECTED", "OVERSIZED");
        continue;
      }
      if (this.staged.size >= maxPendingRecords || this.stagedBytes + bytes > maxPendingBytes) {
        this.counts.capacityRejected++;
        this.counts.dropped++;
        this.traceCapture?.(record, "REJECTED", "CAPACITY");
        continue;
      }
      this.staged.set(record.recordId, { record, bytes, since: performance.now(), unknown: false });
      this.stagedBytes += bytes;
      this.counts.captured++;
      this.traceCapture?.(record, "STAGED");
    }
  }

  finishFeed(now?: number, retain?: RetainClassificationAdmission): Promise<void> | undefined {
    const hasPending = this.staged.size > 0;
    const admission = this.admit(now);
    if (!this.deferAdmission || !retain || !hasPending) return admission;
    try {
      // Register the work with the current request before returning its journey.
      retain(admission);
    } catch {
      console.warn("Classification admission continuation unavailable; waiting for admission");
      return admission;
    }
    if (this.staged.size && this.counts.captured !== this.reportedCaptured) {
      console.info("Classification evidence pending before durable admission", {
        pending: this.staged.size, pendingBytes: this.stagedBytes,
      });
      this.reportedCaptured = this.counts.captured;
    }
  }

  async admit(now?: number): Promise<void> {
    this.reportRejections();
    if (!this.staged.size || (now ?? Date.now()) < this.nextAdmissionMs) return;
    const signal = AbortSignal.timeout(operationBudgetMs);
    while (this.staged.size && !signal.aborted && (now ?? Date.now()) >= this.nextAdmissionMs) {
      if (!this.admissionInFlight) {
        this.admissionInFlight = this.drainAdmission(now, signal).finally(() => { this.admissionInFlight = undefined; });
        return this.admissionInFlight;
      }
      // Another feed can stage records while an admission call is finishing.
      await this.admissionInFlight;
    }
  }

  async flush(now?: number): Promise<void> {
    await this.admit(now);
    if (this.deliveryInFlight) return this.deliveryInFlight;
    if ((now ?? Date.now()) < Math.max(this.nextDeliveryMs, this.nextIdlePollMs)) return;
    this.deliveryInFlight = this.drainDelivery(now, AbortSignal.timeout(operationBudgetMs))
      .finally(() => { this.deliveryInFlight = undefined; });
    return this.deliveryInFlight;
  }

  private reportRejections() {
    const { rejected, capacityRejected, oversized } = this.counts;
    const previous = this.reportedRejections;
    if (rejected === previous.rejected && capacityRejected === previous.capacityRejected && oversized === previous.oversized) return;
    console.warn("Classification evidence admission rejected", {
      invalidEvidence: rejected - previous.rejected, capacity: capacityRejected - previous.capacityRejected,
      oversized: oversized - previous.oversized, pending: this.staged.size, pendingBytes: this.stagedBytes,
    });
    this.reportedRejections = { rejected, capacityRejected, oversized };
  }

  private takeBatch(now: number) {
    const batch: ClassificationEvidenceRecord[] = [];
    let bytes = 2;
    let expired = 0, unconfirmed = 0;
    for (const { record, bytes: size, unknown } of this.staged.values()) {
      if (now >= record.expiresAtMs) {
        this.removeStaged(record.recordId);
        expired++;
        if (unknown) unconfirmed++;
      } else if (bytes + size <= batchBytes) {
        batch.push(record);
        bytes += size;
      } else break;
    }
    this.counts.expired += expired;
    this.counts.expiredUnconfirmed += unconfirmed;
    if (expired) console.warn("Classification evidence expired before confirmed admission", { count: expired, unconfirmed });
    return batch;
  }

  private removeStaged(id: string) {
    const entry = this.staged.get(id);
    if (!entry) return;
    this.stagedBytes -= entry.bytes;
    this.maxStagingResidenceMs = Math.max(this.maxStagingResidenceMs, performance.now() - entry.since);
    this.staged.delete(id);
  }

  private confirmAdmission(id: string) {
    this.removeStaged(id);
    this.durableIds.add(id);
    if (this.durableIds.size > 8_192) this.durableIds.delete(this.durableIds.values().next().value!);
    this.nextIdlePollMs = 0;
  }

  private async drainAdmission(now: number | undefined, signal: AbortSignal) {
    while (!signal.aborted) {
      const current = now ?? Date.now();
      const batch = this.takeBatch(current);
      if (!batch.length) return;
      const outcome = await this.store.attemptAdmission(batch, current, signal);
      this.lastAdmissionOutcome = outcome.state;
      if (outcome.state === "COMMITTED") {
        this.counts.admissionCommitted++;
        this.counts.queued += outcome.queued;
        this.counts.alreadyQueued += outcome.alreadyQueued;
        for (const record of batch) this.confirmAdmission(record.recordId);
        continue;
      }
      this.counts.enqueueFailures++;
      if (outcome.state === "NOT_COMMITTED") this.counts.admissionNotCommitted++;
      else {
        this.counts.admissionUnknown++;
        for (const record of batch) this.staged.get(record.recordId)!.unknown = true;
        // A positive receipt is conclusive. Absence can race a late commit.
        if (!signal.aborted) {
          try {
            const committed = await this.store.committedIntents(batch, signal);
            for (const id of committed) this.confirmAdmission(id);
            this.counts.reconciled += committed.size;
            if (committed.size === batch.length) {
              this.lastAdmissionOutcome = "COMMITTED";
              continue;
            }
          } catch { /* Keep unresolved IDs staged for an idempotent retry. */ }
        }
      }
      this.nextAdmissionMs = (now ?? Date.now()) + retryDelayMs;
      console.warn("Classification evidence admission unconfirmed", { ...outcome, pending: this.staged.size });
      return;
    }
    if (this.staged.size) {
      this.counts.admissionBudgetStops++;
      console.warn("Classification evidence admission budget exhausted", { pending: this.staged.size });
    }
  }

  private async drainDelivery(now: number | undefined, signal: AbortSignal) {
    while (!signal.aborted) {
      const current = now ?? Date.now();
      try {
        const claim = await this.store.claim(now, signal);
        this.counts.failed += claim.failed;
        if (claim.failed) console.warn("Classification outbox intents expired or exhausted", { count: claim.failed });
        if (claim.claimed && !signal.aborted) {
          const result = await this.store.deliver(claim.token, now, signal);
          this.counts.persisted += result.persisted;
          this.counts.recovered += result.recovered;
          this.counts.failed += result.failed;
          if (result.failed) console.warn("Classification outbox delivery rejected", { count: result.failed });
          this.counts.inserted += result.inserted;
          this.counts.alreadyExists += result.alreadyExists;
        }
        if (claim.claimed + claim.failed < deliveryLimit) {
          this.nextIdlePollMs = current + 5_000;
          return;
        }
      } catch (error) {
        this.counts.recoveryFailures++;
        this.nextDeliveryMs = (now ?? Date.now()) + retryDelayMs;
        console.warn("Classification archive operation unconfirmed", { stage: "recovery", category: timedOut(error, signal) ? "TIMEOUT" : "DATABASE_ERROR" });
        return;
      }
    }
  }
}

export function configuredClassificationArchive(env: Record<string, string | undefined> = process.env): ClassificationEvidenceArchive | undefined {
  if (env.VERCEL_ENV === "production" || env.TRANSIT_CLASSIFICATION_ARCHIVE_ENABLED !== "true") return undefined;
  const url = env.TRANSIT_CLASSIFICATION_DATABASE_URL?.trim();
  if (!url) return undefined;
  try {
    const writer = new URL(url);
    if (!["postgresql:", "postgres:"].includes(writer.protocol) || !writer.hostname || !writer.username || writer.pathname.length < 2)
      throw new Error("Invalid archive writer URL");
    const days = Number(env.TRANSIT_CLASSIFICATION_RETENTION_DAYS ?? 7);
    if (!Number.isInteger(days) || days < 1 || days > 30) throw new Error("Invalid archive retention");
    const sql = neon(url);
    const store = new PostgresClassificationEvidenceStore((statement, parameters, signal) => {
      const timeout = AbortSignal.timeout(1_500);
      return sql.query(statement, parameters, { fetchOptions: { signal: signal ? AbortSignal.any([signal, timeout]) : timeout } });
    });
    return new ClassificationEvidenceArchive(store, days, env.TRANSIT_CLASSIFICATION_DEFER_ADMISSION === "1");
  } catch {
    console.warn("Historical classification evidence archive configuration invalid");
    return undefined;
  }
}

export const classificationArchive = configuredClassificationArchive();
