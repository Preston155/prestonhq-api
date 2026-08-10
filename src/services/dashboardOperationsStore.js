const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const FILE = path.join(__dirname, '..', 'data', 'dashboard-operations.json');

const DEFAULT_PERMISSIONS = {
  Owner: ['Kick', 'Ban', 'Unban', 'Kill', 'Teleport', 'PM', 'Announce', 'API Keys', 'Staff Roles', 'Export Logs'],
  Admin: ['Kick', 'Ban', 'Unban', 'Kill', 'Teleport', 'PM', 'Announce', 'Export Logs'],
  Moderator: ['Kick', 'Kill', 'Teleport', 'PM', 'Announce'],
  'Trial Mod': ['PM', 'Announce'],
};

const DEFAULT_SETTINGS = {
  broadcastCadToServer: true,
  ingestModCalls: true,
  eventWebhookEnabled: true,
  autoRefreshSeconds: 15,
};

let mutationQueue = Promise.resolve();

function defaults() {
  return {
    version: 2,
    calls: [],
    records: [],
    unitStatuses: {},
    permissions: structuredClone(DEFAULT_PERMISSIONS),
    settings: { ...DEFAULT_SETTINGS },
    seenModCallIds: [],
    seenEventIds: [],
    modCallBaselineInitialized: false,
    sequence: 1100,
    updatedAt: new Date().toISOString(),
  };
}

function normalize(parsed) {
  const base = defaults();
  return {
    ...base,
    ...(parsed && typeof parsed === 'object' ? parsed : {}),
    calls: Array.isArray(parsed?.calls) ? parsed.calls : [],
    records: Array.isArray(parsed?.records) ? parsed.records : [],
    unitStatuses: parsed?.unitStatuses && typeof parsed.unitStatuses === 'object' ? parsed.unitStatuses : {},
    permissions: parsed?.permissions && typeof parsed.permissions === 'object' ? parsed.permissions : base.permissions,
    settings: { ...base.settings, ...(parsed?.settings || {}) },
    seenModCallIds: Array.isArray(parsed?.seenModCallIds) ? parsed.seenModCallIds : [],
    seenEventIds: Array.isArray(parsed?.seenEventIds) ? parsed.seenEventIds : [],
  };
}

async function readStore() {
  try {
    return normalize(JSON.parse(await fs.readFile(FILE, 'utf8')));
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('Dashboard operations store read failed:', error.message);
    return defaults();
  }
}

