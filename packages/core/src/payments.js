/**
 * Payment routers. Verafy Chain has no coin. A contract is paid in whatever asset
 * the requester chooses, on the chain where they hold it, and a harness plugs in
 * a payment router that decides which payments it accepts and where its share
 * is sent. Money never moves to Verafy Chain; the router settles on the source chain.
 *
 *   ledger        writes payouts to a local file. The default, for the prototype and devnet.
 *   solana-usdc   planned: releases escrow from a Solana program with a quorum-signed trigger.
 *   evm           planned: the same for Ethereum and EVM chains.
 *
 * @module @verafyharness/core/payments
 */
import { appendFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

/**
 * Whether a harness accepts a contract's payment.
 * @param {{accept?: {chain: string, asset: string}[]}} payments - the harness payment config.
 * @param {{chain?: string, currency: string}} payment - the contract's payment.
 * @returns {boolean} true when the payment's chain and asset are on the accept list, or no list is set.
 */
export function acceptsPayment(payments, payment) {
  if (!payments?.accept?.length) return true
  return payments.accept.some(a => (a.chain === '*' || a.chain === (payment.chain ?? 'any')) && (a.asset === '*' || a.asset === payment.currency))
}

/**
 * A router that records payouts in a local JSON Lines file. Nothing moves on any chain.
 * @param {{file: string}} options - where to write.
 * @returns {{name: string, settle: (ruling: object, asc: object, book: Record<string, string>) => Promise<object[]>}} the router.
 */
export function ledgerRouter({ file }) {
  return {
    name: 'ledger',
    async settle(ruling, asc, book = {}) {
      const chain = asc.payment.chain ?? 'any'
      const lines = ruling.diff.filter(d => d.delta > 0).map(d => ({
        asc: asc.id,
        ascHash: ruling.ascHash,
        chain,
        asset: asc.payment.currency,
        account: d.account,
        to: book[d.account]?.[chain] ?? null,
        amount: d.delta,
        status: 'recorded',
      }))
      await mkdir(dirname(file), { recursive: true })
      await appendFile(file, lines.map(l => JSON.stringify(l)).join('\n') + (lines.length ? '\n' : ''))
      return lines
    },
  }
}

/**
 * Placeholder for a router that settles on a chain. It names what it will do and fails loudly.
 * @param {string} name - the router name.
 * @param {string} plan - what the router will do once built.
 * @returns {{name: string, settle: () => Promise<never>}} the router.
 */
function plannedRouter(name, plan) {
  return {
    name,
    async settle() {
      throw new Error(`payment router "${name}" is planned, not built: ${plan}. Use "ledger" for now.`)
    },
  }
}

/**
 * Build the router a harness config names.
 * @param {{router?: string, file?: string}} payments - the harness payment config.
 * @returns {object} the router.
 */
export function createRouter(payments = {}) {
  const name = payments.router ?? 'ledger'
  if (name === 'ledger') return ledgerRouter({ file: payments.file ?? '.verafy/payouts.jsonl' })
  if (name === 'solana-usdc') return plannedRouter(name, 'release escrow held by a Solana program, in USDC or any SPL token, with a quorum-signed trigger')
  if (name === 'evm') return plannedRouter(name, 'release escrow held by an EVM contract, in ETH or any ERC-20, with a quorum-signed trigger')
  throw new Error(`unknown payment router "${name}"; use ledger, solana-usdc or evm`)
}
