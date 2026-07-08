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

Every push to `main` builds the app and deploys it to the `gh-pages` branch.

### One-time setup (required if you see a blank page)

1. Open **https://github.com/mnafeel/Cash-counter/settings/pages**
2. Under **Build and deployment → Source**, choose **Deploy from a branch**
3. Set **Branch** to `gh-pages` and folder to **`/ (root)`**
4. Click **Save**
5. Wait 1–2 minutes, then refresh the live link above

Do **not** use `main` branch as the Pages source — that serves source files and shows a blank page.

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
