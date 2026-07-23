# Cash-counter

A responsive cash counter app for phone, tablet, and desktop. Track bills, customer payments, change, expenses, and drawer balance — all saved locally on your device.

## Features

- **Home** — Current cash in drawer, today’s sales/expenses, quick navigation
- **Cash Counter** — Bill amount, customer payment, return change (large display), round-off suggestions, optional customer name
- **Cash Expenses** — Record money taken out of the drawer
- **History** — All saved bills and expenses
- **Settings** — Set opening cash balance

## Live app (GitHub Pages)

**https://mnafeel.github.io/Cash-counter/**

Every push to `main` builds the app and deploys via GitHub Actions. In repo **Settings → Pages**, set source to **GitHub Actions** (not “Deploy from branch”).

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
