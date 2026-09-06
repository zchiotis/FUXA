/**
 * Kawasaki AS monitor telnet driver.
 *
 * Keeps one persistent telnet session open and polls STA/OPEINFO/ERRLOG serially.
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
const DEFAULT_ERRLOG_INTERVAL_MS = 30000;
const ERRLOG_SLOT_COUNT = 10;
const DEFAULT_ERRLOG_IGNORE_CODES = 'E1326';
const PAGE_MARKER = 'Press SPACE key to continue.';
const ACQUISITION_CANCELLED = 'KAWASAKI_ACQUISITION_CANCELLED';

// Device objects are recreated at each VPN visit; retain history for this FUXA runtime.
const errlogRuntimeCaches = new WeakMap();

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
    let latestSnapshot = {};
    let sessionMonitor = '';
    let errlogWatermark = '';
    let errlogSlots = Array(ERRLOG_SLOT_COUNT).fill(null);
    let errlogNextSlot = 0;
    let nextErrlogAt = 0;
    let acquisitionState = 'pending';
    let acquisitionError = '';
    let cancelled = false;
    let traffic = { rx: 0, tx: 0, sta: 0, opeinfo: 0, errlog: 0 };

    this.getAcquisitionStatus = () => ({
        state: data.runtimeAcquisitionOnce ? acquisitionState : 'continuous',
        error: acquisitionError
    });

    function historyCache() {
        if (!runtime || typeof runtime !== 'object') return null;
        if (!errlogRuntimeCaches.has(runtime)) errlogRuntimeCaches.set(runtime, new Map());
        return errlogRuntimeCaches.get(runtime);
    }

    function historyIdentity() {
        return JSON.stringify([_host(), _port(), _loginCommand(), Array.from(_errlogIgnoredCodes()).sort()]);
    }

    function saveHistory() {
        const cache = historyCache();
        if (cache) cache.set(data.id, {
            identity: historyIdentity(), watermark: errlogWatermark,
            slots: errlogSlots.map(entry => entry && { ...entry }), nextSlot: errlogNextSlot
        });
    }

    this.init = function () {};

    this.connect = function () {
        return new Promise(async (resolve, reject) => {
            cancelled = false;
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
            cancelled = true;
            _checkWorking(false);
            await _closeSocket();
            connected = false;
            _emitStatus('connect-off');
            _clearVarsValue();
            resolve(true);
        });
    };

    this.polling = async function () {
        if (data.runtimeAcquisitionOnce && acquisitionState !== 'pending') return;
        if (data.runtimeAcquisitionOnce && working) return;
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
            if (sessionMonitor) {
                snapshot['session.monitor'] = sessionMonitor;
            }
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

            if (!commandError && _isErrlogEnabled() && Date.now() >= nextErrlogAt) {
                try {
                    const errlogResult = await _runErrlogIncremental();
                    if (errlogResult.firstFingerprint) {
                        errlogWatermark = errlogResult.firstFingerprint;
                    }
                    _storeErrlogEntries(errlogResult.entries);
                    _appendErrlogSlots(snapshot);
                    saveHistory();
                } catch (err) {
                    commandError = err;
                } finally {
                    nextErrlogAt = Date.now() + _errlogIntervalMs();
                }
            }

            // A managed visit must not be acknowledged using a partial command result.
            if (commandError && data.runtimeAcquisitionOnce) throw commandError;
            latestSnapshot = Object.assign({}, latestSnapshot, snapshot);
            const changed = await _updateVarsValue(snapshot);
            lastTimestampValue = Date.now();
            if (data.runtimeAcquisitionOnce) {
                await _closeSocket();
                connected = false;
                acquisitionState = 'complete';
                logger.info(`'${data.name}' acquisition complete: STA=${traffic.sta} OPEINFO=${traffic.opeinfo} ERRLOG=${traffic.errlog} rx=${traffic.rx} tx=${traffic.tx} bytes (Telnet only)`, true);
            }
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
            if (_isCancellation(err)) {
                return;
            }
            if (data.runtimeAcquisitionOnce) {
                acquisitionState = 'error';
                acquisitionError = err && err.message ? err.message : String(err);
            }
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
        latestSnapshot = {};
        sessionMonitor = '';
        errlogWatermark = '';
        errlogSlots = Array(ERRLOG_SLOT_COUNT).fill(null);
        errlogNextSlot = 0;
        nextErrlogAt = 0;
        data = JSON.parse(JSON.stringify(_data));
        acquisitionState = 'pending';
        acquisitionError = '';
        cancelled = false;
        traffic = { rx: 0, tx: 0, sta: 0, opeinfo: 0, errlog: 0 };
        const saved = historyCache()?.get(data.id);
        if (saved && saved.identity === historyIdentity()) {
            errlogWatermark = saved.watermark;
            errlogSlots = saved.slots.map(entry => entry && { ...entry });
            errlogNextSlot = saved.nextSlot;
        }
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
        const definitions = new Map(DEFAULT_TAGS.map((tag) => [tag.address, tag]));
        Object.keys(latestSnapshot).sort().forEach((address) => {
            if (definitions.has(address)) {
                return;
            }
            const value = latestSnapshot[address];
            definitions.set(address, {
                name: tagName(address, 'kawasaki_tag'),
                label: address,
                address,
                type: typeof value === 'boolean' ? 'boolean' : (typeof value === 'number' ? 'number' : 'string')
            });
        });
        return Promise.resolve({
            items: Array.from(definitions.values()).map((tag) => ({
                name: tag.name,
                label: tag.label,
                address: tag.address,
                type: tag.type
            })),
            total: definitions.size
        });
    };

    async function _openSession() {
        await _closeSocket();
        receiveBuffer = '';
        sessionMonitor = '';
        const host = _host();
        if (!host) {
            throw new Error('Kawasaki host is required');
        }
        socket = net.createConnection({ host, port: _port() });
        socket.setEncoding('utf8');
        socket.setNoDelay(true);
        socket.on('data', (chunk) => {
            traffic.rx += Buffer.byteLength(chunk, 'utf8');
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
        const loginResponse = await _waitForPrompt();
        sessionMonitor = parseMonitorName(loginResponse);
        if (sessionMonitor) {
            logger.info(`'${data.name}' Kawasaki monitor terminal ${sessionMonitor}`, true);
        } else {
            logger.warn(`'${data.name}' Kawasaki monitor terminal name was not found in the login response`);
        }
    }

    async function _runCommand(command, options) {
        traffic[command]++;
        receiveBuffer = '';
        _sendLine(command);
        const startedAt = Date.now();
        let deadline = startedAt + _timeoutMs();
        const hardDeadline = startedAt + Math.max(_timeoutMs() * 6, 60000);
        let response = '';
        while (Date.now() < deadline && Date.now() < hardDeadline) {
            _throwIfCancelled();
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

    async function _runErrlogIncremental() {
        traffic.errlog++;
        receiveBuffer = '';
        _sendLine('errlog');

        const previousWatermark = errlogWatermark;
        const ignoredCodes = _errlogIgnoredCodes();
        const entries = [];
        let firstFingerprint = '';
        let stopRequested = false;
        let requestedAfterCompleteScan = false;
        let stopDeadline = 0;
        let managedStopReadyAt = 0;
        let responseTail = '';
        let idleDeadline = Date.now() + _timeoutMs();
        const hardDeadline = Date.now() + Math.max(_timeoutMs() * 12, 120000);

        const requestStop = (completeScan = false) => {
            if (!stopRequested) {
                stopRequested = true;
                requestedAfterCompleteScan = completeScan;
                stopDeadline = Date.now() + _timeoutMs();
                managedStopReadyAt = Date.now() + 250;
                _sendLine('');
            }
        };
        const parser = createErrlogStreamParser((entry) => {
            if (stopRequested) {
                return;
            }
            const fingerprint = errlogFingerprint(entry);
            if (!firstFingerprint) {
                firstFingerprint = fingerprint;
            }
            if (previousWatermark && fingerprint === previousWatermark) {
                requestStop(true);
                return;
            }
            if (ignoredCodes.has(entry.code)) {
                return;
            }
            entries.push(entry);
            if (entries.length >= ERRLOG_SLOT_COUNT) {
                requestStop(true);
            }
        });

        while (Date.now() < hardDeadline) {
            _throwIfCancelled();
            await _sleep(50);
            if (receiveBuffer) {
                const chunk = receiveBuffer;
                receiveBuffer = '';
                responseTail = `${responseTail}${chunk}`.slice(-4096);
                parser.push(chunk);
                idleDeadline = Date.now() + _timeoutMs();
                if (!stopRequested && responseTail.indexOf(PAGE_MARKER) !== -1) {
                    responseTail = responseTail.replace(PAGE_MARKER, '');
                    _sendRaw(' ');
                }
            }
            if (_hasFinalPrompt(responseTail, 'errlog')) {
                parser.flush();
                return { entries, firstFingerprint };
            }
            // ERRLOG is the final command of a managed VPN visit. Once enough
            // history is collected, close the session instead of waiting for a
            // prompt that some controllers do not send after Enter.
            if (stopRequested && requestedAfterCompleteScan && data.runtimeAcquisitionOnce &&
                    Date.now() >= managedStopReadyAt) {
                parser.flush();
                return { entries, firstFingerprint };
            }
            if (stopRequested && Date.now() > stopDeadline) {
                throw new Error('Timed out waiting for ERRLOG to stop');
            }
            if (!stopRequested && Date.now() > idleDeadline) {
                requestStop();
            }
        }
        throw new Error('Timed out waiting for ERRLOG response');
    }

    function _storeErrlogEntries(entries) {
        entries.slice().reverse().forEach((entry) => {
            errlogSlots[errlogNextSlot] = entry;
            errlogNextSlot = (errlogNextSlot + 1) % ERRLOG_SLOT_COUNT;
        });
    }

    function _appendErrlogSlots(snapshot) {
        errlogSlots.forEach((entry, index) => {
            const prefix = `errlog.slot_${String(index + 1).padStart(2, '0')}`;
            snapshot[`${prefix}.timestamp_ms`] = entry ? entry.timestampMs : 0;
            snapshot[`${prefix}.code`] = entry ? entry.code : '';
            snapshot[`${prefix}.message`] = entry ? entry.message : '';
        });
    }

    function _waitForPrompt() {
        return _waitForMarker(_readyMarker(), _timeoutMs());
    }

    function _waitForMarker(marker, timeoutMs) {
        const startedAt = Date.now();
        return new Promise((resolve, reject) => {
            const timer = setInterval(() => {
                if (cancelled) {
                    clearInterval(timer);
                    reject(_cancellationError());
                    return;
                }
                if (receiveBuffer.indexOf(marker) !== -1) {
                    clearInterval(timer);
                    const response = receiveBuffer;
                    receiveBuffer = '';
                    resolve(response);
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
            traffic.tx += Buffer.byteLength(text, 'utf8');
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

    function _isErrlogEnabled() {
        return !!(data.property && data.property.errlog);
    }

    function _errlogIntervalMs() {
        return Math.max(Number(data.property && data.property.errlogIntervalMs) || DEFAULT_ERRLOG_INTERVAL_MS, 3000);
    }

    function _errlogIgnoredCodes() {
        const configured = data.property && data.property.errlogIgnoreCodes;
        return new Set(String(configured == null ? DEFAULT_ERRLOG_IGNORE_CODES : configured)
            .split(/[\s,;]+/)
            .map((code) => code.trim().toUpperCase())
            .filter(Boolean));
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

    function _throwIfCancelled() {
        if (cancelled) throw _cancellationError();
    }
}

function _cancellationError() {
    const error = new Error('Acquisition cancelled');
    error.code = ACQUISITION_CANCELLED;
    return error;
}

function _isCancellation(error) {
    return !!error && error.code === ACQUISITION_CANCELLED;
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

function parseMonitorName(responseText) {
    const text = String(responseText || '');
    const quoted = text.match(/This\s+is\s+AS\s+monitor\s+terminal\s+"([^"\r\n]+)"/i);
    if (quoted) {
        return quoted[1].trim();
    }
    const unquoted = text.match(/This\s+is\s+AS\s+monitor\s+terminal\s+([^\r\n]+)/i);
    return unquoted ? unquoted[1].trim() : '';
}

function parseErrlogHeader(line) {
    const match = String(line || '').match(
        /^\s*(\d+)\s+-\s+\[(\d{2}\/\d{2}\/\d{2}\s+\d{2}:\d{2}:\d{2})(?:\s+(.+?))?\]\s+\(([^)]+)\)\s*$/
    );
    if (!match) {
        return null;
    }
    return {
        displayIndex: Number(match[1]),
        timestamp: match[2],
        timestampMs: parseErrlogTimestampMs(match[2]),
        mode: String(match[3] || '').trim(),
        source: String(match[4] || '').trim()
    };
}

function parseErrlogTimestampMs(value) {
    const match = String(value || '').match(/^(\d{2})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/);
    if (!match) {
        return 0;
    }
    const date = new Date(
        2000 + Number(match[1]),
        Number(match[2]) - 1,
        Number(match[3]),
        Number(match[4]),
        Number(match[5]),
        Number(match[6])
    );
    return Number.isFinite(date.getTime()) ? date.getTime() : 0;
}

function createErrlogStreamParser(onEntry) {
    let pending = '';
    let header = null;

    function processLine(rawLine) {
        const line = String(rawLine || '').trim();
        const parsedHeader = parseErrlogHeader(line);
        if (parsedHeader) {
            header = parsedHeader;
            return;
        }
        if (!header) {
            return;
        }
        const messageMatch = line.match(/^\(([A-Z]\d+)\)\s*(.*?)\s*$/i);
        if (!messageMatch) {
            return;
        }
        const entry = Object.assign({}, header, {
            code: messageMatch[1].toUpperCase(),
            message: messageMatch[2].trim()
        });
        header = null;
        onEntry(entry);
    }

    return {
        push(text) {
            pending += String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
            const lines = pending.split('\n');
            pending = lines.pop();
            lines.forEach(processLine);
        },
        flush() {
            if (pending) {
                processLine(pending);
                pending = '';
            }
        }
    };
}

function parseErrlogEntries(responseText) {
    const entries = [];
    const parser = createErrlogStreamParser((entry) => entries.push(entry));
    parser.push(responseText);
    parser.flush();
    return entries;
}

function errlogFingerprint(entry) {
    return [entry.timestamp, entry.mode, entry.source, entry.code, entry.message].join('|');
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
    { name: 'session_monitor', label: 'Session monitor terminal', address: 'session.monitor', type: 'string' },
    { name: 'sta_mode', label: 'STA mode', address: 'sta.mode', type: 'string' },
    { name: 'sta_cycle_start', label: 'STA cycle start', address: 'sta.cycle_start', type: 'boolean' },
    { name: 'sta_motor_power', label: 'STA motor power', address: 'sta.motor_power', type: 'boolean' },
    { name: 'sta_robot_status_raw', label: 'STA robot status raw', address: 'sta.robot_status_raw', type: 'string' },
    { name: 'sta_moving_program', label: 'STA moving program', address: 'sta.now_moving_program', type: 'string' },
    { name: 'sta_moving_step', label: 'STA moving step', address: 'sta.now_moving_step', type: 'number' },
    { name: 'sta_stepper_status', label: 'STA stepper status', address: 'sta.stepper_status', type: 'string' },
    { name: 'sta_pc_status', label: 'STA PC status', address: 'sta.pc_status', type: 'string' },
    { name: 'sta_program_running', label: 'STA program running', address: 'sta.program_running', type: 'boolean' },
    { name: 'sta_program_name', label: 'STA program name', address: 'sta.program_name', type: 'string' },
    { name: 'sta_program_priority', label: 'STA program priority', address: 'sta.program_priority', type: 'number' },
    { name: 'sta_program_step_no', label: 'STA program step no', address: 'sta.program_step_no', type: 'number' },
    { name: 'sta_program_step_detail', label: 'STA program step detail', address: 'sta.program_step_detail', type: 'string' },
    { name: 'sta_completed_cycles', label: 'STA completed cycles', address: 'sta.completed_cycles', type: 'number' },
    { name: 'sta_remaining_cycles', label: 'STA remaining cycles', address: 'sta.remaining_cycles', type: 'number' },
    { name: 'sta_monitor_speed_percent', label: 'STA monitor speed percent', address: 'sta.monitor_speed_percent', type: 'number' },
    { name: 'sta_program_speed_percent', label: 'STA program speed percent', address: 'sta.program_speed_percent', type: 'number' },
    { name: 'sta_program_speed_always_percent', label: 'STA program speed always percent', address: 'sta.program_speed_always_percent', type: 'number' },
    { name: 'sta_always_accu_mm', label: 'STA always accu mm', address: 'sta.always_accu_mm', type: 'number' },
    { name: 'sta_trailing_status_raw', label: 'STA trailing status raw', address: 'sta.trailing_status_raw', type: 'string' },
    { name: 'sta_raw', label: 'STA raw response', address: 'sta.raw', type: 'string' },
    { name: 'opeinfo_header', label: 'OPEINFO header', address: 'opeinfo.header', type: 'string' },
    { name: 'opeinfo_operation_date', label: 'OPEINFO operation date', address: 'opeinfo.operation_date', type: 'string' },
    { name: 'opeinfo_file_load_date', label: 'OPEINFO file load date', address: 'opeinfo.file_load_date', type: 'string' },
    { name: 'opeinfo_hour_meter_h', label: 'OPEINFO hour meter', address: 'opeinfo.hour_meter_h', type: 'number' },
    { name: 'opeinfo_control_power_on_h', label: 'OPEINFO control power on', address: 'opeinfo.control_power_on_h', type: 'number' },
    { name: 'opeinfo_servo_on_h', label: 'OPEINFO servo on', address: 'opeinfo.servo_on_h', type: 'number' },
    { name: 'opeinfo_motor_on_count', label: 'OPEINFO motor on count', address: 'opeinfo.motor_on_count', type: 'number' },
    { name: 'opeinfo_servo_on_count', label: 'OPEINFO servo on count', address: 'opeinfo.servo_on_count', type: 'number' },
    { name: 'opeinfo_estop_moving_count', label: 'OPEINFO E-STOP moving count', address: 'opeinfo.estop_moving_count', type: 'number' },
    { name: 'opeinfo_raw', label: 'OPEINFO raw', address: 'opeinfo.raw', type: 'string' }
];

for (let slot = 1; slot <= ERRLOG_SLOT_COUNT; slot++) {
    const slotName = String(slot).padStart(2, '0');
    const prefix = `errlog.slot_${slotName}`;
    DEFAULT_TAGS.push(
        { name: `errlog_slot_${slotName}_timestamp_ms`, label: `ERRLOG slot ${slotName} timestamp`, address: `${prefix}.timestamp_ms`, type: 'number' },
        { name: `errlog_slot_${slotName}_code`, label: `ERRLOG slot ${slotName} code`, address: `${prefix}.code`, type: 'string' },
        { name: `errlog_slot_${slotName}_message`, label: `ERRLOG slot ${slotName} message`, address: `${prefix}.message`, type: 'string' }
    );
}

for (let axis = 1; axis <= 8; axis++) {
    const prefix = `opeinfo.jt${axis}`;
    DEFAULT_TAGS.push(
        { name: `opeinfo_jt${axis}_section`, label: `OPEINFO JT${axis} section`, address: `${prefix}.section`, type: 'string' },
        { name: `opeinfo_jt${axis}_move_time_h`, label: `OPEINFO JT${axis} move time`, address: `${prefix}.move_time_h`, type: 'number' },
        { name: `opeinfo_jt${axis}_displacement_total`, label: `OPEINFO JT${axis} displacement total`, address: `${prefix}.displacement_total`, type: 'number' },
        { name: `opeinfo_jt${axis}_displacement_positive`, label: `OPEINFO JT${axis} displacement positive`, address: `${prefix}.displacement_positive`, type: 'number' },
        { name: `opeinfo_jt${axis}_displacement_negative`, label: `OPEINFO JT${axis} displacement negative`, address: `${prefix}.displacement_negative`, type: 'number' }
    );
}

module.exports = {
    init: function () {},
    create: function (data, logger, events, manager, runtime) {
        return new KawasakiClient(data, logger, events, manager, runtime);
    },
    parseSta,
    parseOpeinfo,
    parseMonitorName,
    parseErrlogEntries,
    parseErrlogTimestampMs,
    createErrlogStreamParser,
    errlogFingerprint,
    DEFAULT_TAGS
};
