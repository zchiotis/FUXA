/**
 * Kawasaki AS monitor telnet driver.
 *
 * Keeps one persistent telnet session open and polls STA/OPEINFO serially.
 */

'use strict';

const net = require('net');
const utils = require('../../utils');
const deviceUtils = require('../device-utils');

const DEFAULT_PORT = 23;
const DEFAULT_LOGIN = 'as';
const DEFAULT_READY_MARKER = '>';
const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_READ_WINDOW_MS = 150;
const DEFAULT_EXTEND_MS = 750;
const PAGE_MARKER = 'Press SPACE key to continue.';

function KawasakiClient(_data, _logger, _events, _manager, _runtime) {
    let data = JSON.parse(JSON.stringify(_data));
    const logger = _logger;
    const events = _events;
    const runtime = _runtime;

    let socket = null;
    let connected = false;
    let working = false;
    let overloading = 0;
    let lastStatus = 'connect-off';
    let lastTimestampValue = null;
    let varsValue = {};
    let tagMap = {};
    let receiveBuffer = '';
    let addDaq = null;

    this.init = function () {};

    this.connect = function () {
        return new Promise(async (resolve, reject) => {
            if (!_checkWorking(true)) {
                return reject(new Error('busy'));
            }
            try {
                await _openSession();
                connected = true;
                _emitStatus('connect-ok');
                logger.info(`'${data.name}' connected to Kawasaki ${_host()}:${_port()}`, true);
                resolve(true);
            } catch (err) {
                connected = false;
                _emitStatus('connect-error');
                _clearVarsValue();
                await _closeSocket();
                reject(err);
            } finally {
                _checkWorking(false);
            }
        });
    };

    this.disconnect = function () {
        return new Promise(async (resolve) => {
            _checkWorking(false);
            await _closeSocket();
            connected = false;
            _emitStatus('connect-off');
            _clearVarsValue();
            resolve(true);
        });
    };

    this.polling = async function () {
        if (!_checkWorking(true)) {
            _emitStatus('connect-busy');
            return;
        }
        try {
            if (!socket || !connected) {
                _checkWorking(false);
                return;
            }

            const snapshot = {};
            const staText = await _runCommand('sta', { paged: false });
            Object.assign(snapshot, parseSta(staText));
            snapshot['sta.raw'] = staText;

            let commandError = null;
            if (_isOpeinfoEnabled()) {
                try {
                    const opeinfoText = await _runCommand('opeinfo', { paged: true });
                    Object.assign(snapshot, parseOpeinfo(opeinfoText));
                    snapshot['opeinfo.raw'] = _stripCommandNoise(opeinfoText, 'opeinfo');
                } catch (err) {
                    commandError = err;
                }
            }

            const changed = await _updateVarsValue(snapshot);
            lastTimestampValue = Date.now();
            _emitValues(varsValue);
            if (addDaq && changed && !utils.isEmptyObject(changed)) {
                addDaq(changed, data.name, data.id);
            }
            if (commandError) {
                throw commandError;
            }
            if (lastStatus !== 'connect-ok') {
                _emitStatus('connect-ok');
            }
        } catch (err) {
            logger.error(`'${data.name}' polling error: ${err && err.message ? err.message : err}`);
            connected = false;
            _emitStatus('connect-error');
            await _closeSocket();
        } finally {
            _checkWorking(false);
        }
    };

    this.load = function (_data) {
        varsValue = {};
        tagMap = {};
        data = JSON.parse(JSON.stringify(_data));
        data.polling = Math.max(Number(data.polling) || 3000, 3000);
        const tags = data.tags || {};
        for (const id in tags) {
            const tag = tags[id];
            tagMap[id] = {
                key: String(tag.address || tag.name || '').trim(),
                tag
            };
        }
        logger.info(`'${data.name}' data loaded (${Object.keys(tagMap).length})`, true);
    };

    this.getValues = function () {
        return varsValue;
    };

    this.getValue = function (id) {
        if (varsValue[id]) {
            return { id, value: varsValue[id].value, ts: varsValue[id].timestamp || lastTimestampValue };
        }
        return null;
    };

    this.getStatus = function () {
        return lastStatus;
    };

    this.getTagProperty = function (tagId) {
        if (data.tags && data.tags[tagId]) {
            const tag = data.tags[tagId];
            return { id: tagId, name: tag.name, type: tag.type, format: tag.format };
        }
        return null;
    };

    this.setValue = async function () {
        logger.warn(`'${data.name}' setValue not supported for Kawasaki monitor tags`);
        return false;
    };

    this.isConnected = function () {
        return !!connected;
    };

    this.bindAddDaq = function (fnc) {
        addDaq = fnc;
    };

    this.lastReadTimestamp = () => lastTimestampValue;

    this.getTagDaqSettings = (tagId) => data.tags && data.tags[tagId] ? data.tags[tagId].daq : null;
    this.setTagDaqSettings = (tagId, settings) => {
        if (data.tags && data.tags[tagId]) {
            utils.mergeObjectsValues(data.tags[tagId].daq, settings);
        }
    };

    this.browse = function () {
        return Promise.resolve({
            items: DEFAULT_TAGS.map((tag) => ({
                name: tag.name,
                label: tag.label,
                address: tag.address,
                type: tag.type
            })),
            total: DEFAULT_TAGS.length
        });
    };

    async function _openSession() {
        await _closeSocket();
        receiveBuffer = '';
        const host = _host();
        if (!host) {
            throw new Error('Kawasaki host is required');
        }
        socket = net.createConnection({ host, port: _port() });
        socket.setEncoding('utf8');
        socket.setNoDelay(true);
        socket.on('data', (chunk) => {
            receiveBuffer += sanitizeTelnetText(chunk);
        });
        socket.on('close', () => {
            connected = false;
        });
        socket.on('error', (err) => {
            logger.error(`'${data.name}' socket error: ${err && err.message ? err.message : err}`);
        });
        await _waitForConnect(socket, _timeoutMs());
        try {
            await _waitForMarker('login:', 2000);
        } catch (_) {
            // Some controllers may already be logged in or show only the AS prompt.
        }
        _sendLine(_loginCommand());
        await _waitForPrompt();
    }

    async function _runCommand(command, options) {
        receiveBuffer = '';
        _sendLine(command);
        const startedAt = Date.now();
        let deadline = startedAt + _timeoutMs();
        const hardDeadline = startedAt + Math.max(_timeoutMs() * 6, 60000);
        let response = '';
        while (Date.now() < deadline && Date.now() < hardDeadline) {
            await _sleep(DEFAULT_READ_WINDOW_MS);
            if (receiveBuffer) {
                response += receiveBuffer;
                receiveBuffer = '';
                deadline = Math.max(deadline, Date.now() + _extendMs());
            }
            if (options && options.paged && response.indexOf(PAGE_MARKER) !== -1) {
                response = response.replace(PAGE_MARKER, '');
                _sendRaw(' ');
                deadline = Math.max(deadline, Date.now() + _timeoutMs());
                continue;
            }
            if (_hasFinalPrompt(response, command)) {
                return response;
            }
        }
        throw new Error(`Timed out waiting for ${command} response`);
    }

    function _waitForPrompt() {
        return _waitForMarker(_readyMarker(), _timeoutMs());
    }

    function _waitForMarker(marker, timeoutMs) {
        const startedAt = Date.now();
        return new Promise((resolve, reject) => {
            const timer = setInterval(() => {
                if (receiveBuffer.indexOf(marker) !== -1) {
                    clearInterval(timer);
                    receiveBuffer = '';
                    resolve(true);
                    return;
                }
                if (Date.now() - startedAt > timeoutMs) {
                    clearInterval(timer);
                    reject(new Error(`Timed out waiting for telnet marker: ${marker}`));
                }
            }, 50);
        });
    }

    function _sendLine(line) {
        _sendRaw(`${line}\r\n`);
    }

    function _sendRaw(text) {
        if (socket) {
            socket.write(text, 'utf8');
        }
    }

    async function _closeSocket() {
        if (!socket) {
            return;
        }
        const oldSocket = socket;
        socket = null;
        try {
            oldSocket.removeAllListeners('data');
            oldSocket.end();
            oldSocket.destroy();
        } catch (_) {}
    }

    async function _updateVarsValue(snapshot) {
        const timestamp = Date.now();
        const changed = {};
        for (const id in tagMap) {
            const entry = tagMap[id];
            const tag = entry.tag;
            const rawValue = snapshot[entry.key];
            if (utils.isNullOrUndefined(rawValue)) {
                continue;
            }
            const prev = varsValue[id];
            const parsed = deviceUtils.parseValue(rawValue, tag.type);
            const value = await deviceUtils.tagValueCompose(parsed, prev ? prev.value : null, tag, runtime);
            const item = {
                id,
                rawValue,
                value,
                type: tag.type,
                daq: tag.daq,
                changed: !prev || prev.rawValue !== rawValue,
                tagref: tag,
                timestamp
            };
            if (addDaq && deviceUtils.tagDaqToSave(item, timestamp)) {
                changed[id] = item;
            }
            item.changed = false;
            varsValue[id] = item;
        }
        return changed;
    }

    function _clearVarsValue() {
        for (const id in varsValue) {
            varsValue[id].value = null;
        }
        _emitValues(varsValue);
    }

    function _emitValues(values) {
        events.emit('device-value:changed', { id: data.id, values });
    }

    function _emitStatus(status) {
        lastStatus = status;
        events.emit('device-status:changed', { id: data.id, status });
    }

    function _checkWorking(flag) {
        if (flag) {
            if (working) {
                if (++overloading > 3) {
                    _emitStatus('connect-busy');
                    overloading = 0;
                }
                logger.warn(`'${data.name}' working (connection || polling) overload! ${overloading}`);
                return false;
            }
            working = true;
            return true;
        }
        working = false;
        return true;
    }

    function _host() {
        return String(data.property && data.property.address || '').trim();
    }

    function _port() {
        return Number(data.property && data.property.port) || DEFAULT_PORT;
    }

    function _loginCommand() {
        return String(data.property && data.property.loginCommand || DEFAULT_LOGIN).trim() || DEFAULT_LOGIN;
    }

    function _readyMarker() {
        return String(data.property && data.property.readyMarker || DEFAULT_READY_MARKER);
    }

    function _timeoutMs() {
        return Number(data.property && data.property.timeoutMs) || DEFAULT_TIMEOUT_MS;
    }

    function _extendMs() {
        return Number(data.property && data.property.extendTimeoutMs) || DEFAULT_EXTEND_MS;
    }

    function _isOpeinfoEnabled() {
        return !(data.property && data.property.opeinfo === false);
    }

    function _hasFinalPrompt(text, command) {
        const prompt = _readyMarker();
        const lines = String(text || '').replace(/\r/g, '\n').split('\n');
        for (let index = lines.length - 1; index >= 0; index--) {
            const line = lines[index].trim();
            if (!line) {
                continue;
            }
            return line === prompt;
        }
        return false;
    }
}

