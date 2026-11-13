/**
 * Resolve Firebase Admin credentials for the backend.
 *
 * Priority, in order:
 *   1. `firebase-credentials.json` next to this file (gitignored — safe to keep locally).
 *   2. `FIREBASES_CREDENTIALS` env var, base64-encoded JSON (good for deploys).
 *   3. `GOOGLE_APPLICATION_CREDENTIALS` env var pointing at a service-account
 *      JSON file on disk.
 *   4. Application Default Credentials (GCE metadata server, etc.).
 *
 * The resolved project id is exposed via `getProjectId()` so the Firestore
 * client and the auth middleware can share one source of truth.
 */

const fs = require("fs");
const path = require("path");
const { cert } = require("firebase-admin/app");

const LOCAL_FILE = path.join(__dirname, "firebase-credentials.json");

/** Parse a service-account JSON object into a credential + project id. */
function fromServiceAccount(sa) {
  if (!sa || !sa.private_key || !sa.client_email) {
    throw new Error(
      "Service account JSON must contain `private_key` and `client_email`."
    );
  }
  return {
    // cert() returns a Credential object directly in v14+
    credential: cert({
      clientEmail: sa.client_email,
      privateKey: sa.private_key,
      projectId: sa.project_id,
    }),
    projectId: sa.project_id,
  };
}

/** Load and validate the credential + project id. */
function resolve() {
  // 1. Local file.
  if (fs.existsSync(LOCAL_FILE)) {
    const raw = fs.readFileSync(LOCAL_FILE, "utf8");
    const sa = JSON.parse(raw);
    const { credential, projectId } = fromServiceAccount(sa);
    return { credential, projectId };
  }

  // 2. Base64 env var.
  if (process.env.FIREBASES_CREDENTIALS) {
    const sa = JSON.parse(
      Buffer.from(process.env.FIREBASES_CREDENTIALS, "base64").toString("utf8")
    );
    const { credential, projectId } = fromServiceAccount(sa);
    return { credential, projectId };
  }

  // 3. GOOGLE_APPLICATION_CREDENTIALS file path.
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    const raw = fs.readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, "utf8");
    const sa = JSON.parse(raw);
    const { credential, projectId } = fromServiceAccount(sa);
    return { credential, projectId };
  }

  // 4. ADC — let google-auth-library figure it out.
  return { credential: undefined, projectId: undefined };
}

/** Return the Admin credential object (or undefined for ADC). */
function getCredential() {
  return resolve().credential;
}

/** Return the project id, env override first. */
function getProjectId() {
  return process.env.FIREBASES_PROJECT_ID || resolve().projectId;
}

module.exports = { getCredential, getProjectId };