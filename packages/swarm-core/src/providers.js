/**
 * Model providers a harness can mount. Swapping the AI means swapping the
 * provider and the committed model id; nothing else in the harness changes.
 *
 *   mock     scripted answers from examples/mock-answers.json, for demos and tests
 *   openai   any OpenAI-compatible chat endpoint: OpenRouter, a gateway, or a local server
 *
 * Inside DeepSeek Harness the same swap is a `@deepseek-ai/dsh-llm-pi-ai` route;
 * see config/cordis.swarm.yml.
 * @module swarm-core/providers
 */

/**
 * A provider that returns scripted answers keyed by contract id and lab.
 * @param {Record<string, Record<string, object>>} script - answers by contract id, then lab.
 * @param {string} ascId - the contract being ruled on.
 * @param {string} lab - the juror's lab.
 * @returns {{complete: () => Promise<string>}} the provider.
 */
export function mockProvider(script, ascId, lab) {
  return {
    async complete() {
      const a = script[ascId]?.[lab]
      if (!a) throw new Error(`no scripted answer for ${ascId} / ${lab}`)
      return JSON.stringify(a)
    },
  }
}

/**
 * A provider for any OpenAI-compatible chat completions endpoint.
 * @param {{baseURL: string, apiKey: string}} options - endpoint and key.
 * @returns {{complete: (req: {model: string, system: string, user: string}) => Promise<string>}} the provider.
 */
export function openaiProvider({ baseURL, apiKey }) {
  if (!apiKey) throw new Error('openai provider needs an API key; set SWARM_API_KEY')
  return {
    async complete({ model, system, user }) {
      const res = await fetch(`${baseURL.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, temperature: 0, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
      })
      if (!res.ok) throw new Error(`${model}: HTTP ${res.status} ${await res.text()}`)
      const body = await res.json()
      return body.choices?.[0]?.message?.content ?? ''
    },
  }
}
