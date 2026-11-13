CREATE TABLE IF NOT EXISTS transit_classification_evidence_v1 (
    record_id text PRIMARY KEY CHECK (record_id ~ '^[a-f0-9]{64}$'),
    run_stop_id text NOT NULL CHECK (run_stop_id ~ '^[a-f0-9]{64}$'),
    evaluated_fix_ms bigint NOT NULL,
    expires_at_ms bigint NOT NULL,
    payload jsonb NOT NULL,
    CHECK (payload->>'recordId' IS NOT DISTINCT FROM record_id),
    CHECK (payload->>'runStopId' IS NOT DISTINCT FROM run_stop_id),
    CHECK (payload->>'evaluatedFixMs' IS NOT DISTINCT FROM evaluated_fix_ms::text),
    CHECK (payload->>'expiresAtMs' IS NOT DISTINCT FROM expires_at_ms::text)
);

CREATE INDEX IF NOT EXISTS transit_classification_run_stop_v1
    ON transit_classification_evidence_v1 (run_stop_id, evaluated_fix_ms DESC, record_id DESC);

CREATE INDEX IF NOT EXISTS transit_classification_expiry_v1
    ON transit_classification_evidence_v1 (expires_at_ms, run_stop_id);
