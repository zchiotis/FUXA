/**
 * Talk2M Automator coordinator.
 *
 * Controls the local Windows automator, enables mapped FUXA connections only
 * for the active VPN site, and waits for fresh required tags.
 */

'use strict';

const axios = require('axios');
const utils = require('../../utils');

const DEFAULT_ENDPOINT = 'http://127.0.0.1:17831';
const DEFAULT_TIMEOUT_SECONDS = 90;
const DEFAULT_CYCLE_DELAY_SECONDS = 300;
const DEFAULT_FAILURE_DELAY_SECONDS = 5;

const TAG_DEFINITIONS = [
    { address: 'automator.alive', name: 'automator_alive', label: 'Automator reachable', type: 'boolean' },
    { address: 'ecatcher.running', name: 'ecatcher_running', label: 'eCatcher running', type: 'boolean' },
    { address: 'ecatcher.connected_site', name: 'ecatcher_connected_site', label: 'Connected site', type: 'string' },
    { address: 'sites.online_count', name: 'sites_online_count', label: 'Online sites', type: 'number' },
    { address: 'cycle.state', name: 'cycle_state', label: 'Collection state', type: 'string' },
    { address: 'cycle.site', name: 'cycle_site', label: 'Collection site', type: 'string' },
    { address: 'cycle.required_tags', name: 'cycle_required_tags', label: 'Required tags', type: 'number' },
    { address: 'cycle.updated_tags', name: 'cycle_updated_tags', label: 'Fresh tags', type: 'number' },
    { address: 'cycle.last_success_at', name: 'cycle_last_success_at', label: 'Last success timestamp', type: 'number' },
    { address: 'cycle.last_error', name: 'cycle_last_error', label: 'Last collection error', type: 'string' },
    { address: 'next_acquisition_ts', name: 'next_acquisition_ts', label: 'Next acquisition timestamp', type: 'number' },
];

