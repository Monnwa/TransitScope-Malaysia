/* Opt-in real Redis validation. Never loaded by the application or default test suite.
 * node scripts/validate-redis-evidence.cjs --input <frozen audit directory> --output <artifact directory>
 * Reads .env.phase1-1.local; use a DEDICATED validation database, never production.
 * Removes only keys created/observed by this run. No FLUSHDB, deployment or provisioning.
 */
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const assert = require('node:assert/strict'), { isDeepStrictEqual } = require('node:util');
const { spawn } = require('node:child_process'), { performance } = require('node:perf_hooks');
const { createHash } = require('node:crypto');
const root = process.cwd(), args = process.argv.slice(2), arg = name => args[args.indexOf(name) + 1];
const input = arg('--input'), output = arg('--output'), worker = args.includes('--worker');
const nativeFetch = global.fetch, ts = require(path.join(root, 'node_modules/typescript'));
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  return resolve.call(this, request.startsWith('@/') ? path.join(root, request.slice(2)) : request, parent, ...rest);
};
require.extensions['.ts'] = function (m, filename) {
  m._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
};
if (!input || !output) throw Error('Explicit --input and --output directories required');
const { loadEnvFile } = require('node:process'); loadEnvFile(path.join(root, '.env.phase1-1.local'));
const url = process.env.TRANSIT_EVIDENCE_REDIS_REST_URL, token = process.env.TRANSIT_EVIDENCE_REDIS_REST_TOKEN;
if (!url || !token || !url.endsWith('.upstash.io')) throw Error('A dedicated Upstash validation environment is required');
fs.mkdirSync(output, { recursive: true });
const sources = ['rapid-bus-kl', 'rapid-bus-mrtfeeder', 'rapid-bus-penang'];
global.fetch = async (resource, options) => {
  const u = new URL(String(resource));
  if (u.hostname === 'api.data.gov.my' && u.pathname === '/gtfs-static/prasarana') {
    const filename = path.join(input, u.searchParams.get('category') + '.zip');
    return new Response(fs.readFileSync(filename));
  }
  if (u.origin === new URL(url).origin) return nativeFetch(resource, options);
  throw Error('Unexpected network destination in validation');
};
const { RedisRestEvidenceBackend } = require(path.join(root, 'lib/redis-evidence-store.ts'));
const { BusEvidencePersistence } = require(path.join(root, 'lib/bus-evidence.ts'));
const { VehicleProgressHistory } = require(path.join(root, 'lib/vehicle-progress-history.ts'));
const { ProcessedBusJourneys } = require(path.join(root, 'lib/processed-bus-journeys.ts'));
const { getBusStaticFeed } = require(path.join(root, 'lib/official-transit.ts'));
const { TestEvidenceBackend } = require(path.join(root, 'tests/fixtures/evidence-store.ts'));
const { adherencePoint, adherencePath } = require(path.join(root, 'tests/fixtures/adherence.ts'));
const { buildTimetable } = require(path.join(root, 'lib/scheduled-departures.ts'));
const { ON_TIME_TOLERANCE_SECONDS } = require(path.join(root, 'lib/timetable-adherence.ts'));
const { PROGRESS_LIMITS } = require(path.join(root, 'lib/route-projection.ts'));
const { PASSAGE_LIMITS } = require(path.join(root, 'lib/gps-passage.ts'));
const read = filename => JSON.parse(fs.readFileSync(path.join(output, filename), 'utf8'));
const write = (filename, value) => fs.writeFileSync(path.join(output, filename), JSON.stringify(value, null, 2));
const keyOf = (source, j, s) => JSON.stringify([source, j.vehicle.id, j.selectedDeparture?.key, s.id, s.sequence]);
const eligible = (j, s) => s.status === 'PASSED' && j.match.status === 'MATCHED' && j.selectedDeparture?.key === j.vehicleDeparture?.key && j.selectedDeparture?.classification === 'SCHEDULED' && s.classification === 'SCHEDULED' && Number.isFinite(Date.parse(s.departure ?? ''));
function metrics(entries) {
  const keys = [], classified = [], reasons = {};
  for (const e of entries) for (const s of e.journey.stops) if (eligible(e.journey, s)) {
    const key = keyOf(e.source, e.journey, s); keys.push(key);
    if (s.adherence?.result) classified.push(key);
    else { const reason = s.adherence?.diagnostic?.primary ?? 'UNRESOLVED'; reasons[reason] = (reasons[reason] ?? 0) + 1; }
  }
  assert.equal(new Set(keys).size, keys.length, 'Duplicate stop occurrences');
  assert.equal(new Set(classified).size, classified.length, 'Duplicate classifications');
  return { eligible: keys.length, classified: classified.length, coveragePct: classified.length / keys.length * 100, reasons, keys: keys.sort(), classifiedKeys: classified.sort() };
}
function gpsCore(j) {
  return { match: j.match, progress: j.progress, delay: j.delay, stops: j.stops.map(s => [s.id, s.sequence, s.status, s.arrival, s.departure]), tracking: j.tracking ? { source: j.tracking.source, confidence: j.tracking.confidence, status: j.tracking.status, position: j.tracking.position, distanceM: j.tracking.distanceM, states: j.tracking.stopStates } : null };
}
function sanitize(value) {
  return String(value).split(token).join('[REDACTED]').split(url).join('[REDIS_ENDPOINT]').replace(/https?:\/\/[^\s"')]+/g, '[URL]');
}
async function raw(command, pipeline = false) {
  // Diagnostic probes only. This retry never wraps or changes the application adapter.
  const retryable = !pipeline && ['MGET', 'GET', 'PTTL', 'DBSIZE', 'DEL'].includes(command[0]);
  for (let attempt = 0; attempt < (retryable ? 2 : 1); attempt++) try {
    const r = await nativeFetch(url + (pipeline ? '/pipeline' : ''), { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(command), signal: AbortSignal.timeout(15000) });
    const value = await r.json(); if (!r.ok || value.error) throw Error('Redis command unavailable'); return value;
  } catch { if (!retryable || attempt === 1) throw Error('Diagnostic Redis command failed: ' + (pipeline ? 'pipeline' : command[0])); }
}
const keys = new Set(), transport = { requests: 0, commands: 0, failed: 0, statusCodes: {}, networkErrors: {}, milliseconds: [], requestBytes: 0, responseBytes: 0, expiryTranslations: 0 };
// Only archived replay translates expiry's clock domain. Document GPS clocks are NEVER changed.
// Redis uses today's wall clock; archived engine snapshots use the original November 8 capture clock.
function backend(replayClock) {
  const fetcher = async (resource, options) => {
    const body = JSON.parse(String(options.body)), pipeline = String(resource).endsWith('/pipeline'), commands = pipeline ? body : [body];
    for (const cmd of commands) {
      if (cmd[0] === 'MGET') cmd.slice(1).forEach(key => keys.add(key));
      if (cmd[0] === 'EVAL') {
        keys.add(cmd[3]);
        if (replayClock) { cmd[6] = String(Number(cmd[6]) + Date.now() - replayClock()); transport.expiryTranslations++; }
      }
    }
    const text = JSON.stringify(body), start = performance.now(); transport.requests++; transport.commands += commands.length; transport.requestBytes += Buffer.byteLength(text);
    try {
      const r = await nativeFetch(resource, { ...options, body: text }), response = await r.text(); transport.responseBytes += Buffer.byteLength(response);
      transport.statusCodes[r.status] = (transport.statusCodes[r.status] ?? 0) + 1;
      if (!r.ok) transport.failed++; return new Response(response, { status: r.status, headers: r.headers });
    } catch (e) { transport.failed++; const name = ['TimeoutError', 'AbortError', 'TypeError'].includes(e.name) ? e.name : 'Other'; transport.networkErrors[name] = (transport.networkErrors[name] ?? 0) + 1; throw e; }
    finally { transport.milliseconds.push(performance.now() - start); }
  };
  return new RedisRestEvidenceBackend(url, token, fetcher);
}
async function cleanup(owned) { for (let i = 0; i < owned.length; i += 100) await raw(['DEL', ...owned.slice(i, i + 100)]); }
async function remoteDocuments(owned) {
  const docs = []; for (let i = 0; i < owned.length; i += 10) { const r = await raw(['MGET', ...owned.slice(i, i + 10)]); docs.push(...r.result.filter(Boolean).map(JSON.parse)); } return docs;
}
async function memory(owned) {
  let docs; try { docs = await remoteDocuments(owned); } catch { return { measurementAvailable: false, reason: 'DIAGNOSTIC_READ_TIMEOUT' }; }
  const jsonBytes = docs.reduce((n, d) => n + Buffer.byteLength(JSON.stringify(d)), 0);
  let perKeyMemoryBytes = null, memoryUsageSupported = true;
  try { const response = await raw(owned.map(key => ['MEMORY', 'USAGE', key]), true); if (response.some(r => r.error)) throw Error('Unsupported'); perKeyMemoryBytes = response.reduce((n, r) => n + (r.result ?? 0), 0); } catch { memoryUsageSupported = false; }
  let provider = null;
  if (process.env.TRANSIT_VALIDATION_METRICS_URL) try {
    const r = await nativeFetch(process.env.TRANSIT_VALIDATION_METRICS_URL, { signal: AbortSignal.timeout(10000) }), data = await r.json();
    // Whitelist numeric measurements; never save URLs, identifiers, access links or credentials.
    const values = {};
    const scan = (value, key = '') => { if (typeof value === 'number' && /memory|storage|size|keys|command|bandwidth|uptime|throughput/i.test(key)) values[key] = value; else if (Array.isArray(value)) value.forEach((v, i) => scan(v, key + '.' + i)); else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) scan(v, key ? key + '.' + k : k); };
    scan(data); provider = { httpStatus: r.status, values };
  } catch { provider = { available: false }; }
  return { documents: docs.length, observations: docs.reduce((n, d) => n + d.observations.length, 0), passages: docs.reduce((n, d) => n + d.checkpoint.passages.length, 0), jsonBytes, largestDocumentBytes: docs.length ? Math.max(...docs.map(d => Buffer.byteLength(JSON.stringify(d)))) : 0, memoryUsageSupported, perKeyMemoryBytes, provider };
}
function freshFixture(base = Date.now()) {
  const local = new Date(base + 8 * 3600000), date = local.toISOString().slice(0, 10).replaceAll('-', '');
  const midnight = Date.parse(local.toISOString().slice(0, 10) + 'T00:00:00+08:00');
  const clock = time => { const seconds = Math.floor((time - midnight) / 1000); return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(n => String(n).padStart(2, '0')).join(':'); };
  const table = buildTimetable({ stopTimes: [-21, -11, -1, 2, 4].map((m, i) => ({ trip_id: 't', stop_id: 's' + i, stop_sequence: String((i + 1) * 10), arrival_time: clock(base + m * 60000), departure_time: clock(base + m * 60000), timepoint: '1' })), trips: [{ trip_id: 't', route_id: 'R', service_id: 'D', direction_id: '0', shape_id: 'shape' }], routes: [{ route_id: 'R', route_short_name: 'VALIDATION', route_long_name: 'Synthetic Redis validation only' }], stops: [50, 100, 400, 700, 1400].map((m, i) => ({ stop_id: 's' + i, stop_name: 'Synthetic stop ' + i, stop_lat: String(adherencePoint(m)[0]), stop_lon: String(adherencePoint(m)[1]) })), calendars: [{ service_id: 'D', start_date: date, end_date: date, monday: '1', tuesday: '1', wednesday: '1', thursday: '1', friday: '1', saturday: '1', sunday: '1' }], exceptions: [], frequencies: [], source: 'Synthetic fresh Redis validation', mode: () => 'Bus' });
  const feed = { timetable: table, tripPaths: new Map([['t', adherencePath]]), progressPaths: new Map([['t', adherencePath]]), tripShapeDistances: new Map() };
  const record = (id, metres, time, patch = {}) => ({ id, name: 'Synthetic Redis fixture', feedId: sources[0], operator: 'Synthetic fixture', mode: 'Bus', route: 'VALIDATION', routeId: 'R', tripId: 't', position: adherencePoint(metres), bearing: 90, speed: 8, observation: { tripStartDate: date, positionTimestamp: new Date(time).toISOString() }, reportedAt: new Date(time).toISOString(), feedPublishedAt: new Date(time + 1000).toISOString(), lastUpdatedAt: new Date(time + 2000).toISOString(), recordKind: 'vehicle', station: null, status: 'In service', dataMode: 'LIVE', source: 'Synthetic Redis fixture', ...patch });
  return { base, feed, record };
}
function processor(remote, retention = 60) { const history = new VehicleProgressHistory(), persistence = new BusEvidencePersistence(remote, retention), store = new ProcessedBusJourneys(history, persistence); return { history, persistence, store }; }
async function processRecord(p, f, records, now) { const accepted = p.history.ingest(sources[0], records, now); return p.store.processWithPersistence(sources[0], accepted, f.feed, now); }
const snapshots = () => Array.from({ length: 7 }, (_, round) => Object.fromEntries(sources.map(source => [source, JSON.parse(fs.readFileSync(path.join(input, source + '-' + round + '.json'), 'utf8'))])));
async function replay(mode, startRound, endRound) {
  let clock = 0; const remote = mode === 'redis' ? backend(() => clock) : mode === 'offline' ? new TestEvidenceBackend(() => clock) : undefined;
  let p = remote ? processor(remote) : { history: new VehicleProgressHistory() }; if (!remote) p.store = new ProcessedBusJourneys(p.history);
  const feeds = {}; for (const source of sources) feeds[source] = await getBusStaticFeed(source);
  const rounds = [], statuses = [], all = snapshots();
  for (let round = startRound; round < endRound; round++) {
    if (round === 3 && mode !== 'redis') { p = remote ? processor(remote) : { history: new VehicleProgressHistory() }; if (!remote) p.store = new ProcessedBusJourneys(p.history); }
    const entries = [];
    for (const source of sources) {
      const snapshot = all[round][source]; clock = Date.parse(snapshot.retrievedAt);
      const records = p.history.ingest(source, snapshot.records.filter(r => r.position && r.position.every(Number.isFinite) && !(r.position[0] === 0 && r.position[1] === 0)).map(r => ({ ...r, feedPublishedAt: snapshot.headerTimestamp })), clock);
      entries.push(...(remote ? await p.store.processWithPersistence(source, records, feeds[source], clock) : p.store.process(source, records, feeds[source], clock)));
      if (p.persistence) statuses.push({ round, source, ...p.persistence.status() });
    }
    rounds.push(entries.map(e => {
      const j = e.journey, t = j.tracking;
      // Keep full decision fingerprints without copying large passenger payloads into artifacts.
      const resultHash = value => value ? createHash('sha256').update(JSON.stringify(value)).digest('hex') : null;
      return { source: e.source, vehicleId: e.vehicleId, journey: { vehicle: { id: j.vehicle.id }, match: j.match, progress: j.progress, delay: j.delay, selectedDeparture: j.selectedDeparture ? { key: j.selectedDeparture.key, classification: j.selectedDeparture.classification } : null, vehicleDeparture: j.vehicleDeparture ? { key: j.vehicleDeparture.key } : null, stops: j.stops.map(s => ({ id: s.id, sequence: s.sequence, status: s.status, arrival: s.arrival, departure: s.departure, classification: s.classification, adherence: { result: resultHash(s.adherence?.result), diagnostic: s.adherence?.diagnostic ? { primary: s.adherence.diagnostic.primary } : undefined } })), tracking: t ? { source: t.source, confidence: t.confidence, status: t.status, position: t.position, distanceM: t.distanceM, stopStates: t.stopStates } : null } };
    }));
    if (mode === 'redis') console.log('Redis replay round ' + round + ' complete');
  }
  return { rounds, statuses, keys: [...keys], transport };
}
async function runWorker(startRound, endRound, filename) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [__filename, '--input', input, '--output', output, '--worker', '--start', String(startRound), '--end', String(endRound), '--file', filename], { cwd: root, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', data => process.stdout.write(sanitize(data)));
    let error = ''; child.stderr.on('data', data => { error += sanitize(data); });
    child.on('error', reject); child.on('exit', code => code === 0 ? resolve(read(filename)) : reject(Error('Isolated replay process failed: ' + error)));
  });
}
async function main() {
  if (worker) { write(arg('--file'), await replay('redis', Number(arg('--start')), Number(arg('--end')))); process.exit(0); }
  if (args.includes('--analyze')) { await analyzeSaved(); return; }
  const started = new Date().toISOString(), checks = [];
  const check = async (name, action) => { const start = performance.now(), detail = await action(); checks.push({ name, passed: true, ms: Math.round(performance.now() - start), ...(detail ? { detail } : {}) }); write('integration-checks.json', checks); console.log('PASS: ' + name); };
  await check('dedicated empty managed database and unchanged evidence limits', async () => { assert.equal((await raw(['DBSIZE'])).result, 0, 'Validation requires a fresh isolated database'); assert.equal(ON_TIME_TOLERANCE_SECONDS, 120); assert.equal(PROGRESS_LIMITS.maxAgeMs, 120000); assert.equal(PASSAGE_LIMITS.maxIntervalMs, 60000); assert.equal(PASSAGE_LIMITS.minMovementM, 40); });
  const initialMemory = await memory([]), f = freshFixture(), real = backend(), p = processor(real);
  await check('real writes, original coordinates and three separate clocks', async () => {
    for (const [m, ago] of [[90, 180], [200, 150], [600, 120], [900, 90], [1100, 60]]) await processRecord(p, f, [f.record('REDIS-A', m, f.base - ago * 1000)], f.base - ago * 1000 + 2000);
    const docs = await remoteDocuments([...keys]); assert.equal(docs.length, 1); assert.equal(docs[0].observations.length, 5);
    for (const o of docs[0].observations) { assert.equal(Date.parse(o.feedPublishedAt) - o.fix.timestamp, 1000); assert.equal(Date.parse(o.receivedAt) - o.fix.timestamp, 2000); }
    assert.deepEqual(docs[0].observations[0].fix.position, adherencePoint(90)); assert.equal(docs[0].observations[0].fix.timestamp, f.base - 180000);
    assert.equal(p.persistence.status().failures, 0);
  });
  await check('processing restart retrieves original passage evidence with fresh progress', async () => {
    const reset = processor(backend());
    const first = (await processRecord(reset, f, [f.record('REDIS-A', 1150, f.base - 30000)], f.base - 28000))[0].journey;
    assert.equal(first.tracking.source, 'APPROXIMATE'); assert(first.stops.every(s => !s.adherence?.result));
    const second = (await processRecord(reset, f, [f.record('REDIS-A', 1250, f.base)], f.base + 2000))[0].journey;
    assert.equal(second.stops.filter(s => s.adherence?.result).length, 3); assert.equal(reset.persistence.status().loaded, 1);
    assert((await remoteDocuments([...keys]))[0].observations.some(o => o.fix.timestamp === f.base - 180000));
  });
  await check('duplicate and out-of-order fixes neither append nor extend expiry', async () => {
    const reset = processor(backend()); await processRecord(reset, f, [f.record('REDIS-A', 1250, f.base)], f.base + 2000);
    const key = [...keys][0], before = (await raw(['GET', key])).result, ttl = (await raw(['PTTL', key])).result;
    await processRecord(reset, f, [f.record('REDIS-A', 1250, f.base)], f.base + 2000);
    await processRecord(reset, f, [f.record('REDIS-A', 1200, f.base - 10000)], f.base + 2000);
    assert.equal((await raw(['GET', key])).result, before); assert((await raw(['PTTL', key])).result < ttl);
  });
  await check('invalid, stale, future and rejected jump observations are not persisted', async () => {
    const bad = processor(backend());
    for (const position of [[0, 0], [91, 100], [3, 181]]) await processRecord(bad, f, [f.record('INVALID', 90, f.base, { position })], f.base + 2000);
    for (const timestamp of [undefined, 'invalid', new Date(f.base - 121000).toISOString(), new Date(f.base + 33000).toISOString()]) await processRecord(bad, f, [f.record('INVALID-TIME', 90, f.base, { observation: { tripStartDate: f.record('x', 0, f.base).observation.tripStartDate, positionTimestamp: timestamp } })], f.base);
    const jump = processor(backend()); await processRecord(jump, f, [f.record('JUMP', 90, f.base - 30000)], f.base - 28000); await processRecord(jump, f, [f.record('JUMP', 200, f.base)], f.base + 2000);
    const before = (await remoteDocuments([...keys])).find(d => d.scope.vehicleId === 'JUMP');
    await processRecord(jump, f, [f.record('JUMP', 2200, f.base + 1000)], f.base + 3000);
    const docs = await remoteDocuments([...keys]); assert(!docs.some(d => d.scope.vehicleId.startsWith('INVALID'))); assert.deepEqual(docs.find(d => d.scope.vehicleId === 'JUMP'), before);
    const stale = (await processRecord(processor(backend()), f, [f.record('REDIS-A', 1250, f.base)], f.base + 121000))[0].journey; assert(stale.stops.every(s => !s.adherence?.result));
  });
  await check('vehicle histories and concurrent revision writes remain isolated', async () => {
    const a = processor(backend()), b = processor(backend());
    await Promise.all([processRecord(a, f, [f.record('ISOLATED-A', 90, f.base)], f.base + 2000), processRecord(b, f, [f.record('ISOLATED-B', 700, f.base)], f.base + 2000)]);
    const docs = await remoteDocuments([...keys]); for (const [id, m] of [['ISOLATED-A', 90], ['ISOLATED-B', 700]]) { const doc = docs.find(d => d.scope.vehicleId === id); assert.equal(doc.observations.length, 1); assert.deepEqual(doc.observations[0].fix.position, adherencePoint(m)); }
    const c = processor(backend()), d = processor(backend());
    await Promise.all([processRecord(c, f, [f.record('CONCURRENT', 90, f.base)], f.base + 2000), processRecord(d, f, [f.record('CONCURRENT', 90, f.base)], f.base + 2000)]);
    const doc = (await remoteDocuments([...keys])).find(d => d.scope.vehicleId === 'CONCURRENT'); assert.equal(doc.observations.length, 1); assert.equal(doc.checkpoint.timestamp, f.base);
    assert.equal(c.persistence.status().failures + d.persistence.status().failures, 0); assert(c.persistence.status().conflicts + d.persistence.status().conflicts >= 1);
  });
  await check('real HTTP authentication failure degrades safely and recovers', async () => {
    let offline = true; const denied = new RedisRestEvidenceBackend(url, token, (resource, options) => nativeFetch(resource, { ...options, headers: { ...options.headers, Authorization: 'Bearer deliberately-invalid-validation-token' } }));
    const healthy = backend(), wrapped = { read: (...a) => (offline ? denied : healthy).read(...a), compareAndSet: (...a) => (offline ? denied : healthy).compareAndSet(...a) }, r = processor(wrapped);
    const journey = (await processRecord(r, f, [f.record('OUTAGE', 90, f.base)], f.base + 2000))[0].journey;
    assert(journey); assert.equal(r.persistence.status().state, 'DEGRADED'); offline = false;
    await processRecord(r, f, [f.record('OUTAGE', 200, f.base + 30000)], f.base + 32000); assert.equal(r.persistence.status().state, 'READY');
    assert((await remoteDocuments([...keys])).some(d => d.scope.vehicleId === 'OUTAGE'));
  });
  await check('real endpoint cancellation and timeout preserve processing', async () => {
    const tracked = (resource, options) => { const body = JSON.parse(String(options.body)), commands = String(resource).endsWith('/pipeline') ? body : [body]; for (const cmd of commands) { if (cmd[0] === 'MGET') cmd.slice(1).forEach(key => keys.add(key)); if (cmd[0] === 'EVAL') keys.add(cmd[3]); } return nativeFetch(resource, options); };
    const slow = new RedisRestEvidenceBackend(url, token, tracked, 1), r = processor(slow), start = performance.now();
    const result = await processRecord(r, f, [f.record('TIMEOUT', 90, f.base)], f.base + 2000); assert(result[0].journey); assert.equal(r.persistence.status().state, 'DEGRADED'); assert(performance.now() - start < 3000);
  });
  await check('native absolute expiry removes an aged fix under configured one-minute retention', async () => {
    const expiryFixture = freshFixture(Date.now() - 55000), r = processor(backend(), 1), beforeKeys = new Set(keys);
    await processRecord(r, expiryFixture, [expiryFixture.record('EXPIRY', 90, expiryFixture.base)], Date.now());
    const key = [...keys].find(k => !beforeKeys.has(k)); assert(key); const ttl = (await raw(['PTTL', key])).result; assert(ttl > 0 && ttl <= 5000);
    await new Promise(resolve => setTimeout(resolve, ttl + 200)); assert.equal((await raw(['GET', key])).result, null); assert.equal((await raw(['PTTL', key])).result, -2);
    return { retentionMs: 60000, measuredRemainingTtlMs: ttl, remainingKey: false };
  });
  const fixtureMemory = await memory([...keys]); write('fixture-memory.json', fixtureMemory); await cleanup([...keys]); keys.clear();
  await check('same archived dataset baseline and offline references remain 49 and 130', async () => {
    const baseline = await replay('baseline', 0, 7), offline = await replay('offline', 0, 7); write('reference-replays.json', { baseline: baseline.rounds, offline: offline.rounds });
    const a = metrics(baseline.rounds.at(-1)), b = metrics(offline.rounds.at(-1)); assert.equal(a.eligible, 3157); assert.equal(a.classified, 49); assert.equal(b.classified, 130); assert.deepEqual(a.keys, b.keys);
  });
  const first = await runWorker(0, 3, 'redis-before-restart.json'); first.keys.forEach(key => keys.add(key)); const beforeRestartMemory = await memory(first.keys); write('before-restart-memory.json', beforeRestartMemory);
  const second = await runWorker(3, 7, 'redis-after-restart.json'), allKeys = [...new Set([...first.keys, ...second.keys])]; allKeys.forEach(key => keys.add(key)); const finalMemory = await memory(allKeys); write('final-replay-memory.json', finalMemory);
  const refs = read('reference-replays.json'), actualRounds = [...first.rounds, ...second.rounds];
  let compared = 0;
  try { await check('fresh OS process recovers same classifications and all GPS progress results', async () => {
    for (let round = 0; round < 7; round++) {
      const expected = new Map(refs.offline[round].map(e => [e.source + '|' + e.vehicleId, e.journey]));
      for (const e of actualRounds[round]) { const j = expected.get(e.source + '|' + e.vehicleId); assert(isDeepStrictEqual(gpsCore(e.journey), gpsCore(j)), 'Redis changed GPS progress'); assert.deepEqual(e.journey.stops.map(s => [s.id, s.sequence, s.adherence?.result]), j.stops.map(s => [s.id, s.sequence, s.adherence?.result])); compared++; }
    }
    const a = metrics(actualRounds.at(-1)), b = metrics(refs.offline.at(-1)); assert.deepEqual(a.keys, b.keys); assert.deepEqual(a.classifiedKeys, b.classifiedKeys); assert.equal(a.classified, 130); assert.equal(a.eligible, 3157);
    assert(second.statuses.some(s => s.loaded > 0));
    return { beforeRestartStorageFailures: first.statuses.at(-1).failures, afterRestartStorageFailures: second.statuses.at(-1).failures, transientFailuresDoNotChangeTheClassificationAssertion: true };
  }); } catch {
    await cleanup(allKeys); await analyzeSaved(); process.exitCode = 1; return;
  }
  await cleanup(allKeys); const afterCleanup = (await raw(['DBSIZE'])).result;
  const slim = entries => { const m = metrics(entries); delete m.keys; delete m.classifiedKeys; return m; };
  const report = { started, completed: new Date().toISOString(), provider: 'Upstash temporary managed Redis', expiresDate: '2026-11-11', productionConfigured: false, algorithmChanged: false, checks, comparison: { baseline: slim(refs.baseline.at(-1)), phase1Offline: slim(refs.offline.at(-1)), phase11Redis: slim(actualRounds.at(-1)), progressRowsUnchanged: compared, classificationsExactlyEqualToOffline: true }, memory: { initial: initialMemory, fixtures: fixtureMemory, beforeRestart: beforeRestartMemory, finalReplay: finalMemory, keysAfterOwnedCleanup: afterCleanup }, replayClock: { originalGpsAndDocumentClocksUnmodified: true, onlyRedisExpiryClockTranslatedForArchivedReplay: true, translations: first.transport.expiryTranslations + second.transport.expiryTranslations, nativeExpiryTestSeparate: true }, transport: { fixtures: transport, beforeRestart: first.transport, afterRestart: second.transport }, redisStatuses: { beforeRestart: first.statuses, afterRestart: second.statuses }, initialTrial: fs.existsSync(path.join(output, 'initial-redis-replay-observations.json')) ? read('initial-redis-replay-observations.json') : null, isolation: 'Dedicated temporary database; no production credentials or database used. Shared-database environment prefixes are not implemented.' };
  write('integration-results.json', report); console.log(JSON.stringify({ passed: checks.length, actualRedisClassified: report.comparison.phase11Redis.classified, eligible: 3157, progressRowsUnchanged: compared, cleanupRemaining: afterCleanup, report: 'integration-results.json' }));
}
/** Complete the report even when a real-service regression assertion failed.
 * Analysis never retries/replaces archived observations or changes an application timeout.
 */