function _waitForConnect(sock, timeoutMs) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Socket connect timeout')), timeoutMs);
        sock.once('connect', () => {
            clearTimeout(timer);
            resolve(true);
        });
        sock.once('error', (err) => {
            clearTimeout(timer);
            reject(err);
        });
    });
}

function _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizeTelnetText(data) {
    if (!data) {
        return '';
    }
    const text = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
    return Array.from(text).filter((char) => {
        const code = char.charCodeAt(0);
        return char === '\r' || char === '\n' || char === '\t' || code >= 32;
    }).join('');
}

function parseScalar(value) {
    const text = String(value == null ? '' : value).trim();
    const lower = text.toLowerCase();
    if (['true', 'on', 'yes'].includes(lower)) {
        return true;
    }
    if (['false', 'off', 'no'].includes(lower)) {
        return false;
    }
    const num = Number(text.replace(',', '.'));
    if (text && Number.isFinite(num)) {
        return num;
    }
    return text;
}

function parseLeadingNumber(value) {
    const text = String(value == null ? '' : value).trim();
    const match = text.match(/^(-?\d+(?:[.,]\d+)?)(?:\s|$)/);
    if (!match) {
        return parseScalar(text);
    }
    return Number(match[1].replace(',', '.'));
}

function tagName(value, fallback) {
    let base = String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
    base = base.replace(/_+/g, '_').replace(/^_+|_+$/g, '');
    return base || fallback;
}

