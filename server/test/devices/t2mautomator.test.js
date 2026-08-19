'use strict';

const assert = require('assert');
const { TAG_DEFINITIONS, _test } = require('../../runtime/devices/t2mautomator');

describe('Talk2M Automator coordinator', function () {
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
});
