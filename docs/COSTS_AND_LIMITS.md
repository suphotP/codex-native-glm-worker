# Costs and limits

## Why it can save money

Use premium Codex capacity for work where it is most valuable: decomposition, product judgment, UI, integration, security review, live proof, and final acceptance. Send large non-UI packets to GLM-5.3 workers.

In one operator's earlier workload, routing bounded implementation to native GLM workers reduced pressure on premium Codex capacity. This is an anecdote, not a savings estimate. Compare current plan prices, quotas, quality, and retry behavior for your own workload before spending money.

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
- classify usage-window 1308, terminal Fair Usage 1313, and ordinary high demand before attempting another paid call;
- use two staggered large workers during high demand instead of four simultaneous workers;
- write assignment envelopes with exact ownership and acceptance;
- checkpoint long reports incrementally;
- do not retry ambiguous completed inference blindly;
- let root reject bad work before integration.

Never call a plan unlimited. Check current Z.AI documentation and account usage.
