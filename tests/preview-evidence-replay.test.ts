// @vitest-environment node
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ReplayDatabase, type ReplayTransaction } from "@/lib/preview-evidence-replay-db";
import { handleEvidenceReplay } from "@/lib/preview-evidence-replay-http";
import { GET as getTransit } from "@/app/api/transit/route";
import { NextRequest } from "next/server";

const endpoint = "https://preview.example/api/internal/preview/evidence-replay";
const env = {
  VERCEL_ENV: "preview", VERCEL_TARGET_ENV: "preview", TRANSIT_PREVIEW_REPLAY_SECRET: "local_test_token_only_0000000000000000",
  TRANSIT_PREVIEW_REPLAY_DATABASE_URL: "local-replay-test", TRANSIT_PREVIEW_REPLAY_WRITES_ENABLED: "true",
};
const fixture = { fixtureId: "feeder", mode: "disabled" };
const headers = { authorization: `Bearer ${env.TRANSIT_PREVIEW_REPLAY_SECRET}`, "content-type": "application/json" };

function post(body: Record<string, unknown> = fixture) {
  return new Request(endpoint, { method: "POST", headers, body: JSON.stringify({ requestId: randomUUID(), ...body }) });
}

describe("protected replay validation", () => {
  it.each(["production", "development", "", "PREVIEW", undefined])("rejects environment %s before access", async environment => {
    const connect = vi.fn();
    const result = await handleEvidenceReplay(post(), { ...env, VERCEL_ENV: environment }, connect);
    expect(result.status).toBe(404);
    expect(connect).not.toHaveBeenCalled();
  });

  it.each(["production", "development", "custom", undefined])("rejects ambiguous target %s on every replay operation", async target => {
    const connect = vi.fn();
    const retain = vi.fn();
    for (const method of ["POST", "GET", "PATCH", "DELETE", "HEAD", "OPTIONS"]) {
      const req = method === "POST" ? post() : new Request(`${endpoint}?replayRunId=${randomUUID()}`, { method, headers });
      const result = await handleEvidenceReplay(req, { ...env, VERCEL_TARGET_ENV: target }, connect, retain);
      expect(result.status).toBe(404);
    }
    expect(connect).not.toHaveBeenCalled();
    expect(retain).not.toHaveBeenCalled();
  });

  it("requires a configured token and rejects a wrong token of the correct length", async () => {
    const connect = vi.fn();
    const valid = env.TRANSIT_PREVIEW_REPLAY_SECRET;
    const wrong = new Request(endpoint, { headers: { authorization: `Bearer ${"x".repeat(valid.length)}` } });
    expect((await handleEvidenceReplay(wrong, env, connect)).status).toBe(401);
    for (const secret of [undefined, "short", "x".repeat(129)]) {
      expect((await handleEvidenceReplay(post(), { ...env, TRANSIT_PREVIEW_REPLAY_SECRET: secret }, connect)).status).toBe(404);
    }
    expect(connect).not.toHaveBeenCalled();
  });

  it("rejects caller-supplied database and configuration fields before storage or task registration", async () => {
    const connect = vi.fn();
    const retain = vi.fn();
    for (const extra of [{ databaseUrl: "disallowed" }, { sql: "disallowed" }, { env: { VERCEL_ENV: "preview" } },
      { executable: "disallowed" }, { path: "disallowed" }]) {
      expect((await handleEvidenceReplay(post(extra), env, connect, retain)).status).toBe(400);
    }
    const url = `${endpoint}?replayRunId=${randomUUID()}&databaseUrl=disallowed`;
    expect((await handleEvidenceReplay(new Request(url, { method: "DELETE", headers }), env, connect, retain)).status).toBe(400);
    expect((await handleEvidenceReplay(new Request(`${endpoint}?replayRunId=invalid`, { method: "DELETE", headers }), env, connect, retain)).status).toBe(400);
    expect(connect).not.toHaveBeenCalled();
    expect(retain).not.toHaveBeenCalled();
  });

  it("uses only replay storage and does not disclose connection errors or read normal archive credentials", async () => {
    const connectionError = "private connection detail";
    const connect = vi.fn(() => { throw new Error(connectionError); });
    const warn = vi.spyOn(console, "warn");
    const error = vi.spyOn(console, "error");
    try {
      const result = await handleEvidenceReplay(post(), {
        ...env, get TRANSIT_CLASSIFICATION_DATABASE_URL(): string { throw new Error("Normal archive credentials accessed"); },
      }, connect);
      expect(result.status).toBe(503);
      expect(await result.json()).toEqual({ error: "Replay operation unavailable" });
      expect(result.headers.get("cache-control")).toBe("no-store");
      expect(connect).toHaveBeenCalledExactlyOnceWith(env.TRANSIT_PREVIEW_REPLAY_DATABASE_URL);
      expect(warn).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      error.mockRestore();
    }
  });

  it("ignores replay inputs on the normal transit demo route", async () => {
    const res = await getTransit(new NextRequest(`https://preview.example/api/transit?mode=demo&fixtureId=feeder&replayRunId=${randomUUID()}&fault=lost-ack`, { headers }));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.demo).toBe(true);
    expect(data).not.toHaveProperty("replayRunId");
    expect(data).not.toHaveProperty("candidates");
  });

  it("gates discovery and recovery before storage access", async () => {
    const connect = vi.fn();
    for (const query of ["recoverable=1", `requestId=${randomUUID()}`]) {
      const url = `${endpoint}?${query}`;
      const blocked = await handleEvidenceReplay(new Request(url, { headers }),
        { ...env, VERCEL_ENV: "production", VERCEL_TARGET_ENV: "production" }, connect);
      expect(blocked.status).toBe(404);
      expect((await handleEvidenceReplay(new Request(url), env, connect)).status).toBe(401);
    }
    const url = `${endpoint}?replayRunId=${randomUUID()}`;
    expect((await handleEvidenceReplay(new Request(url, { method: "PATCH", headers }),
      { ...env, TRANSIT_PREVIEW_REPLAY_WRITES_ENABLED: "false" }, connect)).status).toBe(403);
    expect(connect).not.toHaveBeenCalled();
  });

  it("requires the independent token and validates method, format, fixture, mode and size", async () => {
    const connect = vi.fn();
    const check = (request: Request) => handleEvidenceReplay(request, env, connect);
    expect((await check(new Request(endpoint))).status).toBe(401);
    expect((await check(new Request(endpoint, { headers: { authorization: "Bearer wrong" } }))).status).toBe(401);
    expect((await check(new Request(endpoint, { method: "PUT", headers }))).status).toBe(405);
    expect((await check(new Request(endpoint, { method: "POST", headers: { ...headers, "content-type": "text/plain" }, body: "{}" }))).status).toBe(415);
    expect((await check(post({ ...fixture, fixtureId: "../../anything" }))).status).toBe(400);
    expect((await check(post({ ...fixture, mode: "live" }))).status).toBe(400);
    expect((await check(post({ ...fixture, fault: "lost-ack" }))).status).toBe(400);
    expect((await check(post({ ...fixture, sql: "x".repeat(1_050) }))).status).toBe(413);
    expect((await handleEvidenceReplay(post({ ...fixture, mode: "synchronous" }), { ...env, TRANSIT_PREVIEW_REPLAY_WRITES_ENABLED: "false" }, connect)).status).toBe(403);
    expect((await handleEvidenceReplay(post(), { ...env, TRANSIT_CLASSIFICATION_ARCHIVE_ENABLED: "true" }, connect)).status).toBe(404);
    expect(connect).not.toHaveBeenCalled();
  });
});

