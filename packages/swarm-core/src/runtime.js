/**
 * The contract runtime every harness carries. It picks the exit for a ruling,
 * turns it into an exact state diff, splits the escrow, and checks that the diff
 * conserves totals. Every harness runs the same function, so every harness can
 * check every other harness's diff.
 * @module swarm-core/runtime
 */
import { BELOW_BAR } from './asc.js'

/**
 * Choose the exit for a ruling.
 * @param {object} asc - the contract.
 * @param {{answer: unknown, agreement: number}} result - the measured ruling.
 * @returns {{exit: object, passed: boolean}} the exit to run and whether the bar was cleared.
 */
export function chooseExit(asc, result) {
  const passed = result.agreement >= asc.payment.bar
  if (!passed) return { exit: asc.exits.find(e => e.outcome === BELOW_BAR), passed }
  if (asc.question.answer.type === 'forecast') {
    return { exit: asc.exits.find(e => e.outcome === '*forecast') ?? asc.exits.find(e => e.outcome !== BELOW_BAR), passed }
  }
  const exit = asc.exits.find(e => e.outcome === result.answer)
  if (!exit) throw new Error(`no exit for outcome "${result.answer}"`)
  return { exit, passed }
}

/**
 * Build the state diff for a ruling: the exit's effect plus the escrow payout.
 * Jurors are paid per counted vote. A ruling below the bar pays nothing yet; its
 * escrow carries over to the escalated jury.
 * @param {object} asc - the contract.
 * @param {object} exit - the chosen exit.
 * @param {boolean} passed - whether the bar was cleared.
 * @param {string[]} counted - harness ids whose votes were counted.
 * @param {string} sealer - the sealing harness id.
 * @returns {{account: string, delta: number}[]} the diff.
 */
export function buildDiff(asc, exit, passed, counted, sealer) {
  const pay = asc.payment
  const diff = []
  const pool = `escrow:${asc.id}`
  if (!passed) {
    diff.push({ account: pool, delta: -pay.escrow }, { account: `escrow:${asc.id}:escalation`, delta: pay.escrow })
    return diff
  }
  const jurorShare = round(pay.escrow * pay.split.jurors)
  const each = counted.length ? round(jurorShare / counted.length) : 0
  for (const id of counted) diff.push({ account: `harness:${id}`, delta: each })
  const paidJurors = round(each * counted.length)
  diff.push({ account: 'pool:auditors', delta: round(pay.escrow * pay.split.auditors) })
  diff.push({ account: 'pool:storage', delta: round(pay.escrow * pay.split.storage) })
  const sealerShare = round(pay.escrow - paidJurors - round(pay.escrow * pay.split.auditors) - round(pay.escrow * pay.split.storage))
  diff.push({ account: `harness:${sealer}`, delta: sealerShare })
  diff.push({ account: pool, delta: -pay.escrow })
  if (exit.effect.type === 'pay' && exit.effect.amount) {
    diff.push({ account: exit.effect.from, delta: -exit.effect.amount }, { account: exit.effect.to, delta: exit.effect.amount })
  }
  return diff
}

/**
 * Check that a diff conserves totals.
 * @param {{delta: number}[]} diff - the diff.
 * @returns {boolean} whether the deltas sum to zero.
 */
export function conserves(diff) {
  return Math.abs(diff.reduce((s, d) => s + d.delta, 0)) < 1e-9
}

/**
 * The effects to run outside the ledger, such as a call on another chain. Calls
 * are only emitted for a ruling that cleared the bar, and must be signed by the
 * quorum before any chain accepts them.
 * @param {object} exit - the chosen exit.
 * @param {boolean} passed - whether the bar was cleared.
 * @returns {object[]} triggers for the outbox.
 */
export function triggers(exit, passed) {
  if (!passed) return exit.effect.type === 'escalate' ? [{ type: 'escalate', jurySize: exit.effect.jurySize }] : []
  return exit.effect.type === 'call' ? [{ type: 'call', chain: exit.effect.chain, target: exit.effect.target, args: exit.effect.args ?? [] }] : []
}

function round(x) {
  return Math.round(x * 1e6) / 1e6
}
