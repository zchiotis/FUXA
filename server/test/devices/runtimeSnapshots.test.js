'use strict';

const assert = require('assert');
const { _test } = require('../../runtime/devices');

describe('Runtime-managed device snapshots', function () {
    it('keeps last good values when a driver clears its live values on stop', function () {
        const live = {
            'tag-power': {
                id: 'tag-power',
                value: 42,
                timestamp: 1787162400000,
                quality: 0,
            },
            'tag-empty': {
                id: 'tag-empty',
                value: null,
                timestamp: 1787162400000,
            },
        };

        const snapshot = _test.snapshotDeviceValues(live);
        live['tag-power'].value = null;

        assert.deepStrictEqual(Object.keys(snapshot), ['tag-power']);
        assert.strictEqual(snapshot['tag-power'].value, 42);
        assert.strictEqual(snapshot['tag-power'].timestamp, 1787162400000);
    });

    it('preserves valid false, zero, and empty-string values', function () {
        const snapshot = _test.snapshotDeviceValues({
            zero: { id: 'zero', value: 0 },
            disabled: { id: 'disabled', value: false },
            text: { id: 'text', value: '' },
        });

        assert.strictEqual(snapshot.zero.value, 0);
        assert.strictEqual(snapshot.disabled.value, false);
        assert.strictEqual(snapshot.text.value, '');
    });
});
