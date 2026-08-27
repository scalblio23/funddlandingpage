// Backup lead capture — writes straight into a Google Sheet via a Google
// service account, independent of any third-party automation platform
// (Zapier/Make). This is a Vercel serverless function (free on the Hobby
// plan) so a lapsed Zapier/Make subscription can never take this path down.
//
// Required Vercel environment variables (see README for setup steps):
//   GOOGLE_SERVICE_ACCOUNT_EMAIL
//   GOOGLE_PRIVATE_KEY
//   GOOGLE_SHEET_ID

import { JWT } from 'google-auth-library'

// No sheet/tab name prefix — the Sheets API falls back to the first visible
// tab when one isn't specified, so renaming that tab doesn't break this.
const SHEET_RANGE = 'A:A' // append after the last row of column A

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const { GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY, GOOGLE_SHEET_ID } = process.env
  if (!GOOGLE_SERVICE_ACCOUNT_EMAIL || !GOOGLE_PRIVATE_KEY || !GOOGLE_SHEET_ID) {
    console.error('submit-lead: missing Google service account env vars')
    res.status(500).json({ error: 'Server not configured' })
    return
  }

  const lead = req.body || {}

  try {
    const client = new JWT({
      email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
      // Vercel env vars can't store real newlines, so the key is pasted
      // with literal "\n" sequences — turn them back into real newlines.
      key: GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    })
    const { token } = await client.getAccessToken()

    const row = [
      lead.submittedAt || new Date().toISOString(),
      lead.fullName,
      lead.email,
      lead.mobile,
      lead.birthDate,
      lead.address,
      lead.loanAmount,
      lead.loanAmountFormatted,
      lead.purpose,
      lead.timing,
      lead.priority,
      lead.financeNow,
      lead.employment,
      lead.income,
      lead.creditScore,
      lead.hasDefaults,
      lead.brand,
      lead.pageUrl,
    ]

    const url = `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEET_ID}/values/${encodeURIComponent(
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
      console.error('submit-lead: Sheets API error', sheetsRes.status, text)
      res.status(502).json({ error: 'Sheets append failed' })
      return
    }

    res.status(200).json({ ok: true })
  } catch (err) {
    console.error('submit-lead: unexpected error', err)
    res.status(500).json({ error: 'Unexpected error' })
  }
}
