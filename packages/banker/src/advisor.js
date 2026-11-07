/**
 * The Banker advisor (BANK-010): a read-only report over the ledger. It holds
 * no keys and can change nothing; it reads, summarizes and flags. A model can
 * be handed this report to write prose about it, but the flags are computed
 * here, not by a model.
 * @module @verafyharness/banker/advisor
 */

/**
 * @param {import('./service.js').BankerService} svc - the service (read only).
 * @param {{credits?: object[]}} [o] - output of creditPlan, if any.
 * @returns {{counts: Record<string, number>, flags: string[], ledgerOk: boolean, totals: object}} the report.
 */
export function advise(svc, { credits = [] } = {}) {
  const counts = {}
  const flags = []
  for (const d of svc.deposits.values()) counts[d.state] = (counts[d.state] ?? 0) + 1
  if (!svc.ledger.verify()) flags.push('the ledger hash chain does not verify: stop and investigate')
  if (svc.paused) flags.push('the kill switch is on: nothing outbound will run')
  if (counts.FROZEN) flags.push(`${counts.FROZEN} deposit(s) frozen by the sanctions screen: a human must decide`)
  if (counts.NEEDS_HUMAN) flags.push(`${counts.NEEDS_HUMAN} deposit(s) need a human`)
  if (counts.QUARANTINED) flags.push(`${counts.QUARANTINED} deposit(s) of tokens not on the allowlist were left untouched`)
  if (counts.REJECTED) flags.push(`${counts.REJECTED} quote(s) rejected for straying from the reference price: a venue may be manipulated or thin`)
  if (counts.HOLD) flags.push(`${counts.HOLD} deposit(s) waiting on caps, approval or the kill switch`)
  if (counts.UNCONFIRMED) flags.push(`${counts.UNCONFIRMED} deposit(s) unconfirmed: sources disagree or confirmations are pending`)
  for (const c of credits) if (c.status === 'low' || c.status === 'empty') flags.push(`${c.provider} credits ${c.status}: about ${c.daysLeft ?? 0} days left; top up $${c.topUpUsd} (${c.how})`)
  return { counts, flags, ledgerOk: svc.ledger.verify(), totals: svc.totals() }
}
