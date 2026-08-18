# Costs and limits

## Why it can save money

Use premium Codex capacity for work where it is most valuable: decomposition, product judgment, UI, integration, security review, live proof, and final acceptance. Send large non-UI packets to GLM-5.3 workers.

One operator's real workload previously exhausted practical weekly allowance across three $200/month Codex accounts. After adopting native GLM-5.3 workers, one $200/month Codex account plus GLM capacity has been comfortable. This is anecdotal and not a promise.

## What changes the economics

- Z.AI plan tier and GLM-5.3 multiplier;
- peak-hour throttling/multipliers;
- number and size of concurrent workers;
- retries after 429/502/stream failures;
- 1M-context prompts and compaction frequency;
- Codex plan/model usage by the root;
- whether workers redo poor assignments.

## Cost controls

- default protocol retries to zero;
- use two staggered large workers during high demand instead of four simultaneous workers;
- write assignment envelopes with exact ownership and acceptance;
- checkpoint long reports incrementally;
- do not retry ambiguous completed inference blindly;
- let root reject bad work before integration.

Never call a plan unlimited. Check current Z.AI documentation and account usage.