function splitFixedColumns(line) {
    const fixed = line.split(/ {2,}/).map((x) => x.trim()).filter(Boolean);
    return fixed.length >= 3 ? fixed : line.split(/\s+/).map((x) => x.trim()).filter(Boolean);
}

function normalizeLines(responseText, command) {
    return String(responseText || '').replace(/\r/g, '\n').split('\n')
        .map((line) => line.replace(/^\s*>/, '').trim())
        .filter((line) => line && line !== '>' && line.toLowerCase() !== command);
}

function parseSta(responseText) {
    const result = {};
    const lines = normalizeLines(responseText, 'sta');
    let section = '';
    let programTablePending = false;

    for (const line of lines) {
        const lower = line.toLowerCase();
        if (line.endsWith(':') && line.indexOf('=') === -1) {
            const header = line.slice(0, -1).trim().toLowerCase();
            if (['robot status', 'environment', 'execution cycles'].includes(header)) {
                section = header;
                continue;
            }
        }
        if (line.startsWith('Program name') && line.indexOf('Priority') !== -1 && line.indexOf('Step No.') !== -1) {
            programTablePending = true;
            continue;
        }
        if (line === 'No program is running.') {
            result['sta.program_running'] = false;
            programTablePending = false;
            continue;
        }
        if (programTablePending) {
            const columns = splitFixedColumns(line);
            if (columns.length >= 3) {
                result['sta.program_running'] = true;
                result['sta.program_name'] = columns[0];
                result['sta.program_priority'] = parseScalar(columns[1]);
                result['sta.program_step_no'] = parseScalar(columns[2]);
                if (columns.length > 3) {
                    result['sta.program_step_detail'] = columns.slice(3).join(' ');
                }
                programTablePending = false;
                continue;
            }
        }
        if (lower.startsWith('stepper status:')) {
            result['sta.stepper_status'] = line.split(':').slice(1).join(':').trim();
            continue;
        }
        if (lower.startsWith('pc status:')) {
            result['sta.pc_status'] = line.split(':').slice(1).join(':').trim();
            continue;
        }
        if (lower.startsWith('now moving program') && line.indexOf('=') !== -1) {
            result['sta.now_moving_program'] = parseScalar(line.split('=').slice(1).join('='));
            continue;
        }
        if (lower.startsWith('now moving step') && line.indexOf('=') !== -1) {
            result['sta.now_moving_step'] = parseScalar(line.split('=').slice(1).join('='));
            continue;
        }
        if (section === 'robot status') {
            result['sta.robot_status_raw'] = line;
            const modeMatch = line.match(/^([A-Z]+)\s+mode\b/i);
            if (modeMatch) {
                result['sta.mode'] = modeMatch[1].toUpperCase();
            }
            result['sta.cycle_start'] = /\bCYCLE\s+START\s+ON\b/i.test(line);
            result['sta.motor_power'] = /\bMOTOR\s+POWER\s+ON\b/i.test(line) ? true :
                (/\bMOTOR\s+POWER\s+OFF\b/i.test(line) ? false : result['sta.motor_power']);
            continue;
        }
        if (section === 'environment' && line.indexOf('=') !== -1) {
            const [name, ...rest] = line.split('=');
            const label = name.trim();
            const value = rest.join('=').trim();
            if (label === 'Monitor speed(%)') {
                result['sta.monitor_speed_percent'] = parseScalar(value);
                continue;
            }
            if (label === 'Program speed(%) ALWAYS') {
                const values = value.split(/\s+/).filter(Boolean);
                if (values[0]) {
                    result['sta.program_speed_percent'] = parseScalar(values[0]);
                }
                if (values[1]) {
                    result['sta.program_speed_always_percent'] = parseScalar(values[1]);
                }
                continue;
            }
            if (label === 'ALWAYS Accu.[mm]') {
                result['sta.always_accu_mm'] = parseScalar(value);
                continue;
            }
        }
        if (section === 'execution cycles' && line.indexOf(':') !== -1) {
            const [name, ...rest] = line.split(':');
            result[`sta.${tagName(name, 'execution_cycle')}`] = parseScalar(rest.join(':'));
            continue;
        }
        if (line.indexOf('=') !== -1) {
            const [name, ...rest] = line.split('=');
            result[`sta.${tagName(name, 'value')}`] = parseScalar(rest.join('='));
            continue;
        }
        if (line.indexOf(':') !== -1) {
            const [name, ...rest] = line.split(':');
            result[`sta.${tagName(name, 'value')}`] = parseScalar(rest.join(':'));
            continue;
        }
        result['sta.trailing_status_raw'] = line;
    }
    return result;
}

