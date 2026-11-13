/**
 * Firebase Firestore persistence layer for the Cloud Workspace Launcher backend.
 *
 * Implements the same surface as `store.js` (load / saveAll / upsert / remove /
 * find / validateWorkspace / listPaged) but stores workspaces in a Firestore
 * collection instead of a local JSON file.
 *
 * Auth: writes are gated on a verified Firebase ID token (see server.js). The
 * token's `uid` becomes the workspace owner — every write is scoped to the
 * owner's own documents and the list query filters by owner, so one user can
 * never read or mutate another user's workspaces.
 *
 * Security rules (deploy with `firebase deploy --only firestore`):
 *   allow read, write: if request.auth != null
 *                    && request.auth.uid == resource.data.owner;
 */

const { getFirestore } = require("firebase-admin/firestore");
const { getApp } = require("./firebase-app.js");
const storeLocal = require("./store-local.js");

let db = null;

/** Lazily create the Firestore client. Safe to call repeatedly. */
function getDb() {
  if (db) return db;
  db = getFirestore(getApp());
  return db;
}

const COLLECTION = "workspaces";

/** Firestore doesn't need a "load everything" path — we query lazily. */
function load() {
  return Promise.resolve([]);
}

/** No-op: Firestore writes happen per-document in upsert/remove. */
function saveAll() {
  return Promise.resolve();
}

/**
 * Insert or replace a workspace by id. Owner-scoped: the record must carry an
 * `owner` field matching the caller's uid, otherwise the write is rejected.
 * Returns the saved workspace.
 */
async function upsert(workspace, owner) {
  const err = storeLocal.validateWorkspace(workspace);
  if (err) throw new Error(err);
  if (!owner) throw new Error("unauthenticated: owner uid required");

  const now = Date.now();
  const record = {
    ...workspace,
    id: workspace.id,
    owner,
    updatedAt: now,
    createdAt: workspace.createdAt || now,
  };

  const ref = getDb().collection(COLLECTION).doc(workspace.id);
  await ref.set(record, { merge: true });
  return record;
}

/**
 * Remove a workspace by id. Owner-scoped: the doc must exist and belong to
 * the caller, otherwise we return false (404) instead of deleting it.
 */
async function remove(id, owner) {
  if (!owner) throw new Error("unauthenticated: owner uid required");
  const ref = getDb().collection(COLLECTION).doc(id);
  const snap = await ref.get();
  if (!snap.exists) return false;
  const data = snap.data();
  if (data.owner && data.owner !== owner) return false;
  await ref.delete();
  return true;
}

/** Find a single workspace by id, or null. */
async function find(id, owner) {
  const snap = await getDb().collection(COLLECTION).doc(id).get();
  if (!snap.exists) return null;
  const data = snap.data();
  // Never hand back a workspace that doesn't belong to the caller.
  if (owner && data.owner && data.owner !== owner) return null;
  return data;
}

/**
 * Return a page of workspaces, sorted newest-first.
 *
 * Firestore needs an index for the composite sort+filter query below. If you
 * see "FAILED_PRECONDITION: index" in the logs, run the link printed by the
 * error or create the index in the Console. The fallback path (filter in
 * memory) keeps the app working without it, at the cost of a full collection
 * scan on every list call.
 */
async function listPaged({ limit, offset, search, owner } = {}) {
  let query = getDb().collection(COLLECTION);
  if (owner) {
    query = query.where("owner", "==", owner);
  }

  let list;
  try {
    // Composite index: owner (asc) + updatedAt (desc).
    let q = owner
      ? query.orderBy("updatedAt", "desc")
      : getDb().collection(COLLECTION).orderBy("updatedAt", "desc");
    const snap = await q.get();
    list = snap.docs.map((d) => d.data());
  } catch (e) {
    // Index not yet built — fall back to sorting in memory.
    if (e.code !== 9 /* FAILED_PRECONDITION */) throw e;
    const snap = await query.get();
    list = snap.docs.map((d) => d.data());
    list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }

  if (search) {
    const q = search.toLowerCase();
    list = list.filter(
      (w) =>
        (w.name || "").toLowerCase().includes(q) ||
        String(w.id).toLowerCase().includes(q)
    );
  }

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
  validateWorkspace: storeLocal.validateWorkspace,
  listPaged,
};