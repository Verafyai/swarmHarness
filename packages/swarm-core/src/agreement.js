/**
 * Close enough: how much a jury agrees, for each answer type. Every function
 * returns a winning answer and an agreement score in [0, 1] that is compared
 * with the contract's bar.
 * @module swarm-core/agreement
 */

/**
 * Verdicts: the confidence-weighted share of the jury that chose the top option.
 * @param {{answer: string, confidence: number}[]} votes - revealed votes.
 * @returns {{answer: string, agreement: number, tally: Record<string, number>}} the result.
 */
export function verdictAgreement(votes) {
  const tally = {}
  let total = 0
  for (const v of votes) {
    const w = clamp(v.confidence)
    tally[v.answer] = (tally[v.answer] ?? 0) + w
    total += w
  }
  const [answer, weight] = Object.entries(tally).sort((a, b) => b[1] - a[1])[0] ?? [null, 0]
  return { answer, agreement: total > 0 ? weight / total : 0, tally }
}

/**
 * Forecasts: the median probability, with agreement falling as forecasts spread.
 * agreement = 1 - min(1, meanAbsDeviation / tolerance).
 * @param {{answer: number}[]} votes - revealed votes whose answer is a probability.
 * @param {number} tolerance - the spread at which agreement reaches zero.
 * @returns {{answer: number, agreement: number, spread: number}} the result.
 */
export function forecastAgreement(votes, tolerance = 0.2) {
  const xs = votes.map(v => clamp(Number(v.answer))).sort((a, b) => a - b)
  if (xs.length === 0) return { answer: null, agreement: 0, spread: 0 }
  const mid = Math.floor(xs.length / 2)
  const median = xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2
  const mad = xs.reduce((s, x) => s + Math.abs(x - median), 0) / xs.length
  return { answer: round(median), agreement: 1 - Math.min(1, mad / tolerance), spread: round(xs[xs.length - 1] - xs[0]) }
}

/**
 * Graded answers on an ordered scale: a vote on the winning grade counts fully,
 * a vote one step away counts half, anything further counts nothing.
 * @param {{answer: string, confidence: number}[]} votes - revealed votes.
 * @param {string[]} scale - grades in order, such as true, mostly true, misleading, false.
 * @returns {{answer: string, agreement: number}} the result.
 */
export function gradedAgreement(votes, scale) {
  let best = { answer: null, agreement: 0 }
  for (const grade of scale) {
    const gi = scale.indexOf(grade)
    let got = 0
    let total = 0
    for (const v of votes) {
      const w = clamp(v.confidence)
      const d = Math.abs(scale.indexOf(v.answer) - gi)
      got += w * (d === 0 ? 1 : d === 1 ? 0.5 : 0)
      total += w
    }
    const a = total > 0 ? got / total : 0
    if (a > best.agreement) best = { answer: grade, agreement: a }
  }
  return best
}

/**
 * Measure agreement for any answer type.
 * @param {object} question - the contract's question.
 * @param {object[]} votes - revealed votes.
 * @returns {{answer: unknown, agreement: number}} the result.
 */
export function measure(question, votes) {
  const t = question.answer.type
  if (t === 'verdict') return verdictAgreement(votes)
  if (t === 'forecast') return forecastAgreement(votes, question.answer.tolerance)
  if (t === 'graded') return gradedAgreement(votes, question.answer.options)
  throw new Error(`unknown answer type "${t}"`)
}

function clamp(x) {
  return Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0
}

function round(x) {
  return Math.round(x * 1000) / 1000
}
