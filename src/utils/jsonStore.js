const fs = require("node:fs/promises");
const path = require("node:path");

async function ensureParentDir(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function readJson(filePath, fallbackValue) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    if (!raw.trim()) return fallbackValue;
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === "ENOENT") {
      await writeJson(filePath, fallbackValue);
      return fallbackValue;
    }

    if (error instanceof SyntaxError) {
      const badPath = filePath + ".invalid-" + Date.now();
      await fs.rename(filePath, badPath).catch(() => null);
      await writeJson(filePath, fallbackValue);
      return fallbackValue;
    }

    console.error("JSON store read failed:", path.basename(filePath), error.message);
    return fallbackValue;
  }
}

async function writeJson(filePath, data) {
  await ensureParentDir(filePath);
  const tempPath = filePath + ".tmp";
  await fs.writeFile(tempPath, JSON.stringify(data, null, 2) + "\n", "utf8");
  await fs.rename(tempPath, filePath);
}

module.exports = { readJson, writeJson };
