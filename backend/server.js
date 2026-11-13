/**
 * HTTP server wrapping the persistence layer in `store.js`.
 *
 * Implements the REST contract the extension expects from a "custom backend":
 *
 *   GET    /workspaces            -> { workspaces, total, offset, limit }
 *   POST   /workspaces            -> workspace   (body: workspace JSON)
 *   GET    /workspaces/:id        -> workspace | 404
 *   DELETE /workspaces/:id        -> { ok: true } | 404
 *
 * Stateless at the HTTP layer — all state lives in the JSON file managed by
 * store.js. Uses only Node's built-in `http` module (no external deps).
 */

const http = require("http");
const fs = require("fs");
const path = require("path");

// Backend selection. `local` (default) uses the JSON file in store.js;
// `firebase` uses Firestore via the Admin SDK (store-firebase.js) and
// gates every write on a verified Firebase ID token (auth.js).
const BACKEND = process.env.STORAGE_BACKEND || "local";
const store = require(BACKEND === "firebase" ? "./store-firebase.js" : "./store.js");
const { requireAuth } = BACKEND === "firebase" ? require("./auth.js") : { requireAuth: null };

const PORT = process.env.PORT || 3000;

// Dashboard UI lives in ./public. Served statically so the backend has a
// human-facing page in addition to the REST API the extension talks to.
const PUBLIC_DIR = path.join(__dirname, "public");
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

/** Serve a static file from ./public, or 404. */
function serveStatic(req, res, file) {
  const safe = path.basename(file);
  const filePath = path.join(PUBLIC_DIR, safe);
  fs.readFile(filePath, (err, data) => {
    if (err) {
      return send(res, 404, { error: "not found" });
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream" });
    res.end(data);
  });
}

/** JSON helper — sets Content-Type and Content-Length. */
function send(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

/** Read the full request body as a string. */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  // CORS so the chrome-extension origin can talk to this server.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, DELETE, OPTIONS"
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type"
  );

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }

  const parsed = new URL(req.url, `http://${req.headers.host}`);
  const pathname = parsed.pathname;
  const parts = pathname.split("/").filter(Boolean); // ["workspaces", <id>?]

  // Firebase backend gates every route on a verified ID token. The
  // middleware calls `next(err)` on failure, so resolve it into a thrown
  // error here to flow into the shared catch below.
  const auth = () =>
    new Promise((resolve, reject) => {
      if (!requireAuth) return resolve(null);
      requireAuth(req, res, (err) => (err ? reject(err) : resolve(req.uid)));
    });

  try {
    // ---- GET /workspaces[?limit&offset&search] ----
    if (req.method === "GET" && pathname === "/workspaces") {
      const query = Object.fromEntries(parsed.searchParams);
      const uid = await auth();
      const result = await store.listPaged({ ...query, owner: uid });
      return send(res, 200, result);
    }

    // ---- GET /workspaces/:id ----
    if (req.method === "GET" && parts.length === 2 && parts[0] === "workspaces") {
      const uid = await auth();
      const ws = await store.find(parts[1], uid);
      return ws ? send(res, 200, ws) : send(res, 404, { error: "not found" });
    }

    // ---- POST /workspaces ----
    if (req.method === "POST" && pathname === "/workspaces") {
      const uid = await auth();
      const raw = await readBody(req);
      let body;
      try {
        body = JSON.parse(raw || "{}");
      } catch {
        return send(res, 400, { error: "request body must be valid JSON" });
      }
      const err = store.validateWorkspace(body);
      if (err) return send(res, 400, { error: err });
      const saved = await store.upsert(body, uid);
      return send(res, 200, saved);
    }

    // ---- DELETE /workspaces/:id ----
    if (req.method === "DELETE" && parts.length === 2 && parts[0] === "workspaces") {
      const uid = await auth();
      const removed = await store.remove(parts[1], uid);
      return send(res, removed ? 200 : 404, { ok: true });
    }

    // ---- Dashboard UI (static files from ./public) ----
    if (req.method === "GET" && (pathname === "/" || pathname === "/index.html")) {
      return serveStatic(req, res, "index.html");
    }
    if (
      req.method === "GET" &&
      (pathname === "/dashboard.css" || pathname === "/dashboard.js")
    ) {
      return serveStatic(req, res, path.basename(pathname));
    }

    // ---- Health check ----
    if (req.method === "GET" && pathname === "/health") {
      return send(res, 200, { status: "ok", uptime: process.uptime() });
    }

    send(res, 404, { error: "not found" });
  } catch (e) {
    // Auth failures carry a `status` from the middleware; everything else is
    // a 500. Firestore validation errors are surfaced as-is.
    const status = e.status >= 400 && e.status < 600 ? e.status : 500;
    console.error("[server] request error:", e.message);
    send(res, status, { error: e.message });
  }
});

server.listen(PORT, () => {
  console.log(`Backend listening on http://localhost:${PORT}`);
  console.log(`Storage backend: ${BACKEND}`);
  if (BACKEND === "local") {
    console.log(`Store file: ${store.STORE_FILE}`);
  } else {
    console.log(`Firestore project: ${require("./firebase-credentials.js").getProjectId()}`);
  }
});