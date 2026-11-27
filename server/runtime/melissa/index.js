'use strict';
const path = require('path');
const fs = require('fs');
const manifest = require('../../../examples/melissa/manifest.json');

function create(runtime, SQLite) {
    const sqlite3 = SQLite || require('sqlite3');
    fs.mkdirSync(runtime.settings.dbDir, { recursive: true });
    const file = path.join(runtime.settings.dbDir, 'melissa-events.db');
    const db = new sqlite3.Database(file);
    const state = new Map(), devices = new Map(), qualityMemory = new Map();
    let loggingError = null, pending = 0, closed = false;
    const run = (sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, err => err ? reject(err) : resolve()));
    const all = (sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows)));
    const ready = run('PRAGMA journal_mode=WAL').then(() => run('CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp INTEGER NOT NULL, device TEXT, kind TEXT NOT NULL, tag TEXT, value TEXT, previous TEXT)'))
        .then(() => run('CREATE INDEX IF NOT EXISTS event_time ON events(timestamp,id)'))
        .then(() => run('CREATE TABLE IF NOT EXISTS deliveries (id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp INTEGER NOT NULL, station TEXT NOT NULL, sscc TEXT NOT NULL, pallet_type INTEGER, source_event_id TEXT UNIQUE NOT NULL, evidence TEXT NOT NULL)'))
        // A distinct ledger prevents legacy pickup records being relabelled as wrapper deliveries.
        // No automatic writer until the wrapper completion source and correlation are verified.
        .then(() => run('CREATE TABLE IF NOT EXISTS wrapper_deliveries (id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp INTEGER NOT NULL, station TEXT NOT NULL, sscc TEXT NOT NULL, pallet_type INTEGER, source_event_id TEXT UNIQUE NOT NULL, evidence TEXT NOT NULL)'));
    let queue = ready.catch(error => { loggingError = error.message; runtime.logger.error('Melissa event DB: ' + error.message); });
    const record = (kind, device, tag = null, value = null, previous = null) => {
        if (closed) return;
        if (pending >= 20000) { loggingError = 'Event queue overflow; events lost'; return; }
        const timestamp = Date.now();
        pending++;
        queue = queue.then(() => run('INSERT INTO events(timestamp,device,kind,tag,value,previous) VALUES(?,?,?,?,?,?)',
            [timestamp, device, kind, tag, JSON.stringify(value), JSON.stringify(previous)]))
            .catch(error => { loggingError = error.message; runtime.logger.error('Melissa event log: ' + error.message); })
            .finally(() => { pending--; });
    };
    const scoped = id => String(id).startsWith('melissa-');
    function onValues(event) {
        if (!scoped(event.id)) return;
        const opcUa=Object.values(runtime.project.getDevices()||{}).some(d=>d.id===event.id&&d.type==='OPCUA');
        for (const item of Object.values(event.values || {})) {
            const key = event.id + '/' + item.id, previous = state.get(key);
            const good = item.value !== null && item.value !== undefined && item.quality !== 'bad';
            const timestamp = Number(item.timestamp) || 0;
            const current = { value: good ? item.value : previous?.value ?? null,
                timestamp: good ? timestamp : previous?.timestamp || 0, valid: good };
            // UA subscriptions timestamp a value change, not every healthy poll.
            // Keep the source timestamp while measuring observation freshness separately.
            if(opcUa)current.observedAt=good?Date.now():previous?.observedAt||0;
            state.set(key, current);
            if (!previous || previous.value !== current.value || previous.valid !== current.valid) {
                record(good ? 'tag-change' : 'tag-invalid', event.id, item.id, current, previous || null);
            }
        }
    }
    function onStatus(event) {
        if (!scoped(event.id)) return;
        const old = devices.get(event.id);
        devices.set(event.id, event.status);
        if (old !== event.status) record('device-status', event.id, null, event.status, old ?? null);
    }
    function onAlarm() {
        try { record('fuxa-alarm-transition', 'melissa-runtime', null, runtime.alarmsMgr?.getAlarmsValues(null,-1) || []); }
        catch(error) { record('fuxa-alarm-read-error','melissa-runtime',null,error.message); }
    }
    const staleMs = Number(runtime.settings.melissa?.staleMs) || 15000;
    const get = (device, tag, now = Date.now()) => {
        const item = state.get(device + '/' + tag);
        const status = devices.get(device);
        const freshnessAt=item?.observedAt||item?.timestamp;
        const quality = !item?.timestamp ? 'unknown' : !item.valid || !['connect-ok', 'connect-on'].includes(status) ? 'bad'
            : now - freshnessAt > staleMs ? 'stale' : 'good';
        return { value: item?.value ?? null, timestamp: item?.timestamp || null,
            ageMs: freshnessAt ? now - freshnessAt : null, observedAt:item?.observedAt||null, quality };
    };
    function snapshot(now = Date.now()) {
        const cplc = Object.fromEntries(manifest.tags.map(t => [t.path, get('melissa-cplc', t.id, now)]));
        const projectDevices = Object.values(runtime.project.getDevices() || {});
        const configured = projectDevices.filter(d => scoped(d.id)).map(d => ({ id: d.id, name: d.name,
            enabled: !!d.enabled, status: devices.get(d.id) || 'not-connected',
            lastGood: Math.max(0, ...Array.from(state.entries()).filter(([key]) => key.startsWith(d.id + '/')).map(([,v]) => v.observedAt||v.timestamp)) }));
        const kawasaki = {};
        for (const c of manifest.controllers) {
            const device = projectDevices.find(d => d.id === 'melissa-kawasaki-' + c.robot);
            kawasaki[c.robot] = Object.fromEntries(Object.values(device?.tags || {}).map(t => [t.address, get(device.id,t.id,now)]));
        }
        // Bindings use real FUXA tag IDs after symbolic browse. No fabricated OPC UA node IDs.
        const bindings = runtime.settings.melissa?.bindings || {};
        const bound = {};
        for (const [key,binding] of Object.entries(bindings)) {
            if (binding && scoped(binding.device) && typeof binding.tag === 'string') bound[key] = get(binding.device,binding.tag,now);
        }
        const alarms = configured.filter(d => d.enabled && (!d.lastGood || now-d.lastGood > staleMs || !['connect-ok','connect-on'].includes(d.status)))
            .map(d => ({ severity:'error', text:`${d.name}: no fresh data`, device:d.id }));
        if (loggingError) alarms.push({severity:'error',text:'Event logging: '+loggingError});
        const hb = cplc['Interface.CPLC_HB'];
        if (hb?.quality === 'good' && heartbeat.cplcAt && now-heartbeat.cplcAt>10000) alarms.push({severity:'warning',text:'CPLC heartbeat has stopped changing; data reads alone do not prove a running PLC cycle'});
        const agv = cplc['Interface.AGV_HB'];
        if (agv?.quality === 'good' && heartbeat.agvAt && now-heartbeat.agvAt>10000) alarms.push({severity:'warning',text:'AGV heartbeat has stopped changing; verify JH connection'});
        return { now, source:'PLC / Kawasaki (no simulation)', manifest, cplc, kawasaki, bound, devices:configured, alarms,
            logging:{ eventsDatabase:'melissa-events.db', telemetry:'FUXA native DAQ (all configured tags, change + 10 s sample)', pending, error:loggingError },
            buffer:{ verifiedDelivered:false, reason:manifest.pending.buffer.reason,
                entries:Array.from({length:60},(_,i) => ({ slot:i+1, sscc:bound[`buffer.${i+1}.SSCC`], material:bound[`buffer.${i+1}.MATNR`], pallet:bound[`buffer.${i+1}.PALNR`] })) } };
    }
    const heartbeat = { cplcAt:0, agvAt:0, cplc:null, agv:null };
    let lastAlarms = new Set();
    function tick() {
        const now = Date.now();
        for (const [key,item] of state) {
            const [device,...tagParts]=key.split('/');
            const quality = get(device,tagParts.join('/'),now).quality;
            if (qualityMemory.get(key) !== quality) { record('quality',device,tagParts.join('/'),quality,qualityMemory.get(key) || null); qualityMemory.set(key,quality); }
        }
        for (const [name,tag] of [['cplc','Interface.CPLC_HB'],['agv','Interface.AGV_HB']]) {
            const value = get('melissa-cplc','db100.'+tag,now);
            if (value.quality==='good' && heartbeat[name] !== value.value) { heartbeat[name]=value.value;heartbeat[name+'At']=now; }
        }
        const alarms = new Set(snapshot(now).alarms.map(a=>a.text));
        for (const alarm of alarms) if (!lastAlarms.has(alarm)) record('diagnostic-raised','melissa-runtime',null,alarm);
        for (const alarm of lastAlarms) if (!alarms.has(alarm)) record('diagnostic-cleared','melissa-runtime',null,alarm);
        lastAlarms = alarms;
    }
    runtime.events.on('device-value:changed',onValues);
    runtime.events.on('device-status:changed',onStatus);
    runtime.events.on('alarms-status:changed',onAlarm);
    const timer = setInterval(tick,1000); timer.unref();
    record('runtime-start','melissa-runtime',null,{manifest:manifest.version,archive:manifest.archiveSha256});
    return { snapshot, record, ready,
        history: async (before = Number.MAX_SAFE_INTEGER,limit = 200) => {
            await queue;
            return all('SELECT * FROM events WHERE id < ? ORDER BY id DESC LIMIT ?', [Number(before)||Number.MAX_SAFE_INTEGER,Math.min(Math.max(Number(limit)||200,1),1000)]);
        },
        deliveryHistory: async () => { await queue;return all('SELECT * FROM wrapper_deliveries ORDER BY id DESC LIMIT 500'); },
        close: async () => { clearInterval(timer);runtime.events.off('device-value:changed',onValues);runtime.events.off('device-status:changed',onStatus);runtime.events.off('alarms-status:changed',onAlarm);closed=true;await queue;await new Promise((resolve,reject)=>db.close(e=>e?reject(e):resolve())); }
    };
}
module.exports={ create };
