// Fail-closed PII/secret scrub gate (SPEC §7.5). Runs on export BEFORE signing.
// On any secret match it blocks export; secrets are never silently redacted.

export const DENY_RULES = [
  { id: 'pem-private-key', re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/i },
  { id: 'aws-access-key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { id: 'github-token', re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { id: 'slack-token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/ },
  { id: 'google-api-key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { id: 'jwt', re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
  { id: 'uri-credentials', re: /:\/\/[^/\s:@]+:[^/\s@]+@/ },
  // assignment shape: any identifier containing a secret word, drop trailing \b so
  // access_token=, client_secret=, passwd=, pwd=, api-key= all match (H2).
  { id: 'secret-assignment', re: /\b[\w-]*(?:secret|token|password|passwd|pwd|api[_-]?key|access[_-]?key|client[_-]?secret|private[_-]?key)[\w-]*\s*[=:]\s*['"]?[^\s'"]{6,}/i },
]

const HOME_PATH = /(?:\/(?:Users|home)\/[A-Za-z0-9._-]+|(?:^|[\s"'`(])~[\\/][^\s"'`,;()[\]{}]*|\b[A-Za-z]:\\Users\\[A-Za-z0-9._-]+)/i

/** Shannon entropy in bits/char. */
function entropy(s) {
  const freq = {}
  for (const ch of s) freq[ch] = (freq[ch] ?? 0) + 1
  let h = 0
  for (const k in freq) {
    const p = freq[k] / s.length
    h -= p * Math.log2(p)
  }
  return h
}

function highEntropyHit(str) {
  for (const tok of str.split(/[\s"'`,;()[\]{}]+/)) {
    if (tok.length < 16) continue
    // pure-hex secret >= 32 chars (SHA/HMAC keys, hex tokens) — hex tops out at
    // 4.0 bits/char so an absolute-entropy rule can never catch it (H2).
    if (tok.length >= 32 && /^[0-9a-f]+$/i.test(tok)) return tok.slice(0, 12) + '…'
    // base64 / base64url secret. Require a digit (or length >= 40) plus high
    // absolute entropy, so hyphenated/camelCase identifiers (LicenseRef-...,
    // preferredProtocolRevision) are not false positives while random secrets are.
    if (/^[A-Za-z0-9+/_=-]+$/.test(tok) && tok.length >= 24 && (/[0-9]/.test(tok) || tok.length >= 40)) {
      const alphabet = new Set(tok).size
      const norm = entropy(tok) / Math.log2(Math.max(2, alphabet))
      if (entropy(tok) >= 4.0 && norm >= 0.85) return tok.slice(0, 12) + '…'
    }
  }
  return null
}

/**
 * Scan an object graph / string set. Returns { blocked, findings[] }.
 * findings: { field, ruleId, sample }.
 * @param {Array<{field:string, text:string}>} items
 * @param {object} [opts] - { forbidLiterals: string[] } literal repo identifiers that must not survive.
 */
export function scrub(items, opts = {}) {
  const findings = []
  const forbid = (opts.forbidLiterals ?? []).filter((s) => s && String(s).length >= 3)
  for (const { field, text } of items) {
    if (text == null) continue
    const s = String(text)
    for (const rule of DENY_RULES) {
      const m = s.match(rule.re)
      if (m) findings.push({ field, ruleId: rule.id, sample: m[0].slice(0, 16) + '…' })
    }
    const he = highEntropyHit(s)
    if (he) findings.push({ field, ruleId: 'high-entropy', sample: he })
    const homePath = s.match(HOME_PATH)
    if (homePath) findings.push({ field, ruleId: 'home-path', sample: homePath[0].trim() })
    for (const lit of forbid) {
      if (s.includes(lit)) findings.push({ field, ruleId: 'repo-identifier-leak', sample: lit })
    }
  }
  // home-path is a warning that MAY be auto-namespaced; treat only secret + leak rules as blocking.
  const blockingRules = new Set([...DENY_RULES.map((r) => r.id), 'high-entropy', 'repo-identifier-leak'])
  const blocked = findings.some((f) => blockingRules.has(f.ruleId))
  return { blocked, findings }
}

/** Collect scannable strings — EVERY string field of every record (SPEC §7.5). */
export function collectScanItems({ records = [], files = [] }) {
  const items = []
  const walk = (prefix, val) => {
    if (typeof val === 'string') items.push({ field: prefix, text: val })
    else if (Array.isArray(val)) val.forEach((v, i) => walk(`${prefix}[${i}]`, v))
    else if (val && typeof val === 'object') for (const k of Object.keys(val)) walk(`${prefix}.${k}`, val[k])
  }
  for (const r of records) walk(`memory:${r.id ?? '?'}`, r)
  for (const { name, text } of files) items.push({ field: `sqlar:${name}`, text })
  return items
}