async function analyzeSaved() {
  const first = read('redis-before-restart.json'), second = read('redis-after-restart.json'), refs = read('reference-replays.json'), actual = [...first.rounds, ...second.rounds];
  let compared = 0, progressDifferences = 0, classificationDifferences = 0;
  const roundResults = [];
  for (let round = 0; round < 7; round++) {
    const expected = new Map(refs.offline[round].map(e => [e.source + '|' + e.vehicleId, e.journey]));
    for (const e of actual[round]) {
      const j = expected.get(e.source + '|' + e.vehicleId); compared++;
      if (!isDeepStrictEqual(gpsCore(e.journey), gpsCore(j))) progressDifferences++;
      for (let i = 0; i < e.journey.stops.length; i++) if (e.journey.stops[i].adherence?.result !== j.stops[i].adherence?.result) classificationDifferences++;
    }
    const a = metrics(actual[round]), b = metrics(refs.offline[round]), expectedKeys = new Set(b.classifiedKeys), actualKeys = new Set(a.classifiedKeys);
    roundResults.push({ round, eligible: a.eligible, actualClassified: a.classified, offlineClassified: b.classified, missingClassifications: b.classifiedKeys.filter(k => !actualKeys.has(k)).length, unexpectedClassifications: a.classifiedKeys.filter(k => !expectedKeys.has(k)).length, sameEligibleKeys: isDeepStrictEqual(a.keys, b.keys) });
  }
  const slim = entries => { const m = metrics(entries); delete m.keys; delete m.classifiedKeys; return m; };
  const final = roundResults.at(-1), checks = read('integration-checks.json');
  checks.push({ name: 'fresh OS process fleet classification equivalence', passed: progressDifferences === 0 && classificationDifferences === 0, detail: { compared, progressDifferences, classificationDifferences, roundResults } });
  const report = { completed: new Date().toISOString(), provider: 'Upstash temporary managed Redis', expiresDate: '2026-11-11', productionConfigured: false, applicationCodeChanged: false, verdict: classificationDifferences ? 'NOT_READY_FOR_PRODUCTION_PERSISTENCE' : 'FUNCTIONAL_VALIDATION_PASSED_WITH_OPERATIONAL_LIMITATIONS', checks, comparison: { baseline: slim(refs.baseline.at(-1)), phase1Offline: slim(refs.offline.at(-1)), phase11Redis: slim(actual.at(-1)), progressRowsUnchanged: compared - progressDifferences, progressRowsCompared: compared, classificationDifferencesAcrossAllRounds: classificationDifferences, finalMissingClassifications: final.missingClassifications, finalUnexpectedClassifications: final.unexpectedClassifications, roundResults }, memory: { fixtures: read('fixture-memory.json'), beforeRestart: read('before-restart-memory.json'), finalReplay: read('final-replay-memory.json'), keysAfterOwnedCleanup: (await raw(['DBSIZE'])).result }, replayClock: { originalGpsAndDocumentClocksUnmodified: true, onlyRedisExpiryClockTranslatedForArchivedReplay: true, translations: first.transport.expiryTranslations + second.transport.expiryTranslations, nativeExpiryTestSeparate: true }, transport: { beforeRestart: first.transport, afterRestart: second.transport }, redisStatuses: { beforeRestart: first.statuses, afterRestart: second.statuses }, initialTrial: read('initial-redis-replay-observations.json'), isolation: 'Dedicated temporary database. Shared-database environment prefixes are not implemented.', noPaidServiceOrDeployment: true };
  write('integration-results.json', report); console.log(JSON.stringify({ verdict: report.verdict, passedGroups: checks.filter(c => c.passed).length, failedGroups: checks.filter(c => !c.passed).length, comparison: report.comparison, memory: report.memory }, null, 2));
}
main().catch(async error => { console.error(sanitize(error.stack ?? error)); if (!worker) try { await cleanup([...keys]); } catch { console.error('Owned validation keys require expiry cleanup'); } process.exitCode = 1; });
