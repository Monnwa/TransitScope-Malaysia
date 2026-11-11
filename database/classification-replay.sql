-- Install in the isolated transit_preview_replay schema after both archive migrations.
CREATE TABLE IF NOT EXISTS transit_preview_replay.replay_runs (
    id uuid PRIMARY KEY,
    request_id uuid UNIQUE NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    finished_at timestamptz,
    cleaned_at timestamptz,
    report jsonb NOT NULL
);

-- Legacy local drafts have no immutable manifest. Leave them ineligible; do not
-- reconstruct ownership from mutable reports. Provision a clean replay schema.
ALTER TABLE transit_preview_replay.replay_runs
    ADD COLUMN IF NOT EXISTS manifest jsonb,
    ADD COLUMN IF NOT EXISTS journal_revision integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS finalized_at timestamptz,
    ADD COLUMN IF NOT EXISTS terminal_summary jsonb,
    ADD COLUMN IF NOT EXISTS last_recovery_at timestamptz,
    ADD COLUMN IF NOT EXISTS recovery_attempts integer NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS replay_one_uncleaned_run
    ON transit_preview_replay.replay_runs ((true)) WHERE cleaned_at IS NULL;

CREATE OR REPLACE FUNCTION transit_preview_replay.lock_replay(replay_id uuid, recover boolean)
RETURNS void LANGUAGE plpgsql SET search_path TO pg_catalog, transit_preview_replay, pg_temp AS $$
BEGIN
    PERFORM 1 FROM replay_runs
        WHERE id = replay_id AND cleaned_at IS NULL AND manifest IS NOT NULL
            AND NOT recover AND finalized_at IS NULL AND finished_at IS NULL
            AND created_at > clock_timestamp() - interval '90 seconds'
        FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Replay reservation is unavailable';
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION transit_preview_replay.lock_replay(uuid, boolean) FROM PUBLIC;
ALTER FUNCTION transit_preview_replay.transit_deliver_classification_outbox_v1(uuid, bigint)
    SET search_path TO pg_catalog, transit_preview_replay, pg_temp;
REVOKE ALL ON FUNCTION transit_preview_replay.transit_deliver_classification_outbox_v1(uuid, bigint) FROM PUBLIC;