function parseOpeinfo(responseText) {
    const result = {};
    const lines = normalizeLines(responseText, 'opeinfo')
        .filter((line) => !line.toLowerCase().startsWith('press space key to continue'));
    let currentAxis = '';
    let lineIndex = 0;

    for (const line of lines) {
        if (line.startsWith('Operation information (')) {
            result['opeinfo.header'] = line;
            const headerMatch = line.match(/^Operation information\s*\((.*?)\)\s*\(\s*FILE LOAD\s+(.*?)\s*\)$/i);
            if (headerMatch) {
                result['opeinfo.operation_date'] = headerMatch[1].replace(/\s*-\s*$/, '').trim();
                result['opeinfo.file_load_date'] = headerMatch[2].trim();
            }
            continue;
        }
        if (/^JT\d+$/i.test(line)) {
            currentAxis = line.toLowerCase();
            result[`opeinfo.${currentAxis}.section`] = line.toUpperCase();
            continue;
        }
        const pieces = line.split(/ {2,}/).map((x) => x.trim()).filter(Boolean);
        if (pieces.length >= 2) {
            const label = pieces.slice(0, -1).join(' ');
            const valueText = pieces[pieces.length - 1];
            const normalizedLabel = label.toLowerCase();
            const globalKeys = {
                'hour meter': 'hour_meter_h',
                'time of control power on': 'control_power_on_h',
                'time of servo on': 'servo_on_h',
                'frequency of motor on': 'motor_on_count',
                'frequency of servo on': 'servo_on_count',
                'frequency of e-stop(moving)': 'estop_moving_count'
            };
            const axisKeys = {
                'total time in move': 'move_time_h',
                'total displacement': 'displacement_total',
                'total displacement(+)': 'displacement_positive',
                'total displacement(-)': 'displacement_negative'
            };
            const deterministicKey = currentAxis ? axisKeys[normalizedLabel] : globalKeys[normalizedLabel];
            if (deterministicKey) {
                result[currentAxis ? `opeinfo.${currentAxis}.${deterministicKey}` : `opeinfo.${deterministicKey}`] =
                    parseLeadingNumber(valueText);
                continue;
            }
            const value = parseScalar(valueText);
            const key = tagName(label, `line_${lineIndex + 1}`);
            result[currentAxis ? `opeinfo.${currentAxis}.${key}` : `opeinfo.${key}`] = value;
            continue;
        }
        lineIndex++;
        result[`opeinfo.line_${String(lineIndex).padStart(2, '0')}`] = line;
    }
    return result;
}

