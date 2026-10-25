# Brief: mesh (spec 04), branch ws/mesh

**Mission:** per-student agents that coordinate without revealing schedules, budgets or vetoes; the trust story must survive a crypto-savvy judge.

**Build:** apps/agent (one process per student) and packages/mesh: A2A-shaped protocol with task states (including input-required for the DM confirm), zod privacy gate on every outbound message plus a check against the agent's private fields, disclosure ledger, ECDH PSI for free slots and dates (fixed-size padding), additive secret sharing for affordability, vetoes, ranked votes and topic counts, the deterministic mediator, study-session flow, trip flow (dates, budgets, anonymous veto, secret ranked vote, top-2 check, DM confirm, split and Venmo links) emitting trip.confirmed exactly once after all confirms, the query / query.denied flow, option_dropped, Bouncer (stretch ticket after core), a `--scripted` deterministic run that exports replay JSON for the village, all emission through the core helper.

**Quality bar:** property-based tests for PSI and secret-sharing correctness and for the invariant that no event, log or ledger line ever contains a withheld value; a red-team test suite (an agent that probes, replays, or injects instructions); byte-identical scripted replays; a trust table in the README stating exactly what is cryptographic and what is data minimization, using 'privacy-preserving' not 'zero-knowledge'.

**Sub-agent ideas:** protocol+gate, crypto, mediator, study flow, trip flow, query/Bouncer, red-team and replay export.
