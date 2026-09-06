'use strict';

const assert = require('assert');
const { TAG_DEFINITIONS, _test } = require('../../runtime/devices/t2mautomator');

describe('Talk2M Automator coordinator', function () {
    it('waits for the complete robot acquisition even when required tags arrived earlier', async function () {
        const axios = require('axios');
        const EventEmitter = require('events');
        const savedGet = axios.get;
        const savedPost = axios.post;
        let site = '';
        let robotState = 'pending';
        let enabled = false;
        let ready = false;
        let cleanup = false;
        let sample = null;
        const events = new EventEmitter();
        events.on('t2m-cycle:ready', () => { ready = true; });
        axios.get = async () => ({ data: { connectedSite: site, sites: [{ name: 'Test site', status: 'Online', enabled: true }] } });
        axios.post = async (_path, body) => {
            site = body.action === 'connect' ? 'Test site' : '';
            if (body.action === 'disconnect') cleanup = true;
            return { data: { state: 'succeeded', success: true, connectedSite: site } };
        };
        const runtime = { devices: {
            setDeviceRuntimeEnabled: async (_name, on) => {
                enabled = on;
                if (on) {
                    sample = { id: 'required', value: 42, timestamp: Date.now() };
                    events.emit('device-value:changed', { values: { required: sample } });
                }
            },
            getDevice: () => ({ getAcquisitionStatus: () => ({ state: robotState }) }),
            getTagValue: () => sample
        } };
        const data = { id: 'coordinator', name: 'Coordinator', tags: {}, property: {
            mappings: [{ site: 'Test site', connections: ['Robot'], requiredTags: ['required'] }]
        } };
        const client = require('../../runtime/devices/t2mautomator').create(data,
            { info() {}, warn() {}, error() {} }, events, null, runtime);
        try {
            client.load(data);
            await client.connect();
            await client.polling();
            await new Promise(resolve => setTimeout(resolve, 350));
            assert.strictEqual(enabled, true);
            assert.strictEqual(ready, false);
            assert.strictEqual(cleanup, false);
            robotState = 'complete';
            const deadline = Date.now() + 2000;
            while (!cleanup && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
            assert.strictEqual(ready, true);
            assert.strictEqual(cleanup, true);
            assert.strictEqual(enabled, false);
        } finally {
            robotState = 'complete';
            await client.disconnect();
            axios.get = savedGet;
            axios.post = savedPost;
        }
    });
    it('rejects cached samples from an earlier acquisition, including missing timestamps', function () {
        const fresh = new Map();
        const required = new Set(['old', 'missing', 'new', 'empty']);
        _test.collectFreshValues({
            old: { value: 7, timestamp: 999 }, missing: { value: 8 },
            new: { value: 0, ts: 1001 }, empty: { value: '', timestamp: 1000 }
        }, required, fresh, 1100, 1000);
        assert.deepStrictEqual(Array.from(fresh.keys()), ['new', 'empty']);
    });
    it('normalizes PascalCase Automator site responses', function () {
        const sites = _test.responseSites({
            Sites: [{ Name: 'Delta Foods', Status: 'Online', Enabled: true }],
        });

        assert.deepStrictEqual(sites, [{
            name: 'Delta Foods',
            status: 'Online',
            enabled: true,
        }]);
    });

    it('creates stable distinct tag addresses for Unicode site names', function () {
        const first = _test.safeName('Αθήνα');
        const second = _test.safeName('Θεσσαλονίκη');

        assert.match(first, /^site_[a-f0-9]+$/);
        assert.notStrictEqual(first, second);
        assert.strictEqual(first, _test.safeName('Αθήνα'));
    });

    it('exposes the cycle and connectivity tags used for reporting', function () {
        const addresses = TAG_DEFINITIONS.map((tag) => tag.address);

        assert.ok(addresses.includes('ecatcher.connected_site'));
        assert.ok(addresses.includes('cycle.updated_tags'));
        assert.ok(addresses.includes('cycle.last_error'));
        assert.ok(addresses.includes('next_acquisition_ts'));
    });

    it('calculates the next acquisition timestamp from the actual cycle completion time', function () {
        assert.strictEqual(
            _test.calculateNextAcquisitionTimestamp(1788104700000, 300000),
            1788105000000);
    });

    it('accepts a fresh value when its id is only present as the values map key', function () {
        const required = new Set(['tag-delta-1']);
        const collected = new Map();

        const changed = _test.collectFreshValues({
            'tag-delta-1': {
                value: 42,
                timestamp: '2026-08-19T07:00:00.000Z',
            },
        }, required, collected, 1770000000000);

        assert.strictEqual(changed, true);
        assert.strictEqual(collected.size, 1);
        assert.strictEqual(collected.get('tag-delta-1').timestamp, 1770000000000);
        assert.strictEqual(collected.get('tag-delta-1').sourceTimestamp, 1787122800000);
    });

    it('reads required values directly from the active FUXA runtime store', function () {
        const requested = [];
        const values = _test.readRuntimeTagValues(
            new Set(['tag-delta-1', 'tag-delta-2']),
            (id) => {
                requested.push(id);
                return id === 'tag-delta-1'
                    ? { id, value: 7, ts: 1787122900000 }
                    : null;
            });

        assert.deepStrictEqual(requested, ['tag-delta-1', 'tag-delta-2']);
        assert.deepStrictEqual(values, {
            'tag-delta-1': { id: 'tag-delta-1', value: 7, ts: 1787122900000 },
        });
    });
});
