/**
 * Persistence layer for the Cloud Workspace Launcher custom backend.
 *
 * All workspaces live in a single JSON file so the server is stateless at
 * the HTTP layer — just read/write the file. Writes are atomic (temp file +
 * rename) so a crash mid-write never corrupts the data.
 */

const fs = require("fs");
const path = require("path");

// Allow tests / deployments to redirect the data directory. Falls back to a
// `data/` folder next to this file in production.
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, "data");
const STORE_FILE = process.env.STORE_FILE
  ? path.resolve(process.env.STORE_FILE)
  : path.join(DATA_DIR, "workspaces.json");

/** Ensure the data directory exists (called once on startup). */
function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

/** Read the full workspace array. Returns [] when the file is missing/empty. */
function load() {
  try {
    if (!fs.existsSync(STORE_FILE)) return [];
    const raw = fs.readFileSync(STORE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error("[store] Failed to read workspaces.json:", err.message);
    return [];
  }
}

/**
 * Atomically write the full workspace array to disk.
 * Writes to a temp file first, then renames over the real file. If the
 * process dies during the write, the original file is untouched.
 */
function saveAll(list) {
  ensureDir();
  const tmp = STORE_FILE + ".tmp";
  const payload = JSON.stringify(list, null, 2);
  fs.writeFileSync(tmp, payload, "utf8");
  fs.renameSync(tmp, STORE_FILE);
}

/** Insert or replace a workspace by id. Returns the saved workspace. */
function upsert(workspace) {
  const list = load();
  const idx = list.findIndex((w) => w.id === workspace.id);
  const now = Date.now();
  const record = { ...workspace, updatedAt: now, id: workspace.id };
  if (idx >= 0) {
    list[idx] = { ...list[idx], ...record };
  } else {
    record.createdAt = now;
    list.push(record);
  }
  saveAll(list);
  return list[idx >= 0 ? idx : list.length - 1];
}

/** Remove a workspace by id. Returns true if something was removed. */
function remove(id) {
  const list = load();
  const next = list.filter((w) => w.id !== id);
  const removed = next.length !== list.length;
  if (removed) saveAll(next);
  return removed;
}

/** Find a single workspace by id, or null. */
function find(id) {
  return load().find((w) => w.id === id) || null;
}

/**
 * Validate the shape of a workspace before it hits disk. Returns an error
 * string, or null when the record is acceptable.
 *
 * The extension sends whatever it captured — we reject the obvious garbage
 * (no id, no snapshot, snapshot not an object) rather than letting it
 * corrupt the store.
 */
function validateWorkspace(ws) {
  if (!ws || typeof ws !== "object") return "workspace must be an object";
  if (!ws.id || typeof ws.id !== "string") return "workspace.id is required (string)";
  if (!ws.snapshot || typeof ws.snapshot !== "object")
    return "workspace.snapshot is required (object)";
  if (!Array.isArray(ws.snapshot.tabs))
    return "workspace.snapshot.tabs must be an array";
  return null;
}

/** Return a page of workspaces, sorted newest-first. */
function listPaged({ limit, offset, search } = {}) {
  let list = load();
  if (search) {
    const q = search.toLowerCase();
    list = list.filter(
      (w) =>
        (w.name || "").toLowerCase().includes(q) ||
        String(w.id).toLowerCase().includes(q)
    );
  }
  list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const total = list.length;
  const start = Math.max(0, offset | 0);
  const page =
    limit && limit > 0 ? list.slice(start, start + (limit | 0)) : list.slice(start);
  return { workspaces: page, total, offset: start, limit: limit || total };
}

module.exports = {
  load,
  saveAll,
  upsert,
  remove,
  find,
  validateWorkspace,
  listPaged,
  STORE_FILE,
  DATA_DIR,
};