// Minimal TrueSkill (1v1) rating (SPEC §10.2/§10.3).
// Standard Herbrich/Minka/Graepel update with a fixed-skill "task opponent".
const BETA = 25 / 6 // skill-class width
const TAU = 25 / 300 // dynamics factor
const SQRT2 = Math.SQRT2

export const DEFAULT_MU = 25
export const DEFAULT_SIGMA = 25 / 3 // 8.333…

function pdf(x) { return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI) }
// standard normal CDF via erf
function cdf(x) { return 0.5 * (1 + erf(x / SQRT2)) }
function erf(x) {
  // Abramowitz & Stegun 7.1.26
  const t = 1 / (1 + 0.3275911 * Math.abs(x))
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x)
  return x >= 0 ? y : -y
}
// truncated-Gaussian correction functions (win, non-draw)
function vWin(t) { const d = cdf(t); return d < 1e-12 ? -t : pdf(t) / d }
function wWin(t) { const v = vWin(t); return v * (v + t) }

/**
 * Update a rating after one game vs a fixed-skill task opponent.
 * @param {{mu:number,sigma:number}} r  current rating
 * @param {number} taskMu  task difficulty as an opponent skill
 * @param {boolean} won
 * @param {number} [taskSigma]  opponent uncertainty (small; tasks are calibrated)
 */
export function update(r, taskMu, won, taskSigma = 0.5) {
  const s1 = Math.sqrt(r.sigma * r.sigma + TAU * TAU) // add dynamics first
  const s2 = taskSigma
  const c = Math.sqrt(2 * BETA * BETA + s1 * s1 + s2 * s2)
  // orient so the winner is first
  const [muW, muL, sign] = won ? [r.mu, taskMu, 1] : [taskMu, r.mu, -1]
  const t = (muW - muL) / c
  const v = vWin(t)
  const w = wWin(t)
  const muDelta = (s1 * s1 / c) * v * sign
  const sigmaFactor = Math.sqrt(Math.max(1e-6, 1 - (s1 * s1 / (c * c)) * w))
  return { mu: r.mu + muDelta, sigma: s1 * sigmaFactor }
}

/** Conservative skill estimate R = mu - 3*sigma (SPEC §10.2). */
export function conservative(r) { return r.mu - 3 * r.sigma }

/** Map conservative rating R to an integer acx level and career tier (SPEC §10.2). */
export function levelFor(R) {
  const acxLevel = Math.max(0, Math.round(R))
  return { acxLevel, careerTier: careerTierForLevel(acxLevel) }
}

export function careerTierForLevel(level) {
  if (level >= 35) return 'legend'
  if (level >= 30) return 'distinguished'
  if (level >= 25) return 'principal'
  if (level >= 20) return 'staff'
  if (level >= 15) return 'senior'
  if (level >= 10) return 'mid'
  if (level >= 5) return 'junior'
  return 'intern'
}
