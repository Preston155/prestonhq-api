const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

const FILE = path.join(__dirname, "..", "data", "erlc-moderation.json");
let writeQueue = Promise.resolve();

async function readStore() {
  try {
    const parsed = JSON.parse(await fs.readFile(FILE, "utf8"));
    return { cases: Array.isArray(parsed.cases) ? parsed.cases : [], audit: Array.isArray(parsed.audit) ? parsed.audit : [] };
  } catch (error) {
    if (error.code !== "ENOENT") console.error("Moderation store read failed:", error.message);
    return { cases: [], audit: [] };
  }
}

function writeStore(store) {
  writeQueue = writeQueue.then(async () => {
    await fs.mkdir(path.dirname(FILE), { recursive: true });
    const temp = FILE + ".tmp";
    await fs.writeFile(temp, JSON.stringify(store, null, 2), "utf8");
    await fs.rename(temp, FILE);
  });
  return writeQueue;
}

async function addAudit(entry) {
  const store = await readStore();
  const item = { id: crypto.randomUUID(), timestamp: new Date().toISOString(), ...entry };
  store.audit.unshift(item);
  store.audit = store.audit.slice(0, 5000);
  await writeStore(store);
  return item;
}

async function addCase(entry) {
  const store = await readStore();
  const number = (store.cases.reduce((max, item) => Math.max(max, Number(item.number || 0)), 0) || 0) + 1;
  const item = { id: crypto.randomUUID(), number, status: "completed", createdAt: new Date().toISOString(), ...entry };
  store.cases.unshift(item);
  store.cases = store.cases.slice(0, 5000);
  store.audit.unshift({ id: crypto.randomUUID(), timestamp: item.createdAt, action: "moderation_case_created", actor: entry.staff, entityId: item.id, details: { number, type: entry.type, target: entry.target, reason: entry.reason } });
  store.audit = store.audit.slice(0, 5000);
  await writeStore(store);
  return item;
}

async function listCases(limit = 200) { return (await readStore()).cases.slice(0, Math.max(1, Math.min(Number(limit) || 200, 500))); }
async function listAudit(limit = 300) { return (await readStore()).audit.slice(0, Math.max(1, Math.min(Number(limit) || 300, 1000))); }

module.exports = { addAudit, addCase, listCases, listAudit };
