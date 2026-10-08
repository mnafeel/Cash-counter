# Cash-counter

A responsive cash counter app for phone, tablet, and desktop. Track bills, customer payments, change, expenses, and drawer balance — all saved locally on your device.

## Features

- **Home** — Current cash in drawer, today’s sales/expenses, quick navigation
- **Cash Counter** — Bill amount, customer payment, return change (large display), round-off suggestions, optional customer name
- **Cash Expenses** — Record money taken out of the drawer
- **History** — All saved bills and expenses
- **Settings** — Set opening cash balance

## Live app (GitHub Pages)

**https://dashboard.shalimarfashions.com/**

Hosted on the `dashboard` subdomain. The public Shalimar Fashions site (`shalimarfashions.com`) is separate.

Every push to `main` builds and publishes the app to the `main` branch. In repo **Settings → Pages**, set source to **Deploy from a branch** → `main` → `/ (root)`, custom domain `dashboard.shalimarfashions.com`.

DNS: `dashboard` CNAME → `mnafeel.github.io`

### Run locally

Use the dev entry file — do not edit root `index.html` (it is the live build):

```bash
npm install
npm run dev
```

Open the URL shown in the terminal (usually `http://localhost:5173`).

## Build for production

```bash
npm run build
npm run preview
```

Data is stored in your browser (`localStorage`) — no server required.

## Cloud backup format

Cloud backups use a small manifest at `users/{uid}/data/latest`. The complete JSON
is split into UTF-8-safe parts (at most 600 KB each) stored under
`users/{uid}/snapshots/{backupId}/chunks/{index}`. After every part is uploaded,
the history manifest and latest pointer are published in one atomic batch. A
failed upload therefore leaves the previous published backup available. Existing
single-document backups remain readable; the next successful save uses parts.
The owner-only recursive Firestore rules already cover these paths.

Deploy the updated app and reload **every device** before saving in the new
format; older app builds cannot read the manifest. Keep a downloaded local JSON
backup from the main billing device before rollout. On that device, use Settings
→ Cloud → Save to cloud after updating. Do not load an older cloud backup to
resolve a failed upload: it could replace newer local records.

Each backup uses multiple document reads/writes. History parts are retained with
their snapshot; deleting a snapshot manifest alone does not delete its parts.
Interrupted uploads can leave unpublished parts that require later cleanup.

Run the chunk regression checks with Node 22.6+:

```bash
node --experimental-strip-types --test tests/backupChunks.test.mjs
```

For rollout, recovery, and Firebase billing steps, see [OPERATIONS.md](OPERATIONS.md).
