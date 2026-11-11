-- Run as the replay schema owner inside the migration transaction.
-- Provision transit_replay_writer and transit_replay_observer separately.
REVOKE ALL ON SCHEMA transit_preview_replay FROM PUBLIC, transit_replay_writer, transit_replay_observer;
REVOKE ALL ON ALL TABLES IN SCHEMA transit_preview_replay FROM PUBLIC, transit_replay_writer, transit_replay_observer;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA transit_preview_replay FROM PUBLIC, transit_replay_writer, transit_replay_observer;

GRANT USAGE ON SCHEMA transit_preview_replay TO transit_replay_writer, transit_replay_observer;
GRANT SELECT ON transit_preview_replay.replay_runs,
    transit_preview_replay.transit_classification_evidence_v1,
    transit_preview_replay.transit_classification_outbox_v1
TO transit_replay_writer, transit_replay_observer;

GRANT INSERT (id, request_id, manifest, report),
    UPDATE (report, journal_revision, finished_at, finalized_at, terminal_summary,
            last_recovery_at, recovery_attempts, cleaned_at)
ON transit_preview_replay.replay_runs TO transit_replay_writer;

-- The existing admission readiness check requires table-level INSERT/UPDATE
-- privileges on these disposable copies. DELETE supports explicit run cleanup.
GRANT INSERT, DELETE ON transit_preview_replay.transit_classification_evidence_v1 TO transit_replay_writer;
GRANT INSERT, UPDATE, DELETE ON transit_preview_replay.transit_classification_outbox_v1 TO transit_replay_writer;

GRANT EXECUTE ON FUNCTION transit_preview_replay.lock_replay(uuid, boolean),
    transit_preview_replay.finish_replay(uuid),
    transit_preview_replay.replay_terminal_summary(uuid),
    transit_preview_replay.recover_replay(uuid, uuid),
    transit_preview_replay.transit_deliver_classification_outbox_v1(uuid, bigint)
TO transit_replay_writer;
