/**
 * Shared Firebase Admin app singleton.
 *
 * `auth.js` and `store-firebase.js` both need the Admin SDK initialised, but
 * calling initializeApp() twice with different configs throws "A Firebase app
 * named '[DEFAULT]' already exists with a different configuration." So we
 * centralise it here: the first caller wins, subsequent callers get the
 * already-initialised app.
 *
 * If no service-account credential is available (no local file, no env var,
 * no ADC), the app is initialised without one. Writes will fail with a clear
 * error, but auth (token verification) still works when a real ID token is
 * provided — which is enough to test the 401/403 paths without a real project.
 */

const { initializeApp, getApps } = require("firebase-admin/app");

let app = null;

/** Return the shared Admin app, initialising it on first call. */
function getApp() {
  if (app) return app;
  const existing = getApps();
  if (existing.length) {
    app = existing[0];
    return app;
  }
  const creds = require("./firebase-credentials.js");
  const config = { projectId: creds.getProjectId() };
  const credential = creds.getCredential();
  if (credential) config.credential = credential;
  app = initializeApp(config);
  return app;
}

module.exports = { getApp };