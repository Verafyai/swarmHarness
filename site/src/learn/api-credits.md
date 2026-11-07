# API credits

*How a harness keeps its model accounts funded, and why most top-ups are still manual.*

A harness spends on model APIs. The Banker reads each provider's balance, projects how many days it will last at recent spend, and says how much to top up and when.

Most providers sell credits only through a web checkout with a card. OpenRouter's API for buying credits with crypto now returns "410 Gone" (checked Nov 6, 2026). So top-ups are manual for now, and the Banker sets aside the target token for them.

Pay-per-request standards such as x402 would let a harness pay as it goes in USDC with no prepaid balance. The Banker has a slot for that, for any provider that supports it.

**Status.** Built: balance reading and planning (BANK-013). Automatic top-ups wait on provider support. See the [specification](/spec).

**Related:** [The Banker](/learn/banker), [The routing agent](/learn/routing-agent)