-- A manifest entry is only an expectation. A terminal success needs the
-- matching archive and receipt, a failure needs a matching retained payload,
-- and a rejection needs a durable trace and absence of conflicting evidence.
CREATE OR REPLACE FUNCTION transit_preview_replay.replay_terminal_summary(replay_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SET search_path TO pg_catalog, transit_preview_replay, pg_temp AS $$
    SELECT CASE WHEN (r.finished_at IS NOT NULL OR states.expected > 0)
                      AND states.expected = (r.manifest->>'expectedCandidateCount')::integer
                      AND states.expected = states.archived + states.failed + states.rejected
        THEN jsonb_build_object('expected', states.expected, 'archived', states.archived,
            'failed', states.failed, 'rejected', states.rejected, 'evidence', states.evidence) END
    FROM replay_runs r
    CROSS JOIN LATERAL (
        SELECT count(*) AS expected,
            count(*) FILTER (WHERE j.staged AND j."generatedAt" IS NOT NULL AND a.payload->>'checksum' = m.checksum
                AND q.state IN ('PERSISTED', 'RECOVERED') AND q.payload IS NULL) AS archived,
            count(*) FILTER (WHERE j.staged AND j."generatedAt" IS NOT NULL AND a.record_id IS NULL AND q.state = 'FAILED'
                AND q.payload->>'checksum' = m.checksum) AS failed,
            count(*) FILTER (WHERE a.record_id IS NULL AND q.record_id IS NULL AND j.rejection IS NOT NULL
                AND j."generatedAt" IS NOT NULL) AS rejected,
            coalesce(jsonb_agg(jsonb_build_object(
                'id', m."candidateId", 'receipt', q.state, 'deliveryAttempts', q.attempts,
                'deliveryError', q.error_kind, 'intentChecksum', q.payload->>'checksum',
                'archiveChecksum', a.payload->>'checksum', 'settledAtMs', q.settled_at_ms,
                'archiveDisposition', q.archive_disposition
            ) ORDER BY m."candidateId"), '[]'::jsonb) AS evidence
        FROM jsonb_to_recordset(r.manifest->'candidates') AS m("candidateId" text, checksum text)
        LEFT JOIN LATERAL (
            SELECT x.rejection, x."generatedAt", x.staged FROM jsonb_to_recordset(r.report->'candidates')
                AS x("candidateId" text, checksum text, rejection text, "generatedAt" text, staged boolean)
            WHERE x."candidateId" = m."candidateId" AND x.checksum = m.checksum
        ) j ON true
        LEFT JOIN transit_classification_outbox_v1 q ON q.record_id = m."candidateId"
        LEFT JOIN transit_classification_evidence_v1 a ON a.record_id = m."candidateId"
    ) states
    WHERE r.id = replay_id AND r.manifest IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION transit_preview_replay.finish_replay(replay_id uuid)
RETURNS void LANGUAGE plpgsql SET search_path TO pg_catalog, transit_preview_replay, pg_temp AS $$
DECLARE summary jsonb;
BEGIN
    PERFORM 1 FROM replay_runs WHERE id = replay_id AND cleaned_at IS NULL AND manifest IS NOT NULL
        AND finalized_at IS NULL AND (finished_at IS NOT NULL OR created_at <= clock_timestamp() - interval '90 seconds')
        FOR UPDATE;
    IF NOT FOUND THEN RETURN; END IF;
    summary := replay_terminal_summary(replay_id);
    IF summary IS NOT NULL THEN
        UPDATE replay_runs SET finalized_at = clock_timestamp(), terminal_summary = summary WHERE id = replay_id;
    END IF;
END;
$$;

-- One bounded recovery request. The claim, archive/receipt delivery and run
-- finalization commit together. A dropped acknowledgement is safe to retry.
CREATE OR REPLACE FUNCTION transit_preview_replay.recover_replay(replay_id uuid, worker_token uuid)
RETURNS boolean LANGUAGE plpgsql SET search_path TO pg_catalog, transit_preview_replay, pg_temp AS $$
DECLARE
    run replay_runs%ROWTYPE;
    replay_now bigint;
BEGIN
    SELECT * INTO run FROM replay_runs WHERE id = replay_id AND cleaned_at IS NULL AND manifest IS NOT NULL
        AND (finished_at IS NOT NULL OR created_at <= clock_timestamp() - interval '90 seconds')
        FOR UPDATE;
    IF NOT FOUND THEN RETURN false; END IF;
    IF run.finalized_at IS NOT NULL THEN RETURN true; END IF;
    UPDATE replay_runs SET last_recovery_at = clock_timestamp(), recovery_attempts = recovery_attempts + 1
        WHERE id = replay_id;
    -- Advance from the captured clock without using today's wall-clock date to expire historical evidence.
    replay_now := (run.manifest->>'finalTime')::bigint + 2000
        + greatest(0, floor(extract(epoch FROM clock_timestamp() - run.created_at) * 1000)::bigint);
    WITH due AS (
        SELECT q.record_id, CASE WHEN q.expires_at_ms <= replay_now THEN 'EVIDENCE_EXPIRED'
            WHEN q.attempts >= 6 THEN 'RETRIES_EXHAUSTED' END AS failure
        FROM transit_classification_outbox_v1 q
        JOIN jsonb_to_recordset(run.manifest->'candidates') AS m("candidateId" text, checksum text)
            ON m."candidateId" = q.record_id AND m.checksum = q.payload->>'checksum'
        WHERE q.state IN ('PENDING', 'RETRYING') AND q.next_attempt_at_ms <= replay_now
            AND EXISTS (
                SELECT 1 FROM jsonb_to_recordset(run.report->'candidates')
                    AS j("candidateId" text, checksum text, staged boolean, "generatedAt" text)
                WHERE j."candidateId" = q.record_id AND j.checksum = m.checksum AND j.staged AND j."generatedAt" IS NOT NULL
            )
            AND NOT EXISTS (
                SELECT 1 FROM transit_classification_evidence_v1 a WHERE a.record_id = q.record_id
                    AND a.payload->>'checksum' IS DISTINCT FROM m.checksum
            )
        ORDER BY q.record_id LIMIT 64 FOR UPDATE OF q
    )
    UPDATE transit_classification_outbox_v1 q SET
        state = CASE WHEN due.failure IS NULL THEN 'RETRYING' ELSE 'FAILED' END,
        attempts = q.attempts + CASE WHEN due.failure IS NULL THEN 1 ELSE 0 END,
        claim_token = CASE WHEN due.failure IS NULL THEN worker_token END,
        next_attempt_at_ms = CASE WHEN due.failure IS NULL
            THEN replay_now + least(60000, 2000 * (1::bigint << q.attempts)) END,
        settled_at_ms = CASE WHEN due.failure IS NOT NULL THEN replay_now END,
        error_kind = due.failure
    FROM due WHERE q.record_id = due.record_id;
    PERFORM * FROM transit_deliver_classification_outbox_v1(worker_token, replay_now);
    PERFORM finish_replay(replay_id);
    RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION transit_preview_replay.replay_terminal_summary(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION transit_preview_replay.finish_replay(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION transit_preview_replay.recover_replay(uuid, uuid) FROM PUBLIC;
