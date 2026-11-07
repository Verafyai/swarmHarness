# Fast screens and calibration

*A fast model may settle a question only where its accuracy is proven, per kind of question, and the proof is rechecked live.*

A screen is a fast, cheap model such as Jev (vendor-reported: 70 to 500 ms, about $0.0004 a decision, 67.8% on its benchmark against 73 to 74% for frontier models).

Shadow mode is the default. The screen sizes juries and logs what it would have settled, but settles nothing.

A screen earns the right to settle a kind of question only by calibration. It answers a labeled set; for each kind, the router finds the lowest confidence where the screen's accuracy, measured as a Wilson lower bound and not an average, reaches the target (97% by default). With too few examples there is no cutoff. Under about 130 examples per kind, no screen can show a 97% lower bound even if it never errs.

Live audits keep checking. If accuracy above a cutoff falls, `recheck` withdraws the cutoff.

The repo ships a labeled set of 1,000 atoms, 200 per kind, and a runner.

**Status.** Built (ROUTE-004, ROUTE-007 partial). A Jev run needs Jev access. See the [specification](/spec).

**Related:** [Multi-model routing](/learn/multi-model-routing)
