import { neon } from "@neondatabase/serverless";
import { randomUUID } from "node:crypto";

type Row = Record<string, unknown>;
type Statement = { sql: string; args?: unknown[] };
export type ReplayTransaction = (statements: Statement[], signal?: AbortSignal) => Promise<Row[][]>;

export function neonReplayTransaction(url: string): ReplayTransaction {
  const sql = neon(url);
  return (statements, signal) => {
    const timeout = AbortSignal.timeout(1_500);
    return sql.transaction(statements.map(item => sql.query(item.sql, item.args ?? [])), {
      fetchOptions: { signal: signal ? AbortSignal.any([signal, timeout]) : timeout },
    });
  };
}

const schema = { sql: "SET LOCAL search_path TO pg_catalog, transit_preview_replay, pg_temp" };
const outbox = "transit_classification_outbox_v1";
const archive = "transit_classification_evidence_v1";

export class ReplayDatabase {
  constructor(private readonly transaction: ReplayTransaction) {}

  async reserve(id: string, requestId: string, manifest: unknown, report: unknown, signal: AbortSignal) {
    const [, rows] = await this.transaction([schema, {
      sql: `INSERT INTO replay_runs (id, request_id, manifest, report)
        SELECT $1, $2, $3::jsonb, $4::jsonb WHERE NOT EXISTS (SELECT 1 FROM ${outbox})
          AND NOT EXISTS (SELECT 1 FROM ${archive})
        ON CONFLICT DO NOTHING RETURNING id`,
      args: [id, requestId, JSON.stringify(manifest), JSON.stringify(report)],
    }], signal);
    return rows.length === 1;
  }

  async runQuery(id: string, sql: string, args: unknown[], signal?: AbortSignal) {
    const [, , rows] = await this.transaction([schema, {
      sql: "SELECT lock_replay($1::uuid, false)", args: [id],
    }, { sql, args }], signal);
    return rows;
  }

  async save(id: string, report: unknown, revision: number, finished: boolean, signal: AbortSignal) {
    await this.runQuery(id, `UPDATE replay_runs SET report = $2::jsonb, journal_revision = $4,
      finished_at = CASE WHEN $3 THEN clock_timestamp() ELSE NULL END WHERE id = $1 AND journal_revision < $4`,
    [id, JSON.stringify(report), finished, revision], signal);
  }

  async finalize(id: string, signal: AbortSignal) {
    await this.transaction([schema, { sql: "SELECT finish_replay($1::uuid)", args: [id] }], signal);
  }

  async recover(id: string) {
    const [, [row]] = await this.transaction([schema, {
      sql: "SELECT recover_replay($1::uuid, $2::uuid) AS accepted", args: [id, randomUUID()],
    }], AbortSignal.timeout(5_000));
    return row?.accepted === true;
  }

  async discover(requestId?: string) {
    const [, rows] = await this.transaction([schema, {
      sql: `SELECT id AS "replayRunId" FROM replay_runs WHERE manifest IS NOT NULL AND (
        ($1::uuid IS NOT NULL AND request_id = $1) OR ($1 IS NULL AND cleaned_at IS NULL AND finalized_at IS NULL
        AND (finished_at IS NOT NULL OR created_at <= clock_timestamp() - interval '90 seconds'))
      ) LIMIT 1`, args: [requestId ?? null],
    }]);
    return rows;
  }

  async read(id: string) {
    const [, [run]] = await this.transaction([schema, {
      sql: `SELECT report, manifest, created_at AS "createdAt", finalized_at AS "finalizedAt",
        last_recovery_at AS "lastRecoveryAt", recovery_attempts AS "recoveryAttempts",
        terminal_summary AS "terminalSummary", finished_at IS NOT NULL AS finished, cleaned_at IS NOT NULL AS cleaned,
        created_at <= clock_timestamp() - interval '90 seconds' AS expired,
        CASE WHEN cleaned_at IS NOT NULL THEN terminal_summary->'evidence' ELSE COALESCE((SELECT jsonb_agg(evidence) FROM (
          SELECT ids."candidateId" AS id, q.state AS receipt, q.attempts AS "deliveryAttempts",
            q.error_kind AS "deliveryError", q.payload->>'checksum' AS "intentChecksum",
            a.payload->>'checksum' AS "archiveChecksum", q.settled_at_ms AS "settledAtMs",
            q.archive_disposition AS "archiveDisposition"
          FROM jsonb_to_recordset(r.manifest->'candidates') AS ids("candidateId" text)
          LEFT JOIN ${outbox} q ON q.record_id = ids."candidateId"
          LEFT JOIN ${archive} a ON a.record_id = ids."candidateId"
        ) evidence), '[]'::jsonb) END AS evidence
        FROM replay_runs r WHERE id = $1 AND manifest IS NOT NULL`, args: [id],
    }]);
    return { run, rows: (run?.evidence ?? []) as Row[] };
  }

  async cleanup(id: string) {
    const [, rows] = await this.transaction([schema, {
      sql: `WITH run AS MATERIALIZED (
          SELECT id, manifest, terminal_summary FROM replay_runs WHERE id = $1 AND cleaned_at IS NULL
            AND finalized_at IS NOT NULL
          FOR UPDATE
        ), owned AS (
          SELECT ids."candidateId", ids.checksum FROM run
            CROSS JOIN LATERAL jsonb_to_recordset(run.manifest->'candidates') AS ids("candidateId" text, checksum text)
        ), eligible AS MATERIALIZED (
          SELECT id FROM run WHERE terminal_summary = replay_terminal_summary(id) AND NOT EXISTS (
            SELECT 1 FROM ${outbox} WHERE state IN ('PENDING', 'RETRYING')
          ) AND NOT EXISTS (
            SELECT 1 FROM ${archive} a WHERE NOT EXISTS (
              SELECT 1 FROM owned o WHERE a.record_id = o."candidateId" AND a.payload->>'checksum' = o.checksum
            )
          ) AND NOT EXISTS (
            SELECT 1 FROM ${outbox} q WHERE NOT EXISTS (
              SELECT 1 FROM owned o WHERE q.record_id = o."candidateId" AND (
                q.payload->>'checksum' = o.checksum OR
                (q.state IN ('PERSISTED', 'RECOVERED') AND q.payload IS NULL AND EXISTS (
                  SELECT 1 FROM ${archive} a WHERE a.record_id = o."candidateId" AND a.payload->>'checksum' = o.checksum
                ))
              )
            )
          )
        ), deleted_archive AS (
          DELETE FROM ${archive} a USING owned o
          WHERE a.record_id = o."candidateId" AND a.payload->>'checksum' = o.checksum
            AND EXISTS (SELECT 1 FROM eligible)
          RETURNING a.record_id
        ), deleted_outbox AS (
          DELETE FROM ${outbox} q USING owned o WHERE q.record_id = o."candidateId"
            AND EXISTS (SELECT 1 FROM eligible)
            AND (q.payload->>'checksum' = o.checksum OR
              (q.state IN ('PERSISTED', 'RECOVERED') AND q.payload IS NULL
                AND q.record_id IN (SELECT record_id FROM deleted_archive)))
        )
        UPDATE replay_runs r SET cleaned_at = clock_timestamp() FROM eligible WHERE r.id = eligible.id RETURNING r.id`, args: [id],
    }]);
    return rows.length === 1;
  }
}