function T2MAutomatorClient(_data, logger, events, _manager, runtime) {
    let data = JSON.parse(JSON.stringify(_data));
    let connected = false;
    let lastReadTimestamp = null;
    let lastStatus = 'connect-off';
    let varsValue = {};
    let tagMap = {};
    let latestAutomatorStatus = null;
    let cyclePromise = null;
    let pollingBusy = false;
    let stopping = false;
    let mappingIndex = 0;
    let nextCycleAt = 0;
    let activeCycle = createCycleState();
    let freshTagValues = new Map();

    const onDeviceValues = (event) => {
        if (!cyclePromise || activeCycle.state !== 'collecting' || !event || !event.values) {
            return;
        }
        const receivedAt = Date.now();
        if (receivedAt < activeCycle.startedAt) {
            return;
        }
        acceptFreshValues(event.values, receivedAt, 'event');
    };
    events.on('device-value:changed', onDeviceValues);

    this.init = function () {};

    this.connect = async function () {
        try {
            latestAutomatorStatus = await get('/v1/status');
            connected = true;
            lastReadTimestamp = Date.now();
            emitStatus('connect-ok');
            applyAutomatorStatus(latestAutomatorStatus);
            return true;
        } catch (err) {
            connected = false;
            emitStatus('connect-error');
            throw err;
        }
    };

    this.disconnect = async function () {
        stopping = true;
        try {
            await disableAllMappedDevices();
            if (latestAutomatorStatus && connectedSite(latestAutomatorStatus)) {
                await sendCommand('disconnect', '', commandTimeoutMs());
            }
        } catch (err) {
            logger.error(`'${data.name}' shutdown cleanup failed: ${message(err)}`);
        }
        connected = false;
        emitStatus('connect-off');
        clearValues();
        events.removeListener('device-value:changed', onDeviceValues);
        return true;
    };

    this.polling = async function () {
        if (pollingBusy || stopping || cyclePromise) {
            return;
        }
        pollingBusy = true;
        try {
            latestAutomatorStatus = await get('/v1/status');
            connected = true;
            lastReadTimestamp = Date.now();
            emitStatus('connect-ok');
            applyAutomatorStatus(latestAutomatorStatus);
            if (autoCycle() && !cyclePromise && Date.now() >= nextCycleAt) {
                const mapping = nextMapping();
                if (mapping) {
                    let cycleSucceeded = false;
                    cyclePromise = runCycle(mapping)
                        .then(() => { cycleSucceeded = true; })
                        .catch((err) => logger.error(`'${data.name}' cycle failed: ${message(err)}`))
                        .finally(() => {
                            cyclePromise = null;
                            const nextDelayMs = cycleSucceeded
                                ? cycleDelayMs()
                                : failureDelayMs();
                            nextCycleAt = calculateNextAcquisitionTimestamp(Date.now(), nextDelayMs);
                            setValue('next_acquisition_ts', nextCycleAt);
                            emitValues();
                        });
                }
            }
        } catch (err) {
            connected = false;
            setValue('automator.alive', false);
            emitValues();
            setCycleError(message(err));
            emitStatus('connect-error');
        } finally {
            pollingBusy = false;
        }
    };

    this.load = function (_data) {
        data = JSON.parse(JSON.stringify(_data));
        varsValue = {};
        tagMap = {};
        Object.values(data.tags || {}).forEach((tag) => {
            tagMap[String(tag.address || tag.name || '').trim()] = tag;
        });
        stopping = false;
        nextCycleAt = Date.now();
        setValue('cycle.state', 'idle');
        logger.info(`'${data.name}' Talk2M Automator data loaded`, true);
    };

    this.getValues = () => varsValue;
    this.getValue = (id) => varsValue[id] || null;
    this.getStatus = () => lastStatus;
    this.isConnected = () => connected;
    this.lastReadTimestamp = () => lastReadTimestamp;
    this.setValue = async function () { return false; };
    this.bindAddDaq = function () {};
    this.getTagProperty = function (tagId) {
        const tag = data.tags && data.tags[tagId];
        return tag ? { id: tagId, name: tag.name, type: tag.type, format: tag.format } : null;
    };
    this.getTagDaqSettings = (tagId) => data.tags && data.tags[tagId] ? data.tags[tagId].daq : null;
    this.setTagDaqSettings = (tagId, settings) => {
        if (data.tags && data.tags[tagId]) {
            utils.mergeObjectsValues(data.tags[tagId].daq, settings);
        }
    };
    this.browse = async function () {
        let sites = [];
        try {
            const response = await get('/v1/sites');
            sites = responseSites(response);
        } catch (_) {}
        return {
            items: TAG_DEFINITIONS.concat(sites.map((site) => ({
                address: `site.${safeName(site.name)}.online`,
                name: `site_${safeName(site.name)}_online`,
                label: `${site.name} online`,
                type: 'boolean',
            }))),
            sites,
            total: TAG_DEFINITIONS.length + sites.length,
        };
    };

    async function runCycle(mapping) {
        activeCycle = createCycleState(mapping);
        freshTagValues = new Map();
        setCycleState('preparing');
        try {
            await disableAllMappedDevices();
            if (connectedSite(latestAutomatorStatus)) {
                await sendCommand('disconnect', '', commandTimeoutMs());
            }
            setCycleState('connecting');
            const connectResult = await sendCommand('connect', mapping.site, commandTimeoutMs());
            if (!connectResult.success || !sameText(connectResult.connectedSite, mapping.site)) {
                throw new Error(connectResult.message || `Could not verify VPN site '${mapping.site}'`);
            }

            activeCycle.startedAt = Date.now();
            activeCycle.requiredTagIds = new Set(normalizeList(mapping.requiredTags));
            activeCycle.requiredTags = activeCycle.requiredTagIds.size;
            if (!activeCycle.requiredTags) {
                throw new Error(`No required tags are mapped for '${mapping.site}'`);
            }
            setCycleState('collecting');
            for (const deviceName of normalizeList(mapping.connections)) {
                await runtime.devices.setDeviceRuntimeEnabled(deviceName, true);
                activeCycle.enabledDevices.add(deviceName);
            }
            await waitForRequiredTags();
            activeCycle.lastSuccessAt = Date.now();
            activeCycle.lastError = '';
            setCycleState('ready');
            events.emit('t2m-cycle:ready', {
                site: mapping.site,
                timestamp: activeCycle.lastSuccessAt,
                values: Array.from(freshTagValues.values()),
            });
        } catch (err) {
            setCycleError(message(err));
            throw err;
        } finally {
            setCycleState('disconnecting');
            try {
                await disableDevices(Array.from(activeCycle.enabledDevices));
                await sendCommand('disconnect', '', commandTimeoutMs());
            } catch (err) {
                setCycleError(`Cleanup blocked: ${message(err)}. VPN was left unchanged for safety.`);
            }
            setCycleState(activeCycle.lastError ? 'error' : 'idle');
        }
    }

    async function sendCommand(action, site, timeoutMs) {
        const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        let command = await post('/v1/commands', { id, action, site: site || '' });
        const started = Date.now();
        while (command.state === 'queued' || command.state === 'running') {
            if (Date.now() - started > timeoutMs) {
                throw new Error(`${action} command timed out`);
            }
            await delay(500);
            command = await get(`/v1/commands/${encodeURIComponent(id)}`);
        }
        if (command.state !== 'succeeded') {
            throw new Error(command.message || `${action} command failed`);
        }
        latestAutomatorStatus = await get('/v1/status');
        applyAutomatorStatus(latestAutomatorStatus);
        return command;
    }

    async function disableAllMappedDevices() {
        const names = new Set();
        mappings().forEach((mapping) => normalizeList(mapping.connections).forEach((name) => names.add(name)));
        await disableDevices(Array.from(names));
    }

    async function waitForRequiredTags() {
        const started = Date.now();
        while (true) {
            let pendingAcquisition = false;
            for (const name of activeCycle.enabledDevices) {
                const driver = runtime.devices.getDevice(name, true);
                const status = driver && driver.getAcquisitionStatus && driver.getAcquisitionStatus();
                if (status && status.state === 'error') {
                    throw new Error(`'${name}' acquisition failed: ${status.error}`);
                }
                if (status && status.state === 'pending') pendingAcquisition = true;
            }
            const receivedAt = Date.now();
            const runtimeValues = readRuntimeTagValues(
                activeCycle.requiredTagIds,
                (tagId) => runtime.devices.getTagValue(tagId, true));
            acceptFreshValues(runtimeValues, receivedAt, 'runtime');
            if (stopping) {
                throw new Error('Collection stopped');
            }
            if (!pendingAcquisition && freshTagValues.size >= activeCycle.requiredTags) return;
            if (receivedAt - started > collectionTimeoutMs()) {
                const missing = Array.from(activeCycle.requiredTagIds)
                    .filter((id) => !freshTagValues.has(id));
                throw new Error(`Timed out waiting for ${missing.length} fresh required tags: ${missing.join(', ')}`);
            }
            await delay(250);
        }
    }

    function acceptFreshValues(values, receivedAt, source) {
        const before = freshTagValues.size;
        collectFreshValues(
            values,
            activeCycle.requiredTagIds,
            freshTagValues,
            receivedAt,
            activeCycle.startedAt);
        if (freshTagValues.size > before) {
            activeCycle.updatedTags = freshTagValues.size;
            publishCycleTags();
            logger.info(`'${data.name}' collected ${activeCycle.updatedTags}/${activeCycle.requiredTags} required tags from ${source}`, true);
        }
    }

    async function disableDevices(names) {
        const failures = [];
        for (const name of names) {
            try {
                await runtime.devices.setDeviceRuntimeEnabled(name, false);
            } catch (err) {
                const detail = `'${name}': ${message(err)}`;
                failures.push(detail);
                logger.error(`'${data.name}' could not disable ${detail}`);
            }
        }
        if (failures.length) {
            throw new Error(`VPN switch blocked because FUXA connections did not stop: ${failures.join('; ')}`);
        }
    }

    function nextMapping() {
        const sites = responseSites(latestAutomatorStatus);
        const available = mappings().filter((mapping) => mapping.enabled !== false
            && mapping.site
            && sites.some((site) => site.enabled !== false
                && sameText(site.name, mapping.site)
                && (sameText(site.status, 'Online') || sameText(site.status, 'Connected'))));
        if (!available.length) {
            return null;
        }
        const mapping = available[mappingIndex % available.length];
        mappingIndex = (mappingIndex + 1) % available.length;
        return mapping;
    }

    function applyAutomatorStatus(status) {
        setValue('automator.alive', true);
        setValue('ecatcher.running', Boolean(status.ecatcherRunning ?? status.EcatcherRunning));
        setValue('ecatcher.connected_site', connectedSite(status) || '');
        const sites = responseSites(status);
        setValue('sites.online_count', sites.filter((site) => sameText(site.status, 'Online')
            || sameText(site.status, 'Connected')).length);
        sites.forEach((site) => setValue(`site.${safeName(site.name)}.online`,
            sameText(site.status, 'Online') || sameText(site.status, 'Connected')));
        emitValues();
    }

    function publishCycleTags() {
        setValue('cycle.state', activeCycle.state);
        setValue('cycle.site', activeCycle.site || '');
        setValue('cycle.required_tags', activeCycle.requiredTags || 0);
        setValue('cycle.updated_tags', activeCycle.updatedTags || 0);
        setValue('cycle.last_success_at', activeCycle.lastSuccessAt || 0);
        setValue('cycle.last_error', activeCycle.lastError || '');
        emitValues();
    }

    function setCycleState(state) {
        activeCycle.state = state;
        publishCycleTags();
    }

    function setCycleError(errorMessage) {
        activeCycle.lastError = errorMessage;
        activeCycle.state = 'error';
        publishCycleTags();
    }

    function setValue(address, value) {
        const tag = tagMap[address];
        if (!tag) {
            return;
        }
        varsValue[tag.id] = {
            id: tag.id,
            value,
            rawValue: value,
            type: tag.type,
            daq: tag.daq,
            timestamp: Date.now(),
            tagref: tag,
        };
    }

    function emitValues() {
        events.emit('device-value:changed', { id: data.id, values: varsValue });
    }

    function clearValues() {
        Object.values(varsValue).forEach((tag) => { tag.value = null; });
        emitValues();
    }

    function emitStatus(status) {
        if (lastStatus !== status) {
            lastStatus = status;
            events.emit('device-status:changed', { id: data.id, status });
        }
    }

    function httpConfig() {
        return {
            baseURL: String(data.property?.address || DEFAULT_ENDPOINT).replace(/\/$/, ''),
            timeout: 10000,
            headers: { 'X-T2M-Token': String(data.property?.apiToken || '') },
            validateStatus: (status) => status >= 200 && status < 300,
        };
    }

    async function get(path) {
        const response = await axios.get(path, httpConfig());
        return response.data;
    }

    async function post(path, body) {
        const response = await axios.post(path, body, httpConfig());
        return response.data;
    }

    function mappings() {
        return Array.isArray(data.property?.mappings) ? data.property.mappings : [];
    }

    function autoCycle() {
        return data.property?.autoCycle !== false;
    }

    function commandTimeoutMs() {
        return Math.max(Number(data.property?.commandTimeoutSeconds) || 120, 10) * 1000;
    }

    function collectionTimeoutMs() {
        return Math.max(Number(data.property?.collectionTimeoutSeconds) || DEFAULT_TIMEOUT_SECONDS, 10) * 1000;
    }

    function cycleDelayMs() {
        return Math.max(Number(data.property?.cycleDelaySeconds) || DEFAULT_CYCLE_DELAY_SECONDS, 5) * 1000;
    }

    function failureDelayMs() {
        return Math.max(Number(data.property?.failureDelaySeconds) || DEFAULT_FAILURE_DELAY_SECONDS, 1) * 1000;
    }
}

