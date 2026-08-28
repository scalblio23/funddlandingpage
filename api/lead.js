// Shared, public, cross-origin lead capture endpoint. Unlike
// /api/submit-lead.js (same-origin, this site only), this one is meant to
// be called from OTHER sites too — e.g. a GoHighLevel "Custom HTML" page,
// which has no backend of its own and can't safely hold the Google service
// account credentials, so it calls out to this endpoint instead.
//
// Security note: the caller only ever sends a `client` key (e.g.
// "goal-finance"), never a raw Google Sheet ID or webhook URL. Those
// mappings live server-side only, so a public caller can never point this
// endpoint at an arbitrary destination — only at ones we've explicitly
// configured below.
//
// A client can have either or both destinations configured, and the two
// run as fully independent operations (Promise.allSettled) — neither is
// gated on the other succeeding, so a Google Cloud outage can't silence a
// GHL webhook forward, and vice versa. That independence is the entire
// point of having more than one delivery path.
//
// Environment variables:
//   GOOGLE_SERVICE_ACCOUNT_EMAIL  required only if any client uses LEAD_SHEET_MAP
//   GOOGLE_PRIVATE_KEY            required only if any client uses LEAD_SHEET_MAP
//   LEAD_SHEET_MAP                JSON string mapping client key -> Google Sheet ID, e.g.
//                                 {"goal-finance":"1yQ_d0tVO6_..."}
//   LEAD_WEBHOOK_MAP              JSON string mapping client key -> an extra
//                                 webhook URL to forward the lead to (e.g. a
//                                 GHL "Inbound Webhook" workflow trigger URL), e.g.
//                                 {"goal-finance":"https://services.leadconnectorhq.com/hooks/..."}
//                                 Sent server-to-server, so it's immune to the
//                                 CORS issues a client-side fetch to a webhook
//                                 endpoint would risk.
//
// A client key needs at least one of the two maps to have an entry; either
// alone is enough to accept the request.

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

function parseJsonMap(envValue, envName) {
  if (!envValue) return {}
  try {
    return JSON.parse(envValue)
  } catch (e) {
    console.error(`lead: ${envName} is not valid JSON`, e)
    return {}
  }
}

async function appendToSheet(sheetId, fields, submittedAt) {
  const { GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY } = process.env
  if (!GOOGLE_SERVICE_ACCOUNT_EMAIL || !GOOGLE_PRIVATE_KEY) {
    throw new Error('Google service account env vars not set')
  }

  const jwt = new JWT({
    email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: normalizePrivateKey(GOOGLE_PRIVATE_KEY),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  })
  const { token } = await jwt.getAccessToken()

  // `fields` is a flat object of column values, in whatever order the
  // caller wants them written — the caller owns its own column layout.
  const row = [submittedAt, ...Object.values(fields)]

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
    throw new Error(`Sheets API ${sheetsRes.status}: ${await sheetsRes.text()}`)
  }
}

async function forwardToWebhook(webhookUrl, client, fields, submittedAt) {
  const webhookRes = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client, submittedAt, ...fields }),
  })
  if (!webhookRes.ok) {
    throw new Error(`Webhook ${webhookRes.status}: ${await webhookRes.text()}`)
  }
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

  const body = req.body || {}
  const { client, fields } = body

  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
    res.status(400).json({ error: 'Missing fields' })
    return
  }

  const sheetMap = parseJsonMap(process.env.LEAD_SHEET_MAP, 'LEAD_SHEET_MAP')
  const webhookMap = parseJsonMap(process.env.LEAD_WEBHOOK_MAP, 'LEAD_WEBHOOK_MAP')

  const sheetId = sheetMap[client]
  const webhookUrl = webhookMap[client]

  if (!sheetId && !webhookUrl) {
    // Deliberately vague — don't reveal which client keys are valid.
    res.status(400).json({ error: 'Unknown client' })
    return
  }

  const submittedAt = body.submittedAt || new Date().toISOString()

  const jobs = []
  if (sheetId) jobs.push({ channel: 'sheet', promise: appendToSheet(sheetId, fields, submittedAt) })
  if (webhookUrl) jobs.push({ channel: 'webhook', promise: forwardToWebhook(webhookUrl, client, fields, submittedAt) })

  const settled = await Promise.allSettled(jobs.map((j) => j.promise))
  const results = settled.map((r, i) => {
    const channel = jobs[i].channel
    if (r.status === 'rejected') {
      console.error(`lead: ${channel} failed`, client, r.reason)
      return { channel, ok: false }
    }
    return { channel, ok: true }
  })

  const anyOk = results.some((r) => r.ok)
  res.status(anyOk ? 200 : 502).json({ ok: anyOk, results })
}
