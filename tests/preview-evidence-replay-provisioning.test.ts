// @vitest-environment node
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ReplayDatabase } from "@/lib/preview-evidence-replay-db";
import { handleEvidenceReplay } from "@/lib/preview-evidence-replay-http";

const migrations = ["classification-evidence", "classification-outbox", "classification-replay", "classification-replay-grants"]
  .map(name => readFileSync(new URL(`../database/${name}.sql`, import.meta.url), "utf8"));
const schema = "transit_preview_replay";
const writer = "transit_replay_writer";
const observer = "transit_replay_observer";
const endpoint = "https://preview.example/api/internal/preview/evidence-replay";
const env = {
  VERCEL_ENV: "preview", VERCEL_TARGET_ENV: "preview",
  TRANSIT_CLASSIFICATION_ARCHIVE_ENABLED: "false",
  TRANSIT_PREVIEW_REPLAY_SECRET: "local_provisioning_token_only_0000000000",
  TRANSIT_PREVIEW_REPLAY_DATABASE_URL: "isolated-pglite",
  TRANSIT_PREVIEW_REPLAY_WRITES_ENABLED: "true",
};
const headers = { authorization: `Bearer ${env.TRANSIT_PREVIEW_REPLAY_SECRET}`, "content-type": "application/json" };

describe("isolated replay schema provisioning", () => {
  let pg: PGlite;

  beforeEach(async () => {
    pg = await PGlite.create();
    await pg.exec(`CREATE ROLE ${writer} LOGIN; CREATE ROLE ${observer} LOGIN`);
  }, 20_000);
  afterEach(async () => { await pg?.close(); });

  function install(fail = false) {
    return pg.transaction(async tx => {
      await tx.exec(`CREATE SCHEMA IF NOT EXISTS ${schema}; SET LOCAL search_path TO ${schema}, pg_catalog, pg_temp`);
      for (const migration of migrations) await tx.exec(migration);
      if (fail) await tx.query("SELECT 1/0");
    });
  }

  function asRole(role: typeof writer | typeof observer) {
    return new ReplayDatabase(statements => pg.transaction(async tx => {
      await tx.exec(`SET LOCAL ROLE ${role}`);
      const results = [];
      for (const { sql, args } of statements) results.push((await tx.query<Record<string, unknown>>(sql, args ?? [])).rows);
      return results;
    }));
  }

  function send(db: ReplayDatabase, method: string, id?: string) {
    const url = id ? `${endpoint}?replayRunId=${id}` : endpoint;
    const body = method === "POST"
      ? JSON.stringify({ fixtureId: "feeder", mode: "synchronous", fault: "after-commit", requestId: randomUUID() })
      : undefined;
    return handleEvidenceReplay(new Request(url, { method, headers, body }), env, () => db);
  }

  it("installs and retries the migration with writer admission and observer-only readback", async () => {
    await install();
    const write = asRole(writer);
    const read = asRole(observer);
    const start = await send(write, "POST");
    expect(start.status).toBe(202);
    const { replayRunId } = await start.json();

    await install();
    expect(await read.discover()).toEqual([{ replayRunId }]);
    expect((await read.read(replayRunId)).rows[0].receipt).toBe("PENDING");
    await expect(read.recover(replayRunId)).rejects.toMatchObject({ code: "42501" });
    await expect(read.cleanup(replayRunId)).rejects.toMatchObject({ code: "42501" });
    expect((await send(write, "DELETE", replayRunId)).status).toBe(409);

    const recovered = await send(write, "PATCH", replayRunId);
    expect(recovered.status).toBe(200);
    const report = await recovered.json();
    expect(report.counts).toMatchObject({ committed: 1, archived: 1, terminal: 1 });
    const repeated = await (await send(write, "PATCH", replayRunId)).json();
    expect(repeated.finalizedAt).toBe(report.finalizedAt);
    expect(repeated.recoveryAttempts).toBe(1);
    expect((await send(write, "DELETE", replayRunId)).status).toBe(204);
    expect((await read.read(replayRunId)).run?.cleaned).toBe(true);
  });

  it("upgrades an earlier ledger while preserving legacy records and keeping them ineligible", async () => {
    await pg.exec(migrations[0]);
    await pg.exec(migrations[1]);
    await pg.exec(`CREATE SCHEMA ${schema}; CREATE TABLE ${schema}.replay_runs (
      id uuid PRIMARY KEY, request_id uuid UNIQUE NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      finished_at timestamptz, cleaned_at timestamptz, report jsonb NOT NULL)`);
    const legacyId = randomUUID();
    await pg.query(`INSERT INTO ${schema}.replay_runs (id, request_id, finished_at, cleaned_at, report)
      VALUES ($1, $2, now(), now(), '{"legacy":true}')`, [legacyId, randomUUID()]);
    await install();
    const writerDb = asRole(writer);
    expect((await writerDb.read(legacyId)).run).toBeUndefined();
    expect(await writerDb.recover(legacyId)).toBe(false);
    expect((await pg.query(`SELECT report, manifest FROM ${schema}.replay_runs WHERE id = $1`, [legacyId])).rows)
      .toEqual([{ report: { legacy: true }, manifest: null }]);
    expect((await pg.query(`SELECT has_table_privilege($1, 'public.transit_classification_outbox_v1', 'INSERT') AS access`, [writer])).rows)
      .toEqual([{ access: false }]);
    expect((await send(writerDb, "POST")).status).toBe(202);
  });

  it("denies writer changes to immutable ledger fields and observer data mutations", async () => {
    await install();
    const checks = [
      [writer, `UPDATE ${schema}.replay_runs SET manifest = '{}'::jsonb`],
      [writer, `UPDATE ${schema}.replay_runs SET created_at = clock_timestamp()`],
      [writer, `DELETE FROM ${schema}.replay_runs`],
      [writer, `TRUNCATE ${schema}.transit_classification_outbox_v1`],
      [observer, `UPDATE ${schema}.replay_runs SET report = '{}'::jsonb`],
      [observer, `DELETE FROM ${schema}.transit_classification_evidence_v1`],
    ] as const;
    for (const [role, sql] of checks) {
      await expect(pg.transaction(async tx => {
        await tx.exec(`SET LOCAL ROLE ${role}`);
        await tx.query(sql);
      })).rejects.toMatchObject({ code: "42501" });
    }
  });

  it("rolls back schema and grants after a migration failure and permits a clean retry", async () => {
    await expect(install(true)).rejects.toMatchObject({ code: "22012" });
    expect((await pg.query("SELECT to_regnamespace($1) AS schema", [schema])).rows).toEqual([{ schema: null }]);
    await install();
    expect(await asRole(observer).discover()).toEqual([]);
    expect((await send(asRole(writer), "POST")).status).toBe(202);
  });
});