async function writeStore(store) {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  store.updatedAt = new Date().toISOString();
  const temporary = `${FILE}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(store, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await fs.rename(temporary, FILE);
}

function mutate(callback) {
  const operation = mutationQueue.then(async () => {
    const store = await readStore();
    const result = await callback(store);
    await writeStore(store);
    return result;
  });
  mutationQueue = operation.catch(() => undefined);
  return operation;
}

function clean(value, max = 500) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 24);
}

function nextCallId(store) {
  store.sequence = Math.max(1000, Number(store.sequence || 1000)) + 1;
  return `CAD-${store.sequence}`;
}

function normalizePriority(value) {
  const text = clean(value, 30).toLowerCase();
  if (text.includes('1')) return 'Code 1';
  if (text.includes('2')) return 'Code 2';
  return 'Code 3';
}

function callFromInput(store, input, actor) {
  const now = new Date().toISOString();
  return {
    id: nextCallId(store),
    caller: clean(input.caller || actor?.name || 'Dispatch', 80),
    location: clean(input.location || 'Location not provided', 160),
    type: clean(input.type || input.title || 'Emergency Call', 160),
    description: clean(input.description || input.details || 'No additional details provided.', 1000),
    priority: normalizePriority(input.priority),
    status: 'Pending',
    assignedUnits: [],
    createdAt: now,
    updatedAt: now,
    createdBy: actor || null,
    source: clean(input.source || 'dashboard', 40),
    sourceId: clean(input.sourceId || '', 100) || null,
  };
}

function modCallIdentity(item) {
  const explicit = item?.Id || item?.id || item?.CallId || item?.callId;
  return explicit ? String(explicit) : hash(JSON.stringify(item));
}

function extractModCall(item) {
  const caller = item?.Caller || item?.caller || item?.Player || item?.player || item?.Username || item?.username || 'ER:LC Caller';
  const location = item?.Location || item?.location || item?.Postal || item?.postal || 'Location not provided';
  const description = item?.Message || item?.message || item?.Reason || item?.reason || item?.Description || item?.description || 'Emergency assistance requested in game.';
  return {
    caller,
    location,
    type: item?.Type || item?.type || 'In-Game Emergency / Mod Call',
    description,
    priority: 'Code 3',
    source: 'prc-modcall',
    sourceId: modCallIdentity(item),
  };
}

function flattenWebhook(payload) {
  const parts = [];
  const fields = [];
  if (payload?.content) parts.push(payload.content);
  if (payload?.event) parts.push(payload.event);
  if (payload?.message) parts.push(payload.message);
  for (const embed of Array.isArray(payload?.embeds) ? payload.embeds : []) {
    if (embed.title) parts.push(embed.title);
    if (embed.description) parts.push(embed.description);
    if (embed.author?.name) parts.push(embed.author.name);
    for (const field of Array.isArray(embed.fields) ? embed.fields : []) {
      fields.push({ name: clean(field.name, 100), value: clean(field.value, 500) });
      parts.push(`${field.name}: ${field.value}`);
    }
  }
  return { text: clean(parts.join(' | '), 2000), fields };
}

function fieldValue(fields, names) {
  const target = fields.find((field) => names.some((name) => field.name.toLowerCase().includes(name)));
  return target?.value || '';
}

async function getDashboardState() {
  const store = await readStore();
  return {
    calls: store.calls.slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))),
    records: store.records.slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))),
    unitStatuses: store.unitStatuses,
    permissions: store.permissions,
    settings: store.settings,
    updatedAt: store.updatedAt,
  };
}

async function createCall(input, actor) {
  return mutate((store) => {
    const call = callFromInput(store, input, actor);
    store.calls.unshift(call);
    store.calls = store.calls.slice(0, 1000);
    return call;
  });
}

async function updateCall(id, changes, actor) {
  return mutate((store) => {
    const call = store.calls.find((item) => item.id === id);
    if (!call) return null;
    if (changes.status && ['Pending', 'Dispatched', 'Cleared'].includes(changes.status)) call.status = changes.status;
    if (Array.isArray(changes.assignedUnits)) call.assignedUnits = [...new Set(changes.assignedUnits.map((item) => clean(item, 80)).filter(Boolean))].slice(0, 20);
    if (changes.addUnit) call.assignedUnits = [...new Set([...call.assignedUnits, clean(changes.addUnit, 80)])].filter(Boolean).slice(0, 20);
    if (changes.removeUnit) call.assignedUnits = call.assignedUnits.filter((unit) => unit !== clean(changes.removeUnit, 80));
    call.updatedAt = new Date().toISOString();
    call.updatedBy = actor || null;
    return call;
  });
}

async function syncModCalls(items) {
  const list = Array.isArray(items) ? items : [];
  return mutate((store) => {
    const identities = list.map(modCallIdentity);
    if (!store.modCallBaselineInitialized) {
      store.seenModCallIds = [...new Set([...store.seenModCallIds, ...identities])].slice(-2000);
      store.modCallBaselineInitialized = true;
      return [];
    }
    const seen = new Set(store.seenModCallIds);
    const created = [];
    for (const item of list) {
      const identity = modCallIdentity(item);
      if (seen.has(identity)) continue;
      const call = callFromInput(store, extractModCall(item), { id: 'prc', name: 'ER:LC' });
      store.calls.unshift(call);
      created.push(call);
      seen.add(identity);
    }
    store.calls = store.calls.slice(0, 1000);
    store.seenModCallIds = [...seen].slice(-2000);
    return created;
  });
}

async function ingestWebhook(payload) {
  const flattened = flattenWebhook(payload);
  const eventId = String(payload?.id || payload?.eventId || hash(JSON.stringify(payload)));
  return mutate((store) => {
    if (store.seenEventIds.includes(eventId)) return { duplicate: true, call: null, text: flattened.text };
    store.seenEventIds.push(eventId);
    store.seenEventIds = store.seenEventIds.slice(-3000);
    const emergency = /(?:\b911\b|!911|emergency call|mod(?:erator)? call|help request)/i.test(flattened.text);
    if (!emergency) return { duplicate: false, call: null, text: flattened.text };
    const caller = fieldValue(flattened.fields, ['caller', 'player', 'username']) || payload?.username || 'In-Game Caller';
    const location = fieldValue(flattened.fields, ['location', 'postal']) || flattened.text.match(/(?:location|postal)\s*[:#-]?\s*([^|]+)/i)?.[1] || 'Location not provided';
    const details = fieldValue(flattened.fields, ['message', 'details', 'reason', 'description']) || flattened.text;
    const call = callFromInput(store, {
      caller,
      location,
      type: fieldValue(flattened.fields, ['type', 'call']) || '911 Emergency Call',
      description: details,
      priority: 'Code 3',
      source: 'event-webhook',
      sourceId: eventId,
    }, { id: 'event-webhook', name: 'ER:LC Event Log' });
    store.calls.unshift(call);
    store.calls = store.calls.slice(0, 1000);
    return { duplicate: false, call, text: flattened.text };
  });
}

async function createRecord(input, actor) {
  return mutate((store) => {
    const now = new Date().toISOString();
    const citizenName = clean(input.citizenName || input.target, 80);
    const classification = clean(input.classification || 'Incident Report', 100);
    const suppliedWarrants = Array.isArray(input.warrants) ? input.warrants.map((item) => clean(item, 300)).filter(Boolean).slice(0, 20) : [];
    const record = {
      id: `REC-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
      citizenName,
      robloxId: clean(input.robloxId || '', 30),
      classification,
      notes: clean(input.notes, 2000),
      licenses: { drivers: false, firearm: false, commercial: false, ...(input.licenses || {}) },
      warrants: suppliedWarrants.length ? suppliedWarrants : (/warrant/i.test(classification) ? [`Active Warrant: ${classification}`] : []),
      priors: Array.isArray(input.priors) ? input.priors.map((item) => clean(item, 300)).filter(Boolean).slice(0, 50) : [],
      vehicle: {
        plate: clean(input.vehicle?.plate || 'Not recorded', 20),
        model: clean(input.vehicle?.model || 'Not recorded', 100),
        color: clean(input.vehicle?.color || 'Not recorded', 50),
        status: ['Valid', 'Stolen', 'Expired'].includes(input.vehicle?.status) ? input.vehicle.status : 'Valid',
      },
      createdAt: now,
      updatedAt: now,
      createdBy: actor || null,
    };
    if (!record.citizenName) throw new Error('Citizen username is required.');
    store.records.unshift(record);
    store.records = store.records.slice(0, 5000);
    return record;
  });
}

