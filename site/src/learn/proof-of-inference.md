# Proofs of inference

*A cryptographic proof that a specific model produced a specific answer to a specific prompt.*

A proof of inference (zkML) shows that the committed model weights, given this exact prompt, produced this exact output. A verifier checks it without rerunning the model.

In Verafy, at L2, each juror commits and reveals as usual, then attaches a proof before a deadline. Only the proof's hash goes on chain; the proof itself stays off chain. A missing or failed proof drops the vote, agreement is measured again, and a fault is recorded against the bond.

Two provers are integrated behind one interface:
- **FlashProve:** Llama 4 Maverick only, at most 1,024 tokens per request, about 9.3 s of H100 time per proof (vendor-reported).
- **DeepProve:** GPT-2 and Gemma 3 on CPUs (vendor-reported).

**Status.** The flow is built and tested with a mock prover (PROVE-001 to 003). No real proof has been made yet (PROVE-006 needs a GPU and two licenses). See the [specification](/spec).

**Related:** [Proof packing](/learn/proof-packing), [Assurance levels](/learn/assurance-levels)
