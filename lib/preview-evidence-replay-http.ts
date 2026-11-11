import { timingSafeEqual } from "node:crypto";
import { after } from "next/server";
import { z } from "zod";
import { ReplayDatabase, neonReplayTransaction } from "./preview-evidence-replay-db";
import { executeReplay, reconcileReplay, recoverReplay, replayInput } from "./preview-evidence-replay";

const headers = { "Cache-Control": "no-store" };
const response = (body: unknown, status = 200) => Response.json(body, { status, headers });
const secretPattern = /^[A-Za-z0-9_-]{32,128}$/;
const payloadLimit = 1_024;

async function readPayload(request: Request): Promise<unknown> {
  const length = request.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > payloadLimit)) throw new RangeError("Payload limit");
  if (!request.body) throw new SyntaxError("Missing payload");
  const reader = request.body.getReader();
  const bytes = new Uint8Array(payloadLimit);
  let used = 0;
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; void reader.cancel().catch(() => {}); }, 1_500);
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (timedOut) throw new SyntaxError("Payload deadline");
      if (done) return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, used)));
      if (used + value.length > payloadLimit) {
        void reader.cancel().catch(() => {});
        throw new RangeError("Payload limit");
      }
      bytes.set(value, used);
      used += value.length;
    }
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }
}

export async function handleEvidenceReplay(request: Request, env: Record<string, string | undefined> = process.env,
  connect = (url: string) => new ReplayDatabase(neonReplayTransaction(url)), retain: (work: () => Promise<void>) => void = after) {
  const secret = env.TRANSIT_PREVIEW_REPLAY_SECRET;
  if (env.VERCEL_ENV !== "preview" || env.VERCEL_TARGET_ENV !== "preview" ||
      env.TRANSIT_CLASSIFICATION_ARCHIVE_ENABLED === "true" || !secret || !secretPattern.test(secret))
    return response({ error: "Not found" }, 404);
  const auth = request.headers.get("authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!secretPattern.test(token) || token.length !== secret.length || !timingSafeEqual(Buffer.from(token), Buffer.from(secret)))
    return response({ error: "Unauthorized" }, 401);
  if (!["POST", "GET", "PATCH", "DELETE"].includes(request.method))
    return new Response(null, { status: 405, headers: { ...headers, Allow: "POST, GET, PATCH, DELETE" } });

  const url = env.TRANSIT_PREVIEW_REPLAY_DATABASE_URL;
  if (!url) return response({ error: "Replay storage unavailable" }, 503);
  const params = new URL(request.url).searchParams;
  try {
    if (request.method === "POST") {
      if (params.size) return response({ error: "Unexpected query parameters" }, 400);
      if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json")
        return response({ error: "Expected application/json" }, 415);
      let payload: unknown;
      try { payload = await readPayload(request); }
      catch (error) { return error instanceof RangeError ? response({ error: "Payload too large" }, 413) : response({ error: "Invalid JSON" }, 400); }
      const parsed = replayInput.safeParse(payload);
      if (!parsed.success) return response({ error: "Invalid replay request" }, 400);
      if (parsed.data.mode !== "disabled" && env.TRANSIT_PREVIEW_REPLAY_WRITES_ENABLED !== "true")
        return response({ error: "Replay writes disabled" }, 403);
      const result = await executeReplay(connect(url), parsed.data, retain);
      return result ? response(result, 202) : response({ error: "Replay request already used, active, or storage not empty" }, 409);
    }
    if (request.method === "GET" && params.size === 1) {
      if (params.get("recoverable") === "1") return response({ runs: await connect(url).discover() });
      const requestId = z.string().uuid().safeParse(params.get("requestId"));
      if (requestId.success) {
        const [run] = await connect(url).discover(requestId.data);
        return run ? response(run) : response({ error: "Replay not found" }, 404);
      }
    }
    const id = z.string().uuid().safeParse(params.get("replayRunId"));
    if (params.size !== 1 || !id.success) return response({ error: "Expected one replayRunId" }, 400);
    if (request.method === "PATCH" && env.TRANSIT_PREVIEW_REPLAY_WRITES_ENABLED !== "true")
      return response({ error: "Replay writes disabled" }, 403);
    const db = connect(url);
    if (request.method === "DELETE") return await db.cleanup(id.data)
      ? new Response(null, { status: 204, headers }) : response({ error: "Run unavailable for cleanup" }, 409);
    if (request.method === "PATCH") {
      const report = await recoverReplay(db, id.data);
      return report ? response(report) : response({ error: "Run unavailable for recovery" }, 409);
    }
    const report = await reconcileReplay(db, id.data);
    return report ? response(report) : response({ error: "Replay not found" }, 404);
  } catch {
    return response({ error: "Replay operation unavailable" }, 503);
  }
}
