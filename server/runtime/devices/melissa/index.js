'use strict';

// Melissa's standard DBs are read in blocks, including Siemens STRING headers.
// No write operations exist in this adapter.
const mapping = require('../../../../examples/melissa/manifest.json');
const deviceUtils = require('../device-utils');

function decode(buffer, tag) {
    const p = tag.byte;
    switch (tag.type) {
    case 'BOOL': return !!(buffer[p] & (1 << tag.bit));
    case 'BYTE': return buffer.readUInt8(p);
    case 'CHAR': return buffer.toString('latin1', p, p + 1);
    case 'WORD': return buffer.readUInt16BE(p);
    case 'INT': return buffer.readInt16BE(p);
    case 'DWORD': return buffer.readUInt32BE(p);
    case 'DINT': case 'TIME': return buffer.readInt32BE(p);
    case 'REAL': return buffer.readFloatBE(p);
    case 'STRING': {
        const max = buffer[p], length = buffer[p + 1];
        if (max !== tag.length || length > max || p + 2 + max > buffer.length) {
            throw new Error(`Invalid Siemens STRING header: ${tag.path}`);
        }
        return buffer.toString('latin1', p + 2, p + 2 + length);
    }
    default: throw new Error(`Unsupported Melissa type ${tag.type}`);
    }
}

function create(data, logger, events, manager, runtime, injectedSnap7) {
    let snap7 = injectedSnap7;
    if (!snap7) {
        try { snap7 = require('node-snap7'); }
        catch (_) { if (manager) snap7 = manager.require('node-snap7'); }
    }
    if (!snap7) throw new Error('Melissa requires node-snap7 1.0.9');
    const client = new snap7.S7Client();
    let values = {}, status = 'connect-off', lastRead = 0, saveDaq, working = false;
    let tags = mapping.tags.filter(t => data.tags[t.id]);
    const emitStatus = next => { status = next; events.emit('device-status:changed', { id: data.id, status }); };
    const emitValues = () => events.emit('device-value:changed', { id: data.id, values });
    const readDB = (number, size) => new Promise((resolve, reject) => {
        client.DBRead(number, 0, size, (err, buffer) => err ? reject(new Error(client.ErrorText(err))) : resolve(buffer));
    });
    const api = {
        init() {},
        load(next) { data = next; tags = mapping.tags.filter(t => data.tags[t.id]); },
        connect: () => new Promise((resolve, reject) => {
            client.ConnectTo(data.property.address, Number(data.property.rack), Number(data.property.slot), err => {
                emitStatus(err ? 'connect-error' : 'connect-ok');
                err ? reject(new Error(client.ErrorText(err))) : resolve(true);
            });
        }),
        disconnect: async () => { client.Disconnect(); emitStatus('connect-off'); return true; },
        isConnected: () => client.Connected(),
        getStatus: () => status,
        lastReadTimestamp: () => lastRead,
        getValues: () => values,
        getValue: id => values[id] ? { ...values[id], ts: values[id].timestamp } : null,
        getTagProperty: id => data.tags[id],
        bindAddDaq: fn => { saveDaq = fn; },
        setValue: async () => { throw new Error('Melissa PLC interface is read-only; commands await agreement.'); },
        polling: async () => {
            if (working) return;
            working = true;
            try {
                const blocks = {};
                for (const db of new Set(tags.map(t => t.db))) {
                    const size = Math.max(...tags.filter(t => t.db === db).map(t => t.byte + t.bytes));
                    blocks[db] = await readDB(db, size);
                }
                // Decode the complete sample first: no partial-good DB100 cycle.
                const decoded = tags.map(tag => [tag, decode(blocks[tag.db], tag)]);
                const now = Date.now(), daq = {}, next = {};
                for (const [tag, value] of decoded) {
                    const config = data.tags[tag.id], old = values[tag.id];
                    const item = { id: tag.id, value, rawValue: value, type: config.type, quality: 'good',
                        changed: !old || old.value !== value, timestamp: now, daq: config.daq, tagref: config };
                    if (deviceUtils.tagDaqToSave(item, now)) { item.daq.lastDaqSaved=now;daq[tag.id] = item; }
                    next[tag.id] = item;
                }
                values = next;
                lastRead = now;
                emitStatus('connect-ok');
                emitValues();
                if (saveDaq && Object.keys(daq).length) saveDaq(daq, data.name, data.id);
            } catch (error) {
                emitStatus('read-error');
                values = Object.fromEntries(Object.entries(values).map(([id, item]) => [id, { ...item, quality: 'bad', value: null }]));
                emitValues();
                logger.error(`Melissa read failed: ${error.message}`);
                client.Disconnect();
            } finally { working = false; }
        }
    };
    return api;
}
module.exports = { create, decode };
