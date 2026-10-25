# @squad/mesh

Privacy-preserving coordination for per-student agents. This README covers the crypto and protocol half (owned by mesh-crypto); flows, the agent server and the scripted run are documented by mesh-flows below the marker at the bottom. API reference: `docs/mesh-api.md`.

## Trust table (state this verbatim in the pitch)

We call this **privacy-preserving**, built from **PSI + secure aggregation**. It is not zero-knowledge: nothing here is a proof.

| Truly cryptographic (semi-honest model)                                                                                                 | Data minimization (you trust our code)                                                                     |
| --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Common free slots and dates: ECDH PSI on ristretto255 (`@noble/curves`), sets padded to a fixed size and shuffled                       | The privacy gate and its strict zod schemas (no free-text field exists on the wire)                        |
| Budget ("can't afford"), veto, ranked-vote (Borda) and weak-topic counts: additive secret sharing mod 2^127-1, only totals are revealed | Each agent truthfully computing its own bits from its own data                                             |
|                                                                                                                                         | The disclosure ledger (labels only; a withheld value is never stored) and the village events built from it |
|                                                                                                                                         | The deterministic mediator (it sees tokens, share sums and counts, never inputs)                           |
|                                                                                                                                         | Students' DMs, and the minimum group size rule (squads under 3 publish no counts)                          |

### Limits we state

- Semi-honest only. An agent that lies about its own budget or veto is not caught (a range proof needs a committed, attested budget, which we do not have).
- The mediator colluding with an agent can test small slot spaces (dictionary attack on tokens); the PSI intersection size is revealed to the mediator.
- With 2 parties a total reveals the other party's input to each of them; that is why squads under 3 get no counts.
- The gate scan is a safety net, not a proof: it catches an honest-but-buggy flow from sending a private value. The real guarantee is the schema: there is no field a private string can fit into.
- Message ordering / replay protection is per gate instance (in memory).

## What is enforced where

- `protocol/`: one strict zod schema per kind; ids/labels match `^[A-Za-z0-9_.:-]{1,64}$`, hex fields are pinned to hex, venmo links to one URL shape. Unknown keys fail.
- `gate/`: every outbound message is validated, then scanned (case-insensitive, punctuation-evading, word-level for event titles) against the agent's private fields; a failure drops the message and writes a `blocked:true` ledger row. Per-task query/PSI budget (default 8). `result.counts` must be null for squads under 3. Inbound: strict parse, recipient check, task membership, replay and closed-task rejection, per-sender query cap. Every `query` is answered with `query.denied`.
- `ledger/`: rows hold labels ("budget cap"), `record()` refuses a row containing a registered private value, and `toLedgerEvent` emits `withheld: 'hidden'` only.
- `psi/`, `secretshare/`: pure functions with injected RNG (`seededRng` makes scripted runs byte-identical).
- `mediator/`: pure deterministic selection, filtering, Borda tally, top-2 simulate, split and Venmo links (Venmo format unverified against the live app).

## Tests

```
pnpm --filter @squad/mesh test
```

Property-based (fast-check): PSI equals the true intersection across 2-5 parties; padding hides set size; shares reconstruct and single shares look random; the **no-withheld-value invariant** (any message carrying a sentinel is blocked, and ledger rows, events and labels never contain one). `src/redteam/` is the adversarial suite: probing agent, replays, instruction injection, prototype pollution, impersonation, wrong-key PSI party, bad curve points, min group size, a full-run sweep over wire messages, ledger rows, events and console output, and byte-identical determinism.

<!-- mesh-flows: append the flows / agent / scripted-run sections below this line -->
