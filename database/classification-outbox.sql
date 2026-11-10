CREATE TABLE IF NOT EXISTS transit_classification_outbox_v1 (
    record_id text PRIMARY KEY CHECK (record_id ~ '^[a-f0-9]{64}$'),
    payload jsonb,
    enqueued_at_ms bigint NOT NULL,
    expires_at_ms bigint NOT NULL,
    state text NOT NULL DEFAULT 'PENDING'
        CHECK (state IN ('PENDING', 'RETRYING', 'PERSISTED', 'RECOVERED', 'FAILED')),
    attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    next_attempt_at_ms bigint,
    claim_token uuid,
    settled_at_ms bigint,
    archive_disposition text CHECK (archive_disposition IN ('INSERTED', 'ALREADY_EXISTS')),
    error_kind text CHECK (error_kind IN ('EVIDENCE_EXPIRED', 'RETRIES_EXHAUSTED', 'ARCHIVE_REJECTED')),
    CHECK (payload IS NULL OR payload->>'recordId' IS NOT DISTINCT FROM record_id),
    CHECK (payload IS NULL OR payload->>'expiresAtMs' IS NOT DISTINCT FROM expires_at_ms::text),
    CHECK ((state = 'RETRYING') = (claim_token IS NOT NULL)),
    CHECK ((state IN ('PENDING', 'RETRYING')) = (next_attempt_at_ms IS NOT NULL)),
    CHECK ((state IN ('PENDING', 'RETRYING')) = (settled_at_ms IS NULL)),
    CHECK ((state IN ('PERSISTED', 'RECOVERED')) = (archive_disposition IS NOT NULL)),
    CHECK ((state IN ('PERSISTED', 'RECOVERED')) = (payload IS NULL)),
    CHECK ((state = 'FAILED') = (error_kind IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS transit_classification_outbox_due_v1
    ON transit_classification_outbox_v1 (next_attempt_at_ms, record_id)
    WHERE state IN ('PENDING', 'RETRYING');

CREATE INDEX IF NOT EXISTS transit_classification_outbox_claim_v1
    ON transit_classification_outbox_v1 (claim_token)
    WHERE state = 'RETRYING';

CREATE INDEX IF NOT EXISTS transit_classification_outbox_expiry_v1
    ON transit_classification_outbox_v1 (expires_at_ms);

-- Each successful archive insertion and its acknowledgement share one transaction.
-- A savepoint isolates deterministic data failures to their own record.
CREATE OR REPLACE FUNCTION transit_deliver_classification_outbox_v1(worker_token uuid, override_now_ms bigint)
RETURNS TABLE ("recordId" text, state text, inserted boolean)
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
    item transit_classification_outbox_v1%ROWTYPE;
    affected integer;
    acknowledged integer;
    now_ms bigint := COALESCE(override_now_ms, (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::bigint);
BEGIN
    FOR item IN
        SELECT q.* FROM transit_classification_outbox_v1 q
        WHERE q.state = 'RETRYING' AND q.claim_token = worker_token
        -- Claimers skip locks, but an owner waits for its own leased rows.
        ORDER BY q.record_id FOR UPDATE
    LOOP
        "recordId" := item.record_id;
        inserted := false;
        IF item.expires_at_ms <= now_ms THEN
            UPDATE transit_classification_outbox_v1 q
            SET state = 'FAILED', error_kind = 'EVIDENCE_EXPIRED', claim_token = NULL,
                next_attempt_at_ms = NULL, settled_at_ms = now_ms
            WHERE q.record_id = item.record_id;
            GET DIAGNOSTICS acknowledged = ROW_COUNT;
            IF acknowledged <> 1 THEN
                RAISE check_violation;
            END IF;
            state := 'FAILED';
        ELSE
            BEGIN
                INSERT INTO transit_classification_evidence_v1
                    (record_id, run_stop_id, evaluated_fix_ms, expires_at_ms, payload)
                VALUES (item.record_id, item.payload->>'runStopId',
                        (item.payload->>'evaluatedFixMs')::bigint, item.expires_at_ms, item.payload)
                ON CONFLICT (record_id) DO NOTHING;
                GET DIAGNOSTICS affected = ROW_COUNT;
                IF affected = 0 AND NOT EXISTS (
                    SELECT 1 FROM transit_classification_evidence_v1 a WHERE a.record_id = item.record_id
                ) THEN
                    RAISE check_violation;
                END IF;
                inserted := affected = 1;
                state := CASE WHEN item.attempts > 1 THEN 'RECOVERED' ELSE 'PERSISTED' END;
                UPDATE transit_classification_outbox_v1 q
                SET state = CASE WHEN item.attempts > 1 THEN 'RECOVERED' ELSE 'PERSISTED' END,
                    archive_disposition = CASE WHEN affected = 1 THEN 'INSERTED' ELSE 'ALREADY_EXISTS' END,
                    payload = NULL, claim_token = NULL, next_attempt_at_ms = NULL, settled_at_ms = now_ms
                WHERE q.record_id = item.record_id;
                GET DIAGNOSTICS acknowledged = ROW_COUNT;
                IF acknowledged <> 1 THEN
                    RAISE check_violation;
                END IF;
            EXCEPTION WHEN data_exception OR integrity_constraint_violation THEN
                -- The insert and acknowledgement in this block have both rolled back.
                UPDATE transit_classification_outbox_v1 q
                SET state = 'FAILED', error_kind = 'ARCHIVE_REJECTED', claim_token = NULL,
                    next_attempt_at_ms = NULL, settled_at_ms = now_ms
                WHERE q.record_id = item.record_id;
                GET DIAGNOSTICS acknowledged = ROW_COUNT;
                IF acknowledged <> 1 THEN
                    RAISE;
                END IF;
                inserted := false;
                state := 'FAILED';
            END;
        END IF;
        RETURN NEXT;
    END LOOP;
END;
$$;
