/**
 * Proving as a service (Part D4). A harness that rents instead of owning a
 * proving machine buys proofs through the API router, from a `provers` entry,
 * in whatever token the service takes, metered per proof. The service returns
 * `{answer, proof}` for the committed model. The harness verifies every proof
 * before it counts the answer (pass a verifier to `proveVotes`), so it needs
 * no trust in the service; it still holds the bond and casts the vote.
 * @module @verafyharness/prove/service
 */

/**
 * A Prover backed by a proving service in the API router.
 * @param {{router: import('../../core/src/apirouter.js').ApiRouter, token?: string, prover: string}} options -
 *   the router, a scoped key with `call:<prover id>` when the entry needs a secret, and the prover entry id.
 * @returns {object} the prover.
 */
export function serviceProver({ router, token, prover }) {
  const entry = router.apis.get(prover)
  if (entry?.kind !== 'prover') throw new Error(`no prover named "${prover}" in the API router's provers`)
  if (!/^[0-9a-f]{64}$/.test(String(entry.modelCommitment))) throw new Error(`prover "${prover}" declares no model commitment`)
  const call = async (path, body, purpose) => {
    const r = await router.call(token, prover, { path, body, purpose })
    if (r.status >= 400) throw new Error(`${prover}${path}: HTTP ${r.status}${r.body?.error ? `: ${r.body.error}` : ''}`)
    if (!Array.isArray(r.body?.results)) throw new Error(`${prover}${path}: no results`)
    return r.body.results
  }
  return {
    name: `service:${prover}`,
    commitment: () => entry.modelCommitment,
    infer: requests => call('/infer', { requests: requests.map(({ id, input }) => ({ id, input })) }, 'inference for a commit'),
    prove: requests => call('/prove', { commitment: entry.modelCommitment, requests: requests.map(({ id, input }) => ({ id, input })) }, 'proof of inference'),
  }
}
