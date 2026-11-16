import type { EvidenceBackend, EvidenceDocument, EvidenceWrite } from "@/lib/bus-evidence";

/** Test-only external-store stand-in. Not a runtime persistence fallback. */
export class TestEvidenceBackend implements EvidenceBackend {
  readonly values = new Map<string, { value: EvidenceDocument; expiresAt: number }>();
  reads = 0; writes = 0; logicalWriteBytes = 0; failRead = false; failWrite = false;
  constructor(private clock: () => number) {}
  async read(keys: string[]): Promise<Map<string, unknown>> {
    this.reads++; if (this.failRead) throw new Error("Controlled storage read outage");
    const result = new Map<string, unknown>();
    for (const key of keys) { const entry = this.values.get(key); if (entry && entry.expiresAt <= this.clock()) this.values.delete(key); else if (entry) result.set(key, structuredClone(entry.value)); }
    return result;
  }
  async compareAndSet(writes: EvidenceWrite[]): Promise<boolean[]> {
    if (this.failWrite) throw new Error("Controlled storage write outage");
    return writes.map(write => {
      let prior = this.values.get(write.key); if (prior && prior.expiresAt <= this.clock()) { this.values.delete(write.key); prior = undefined; }
      if ((prior?.value.revision ?? 0) !== write.expectedRevision || prior && prior.value.checkpoint.timestamp > write.document.checkpoint.timestamp) return false;
      this.values.set(write.key, { value: structuredClone(write.document), expiresAt: write.expiresAt }); this.writes++; this.logicalWriteBytes += Buffer.byteLength(JSON.stringify(write.document)); return true;
    });
  }
}