function collectFreshValues(values, requiredTagIds, freshTagValues, receivedAt = Date.now(), startedAt = 0) {
    let collected = false;
    Object.entries(values || {}).forEach(([key, tag]) => {
        if (!tag) {
            return;
        }
        const id = String(tag.id || key);
        if (!requiredTagIds.has(id) || tag.value === null || tag.value === undefined) {
            return;
        }
        const sourceTimestamp = parseTimestamp(tag.timestamp ?? tag.ts);
        if (startedAt && (sourceTimestamp === null || sourceTimestamp < startedAt)) return;
        freshTagValues.set(id, {
            id,
            value: tag.value,
            timestamp: receivedAt,
            sourceTimestamp,
            quality: tag.quality,
        });
        collected = true;
    });
    return collected;
}

function readRuntimeTagValues(requiredTagIds, getTagValue) {
    const values = {};
    requiredTagIds.forEach((id) => {
        const tag = getTagValue(id);
        if (tag) {
            values[id] = tag;
        }
    });
    return values;
}

function parseTimestamp(value) {
    if (value === null || value === undefined || value === '') {
        return null;
    }
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
        return numeric;
    }
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function createCycleState(mapping) {
    return {
        state: 'idle',
        site: mapping?.site || '',
        startedAt: 0,
        requiredTagIds: new Set(),
        requiredTags: 0,
        updatedTags: 0,
        enabledDevices: new Set(),
        lastSuccessAt: 0,
        lastError: '',
    };
}

