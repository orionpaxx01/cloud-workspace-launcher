/**
 * Firebase ID-token verification middleware for the backend.
 *
 * The extension signs in with Firebase Auth (email/password) and sends the
 * returned ID token in the `Authorization: Bearer <token>` header on every
 * request. This middleware decodes the token, confirms it's valid and not
 * expired, and attaches `req.uid` (the user's Firebase uid) to the request.
 *
 * Without a valid token every route returns 401 — so even if someone knows the
 * endpoint URL, they can't read or write another user's workspaces.
 *
 * On failure the error is forwarded to `next(err)` with `err.status = 401`
 * rather than writing the response directly, so the host server can render
 * the correct status code through a single error handler.
 *
 * Static bearer token (BACKEND_API_KEY): the extension has no Firebase
 * sign-in UI, so when this env var is set the middleware accepts that one
 * static token instead of verifying a real ID token. Every request is then
 * attributed to the same owner uid (BACKEND_UID, default "extension"). This is
 * a pragmatic single-user fallback — for real per-user isolation, use a real
 * Firebase ID token.
 */

const { getAuth } = require("firebase-admin/auth");
const { getApp } = require("./firebase-app.js");

/** Static bearer token accepted in place of a verified ID token. */
const STATIC_TOKEN = process.env.BACKEND_API_KEY || null;
const STATIC_UID = process.env.BACKEND_UID || "extension";

/**
 * Express-style middleware: (req, res, next) => ...
 * Attaches `req.uid` on success; forwards a 401 error on failure.
 */
function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    return next(
      Object.assign(new Error("missing Authorization: Bearer <token>"), {
        status: 401,
      })
    );
  }

  // Static bearer token fallback (extension has no Firebase sign-in UI).
  if (STATIC_TOKEN && token === STATIC_TOKEN) {
    req.uid = STATIC_UID;
    return next();
  }

  getAuth(getApp())
    .verifyIdToken(token, true)
    .then((decoded) => {
      req.uid = decoded.uid;
      next();
    })
    .catch(() => {
      next(
        Object.assign(new Error("invalid or expired token"), { status: 401 })
      );
    });
}

/** JSON helper — mirrors the one in server.js. Kept for backwards compat. */
function send(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

module.exports = { requireAuth, send };