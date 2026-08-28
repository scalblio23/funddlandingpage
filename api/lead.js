// Shared, public, cross-origin lead capture endpoint. Unlike
// /api/submit-lead.js (same-origin, this site only), this one is meant to
// be called from OTHER sites too — e.g. a GoHighLevel "Custom HTML" page,
// which has no backend of its own and can't safely hold the Google service
// account credentials, so it calls out to this endpoint instead.
//
// Security note: the caller only ever sends a `client` key (e.g.
// "goal-finance"), never a raw Google Sheet ID. The key -> Sheet ID mapping
// lives server-side only, so a public caller can never point this endpoint
// at an arbitrary sheet — only at one of the sheets we've explicitly
// configured below.
//
// Required Vercel environment variables:
//   GOOGLE_SERVICE_ACCOUNT_EMAIL  (shared with /api/submit-lead.js)
//   GOOGLE_PRIVATE_KEY            (shared with /api/submit-lead.js)
//   LEAD_SHEET_MAP                JSON string mapping client key -> Sheet ID, e.g.
//                                 {"goal-finance":"1yQ_d0tVO6_..."}

import { JWT } from 'google-auth-library'

const SHEET_RANGE = 'A:A' // append after the last row of column A, first tab

function normalizePrivateKey(raw) {
  let key = raw.trim()
  if (key.length >= 2 && key[0] === '"' && key[key.length - 1] === '"') {
    key = key.slice(1, -1)
  }
  return key.replace(/\\n/g, '\n').trim()
}

function setCors(res) {
  // Write-only endpoint, no sensitive data read back out, so any origin
  // may call it — same trust model as a public Zapier catch-hook URL.
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

export default async function handler(req, res) {
  setCors(res)

  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const { GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY, LEAD_SHEET_MAP } = process.env
  if (!GOOGLE_SERVICE_ACCOUNT_EMAIL || !GOOGLE_PRIVATE_KEY || !LEAD_SHEET_MAP) {
    console.error('lead: missing env vars (service account or sheet map)')
    res.status(500).json({ error: 'Server not configured' })
    return
  }

  let sheetMap
  try {
    sheetMap = JSON.parse(LEAD_SHEET_MAP)
  } catch (e) {
    console.error('lead: LEAD_SHEET_MAP is not valid JSON', e)
    res.status(500).json({ error: 'Server not configured' })
    return
  }

  const body = req.body || {}
  const { client, fields } = body

  const sheetId = sheetMap[client]
  if (!sheetId) {
    // Deliberately vague — don't reveal which client keys are valid.
    res.status(400).json({ error: 'Unknown client' })
    return
  }

  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
    res.status(400).json({ error: 'Missing fields' })
    return
  }

  try {
    const jwt = new JWT({
      email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
      key: normalizePrivateKey(GOOGLE_PRIVATE_KEY),
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    })
    const { token } = await jwt.getAccessToken()

    // `fields` is a flat object of column values, in whatever order the
    // caller wants them written — the caller owns its own column layout.
    const row = [body.submittedAt || new Date().toISOString(), ...Object.values(fields)]

    const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(
      SHEET_RANGE
    )}:append?valueInputOption=USER_ENTERED`

    const sheetsRes = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ values: [row] }),
    })

    if (!sheetsRes.ok) {
      const text = await sheetsRes.text()
      console.error('lead: Sheets API error', sheetsRes.status, text)
      res.status(502).json({ error: 'Sheets append failed' })
      return
    }

    res.status(200).json({ ok: true })
  } catch (err) {
    console.error('lead: unexpected error', err)
    res.status(500).json({ error: 'Unexpected error' })
  }
}