async function searchRecords(query) {
  const store = await readStore();
  const needle = clean(query, 100).toLowerCase();
  if (!needle) return store.records.slice(0, 25);
  return store.records.filter((record) => [
    record.citizenName, record.robloxId, record.classification, record.notes,
    record.vehicle?.plate, record.vehicle?.model,
  ].some((value) => String(value || '').toLowerCase().includes(needle))).slice(0, 50);
}

async function setUnitStatus(unitId, unitName, status, actor) {
  if (!['10-8 Available', '10-97 On Scene', '10-6 Busy', '10-7 Out of Service'].includes(status)) {
    throw new Error('Invalid unit status.');
  }
  return mutate((store) => {
    const item = { unitId: clean(unitId, 80), unitName: clean(unitName, 80), status, updatedAt: new Date().toISOString(), updatedBy: actor || null };
    store.unitStatuses[item.unitId] = item;
    return item;
  });
}

async function updateConfig(input) {
  return mutate((store) => {
    if (input.permissions && typeof input.permissions === 'object') {
      const allowed = Object.values(DEFAULT_PERMISSIONS).flat();
      store.permissions = Object.fromEntries(Object.keys(DEFAULT_PERMISSIONS).map((role) => [
        role,
        [...new Set((Array.isArray(input.permissions[role]) ? input.permissions[role] : []).filter((permission) => allowed.includes(permission)))],
      ]));
    }
    if (input.settings && typeof input.settings === 'object') {
      for (const key of ['broadcastCadToServer', 'ingestModCalls', 'eventWebhookEnabled']) {
        if (typeof input.settings[key] === 'boolean') store.settings[key] = input.settings[key];
      }
      if (Number.isInteger(input.settings.autoRefreshSeconds)) {
        store.settings.autoRefreshSeconds = Math.max(10, Math.min(120, input.settings.autoRefreshSeconds));
      }
    }
    return { permissions: store.permissions, settings: store.settings };
  });
}

module.exports = {
  getDashboardState,
  createCall,
  updateCall,
  syncModCalls,
  ingestWebhook,
  createRecord,
  searchRecords,
  setUnitStatus,
  updateConfig,
};
