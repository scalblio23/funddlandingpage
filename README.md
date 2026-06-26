# Fincheck — Business Loans Funnel

Single-page Vite + React landing page + multi-step survey. Static build, deploys to Vercel with zero config.

## Before you go live — edit `src/App.jsx`

At the top of the file:

1. `WEBHOOK_URL` — paste this funnel's Make.com webhook (routes the lead to its Google Sheet).
2. `GOOGLE_MAPS_KEY` — (optional) paste a Google Maps JS API key to turn on address autocomplete. Leave blank and the address field is a normal text input — the build still works either way.
3. `BRAND` — already set to `finchecker` for Pixel/Events Manager filtering. Leave it.

Meta Pixel `1977675273118337` is wired in `index.html` (PageView) and the `Lead` event fires on submit with `{ brand: 'finchecker' }`.

## Deploy (GitHub → Vercel)

1. Push these files to a new GitHub repo.
2. Import the repo in Vercel. It auto-detects **Vite** — build command `npm run build`, output `dist`. No env vars needed.
3. Add your custom domain (e.g. `businessloans.finchecker.com.au`) in Vercel → Domains, then the CNAME in GoDaddy.

## Survey flow

Landing slider (`$5,000 – $1,000,000`) → purpose → timing → priority → business start (month + year) → monthly revenue → credit score → contact details → thank-you. Single-select questions auto-advance; answers persist to `localStorage` so a refresh resumes mid-quiz.

## Lead payload sent to the webhook

`brand, loanAmount, loanAmountFormatted, purpose, timing, priority, businessStartMonth, businessStartYear, monthlyRevenue, creditScore, fullName, email, mobile, businessName, birthDate, address, pageUrl, submittedAt`
