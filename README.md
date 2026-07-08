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

Every push to `main` automatically:
1. Builds the app
2. Deploys to the `gh-pages` branch
3. Updates the `docs/` folder on `main`
4. Tries to set GitHub Pages to use the built app

### If you still see a blank page

Open **https://github.com/mnafeel/Cash-counter/settings/pages** and set:

- **Source:** Deploy from a branch
- **Branch:** `gh-pages` → **`/ (root)`**

**Or use:**

- **Branch:** `main` → **`/docs`**

Do **not** use `main` → **`/ (root)`** — that serves dev source code and shows a blank page.

## Run locally

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