describe("replay and PostgreSQL reconciliation", () => {
  let pg: PGlite;
  let db: ReplayDatabase;
  let holdInsert: Promise<void> | undefined;
  let onInsert: (() => void) | undefined;
  const migrations = ["classification-evidence", "classification-outbox", "classification-replay"];
  const pending: (() => Promise<void>)[] = [];
  const send = (request: Request) => handleEvidenceReplay(request, env, () => db, work => { pending.push(work); });
  const byId = (id: string, method = "GET") => send(new Request(`${endpoint}?replayRunId=${id}`, { method, headers }));
  const lookup = (query: string) => send(new Request(`${endpoint}?${query}`, { headers }));
  const transact: ReplayTransaction = statements => pg.transaction(async tx => {
    const results = [];
    for (const statement of statements) results.push((await tx.query(statement.sql, statement.args ?? [])).rows as Record<string, unknown>[]);
    return results;
  });

  beforeAll(async () => {
    pg = await PGlite.create();
    await pg.exec("CREATE SCHEMA transit_preview_replay; SET search_path TO transit_preview_replay, pg_catalog");
    for (const name of migrations) await pg.exec(readFileSync(new URL(`../database/${name}.sql`, import.meta.url), "utf8"));
    db = new ReplayDatabase(async statements => {
      if (holdInsert && statements.some(item => item.sql.includes("INSERT INTO transit_classification_outbox_v1"))) {
        onInsert?.();
        await holdInsert;
      }
      return transact(statements);
    });
  }, 20_000);

  afterAll(async () => { await pg?.close(); });

  async function start(input: Record<string, unknown>) {
    const response = await send(post(input));
    const result = await response.json();
    expect(response.status, JSON.stringify(result)).toBe(202);
    expect(result.error).toBeNull();
    expect(result.matchesBaseline).toBe(true);
    return result;
  }

  async function clean(id: string) {
    expect((await byId(id, "DELETE")).status).toBe(204);
    expect((await (await byId(id)).json()).runState).toBe("CLEANED");
  }

  const expire = (id: string) => pg.query("UPDATE replay_runs SET created_at = clock_timestamp() - interval '91 seconds' WHERE id = $1", [id]);
  const resetReplayTables = () => pg.exec(`TRUNCATE transit_preview_replay.replay_runs,
    transit_preview_replay.transit_classification_outbox_v1, transit_preview_replay.transit_classification_evidence_v1`);

  it("replays one journey offline, reserves one run and rejects repeat request IDs", async () => {
    const requestId = randomUUID();
    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Replay must stay offline"));
    try {
      const first = await start({ ...fixture, requestId });
      expect(first.journeysProcessed).toBe(7);
      expect((await send(post())).status).toBe(409);
      expect((await byId(first.replayRunId, "DELETE")).status).toBe(204);
      expect((await send(post({ ...fixture, requestId }))).status).toBe(409);
      const next = await start(fixture);
      expect(next.replayRunId).not.toBe(first.replayRunId);
      expect(next.journeyDigest).toBe(first.journeyDigest);
      expect((await (await byId(next.replayRunId)).json()).counts).toMatchObject({ eligibleGenerated: 0, committed: 0 });
      await clean(next.replayRunId);
      expect(fetch).not.toHaveBeenCalled();
    } finally { fetch.mockRestore(); }
  });

  it("reconciles the full 21 journeys in both modes with stable evidence IDs", async () => {
    const awaited = await start({ fixtureId: "phase-1-6q", mode: "synchronous" });
    expect(awaited.journeysProcessed).toBe(21);
    const first = await (await byId(awaited.replayRunId)).json();
    expect(first.runState).toBe("FINISHED");
    expect(first.counts).toEqual({ eligibleGenerated: 4, staged: 4, admissionAttempts: 4, committed: 4,
      archived: 4, terminal: 4, rejected: 0, failed: 0, unresolved: 0, pending: 0 });
    expect(first.candidates.every((row: { lifecycleState: string }) => row.lifecycleState === "TERMINAL")).toBe(true);
    await clean(awaited.replayRunId);
    const deferred = await start({ fixtureId: "phase-1-6q", mode: "deferred" });
    expect(deferred.journeyDigest).toBe(awaited.journeyDigest);
    expect((await byId(deferred.replayRunId, "DELETE")).status).toBe(409);
    expect((await (await byId(deferred.replayRunId)).json()).runState).toBe("RUNNING");
    expect(pending).toHaveLength(1);
    await pending.shift()!();
    const second = await (await byId(deferred.replayRunId)).json();
    expect(second.counts).toEqual(first.counts);
    expect(second.candidates.map((row: { candidateId: string }) => row.candidateId))
      .toEqual(first.candidates.map((row: { candidateId: string }) => row.candidateId));
    await clean(deferred.replayRunId);
  }, 25_000);

  it("returns the deferred journey before commit and reports the in-flight candidate as pending", async () => {
    let release!: () => void;
    holdInsert = new Promise<void>(resolve => { release = resolve; });
    const attempted = new Promise<void>(resolve => { onInsert = resolve; });
    let id: string | undefined;
    try {
      const result = await start({ fixtureId: "feeder", mode: "deferred" });
      id = result.replayRunId;
      await attempted;
      const active = await (await byId(result.replayRunId)).json();
      expect(active.counts).toMatchObject({ staged: 1, admissionAttempts: 1, pending: 1, committed: 0, archived: 0, terminal: 0 });
      expect(active.candidates[0].lifecycleState).toBe("ADMISSION_PENDING");
    } finally {
      release();
      holdInsert = undefined;
      onInsert = undefined;
      await pending.shift()?.();
    }
    expect(id).toBeDefined();
    const finished = await (await byId(id!)).json();
    expect(finished.counts).toMatchObject({ pending: 0, committed: 1, archived: 1, terminal: 1 });
    await clean(id!);
  });

  it.each(["duplicate", "concurrent-duplicate", "lost-ack", "outage-once", "rejection", "before-commit", "after-commit"])(
    "reconciles the %s hook from actual rows", async fault => {
      const run = await start({ fixtureId: "feeder", mode: "synchronous", fault });
      const result = await (await byId(run.replayRunId)).json();
      const [candidate] = result.candidates;
      expect(candidate.generatedAt).toBeTruthy();
      expect(result.counts.eligibleGenerated).toBe(1);
      if (fault === "rejection" || fault === "before-commit") {
        expect(result.counts).toMatchObject({ committed: 0, archived: 0, terminal: 0 });
        expect(candidate.lifecycleState).toBe(fault === "rejection" ? "REJECTED" : "UNRESOLVED");
        if (fault === "rejection") {
          expect(result.runState).toBe("FINISHED");
          expect(result.terminalSummary).toEqual({ expected: 1, archived: 0, failed: 0, rejected: 1 });
        }
      } else if (fault === "after-commit") {
        expect(result.counts).toMatchObject({ committed: 1, pending: 1, archived: 0, terminal: 0 });
        expect((await byId(run.replayRunId, "DELETE")).status).toBe(409);
        const recovered = await (await byId(run.replayRunId, "PATCH")).json();
        expect(recovered.counts).toMatchObject({ committed: 1, pending: 0, archived: 1, terminal: 1 });
      } else {
        expect(result.counts).toMatchObject({ committed: 1, archived: 1, terminal: 1 });
        if (["duplicate", "concurrent-duplicate", "outage-once"].includes(fault)) expect(candidate.admissionAttemptCount).toBe(2);
        if (fault === "lost-ack") expect(candidate.observations).toContain("INJECTED_LOST_ACK");
      }
      if (fault === "before-commit") {
        expect((await byId(run.replayRunId, "DELETE")).status).toBe(409);
        await resetReplayTables();
      } else {
        await clean(run.replayRunId);
      }
    }, 20_000,
  );

  it("does not clean evidence outside the replay schema", async () => {
    await pg.exec("CREATE TABLE public.transit_classification_evidence_v1 (record_id text); INSERT INTO public.transit_classification_evidence_v1 VALUES ('outside-replay')");
    const run = await start(fixture);
    await clean(run.replayRunId);
    expect((await pg.query("SELECT record_id FROM public.transit_classification_evidence_v1")).rows).toEqual([{ record_id: "outside-replay" }]);
  });

  it("admits at most one simultaneous run and cleanup of an old run leaves the newer run intact", async () => {
    const results = await Promise.all([send(post()), send(post())]);
    expect(results.map(item => item.status).sort()).toEqual([202, 409]);
    const first = await results.find(item => item.status === 202)!.json();
    await clean(first.replayRunId);
    const second = await start({ ...fixture, mode: "synchronous" });
    expect((await byId(first.replayRunId, "DELETE")).status).toBe(409);
    expect((await (await byId(second.replayRunId)).json()).counts).toMatchObject({ committed: 1, archived: 1, terminal: 1 });
    await clean(second.replayRunId);
  });

  it("scopes fresh worker recovery to the current run and refuses cleanup when foreign rows remain", async () => {
    const run = await start({ ...fixture, mode: "synchronous", fault: "after-commit" });
    const foreignId = "a".repeat(64);
    await pg.query(`INSERT INTO transit_preview_replay.transit_classification_outbox_v1
      (record_id, payload, enqueued_at_ms, expires_at_ms, next_attempt_at_ms)
      VALUES ($1, jsonb_build_object('recordId', $1::text, 'expiresAtMs', '1999999999999'), 1, 1999999999999, 1)`, [foreignId]);
    try {
      const recovered = await (await byId(run.replayRunId, "PATCH")).json();
      expect(recovered.counts).toMatchObject({ committed: 1, archived: 1, terminal: 1 });
      expect((await byId(run.replayRunId, "DELETE")).status).toBe(409);
      expect((await pg.query(`SELECT state, attempts FROM transit_preview_replay.transit_classification_outbox_v1 WHERE record_id=$1`, [foreignId])).rows)
        .toEqual([{ state: "PENDING", attempts: 0 }]);
      expect((await (await byId(run.replayRunId)).json()).counts).toMatchObject({ archived: 1, terminal: 1 });
    } finally {
      await pg.query("DELETE FROM transit_preview_replay.transit_classification_outbox_v1 WHERE record_id=$1", [foreignId]);
    }
    await clean(run.replayRunId);
  });

  it.each([
    { label: "before manifest commit", sql: "INSERT INTO replay_runs", after: false, manifests: false, generated: 0, commits: 0 },
    { label: "after manifest commit", sql: "INSERT INTO replay_runs", after: true, manifests: true, generated: 0, commits: 0 },
    { label: "after candidate registration", sql: "journal_revision = $4", after: true, manifests: true, generated: 1, commits: 0 },
    { label: "after outbox commit before acknowledgement", sql: "INSERT INTO transit_classification_outbox_v1", after: true, manifests: true, generated: 1, commits: 1 },
    { label: "after receipt before run finalization", sql: "SELECT finish_replay", after: false, manifests: true, generated: 1, commits: 1 },
  ])("recovers only durable evidence $label", async stage => {
    const requestId = randomUUID();
    let terminated = false;
    const original = new ReplayDatabase(async statements => {
      if (terminated) throw new Error("Original invocation terminated");
      if (!statements.some(item => item.sql.includes(stage.sql))) return transact(statements);
      if (stage.after) await transact(statements);
      terminated = true;
      throw new Error("Original invocation terminated");
    });
    const fresh = new ReplayDatabase(transact);
    const call = (query: string, method = "GET") => handleEvidenceReplay(
      new Request(`${endpoint}?${query}`, { method, headers }), env, () => fresh);
    try {
      await handleEvidenceReplay(post({ ...fixture, mode: "synchronous", requestId }), env, () => original);
      expect(terminated).toBe(true);
      const found = await call(`requestId=${requestId}`);
      if (!stage.manifests) {
        expect(found.status).toBe(404);
        expect((await (await call("recoverable=1")).json()).runs).toEqual([]);
        return;
      }
      const { replayRunId } = await found.json();
      const query = `replayRunId=${replayRunId}`;
      expect((await call(query, "DELETE")).status).toBe(409);
      const before = await (await call(query)).json();
      expect(before.finalizedAt).toBeNull();
      expect(before.expectedCandidateCount).toBe(1);
      expect(before.counts).toMatchObject({ eligibleGenerated: stage.generated, committed: stage.commits });
      if (stage.sql === "SELECT finish_replay") expect(before.counts.terminal).toBe(1);
      if (stage.sql !== "SELECT finish_replay") expect((await call(query, "PATCH")).status).toBe(409);
      await expire(replayRunId);
      expect((await (await call("recoverable=1")).json()).runs).toEqual([{ replayRunId }]);
      const recovered = await (await call(query, "PATCH")).json();
      expect(recovered.counts).toMatchObject({ eligibleGenerated: stage.generated, committed: stage.commits,
        terminal: stage.commits, unresolved: stage.commits ? 0 : 1 });
      if (!stage.commits) {
        expect(recovered.finalizedAt).toBeNull();
        expect((await call(query, "DELETE")).status).toBe(409);
      } else {
        expect(recovered.runState).toBe("FINISHED");
        if (stage.sql !== "SELECT finish_replay") {
          expect(recovered.executionState).toBe("INTERRUPTED");
          expect(recovered.matchesBaseline).toBeNull();
        }
        const repeated = await (await call(query, "PATCH")).json();
        expect(repeated.finalizedAt).toBe(recovered.finalizedAt);
        expect(repeated.recoveryAttempts).toBe(1);
        await clean(replayRunId);
      }
    } finally { await resetReplayTables(); }
  });

  it.each(["receipt", "finalization"])("rolls back the recovery transaction if interrupted at %s", async stage => {
    const run = await start({ ...fixture, mode: "synchronous", fault: "after-commit" });
    const target = stage === "receipt" ? "transit_classification_outbox_v1" : "replay_runs";
    const when = stage === "receipt" ? "NEW.state IN ('PERSISTED', 'RECOVERED')" : "NEW.finalized_at IS NOT NULL";
    await pg.exec(`CREATE FUNCTION transit_preview_replay.interrupt_recovery() RETURNS trigger LANGUAGE plpgsql AS
      $$ BEGIN RAISE EXCEPTION 'Controlled rollback'; END; $$;
      CREATE TRIGGER interrupt_recovery BEFORE UPDATE ON transit_preview_replay.${target}
      FOR EACH ROW WHEN (${when}) EXECUTE FUNCTION transit_preview_replay.interrupt_recovery()`);
    try {
      expect((await byId(run.replayRunId, "PATCH")).status).toBe(503);
      const report = await (await byId(run.replayRunId)).json();
      expect(report.finalizedAt).toBeNull();
      expect(report.recoveryAttempts).toBe(0);
      expect(report.counts).toMatchObject({ committed: 1, pending: 1, terminal: 0, archived: 0 });
      expect((await byId(run.replayRunId, "DELETE")).status).toBe(409);
    } finally {
      await pg.exec(`DROP TRIGGER interrupt_recovery ON transit_preview_replay.${target};
        DROP FUNCTION transit_preview_replay.interrupt_recovery()`);
    }
    const retry = await (await byId(run.replayRunId, "PATCH")).json();
    expect(retry.counts).toMatchObject({ committed: 1, archived: 1, terminal: 1 });
    await clean(run.replayRunId);
  });

  it("advances a delivery lease and finalizes a mixed run once for two recovery requests", async () => {
    const run = await start({ fixtureId: "phase-1-6q", mode: "synchronous", fault: "after-commit" });
    const initial = await (await byId(run.replayRunId)).json();
    const candidate = initial.candidates[0].candidateId;
    await pg.query(`UPDATE transit_classification_outbox_v1 SET state = 'RETRYING', attempts = 1,
      next_attempt_at_ms = $2, claim_token = $3 WHERE record_id = $1`, [candidate, initial.finalTime + 60_000, randomUUID()]);
    const mixed = await (await byId(run.replayRunId, "PATCH")).json();
    expect(mixed.counts).toMatchObject({ committed: 4, terminal: 3, pending: 1 });
    expect(mixed.finalizedAt).toBeNull();
    expect((await byId(run.replayRunId, "DELETE")).status).toBe(409);
    await expire(run.replayRunId);
    const responses = await Promise.all([byId(run.replayRunId, "PATCH"), byId(run.replayRunId, "PATCH")]);
    expect(responses.map(item => item.status)).toEqual([200, 200]);
    const [first, second] = await Promise.all(responses.map(item => item.json()));
    expect(first.finalizedAt).toBeTruthy();
    expect(second.finalizedAt).toBe(first.finalizedAt);
    expect(first.recoveryAttempts).toBe(2);
    expect(second.recoveryAttempts).toBe(2);
    expect(second.counts).toMatchObject({ committed: 4, archived: 4, terminal: 4, pending: 0 });
    expect(second.candidates.find((row: { candidateId: string }) => row.candidateId === candidate).receiptState).toBe("RECOVERED");
    await clean(run.replayRunId);
    const archived = await (await byId(run.replayRunId)).json();
    expect(archived.terminalSummary).toEqual(second.terminalSummary);
    expect(archived.counts).toEqual(second.counts);
  });

  it("leaves checksum conflicts unresolved and refuses cleanup", async () => {
    const run = await start({ ...fixture, mode: "synchronous", fault: "after-commit" });
    const initial = await (await byId(run.replayRunId)).json();
    const { candidateId, checksum } = initial.candidates[0];
    const setChecksum = (value: string) => pg.query(`UPDATE transit_classification_outbox_v1
      SET payload = jsonb_set(payload, '{checksum}', to_jsonb($2::text)) WHERE record_id = $1`, [candidateId, value]);
    await setChecksum("0".repeat(64));
    try {
      const report = await (await byId(run.replayRunId, "PATCH")).json();
      expect(report.finalizedAt).toBeNull();
      expect(report.counts).toMatchObject({ committed: 0, archived: 0, terminal: 0, unresolved: 1 });
      expect(report.candidates[0].evidenceConflict).toBe(true);
      expect((await byId(run.replayRunId, "DELETE")).status).toBe(409);
    } finally { await setChecksum(checksum); }
    expect((await (await byId(run.replayRunId, "PATCH")).json()).runState).toBe("FINISHED");
    await clean(run.replayRunId);
  });

  it("reconciles a lost acknowledgement after the recovery transaction commits", async () => {
    const run = await start({ ...fixture, mode: "synchronous", fault: "after-commit" });
    const missingAck = new ReplayDatabase(async statements => {
      const result = await transact(statements);
      if (statements.some(statement => statement.sql.includes("SELECT recover_replay"))) throw new Error("Lost recovery acknowledgement");
      return result;
    });
    const req = new Request(`${endpoint}?replayRunId=${run.replayRunId}`, { method: "PATCH", headers });
    expect((await handleEvidenceReplay(req, env, () => missingAck)).status).toBe(503);
    const recovered = await (await byId(run.replayRunId, "PATCH")).json();
    expect(recovered.recoveryAttempts).toBe(1);
    expect(recovered.counts).toMatchObject({ committed: 1, archived: 1, terminal: 1 });
    await clean(run.replayRunId);
  });

  it("recovers the committed subset without finalizing a run with missing candidates", async () => {
    const requestId = randomUUID();
    let stopped = false;
    const original = new ReplayDatabase(async statements => {
      if (stopped) throw new Error("Original invocation stopped");
      const result = await transact(statements);
      if (statements.some(statement => statement.sql.includes("INSERT INTO transit_classification_outbox_v1"))) {
        stopped = true;
        throw new Error("Original invocation stopped after first commit");
      }
      return result;
    });
    try {
      await handleEvidenceReplay(post({ fixtureId: "phase-1-6q", mode: "synchronous", requestId }), env, () => original);
      expect(stopped).toBe(true);
      const { replayRunId } = await (await lookup(`requestId=${requestId}`)).json();
      await expire(replayRunId);
      const unknown = await byId(randomUUID(), "PATCH");
      expect(unknown.status).toBe(409);
      const initial = await (await byId(replayRunId)).json();
      expect(initial.counts).toMatchObject({ committed: 1, pending: 1, terminal: 0, unresolved: 3 });

      const responses = await Promise.all([byId(replayRunId, "PATCH"), byId(replayRunId, "PATCH")]);
      for (const response of responses) {
        expect(response.status).toBe(200);
        const report = await response.json();
        expect(report.runState).toBe("EXPIRED");
        expect(report.finalizedAt).toBeNull();
        expect(report.matchesBaseline).toBeNull();
        expect(report.counts).toMatchObject({ committed: 1, archived: 1, terminal: 1, pending: 0, unresolved: 3 });
      }
      expect((await byId(replayRunId, "DELETE")).status).toBe(409);
      expect((await send(post())).status).toBe(409);
    } finally { await resetReplayTables(); }
  });
});