function _stripCommandNoise(responseText, command) {
    return normalizeLines(responseText, command)
        .filter((line) => !line.toLowerCase().startsWith('press space key to continue'))
        .join('\n');
}

const DEFAULT_TAGS = [
    { name: 'sta_mode', label: 'STA mode', address: 'sta.mode', type: 'string' },
    { name: 'sta_cycle_start', label: 'STA cycle start', address: 'sta.cycle_start', type: 'boolean' },
    { name: 'sta_robot_status_raw', label: 'STA robot status raw', address: 'sta.robot_status_raw', type: 'string' },
    { name: 'sta_moving_program', label: 'STA moving program', address: 'sta.now_moving_program', type: 'string' },
    { name: 'sta_moving_step', label: 'STA moving step', address: 'sta.now_moving_step', type: 'number' },
    { name: 'sta_stepper_status', label: 'STA stepper status', address: 'sta.stepper_status', type: 'string' },
    { name: 'sta_program_running', label: 'STA program running', address: 'sta.program_running', type: 'boolean' },
    { name: 'sta_program_name', label: 'STA program name', address: 'sta.program_name', type: 'string' },
    { name: 'sta_program_step_no', label: 'STA program step no', address: 'sta.program_step_no', type: 'number' },
    { name: 'sta_completed_cycles', label: 'STA completed cycles', address: 'sta.completed_cycles', type: 'number' },
    { name: 'sta_remaining_cycles', label: 'STA remaining cycles', address: 'sta.remaining_cycles', type: 'number' },
    { name: 'sta_monitor_speed_percent', label: 'STA monitor speed percent', address: 'sta.monitor_speed_percent', type: 'number' },
    { name: 'sta_program_speed_percent', label: 'STA program speed percent', address: 'sta.program_speed_percent', type: 'number' },
    { name: 'sta_program_speed_always_percent', label: 'STA program speed always percent', address: 'sta.program_speed_always_percent', type: 'number' },
    { name: 'sta_always_accu_mm', label: 'STA always accu mm', address: 'sta.always_accu_mm', type: 'number' },
    { name: 'sta_trailing_status_raw', label: 'STA trailing status raw', address: 'sta.trailing_status_raw', type: 'string' },
    { name: 'opeinfo_header', label: 'OPEINFO header', address: 'opeinfo.header', type: 'string' },
    { name: 'opeinfo_hour_meter_h', label: 'OPEINFO hour meter', address: 'opeinfo.hour_meter_h', type: 'number' },
    { name: 'opeinfo_control_power_on_h', label: 'OPEINFO control power on', address: 'opeinfo.control_power_on_h', type: 'number' },
    { name: 'opeinfo_servo_on_h', label: 'OPEINFO servo on', address: 'opeinfo.servo_on_h', type: 'number' },
    { name: 'opeinfo_raw', label: 'OPEINFO raw', address: 'opeinfo.raw', type: 'string' }
];

module.exports = {
    init: function () {},
    create: function (data, logger, events, manager, runtime) {
        return new KawasakiClient(data, logger, events, manager, runtime);
    },
    parseSta,
    parseOpeinfo,
    DEFAULT_TAGS
};
