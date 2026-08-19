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
});
