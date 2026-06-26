import { useState, useEffect, useRef } from 'react'

/* ============================================================
   CONFIG — replace these two values
   ============================================================ */
// Your Make.com webhook for this funnel (routes the lead to your Google Sheet)
const WEBHOOK_URL = 'https://hook.eu1.make.com/zrg0g98jjwnf0b3zcsjpgydv3xbsr6gg'

// Optional: Google Maps JS API key to enable address autocomplete.
// Leave blank to fall back to a plain text input (build still works).
const GOOGLE_MAPS_KEY = ''

// Brand parameter used on the Meta Pixel Lead event + sent to the webhook
const BRAND = 'finchecker'

const STORAGE_KEY = 'fincheck_home_loans_v1'

/* ============================================================
   Survey data
   ============================================================ */
const SLIDER_MIN = 50000
const SLIDER_MAX = 2000000
const SLIDER_STEP = 10000

const PURPOSE_OPTS = [
  'Purchase a Home',
  'Refinance',
  'Investment Property',
  'Construction',
  'First Home Buyer',
  'Other',
]
const TIMING_OPTS = ['ASAP', 'Within 30 Days', '1-3 Months', '3-6 Months', 'Just Researching']
const PRIORITY_OPTS = ['Lowest Rate', 'Flexible Repayments', 'Offset Account', 'Fast Approval', 'Lower Monthly Repayments']
const EMPLOYMENT_OPTS = [
  'Full-Time',
  'Part-Time',
  'Self-Employed',
  'Contractor',
  'Casual',
  'Retired',
]
const INCOME_OPTS = [
  'Under $50k',
  '$50k - $80k',
  '$80k - $120k',
  '$120k - $180k',
  '$180k - $250k',
  '$250k+',
]
const CREDIT_OPTS = ['Excellent (720+)', 'Good (680-719)', 'Fair (640-679)', 'Poor (<640)']

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const CURRENT_YEAR = new Date().getFullYear()
const YEARS = Array.from({ length: CURRENT_YEAR - 1989 }, (_, i) => String(CURRENT_YEAR - i))

const TOTAL_STEPS = 7 // quiz steps (excludes landing + thank-you)

const fmt = (n) => '$' + Number(n).toLocaleString('en-AU')

const emptyData = {
  loanAmount: 500000,
  purpose: '',
  timing: '',
  priority: '',
  employment: '',
  income: '',
  creditScore: '',
  fullName: '',
  email: '',
  mobile: '',
  propertyState: '',
  birthDate: '',
  address: '',
}

/* ============================================================
   Sub-components
   ============================================================ */
function Progress({ step }) {
  const pct = Math.round((step / TOTAL_STEPS) * 100)
  return (
    <div className="progress">
      <div className="progress-bar">
        <div className="progress-fill" style={{ width: pct + '%' }} />
      </div>
      <div className="progress-text">
        Step {step} of {TOTAL_STEPS}
      </div>
    </div>
  )
}

function SelectStep({ title, help, options, value, onSelect, cols }) {
  return (
    <div className="card">
      <h2 className="q-title">{title}</h2>
      {help && <p className="q-help">{help}</p>}
      <div className={'options' + (cols ? ' cols' : '')}>
        {options.map((opt) => (
          <button
            key={opt}
            type="button"
            className={'option' + (value === opt ? ' selected' : '')}
            onClick={() => onSelect(opt)}
          >
            <span>{opt}</span>
            <span className="check" />
          </button>
        ))}
      </div>
    </div>
  )
}

/* ============================================================
   App
   ============================================================ */
