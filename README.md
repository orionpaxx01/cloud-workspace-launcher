# Cloud Workspace Launcher

Save, sync, and launch entire browser workspaces (tabs, groups, pinned state)
in one click. Backed by three interchangeable storage backends.

## Features

- **Capture** — snapshot the current window (tabs + tab groups + pinned state).
- **Restore** — reopen a workspace in a new window, or into the current one.
- **Three backends** — switch in Settings:
  - **Local** — `chrome.storage` only. Offline, no setup, no cloud.
  - **Firebase** — Firestore sync across signed-in devices (needs a Firebase project).
  - **Custom** — your own REST API (`GET/POST /workspaces`, `GET/DELETE /workspaces/:id`).
- **Auto-capture** — debounced snapshot on tab/window changes.
- **Privacy-first** — local backend never leaves the device; Firebase sync is opt-in.

## Install

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top-right toggle).
3. Click **Load unpacked** and select this folder.
4. Pin the extension to the toolbar.

## Usage

- Click the toolbar icon → list of saved workspaces.
- Type a name and hit **Save** (or click the camera icon to pre-fill a name).
- Click **Restore** to reopen all tabs in your current window.
- Click **Settings** (in the popup) to switch backends and configure capture prefs.

## Firebase setup

The extension talks to Firestore through two different paths — pick the one
that fits your deployment.

### Option A — Extension-native (no backend)

The extension talks to Firestore directly via its REST API using your project's
`apiKey`. No server, no sign-in, no per-user isolation — every signed-in user
shares the same collection.

1. Create a project at [Firebase Console](https://console.firebase.google.com/).
2. Register a web app → copy `apiKey`, `authDomain`, `projectId`, `storageBucket`, `appId`.
3. In the extension Settings, select **Firebase** and paste the values.
4. Make sure your Firestore security rules allow reads/writes for the API key
   (or scope them by user if you add auth later).

> Only client-side config is needed. Never commit a real `firebaseConfig.json`.

### Option B — Custom backend with Firebase (recommended)

Run the bundled backend (`backend/`) in **Firebase mode**. It uses the Admin
SDK with a service account, so writes are gated on a verified Firebase ID
token and every workspace is scoped to the caller's `uid` — one user can never
read or mutate another user's workspaces.

1. Create a project at [Firebase Console](https://console.firebase.google.com/).
2. Generate a **service account key** (IAM & Admin → Service Accounts → Create
   key, JSON). This is the only secret the backend needs.
3. Deploy the Firestore rules in `backend/firestore.rules`:

   ```bash
   firebase deploy --only firestore
   ```

   The rules scope every document to `request.auth.uid == resource.data.owner`.

4. Put the service-account JSON somewhere the backend can read it, in priority
   order (see `backend/firebase-credentials.js`):

   - `backend/firebase-credentials.json` (gitignored — safe to keep locally)
   - `FIREBASES_CREDENTIALS` env var, base64-encoded JSON
   - `GOOGLE_APPLICATION_CREDENTIALS` env var pointing at the file on disk

5. Start the backend in Firebase mode:

   ```bash
   cd backend
   STORAGE_BACKEND=firebase npm start
   # -> Backend listening on http://localhost:3000
   ```

6. In the extension Settings, select **Custom** and point it at
   `http://localhost:3000`. The extension signs in with Firebase Auth and sends
   the returned ID token in the `Authorization: Bearer <token>` header on every
   request.

> Never commit a real `firebaseConfig.json` or service-account key.

## AI Features (Anthropic)

Enable intelligent auto-naming, predictive lazy restore, and semantic tab
grouping by providing an Anthropic API key in the Settings → **AI Features**
section.

1. Create an API key at [Anthropic Console](https://console.anthropic.com/).
2. In the extension Settings (click the gear icon in the popup), expand **AI
   Features** and paste your key.
3. Toggle **Auto-name workspaces with AI** to generate contextual workspace
   names (e.g. "React App Development") instead of timestamps.
4. Toggle **Predictive lazy restore** to let the model decide which tabs stay
   loaded in memory during a restore (instead of keeping only the first tab).
5. Toggle **Semantic tab grouping** to let the model organize ungrouped tabs
   into logical Chrome tab groups with colors and titles.

> The API key is stored only in your local Chrome profile (`chrome.storage.sync`)
> and is sent directly to `api.anthropic.com` via `fetch` — no third-party
> servers involved. If an AI call fails or times out (2s), the extension falls
> back to the default behaviour silently so core save/restore never breaks.

## Custom backend

The bundled backend (`backend/`) is a plain Node.js REST API with **no external
dependencies** — it uses only Node's built-in `http` module and persists workspaces
to a local JSON file.

### Run it

```bash
cd backend
npm start
# -> Backend listening on http://localhost:3000
```

Override the port or data directory with environment variables:

```bash
PORT=3001 npm start            # custom port
DATA_DIR=/var/lib/ws npm start # custom data directory
STORE_FILE=/tmp/ws.json npm start
```

### Dashboard

`http://localhost:3000` serves a Bootstrap dashboard that shows every saved
workspace (name, ID, tab count, timestamps, delete), a live status indicator,
and per-workspace stats. It talks to the same REST API the extension uses, so
what you save in the popup appears here instantly.

The dashboard is served statically from `backend/public/` — edit
`public/index.html`, `public/dashboard.css`, `public/dashboard.js` to customise
it. No build step.

### API contract

Point the extension at any server implementing:

```
GET    /workspaces            -> [workspace, ...]
POST   /workspaces            -> workspace   (body: workspace JSON)
GET    /workspaces/:id        -> workspace | 404
DELETE /workspaces/:id        -> 200 | error
```

## File layout

```
backend/
  server.js          — HTTP server wrapping store.js (REST API + dashboard)
  store.js           — JSON-file persistence (atomic writes)
  public/
    index.html       — Bootstrap dashboard UI
    dashboard.css    — dashboard styling
    dashboard.js     — dashboard client (plain fetch, no deps)
src/
  utils.js          — pure helpers (generateId, isRestorableUrl, debounce, …)
  settings.js       — user settings persistence (chrome.storage.sync)
  storage.js        — storage abstraction: local / firebase / custom
  background.js     — service worker: capture, restore, sync, message router
  popup.html/.js/.css — toolbar popup
  options.html/.js/.css — settings page
  content.js        — content script bridge
  injected.js       — web-accessible script (main world)
  icons/            — 16/48/128 PNGs + SVG source
scripts/
  generate-icons.py — regenerate PNGs from icon.svg (pip install pillow)
manifest.json      — MV3 manifest
```

## Regenerate icons

```bash
pip install pillow
python scripts/generate-icons.py
```

## License

MIT