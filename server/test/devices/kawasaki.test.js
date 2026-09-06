'use strict';

const assert = require('assert');
const net = require('net');
const EventEmitter = require('events');
const {
    parseMonitorName,
    parseErrlogEntries,
    createErrlogStreamParser,
    DEFAULT_TAGS
} = require('../../runtime/devices/kawasaki');

describe('Kawasaki telnet driver', function () {
    it('extracts the monitor terminal name from the login banner', function () {
        const response = 'This is AS monitor terminal "AUX1"\r\n>';

        assert.strictEqual(parseMonitorName(response), 'AUX1');
    });

    it('exposes the monitor terminal as a predefined string tag', function () {
        const tag = DEFAULT_TAGS.find((item) => item.address === 'session.monitor');

        assert.ok(tag);
        assert.strictEqual(tag.type, 'string');
    });

    it('parses Kawasaki ERRLOG entries deterministically across chunks', function () {
        const entries = [];
        const parser = createErrlogStreamParser((entry) => entries.push(entry));
        parser.push('>errlog\r\n   1 - [25/09/02 20:58:01 REPEAT mode] (SIGN');
        parser.push('AL:00)\r\n       (E1088) Destination is out of motion range.\r\n');
        parser.push('------------------------------------------------------------------------------\r\n>');
        parser.flush();

        assert.strictEqual(entries.length, 1);
        assert.strictEqual(entries[0].timestamp, '25/09/02 20:58:01');
        assert.ok(entries[0].timestampMs > 0);
        assert.strictEqual(entries[0].mode, 'REPEAT mode');
        assert.strictEqual(entries[0].source, 'SIGNAL:00');
        assert.strictEqual(entries[0].code, 'E1088');
        assert.strictEqual(entries[0].message, 'Destination is out of motion range.');
    });

    it('parses ignored and actionable errors without mixing their fields', function () {
        const response = [
            '>errlog',
            '   1 - [25/09/02 21:57:32 REPEAT mode] (SIGNAL:00)',
            '       (E1326) Safety fence is open.',
            '------------------------------------------------------------------------------',
            '   2 - [25/09/02 20:39:52 REPEAT mode] (SIGNAL:00)',
            '       (E1118) Command value for Jt1 suddenly changed.',
            '------------------------------------------------------------------------------',
            '>'
        ].join('\r\n');
        const entries = parseErrlogEntries(response);

        assert.deepStrictEqual(entries.map((entry) => entry.code), ['E1326', 'E1118']);
        assert.strictEqual(entries[1].message, 'Command value for Jt1 suddenly changed.');
    });

    it('exposes exactly three predefined tags for each ERRLOG slot', function () {
        const tags = DEFAULT_TAGS.filter((tag) => tag.address.startsWith('errlog.slot_'));

        assert.strictEqual(tags.length, 30);
        assert.ok(tags.some((tag) => tag.address === 'errlog.slot_10.timestamp_ms' && tag.type === 'number'));
        assert.ok(tags.some((tag) => tag.address === 'errlog.slot_10.code' && tag.type === 'string'));
        assert.ok(tags.some((tag) => tag.address === 'errlog.slot_10.message' && tag.type === 'string'));
    });

    it('stops ERRLOG at ten accepted entries and then at the previous watermark', async function () {
        this.timeout(15000);
        const state = createFakeKawasakiServer();
        await state.listen();
        const events = new EventEmitter();
        let latestValues = {};
        events.on('device-value:changed', (event) => {
            latestValues = event.values;
        });
        const tags = {};
        DEFAULT_TAGS.filter((tag) => tag.address.startsWith('errlog.slot_')).forEach((tag, index) => {
            tags[`tag-${index}`] = Object.assign({ id: `tag-${index}`, daq: {} }, tag);
        });
        const data = {
            id: 'kawasaki-test',
            name: 'Kawasaki test',
            type: 'Kawasaki',
            polling: 3000,
            property: {
                address: '127.0.0.1',
                port: state.port(),
                loginCommand: 'webml',
                readyMarker: '>',
                timeoutMs: 2000,
                opeinfo: false,
                errlog: true,
                errlogIntervalMs: 3000,
                errlogIgnoreCodes: 'E1326'
            },
            tags
        };
        const logger = { info() {}, warn() {}, error() {} };
        const client = require('../../runtime/devices/kawasaki').create(data, logger, events, null, {});

        try {
            client.load(data);
            await client.connect();
            await client.polling();

            assert.strictEqual(state.errlogStops, 1);
            assert.ok(state.entriesSent <= 12);
            assert.strictEqual(valueForAddress(latestValues, 'errlog.slot_10.code'), 'E1001');
            assert.strictEqual(valueForAddress(latestValues, 'errlog.slot_01.code'), 'E1010');

            state.prependError('E1999', 'New actionable error.');
            await wait(3050);
            await client.polling();

            assert.strictEqual(state.errlogStops, 2);
            assert.ok(state.lastEntriesSent < 6);
            assert.strictEqual(valueForAddress(latestValues, 'errlog.slot_01.code'), 'E1999');
            assert.strictEqual(valueForAddress(latestValues, 'errlog.slot_01.message'), 'New actionable error.');
            assert.strictEqual(valueForAddress(latestValues, 'errlog.slot_02.code'), 'E1009');
        } finally {
            await client.disconnect();
            await state.close();
        }
    });

    it('reads once per managed visit and preserves history across recreated devices', async function () {
        this.timeout(15000);
        const state = createFakeKawasakiServer();
        await state.listen();
        const runtime = {};
        const logger = { info() {}, warn() {}, error() {} };
        const data = {
            id: 'managed-robot', name: 'Managed robot', runtimeAcquisitionOnce: true,
            property: { address: '127.0.0.1', port: state.port(), loginCommand: 'webml',
                timeoutMs: 2000, opeinfo: true, errlog: true },
            tags: Object.fromEntries(DEFAULT_TAGS.map((tag, i) => [String(i), { ...tag, id: String(i), daq: {} }]))
        };
        let previous;
        try {
            for (let visit = 0; visit < 3; visit++) {
                if (visit === 1) state.prependError('E1999', 'New actionable error.');
                const client = require('../../runtime/devices/kawasaki').create(data, logger, new EventEmitter(), null, runtime);
                try {
                    client.load(data);
                    await client.connect();
                    await client.polling();
                    assert.strictEqual(client.getAcquisitionStatus().state, 'complete');
                    assert.strictEqual(client.isConnected(), false);
                    for (let tick = 0; tick < 8; tick++) await client.polling();
                    assert.deepStrictEqual(state.commands, { sta: visit + 1, opeinfo: visit + 1, errlog: visit + 1 });
                    const values = client.getValues();
                    if (visit === 0) {
                        assert.strictEqual(valueForAddress(values, 'errlog.slot_10.code'), 'E1001');
                    } else {
                        assert.ok(state.lastEntriesSent < 6, 'must stop near the previous watermark');
                        assert.strictEqual(valueForAddress(values, 'errlog.slot_01.code'), 'E1999');
                        assert.strictEqual(valueForAddress(values, 'errlog.slot_02.code'), 'E1009');
                    }
                    const codes = Object.values(values).filter(tag => tag.tagref.address.endsWith('.code')).map(tag => tag.value);
                    if (visit === 2) assert.deepStrictEqual(codes, previous, 'no-new-error visit must retain slots');
                    previous = codes;
                } finally { await client.disconnect(); }
            }
        } finally { await state.close(); }
    });

    it('completes an empty error log without inventing error entries', async function () {
        const state = createFakeKawasakiServer([]);
        await state.listen();
        const data = { id: 'empty', name: 'Empty', runtimeAcquisitionOnce: true,
            property: { address: '127.0.0.1', port: state.port(), opeinfo: false, errlog: true },
            tags: Object.fromEntries(DEFAULT_TAGS.filter(tag => tag.address.startsWith('errlog.'))
                .map((tag, i) => [String(i), { ...tag, id: String(i), daq: {} }])) };
        const client = require('../../runtime/devices/kawasaki').create(data,
            { info() {}, warn() {}, error() {} }, new EventEmitter(), null, {});
        try {
            client.load(data);
            await client.connect();
            await client.polling();
            assert.strictEqual(client.getAcquisitionStatus().state, 'complete');
            assert.strictEqual(Object.keys(client.getValues()).length, 30);
            assert.strictEqual(valueForAddress(client.getValues(), 'errlog.slot_01.timestamp_ms'), 0);
            assert.strictEqual(valueForAddress(client.getValues(), 'errlog.slot_10.code'), '');
        } finally { await client.disconnect(); await state.close(); }
    });

    it('does not reconnect or poll a completed managed device from runtime timers', async function () {
        this.timeout(15000);
        const state = createFakeKawasakiServer();
        await state.listen();
        const runtime = { logger: { info() {}, warn() {}, error() {} }, events: new EventEmitter(),
            plugins: { manager: {} }, project: { getDeviceProperty() {} } };
        const device = require('../../runtime/devices/device').create({
            id: 'wrapper', name: 'Wrapper', type: 'Kawasaki', polling: 3000, runtimeAcquisitionOnce: true,
            property: { address: '127.0.0.1', port: state.port(), opeinfo: true, errlog: true }, tags: {}
        }, runtime);
        try {
            device.start();
            const deadline = Date.now() + 6000;
            while (device.getComm().getAcquisitionStatus().state === 'pending' && Date.now() < deadline) await wait(50);
            assert.strictEqual(device.getComm().getAcquisitionStatus().state, 'complete');
            for (let i = 0; i < 8; i++) { device.checkStatus(); await device.polling(); }
            await wait(3100);
            assert.strictEqual(state.connections, 1);
            assert.deepStrictEqual(state.commands, { sta: 1, opeinfo: 1, errlog: 1 });
        } finally { await device.stop(); await state.close(); }
    });

    it('does not publish a partial managed sample or retry after a command timeout', async function () {
        const state = createFakeKawasakiServer();
        state.dropOpeinfo = true;
        await state.listen();
        const data = { id: 'failure', name: 'Failure', runtimeAcquisitionOnce: true,
            property: { address: '127.0.0.1', port: state.port(), timeoutMs: 1000, opeinfo: true, errlog: true },
            tags: { mode: { id: 'mode', address: 'sta.mode', type: 'string' } } };
        const client = require('../../runtime/devices/kawasaki').create(data,
            { info() {}, warn() {}, error() {} }, new EventEmitter(), null, {});
        try {
            client.load(data);
            await client.connect();
            await client.polling();
            assert.strictEqual(client.getAcquisitionStatus().state, 'error');
            assert.match(client.getAcquisitionStatus().error, /opeinfo/);
            assert.deepStrictEqual(client.getValues(), {});
            await client.polling();
            assert.deepStrictEqual(state.commands, { sta: 1, opeinfo: 1, errlog: 0 });
        } finally { await client.disconnect(); await state.close(); }
    });
});

