'use strict';

const assert = require('assert');
const { parseMonitorName, DEFAULT_TAGS } = require('../../runtime/devices/kawasaki');

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
});
