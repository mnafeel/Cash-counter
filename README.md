# Cash-counter

A responsive cash counter app for phone, tablet, and desktop. Track bills, customer payments, change, expenses, and drawer balance — all saved locally on your device.

## Features

- **Home** — Current cash in drawer, today’s sales/expenses, quick navigation
- **Cash Counter** — Bill amount, customer payment, return change (large display), round-off suggestions, optional customer name
- **Cash Expenses** — Record money taken out of the drawer
- **History** — All saved bills and expenses
- **Settings** — Set opening cash balance

## Live app (GitHub Pages)

**https://cc.shalimarfashions.com/**

Hosted on the `cc` subdomain (separate from the public Shalimar Fashions website on `shalimarfashions.com`).

Every push to `main` builds and publishes the app to the `main` branch. In repo **Settings → Pages**, set source to **Deploy from a branch** → `main` → `/ (root)`, custom domain `cc.shalimarfashions.com`.

DNS: `cc` CNAME → `mnafeel.github.io`

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