function valueForAddress(values, address) {
    const item = Object.values(values).find((value) => value.tagref && value.tagref.address === address);
    return item && item.value;
}

function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function createFakeKawasakiServer(customRecords) {
    let records = [makeRecord('E1326', 'Safety fence is open.', '21:57:32')];
    for (let index = 1; index <= 12; index++) {
        records.push(makeRecord(`E${1000 + index}`, `Actionable error ${index}.`, `20:${String(59 - index).padStart(2, '0')}:00`));
    }
    if (customRecords) records = customRecords;
    let activeTimer = null;
    let serverPort = 0;
    const state = {
        connections: 0,
        commands: { sta: 0, opeinfo: 0, errlog: 0 },
        entriesSent: 0,
        lastEntriesSent: 0,
        errlogStops: 0,
        prependError(code, message) {
            records.unshift(makeRecord(code, message, '22:00:00'));
        },
        port: () => serverPort
    };
    const server = net.createServer((socket) => {
        state.connections++;
        let input = '';
        let loggedIn = false;
        let errlogRunning = false;
        socket.setEncoding('utf8');
        socket.write('Connecting to Kawasaki E Controller\r\n\r\nlogin: ');
        socket.on('data', (chunk) => {
            input += chunk;
            const lines = input.split(/\r?\n/);
            input = lines.pop();
            lines.forEach((rawLine) => {
                const line = rawLine.trim().toLowerCase();
                if (!loggedIn) {
                    loggedIn = true;
                    socket.write('This is AS monitor terminal "webml2"\r\n>');
                    return;
                }
                if (line === 'sta') {
                    state.commands.sta++;
                    socket.write('sta\r\nRobot status:\r\nREPEAT mode\r\n\r\n>');
                    return;
                }
                if (line === 'opeinfo') {
                    state.commands.opeinfo++;
                    if (state.dropOpeinfo) return;
                    socket.write('opeinfo\r\nOperation information\r\n>');
                    return;
                }
                if (line === 'errlog') {
                    state.commands.errlog++;
                    errlogRunning = true;
                    state.lastEntriesSent = 0;
                    let index = 0;
                    socket.write('errlog\r\n');
                    activeTimer = setInterval(() => {
                        if (!errlogRunning || index >= records.length) {
                            clearInterval(activeTimer);
                            activeTimer = null;
                            if (errlogRunning) {
                                errlogRunning = false;
                                socket.write('\r\n>');
                            }
                            return;
                        }
                        socket.write(formatRecord(index + 1, records[index]));
                        index++;
                        state.entriesSent++;
                        state.lastEntriesSent++;
                    }, 20);
                    return;
                }
                if (!line && errlogRunning) {
                    errlogRunning = false;
                    state.errlogStops++;
                    if (activeTimer) {
                        clearInterval(activeTimer);
                        activeTimer = null;
                    }
                    socket.write('\r\n>');
                }
            });
        });
        socket.on('close', () => {
            if (activeTimer) {
                clearInterval(activeTimer);
                activeTimer = null;
            }
        });
    });
    state.listen = () => new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => {
            serverPort = server.address().port;
            resolve();
        });
    });
    state.close = () => new Promise((resolve) => server.close(resolve));
    return state;
}

function makeRecord(code, message, time) {
    return { code, message, time };
}

function formatRecord(index, record) {
    return `${String(index).padStart(4, ' ')} - [25/09/02 ${record.time} REPEAT mode] (SIGNAL:00)\r\n` +
        `       (${record.code}) ${record.message}\r\n` +
        '------------------------------------------------------------------------------\r\n';
}
