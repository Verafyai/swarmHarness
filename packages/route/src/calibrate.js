/**
 * Calibration: turn labeled screen results into cutoffs.
 *
 * A screen's answer may stand only above a cutoff where its measured accuracy
 * matches the jury it replaces. We use the Wilson lower bound of accuracy, not
 * the average, so a small or lucky sample can't set a loose cutoff. A type
 * with too few labeled examples gets no cutoff: the screen settles nothing
 * there.
 * @module @verafyharness/route/calibrate
 */

/**
 * Wilson score lower bound for a proportion.
 * @param {number} correct - successes.
 * @param {number} n - trials.
 * @param {number} [z=1.96] - z for the confidence level (1.96 is 95%).
 * @returns {number} the lower bound, 0 when n is 0.
 */
export function wilsonLower(correct, n, z = 1.96) {
  if (!n) return 0
  const p = correct / n
  const d = 1 + (z * z) / n
  const c = p + (z * z) / (2 * n)
  const r = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))
  return (c - r) / d
}

/**
 * Find the lowest confidence cutoff per question type where the screen is at
 * least as accurate as the target, with confidence.
 * @param {Array<{type: string, p: number, correct: boolean}>} records - labeled screen results.
 * @param {object} [opts]
 * @param {number} [opts.target=0.97] - accuracy the screen must match (the jury's measured accuracy).
 * @param {number} [opts.minSamples=50] - fewest labeled examples above a cutoff.
 * @param {number} [opts.z=1.96] - confidence for the Wilson bound.
 * @returns {Record<string, {cutoff: number|null, n: number, accuracy: number|null, lower: number|null, coverage: number}>}
 *   per type: the cutoff (null means never settle), how many examples sit above it,
 *   their accuracy and its lower bound, and coverage (the share of that type the screen would settle).
 */
export function calibrate(records, { target = 0.97, minSamples = 50, z = 1.96 } = {}) {
  const byType = {}
  for (const r of records) (byType[r.type] ??= []).push(r)
  const out = {}
  for (const [type, rs] of Object.entries(byType)) {
    const sorted = [...rs].sort((a, b) => b.p - a.p)
    let best = { cutoff: null, n: 0, accuracy: null, lower: null, coverage: 0 }
    let correct = 0
    for (let i = 0; i < sorted.length; i++) {
      if (sorted[i].correct) correct++
      const n = i + 1
      // Only cut between distinct confidences.
      if (i + 1 < sorted.length && sorted[i + 1].p === sorted[i].p) continue
      if (n < minSamples) continue
      const lower = wilsonLower(correct, n, z)
      if (lower >= target) best = { cutoff: sorted[i].p, n, accuracy: correct / n, lower, coverage: n / sorted.length }
    }
    out[type] = best
  }
  return out
}

/**
 * Check live audits against the cutoffs. When live accuracy above a cutoff
 * falls below target, the cutoff is withdrawn for that type until recalibrated.
 * @param {Record<string, {cutoff: number|null}>} cutoffs - from calibrate.
 * @param {Array<{type: string, p: number, correct: boolean}>} audits - live screen answers checked by a full jury.
 * @param {object} [opts] - { target, minSamples, z }.
 * @returns {{cutoffs: object, withdrawn: string[]}} updated cutoffs and the types withdrawn.
 */
export function recheck(cutoffs, audits, { target = 0.97, minSamples = 30, z = 1.96 } = {}) {
  const next = structuredClone(cutoffs)
  const withdrawn = []
  for (const [type, c] of Object.entries(cutoffs)) {
    if (c.cutoff == null) continue
    const above = audits.filter(a => a.type === type && a.p >= c.cutoff)
    if (above.length < minSamples) continue
    const lower = wilsonLower(above.filter(a => a.correct).length, above.length, z)
    if (lower < target) { next[type] = { ...c, cutoff: null, withdrawnAt: above.length }; withdrawn.push(type) }
  }
  return { cutoffs: next, withdrawn }
}