export default function App() {
  const [step, setStep] = useState(0) // 0 = landing, 1..7 = quiz, 8 = thanks
  const [data, setData] = useState(emptyData)
  const [errors, setErrors] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const addressRef = useRef(null)

  // Restore from localStorage
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
      if (saved && saved.data) {
        setData({ ...emptyData, ...saved.data })
        if (typeof saved.step === 'number' && saved.step < 8) setStep(saved.step)
      }
    } catch (e) {}
  }, [])

  // Persist progress (don't persist the thank-you state)
  useEffect(() => {
    if (step < 8) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ step, data }))
      } catch (e) {}
    }
  }, [step, data])

  const set = (key, val) => setData((d) => ({ ...d, [key]: val }))

  const next = () => setStep((s) => Math.min(s + 1, 8))
  const back = () => setStep((s) => Math.max(s - 1, 0))

  // Auto-advance for single-select questions
  const pick = (key, val) => {
    set(key, val)
    setTimeout(() => setStep((s) => Math.min(s + 1, 8)), 220)
  }

  // Google Places autocomplete (graceful fallback if no key)
  useEffect(() => {
    if (step !== 7 || !GOOGLE_MAPS_KEY) return
    const attach = () => {
      if (!addressRef.current || !window.google?.maps?.places) return
      const ac = new window.google.maps.places.Autocomplete(addressRef.current, {
        componentRestrictions: { country: 'au' },
        fields: ['formatted_address'],
        types: ['address'],
      })
      ac.addListener('place_changed', () => {
        const place = ac.getPlace()
        if (place?.formatted_address) set('address', place.formatted_address)
      })
    }
    if (window.google?.maps?.places) {
      attach()
    } else if (!document.getElementById('gmaps-script')) {
      const s = document.createElement('script')
      s.id = 'gmaps-script'
      s.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_KEY}&libraries=places`
      s.async = true
      s.onload = attach
      document.head.appendChild(s)
    } else {
      document.getElementById('gmaps-script').addEventListener('load', attach)
    }
  }, [step])

  const validateContact = () => {
    const e = {}
    if (!data.fullName.trim()) e.fullName = 'Required'
    if (!/^\S+@\S+\.\S+$/.test(data.email)) e.email = 'Enter a valid email'
    if (data.mobile.replace(/\D/g, '').length < 8) e.mobile = 'Enter a valid number'
    setErrors(e)
    if (Object.keys(e).length > 0) {
      const first = document.querySelector('.err')
      if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return false
    }
    return true
  }

  const submit = async () => {
    if (!validateContact() || submitting) return
    setSubmitting(true)
    try { await _doSubmit() } catch (e) { console.error(e) } finally { setSubmitting(false) }
  }

  const _doSubmit = async () => {

    const payload = {
      brand: BRAND,
      loanAmount: data.loanAmount,
      loanAmountFormatted: fmt(data.loanAmount),
      purpose: data.purpose,
      timing: data.timing,
      priority: data.priority,
      employment: data.employment,
      income: data.income,
      creditScore: data.creditScore,
      fullName: data.fullName.trim(),
      email: data.email.trim(),
      mobile: data.mobile.trim(),
      propertyState: data.propertyState,
      birthDate: data.birthDate,
      address: data.address.trim(),
      pageUrl: window.location.href,
      submittedAt: new Date().toISOString(),
    }

    // Meta Pixel Lead event with brand parameter
    try {
      if (window.fbq) window.fbq('track', 'Lead', { brand: BRAND })
    } catch (e) {}

    // Send to Make.com webhook
    try {
      await fetch(WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
    } catch (e) {
      console.error('Webhook error:', e)
    }

    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch (e) {}
    setStep(8)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // Load Calendly widget when thank-you step is reached
  useEffect(() => {
    if (step !== 8) return
    if (document.getElementById('calendly-script')) {
      if (window.Calendly) window.Calendly.initInlineWidgets()
      return
    }
    const s = document.createElement('script')
    s.id = 'calendly-script'
    s.src = 'https://assets.calendly.com/assets/external/widget.js'
    s.async = true
    document.head.appendChild(s)
  }, [step])

  // scroll to top on step change
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [step])

  const sliderPct = ((data.loanAmount - SLIDER_MIN) / (SLIDER_MAX - SLIDER_MIN)) * 100
  const sliderBg = `linear-gradient(to right, var(--blue) 0%, var(--blue) ${sliderPct}%, var(--track) ${sliderPct}%, var(--track) 100%)`

  return (
    <div className="page">
      <div className="topbar" />
      <div className="wrap">
        {/* ---------------- LANDING ---------------- */}
        {step === 0 && (
          <>
            <div className="hero">
              <h1>
                Compare Home Loan Offers In Seconds
              </h1>
              <p className="sub">Get Access To 100+ Lenders In Minutes</p>
            </div>
            <div className="card">
              <h2 className="q-title">How much do you want to borrow?</h2>
              <div className="slider-wrap">
                <input
                  type="range"
                  className="slider"
                  min={SLIDER_MIN}
                  max={SLIDER_MAX}
                  step={SLIDER_STEP}
                  value={data.loanAmount}
                  style={{ background: sliderBg }}
                  onChange={(e) => set('loanAmount', Number(e.target.value))}
                />
                <div className="slider-ends">
                  <span>{fmt(SLIDER_MIN)}</span>
                  <span>{fmt(SLIDER_MAX)}</span>
                </div>
                <div className="slider-value">{fmt(data.loanAmount)}</div>
              </div>
              <button className="btn btn-block" onClick={next}>
                Compare Offers
              </button>
            </div>
          </>
        )}

        {/* ---------------- QUIZ ---------------- */}
        {step >= 1 && step <= 7 && <Progress step={step} />}

        {step === 1 && (
          <SelectStep
            title="What type of home loan are you looking for?"
            options={PURPOSE_OPTS}
            value={data.purpose}
            onSelect={(v) => pick('purpose', v)}
          />
        )}

        {step === 2 && (
          <SelectStep
            title="When are you looking to get a home loan?"
            options={TIMING_OPTS}
            value={data.timing}
            onSelect={(v) => pick('timing', v)}
          />
        )}

        {step === 3 && (
          <SelectStep
            title="What's most important for you?"
            options={PRIORITY_OPTS}
            value={data.priority}
            onSelect={(v) => pick('priority', v)}
          />
        )}

        {step === 4 && (
          <SelectStep
            title="What's your employment status?"
            options={EMPLOYMENT_OPTS}
            value={data.employment}
            onSelect={(v) => pick('employment', v)}
          />
        )}

        {step === 5 && (
          <SelectStep
            title="What's your annual household income?"
            options={INCOME_OPTS}
            value={data.income}
            cols
            onSelect={(v) => pick('income', v)}
          />
        )}

        {step === 6 && (
          <SelectStep
            title="What's your estimated credit score?"
            options={CREDIT_OPTS}
            value={data.creditScore}
            onSelect={(v) => pick('creditScore', v)}
          />
        )}

        {step === 7 && (
          <div className="card">
            <h2 className="q-title">Where should we send your offers?</h2>
            <p className="q-help">Your details are kept private and secure</p>
            <div className="fields">
              <div className="field">
                <label>Full Name</label>
                <input
                  type="text"
                  placeholder="John Smith"
                  value={data.fullName}
                  onChange={(e) => set('fullName', e.target.value)}
                />
                {errors.fullName && <span className="err">{errors.fullName}</span>}
              </div>
              <div className="field">
                <label>Email Address</label>
                <input
                  type="email"
                  inputMode="email"
                  placeholder="john@email.com.au"
                  value={data.email}
                  onChange={(e) => set('email', e.target.value)}
                />
                {errors.email && <span className="err">{errors.email}</span>}
              </div>
              <div className="field">
                <label>Mobile Number</label>
                <input
                  type="tel"
                  inputMode="tel"
                  placeholder="0400 000 000"
                  value={data.mobile}
                  onChange={(e) => set('mobile', e.target.value)}
                />
                {errors.mobile && <span className="err">{errors.mobile}</span>}
              </div>
              <div className="field">
                <label>Property State</label>
                <select value={data.propertyState} onChange={(e) => set('propertyState', e.target.value)}>
                  <option value="">Select state</option>
                  {['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT'].map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
                {errors.propertyState && <span className="err">{errors.propertyState}</span>}
              </div>
              <div className="field">
                <label>Birth Date</label>
                <input
                  type="date"
                  value={data.birthDate}
                  onChange={(e) => set('birthDate', e.target.value)}
                />
                {errors.birthDate && <span className="err">{errors.birthDate}</span>}
              </div>
              <div className="field">
                <label>Address</label>
                <input
                  ref={addressRef}
                  type="text"
                  placeholder="Start typing your address"
                  value={data.address}
                  onChange={(e) => set('address', e.target.value)}
                />
                {errors.address && <span className="err">{errors.address}</span>}
              </div>
            </div>
            <button className="btn btn-block btn-center" disabled={submitting} onClick={submit}>
              {submitting ? 'Submitting…' : 'See My Offers'}
            </button>
          </div>
        )}

        {step >= 1 && step <= 7 && (
          <button className="back" onClick={back}>
            ← Back
          </button>
        )}

        {/* ---------------- THANK YOU ---------------- */}
        {step === 8 && (
          <div className="thanks">
            <h2>Book in your free loan strategy call</h2>
            <p>One of our home loan specialists will walk you through your best options.</p>
            <div
              className="calendly-inline-widget"
              data-url="https://calendly.com/zippyfinancial/45min"
              style={{ minWidth: '320px', height: '1050px' }}
            />
          </div>
        )}

        {/* ---------------- DISCLAIMER ---------------- */}
        <div className="disclaimer">
          <h4>Disclaimer</h4>
          <p>
            Fincheck provides general information only. We are not a lender, credit provider, or
            finance broker, and we do not hold an Australian Credit Licence. We do not provide credit
            assistance or credit advice, and we do not recommend any product or assess whether a
            product is suitable for you. Any information on this site is general in nature and does
            not take into account your personal objectives, financial situation, or needs. When you
            submit an enquiry, Fincheck collects your contact details and passes them to a licensed
            finance broker who can assist you. We may receive a fee or commission for this referral.
            You are under no obligation to proceed with any product or service.
          </p>
          <p>
            Fincheck is not affiliated with, endorsed by, sponsored by, or associated with Meta
            Platforms, Inc. or its products (including Facebook, Instagram, WhatsApp, and Messenger).
            The Meta and Facebook names and logos are trademarks of Meta Platforms, Inc.
          </p>
        </div>
      </div>
    </div>
  )
}