function normalizeList(value) {
    if (Array.isArray(value)) {
        return value.map((item) => String(item).trim()).filter(Boolean);
    }
    return String(value || '').split(/[,;\r\n]+/).map((item) => item.trim()).filter(Boolean);
}

function sameText(left, right) {
    return String(left || '').localeCompare(String(right || ''), undefined, { sensitivity: 'accent' }) === 0;
}

function safeName(value) {
    const text = String(value || '').trim().toLowerCase();
    const slug = text.replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'site';
    let hash = 2166136261;
    for (let index = 0; index < text.length; index++) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return `${slug}_${(hash >>> 0).toString(16)}`;
}

function responseSites(response) {
    const sites = response?.sites || response?.Sites || [];
    return Array.isArray(sites) ? sites.map((site) => ({
        name: site?.name ?? site?.Name ?? '',
        status: site?.status ?? site?.Status ?? '',
        enabled: site?.enabled ?? site?.Enabled ?? false,
    })).filter((site) => site.name) : [];
}

function connectedSite(response) {
    return response?.connectedSite || response?.ConnectedSite || '';
}

function message(err) {
    return err?.response?.data?.message || err?.message || String(err);
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function calculateNextAcquisitionTimestamp(completedAt, delayMs) {
    return Number(completedAt) + Number(delayMs);
}

async function waitUntil(predicate, timeoutMs, cancelled) {
    const started = Date.now();
    while (!predicate()) {
        if (cancelled && cancelled()) {
            throw new Error('Collection stopped');
        }
        if (Date.now() - started > timeoutMs) {
            throw new Error('Timed out waiting for fresh required tags');
        }
        await delay(250);
    }
}

async function getSites(endpoint) {
    const address = typeof endpoint === 'string' ? endpoint : endpoint?.address;
    const token = typeof endpoint === 'object' ? endpoint?.apiToken : '';
    const response = await axios.get('/v1/sites', {
        baseURL: String(address || DEFAULT_ENDPOINT).replace(/\/$/, ''),
        timeout: 10000,
        headers: { 'X-T2M-Token': String(token || '') },
    });
    return { sites: responseSites(response.data) };
}

module.exports = {
    create(data, logger, events, manager, runtime) {
        return new T2MAutomatorClient(data, logger, events, manager, runtime);
    },
    getSites,
    TAG_DEFINITIONS,
    _test: { calculateNextAcquisitionTimestamp, collectFreshValues, normalizeList, parseTimestamp, readRuntimeTagValues, sameText, safeName, responseSites, waitUntil },
};
