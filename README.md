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

## Backup lead capture (Google Sheet, independent of Zapier/Make)

On submit, the site sends the lead to the Zapier webhook **and**, in parallel,
to `/api/submit-lead` — a Vercel serverless function (free on the Hobby plan)
that appends the lead straight into a Google Sheet using a Google service
account. This path only depends on Google being up, not on Zapier or Make.com
staying paid/active, so a lapsed subscription on either of those can no
longer mean lost leads.

The sheet: https://docs.google.com/spreadsheets/d/1iAh1RZow87mKuY2tu4ustZGo4VoNarmF1RIgM5dYBCY/edit

**One-time setup to activate this path:**

1. In [Google Cloud Console](https://console.cloud.google.com/), create (or
   pick) a project, then go to **APIs & Services → Library** and enable the
   **Google Sheets API**.
2. Go to **APIs & Services → Credentials → Create Credentials → Service
   Account**. Give it any name (e.g. `fincheck-leads-writer`) and finish
   creation — no roles needed.
3. Open the new service account → **Keys → Add Key → Create new key → JSON**.
   This downloads a JSON file — keep it private, don't commit it.
4. Share the Google Sheet above with the service account's email address
   (found in the JSON as `client_email`), giving it **Editor** access.
5. In your Vercel project → **Settings → Environment Variables**, add:
   - `GOOGLE_SERVICE_ACCOUNT_EMAIL` — the `client_email` value from the JSON
   - `GOOGLE_PRIVATE_KEY` — the `private_key` value from the JSON, pasted
     as-is (it contains literal `\n` sequences — the function converts them
     back to real newlines, so don't try to reformat it)
   - `GOOGLE_SHEET_ID` — `1iAh1RZow87mKuY2tu4ustZGo4VoNarmF1RIgM5dYBCY`
     (the long ID in the sheet's URL)
6. Redeploy. New submissions will start landing as rows in the sheet.

Until those env vars are set, `/api/submit-lead` fails quietly (logged to
the browser console only) and the Zapier path keeps working as before —
nothing breaks in the meantime.

## Shared public endpoint for other sites (`/api/lead`)

`/api/submit-lead` above is same-origin only — it's meant for this site
calling its own backend. Some landing pages (e.g. a GoHighLevel "Custom
HTML" page) have no backend of their own at all, so they can't safely hold
the Google service account credentials. `/api/lead` exists for those: it's a
second, public, CORS-enabled endpoint on this same deployment that any site
can call cross-origin.

It reuses the same `GOOGLE_SERVICE_ACCOUNT_EMAIL` / `GOOGLE_PRIVATE_KEY`
above, plus one more env var:

- `LEAD_SHEET_MAP` — a JSON string mapping a client key to a Sheet ID, e.g.
  ```json
  {"goal-finance":"1yQ_d0tVO6_aQtB1bGsUz8_JGgYormH2fXtaq0lv2oiU"}
  ```
  Add a new `"key": "sheetId"` entry here for every new site that uses this
  endpoint — no code change needed, just extend the map.

**Callers never send a raw Sheet ID** — only a `client` key, which the
server looks up in `LEAD_SHEET_MAP`. This is deliberate: since the endpoint
is public, letting a caller name the target sheet directly would let anyone
try to write into any sheet the service account has access to. The mapping
keeps write access scoped to sheets we've explicitly configured.

**Request shape:**
```js
fetch('https://secure.fundd.finchecker.com.au/api/lead', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    client: 'goal-finance', // must be a key in LEAD_SHEET_MAP
    fields: { name: 'Jane', debts: 'Credit card', employment: 'Full time' /* ... */ },
  }),
})
```
`fields` is a flat object — its values get appended as one new row, in
`Object.values()` order, after a leading timestamp column.
