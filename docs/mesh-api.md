# @squad/mesh crypto + protocol API (ws/mesh-crypto)

Consumers (mesh-flows, apps/agent) import everything from `@squad/mesh` (re-exported by `packages/mesh/src/index.ts`).
All names below are final unless this doc is updated on `origin/ws/mesh-crypto`. Verified against `@noble/curves@2.4.0`
(import path `@noble/curves/ed25519.js`: `ristretto255.Point`, `ristretto255_hasher.hashToCurve(msg,{DST})`,
`Point.Fn.ORDER`, `point.multiply(k)` with `1 <= k < ORDER` (0 throws), `toHex()/fromHex()`, `equals()`).

Everything random takes an `Rng` so scripted runs are byte-identical.

## crypto/
```ts
type Rng = (n: number) => Uint8Array;
secureRng(): Rng                                  // node:crypto
seededRng(seed: string): Rng                      // deterministic SHA-256 counter DRBG
randomInt(rng, maxExclusive: number): number      // unbiased
shuffle<T>(rng, xs: readonly T[]): T[]            // Fisher-Yates, returns copy
canonicalJson(v: unknown): string                 // sorted keys, used for replay hashes
```

## psi/ (ring DH-PSI on ristretto255)
Protocol: each party hashes its items to points, blinds with its secret scalar, pads to a FIXED size with random
points, shuffles once. The list then travels the ring ORDER-PRESERVING; every other party multiplies by its own key.
When it returns, the owner holds the fully blinded list aligned with its private index. Each owner sends its token
SET (sorted) to the mediator (`psi.tokens`); mediator intersects and broadcasts `psi.common`; owner maps back.
```ts
const PSI_DST: string
const PSI_PAD_STUDY = 168   // 7 days x 24 hourly slots
const PSI_PAD_TRIP = 64     // days
type HexPoint = string      // 64 lowercase hex chars, canonical ristretto255 encoding
psiKeygen(rng: Rng): bigint                                    // scalar in [1, ORDER-1]
psiPrepare(secret: bigint, items: readonly string[], o: { padTo: number; rng: Rng }):
  { blinded: HexPoint[]; index: (string | null)[] }            // index[i] = item label, null = padding (stays local)
psiApply(secret: bigint, points: readonly HexPoint[]): HexPoint[]   // order-preserving; throws on invalid point
psiTokens(finalPoints: readonly HexPoint[]): HexPoint[]        // sorted, deduped set to publish
psiIntersect(tokenSets: readonly (readonly HexPoint[])[]): HexPoint[]  // mediator
psiResolve(index: (string | null)[], finalPoints: readonly HexPoint[], common: readonly HexPoint[]): string[]  // owner: my common items
runRingPsi(parties: { id: string; items: string[] }[], o: { padTo: number; seed: string }):
  { common: Record<string, string[]>; mediatorView: { tokenCounts: Record<string, number>; common: HexPoint[] }; wire: { from: string; to: string; points: HexPoint[] }[] }
// padTo < items.length throws. Items must be unique non-empty strings; slot labels e.g. '2026-11-03T14' / '2026-11-27'.
```

## secretshare/ (additive, mod p = 2^127 - 1)
```ts
const SHARE_MODULUS: bigint
splitSecret(value: number | bigint, n: number, rng: Rng): bigint[]            // n shares summing to value mod p
splitVector(values: readonly number[], n: number, rng: Rng): bigint[][]       // result[j] = share vector for party j
sumShareVectors(vs: readonly (readonly bigint[])[]): bigint[]                 // what party j publishes (share.sum)
combineSums(sums: readonly (readonly bigint[])[]): number[]                   // totals; throws if a total >= 2^53 (not a count)
encodeShares(v: readonly bigint[]): string[]                                  // 32-char hex, for the wire
decodeShares(h: readonly string[]): bigint[]                                  // validates length + < p
secureSum(inputs: Record<string, number[]>, rng: Rng): { totals: number[]; wire: { from: string; to: string; share: string[] }[] }
// Party j in members order receives share j of every member (including its own, kept local), sums, sends `share.sum` to mediator.
```

## protocol/
Wire type is core's `AgentMessage` (`from: StudentId`, `to: StudentId|'mediator'`, `taskId`, `kind`, `payload`).
Every payload schema is `z.strictObject`; there is NO free-text field (strings are enums, ids, ISO slots, hex, or short labels matching
`/^[A-Za-z0-9_.:-]{1,64}$/`).
```ts
const MESSAGE_KINDS = ['task.open','psi.blind','psi.tokens','psi.common','share.vec','share.sum','confirm.result','result','query','query.denied','conflict','option_dropped'] as const
type MessageKind = typeof MESSAGE_KINDS[number]
const PAYLOAD_SCHEMAS: Record<MessageKind, z.ZodType>
type Payload<K extends MessageKind>
SharePurpose = 'cost'|'cantAfford'|'veto'|'borda'|'weakTopic'|'simulate'
QueryAbout   = 'budget'|'calendar'|'hardNo'|'weakTopic'

task.open       { flow:'study'|'trip', window:{from:string,to:string}, members:string[], squadId?:string, options?:TripOption[], topics?:string[], examAt?:string }
                TripOption = { id, label, dates?:{from,to}, perPerson?: number }  // PUBLIC data
psi.blind       { round:0..3 (0 collect, 1 apply, 2 deliver final, 3 spare), points:HexPoint[], origin:string, hop:number }     // origin = whose set; hop = keys applied so far
psi.tokens      { tokens:HexPoint[] }                                              // to mediator
psi.common      { common:HexPoint[] }                                              // mediator -> members
share.vec       { purpose:SharePurpose, round:number, share:string[] }             // hex shares, to = the share's holder
share.sum       { purpose:SharePurpose, round:number, sum:string[] }               // to mediator
confirm.result  { accept:boolean, optionId:string }
result          { stage:'candidates'|'proposal'|'final'|'none', chosen:string|null, candidates?:string[] /*top-2 option ids*/, slot?:string, dates?:string[] /*yyyy-mm-dd*/,
                  perPerson?:number /*equal split only, whole dollars*/, venmo?:string[] /*^https://venmo.com/<payee>?txn=charge&amount=D.CC&note=<pct-encoded>$ only*/,
                  counts:Record<string,number>|null, rounds?:number }   // counts MUST be null if squad < 3 (gate rejects with 'min_group')
query           { about:QueryAbout, target:string }
query.denied    { about:QueryAbout, reason:'private' }
conflict        { reason:'no_common_slot'|'no_option'|'no_plan', hybrid?:{ slot:string } }
option_dropped  { optionId:string, reason:'budget'|'veto' }

parseMessage(raw: unknown): { ok: true; msg: AgentMessage; kind: MessageKind } | { ok: false; error: string }   // envelope + payload, strict
labelsFor(kind: MessageKind, payload: unknown): string[]   // VillageEvent `shared` labels: counts only, e.g. '48 blinded tokens (padded)'
fieldFor(kind, payload): string                            // ledger field name
// A2A tasks
type TaskState = 'submitted'|'working'|'input-required'|'completed'|'failed'|'canceled'
canTransition(from: TaskState, to: TaskState): boolean
class TaskTracker { open(taskId, members): void; state(taskId): TaskState|undefined; transition(taskId, to): void /*throws on illegal*/; isOpen(taskId): boolean }
agentCard(o: { id: string; name: string; url: string }): AgentCard   // /.well-known/agent.json shape
```

## gate/ (privacy gate, runs on EVERY outbound send; inbound validation too)
```ts
interface PrivateFields { budget?: number; events?: { title: string }[]; hardNos?: { reason: string }[]; weakTopics?: string[]; secrets?: (string|number)[] }
createGate(o: { self: string /* student id or 'mediator' */; fields: PrivateFields; ledger: Ledger; queryBudget?: number /*default 8*/; now?: () => number }): Gate
interface Gate {
  send(msg: AgentMessage): GateResult        // validate strict schema, scan against private fields, per-task query budget
  receive(raw: unknown): ReceiveResult       // strict parse + to===self + task membership + replay (identical canonical message twice) + inbound query cap
  readonly self: string; readonly tasks: TaskTracker   // task.open (sent or received) opens the task; members drive the min-group rule
  closeTask(taskId, state?: 'completed'|'failed'|'canceled'): void
  allowPublic(taskId: string, tokens: (string|number)[]): void   // public values (option prices) exempt from the scan
}
type GateResult = { ok: true; msg: AgentMessage; kind: MessageKind; labels: string[]; ledger: LedgerRow[] }
                | { ok: false; reason: 'schema'|'leak'|'budget'|'unknown_kind'|'min_group'; ledger: LedgerRow[] }   // blocked:true row written
type ReceiveResult = { ok: true; msg: AgentMessage; kind: MessageKind } | { ok: false; reason: 'schema'|'replay'|'closed_task'|'not_member'|'unknown_kind'|'budget'|'misrouted' }
// Scan: text needles are case-insensitive substrings in any non-hex string; numeric needles match number fields (>=3 digits) and word-bounded digits in strings. Hex fields are exempt (schema pins them to hex).
answerQuery(gate: Gate, ledger: Ledger, msg: AgentMessage): AgentMessage | null   // query.denied reply (null if not a query for gate.self) + blocked ledger row written
```

## ledger/
Stores LABELS only; never a withheld value. `record()` refuses (throws) a label containing a registered private value.
```ts
interface LedgerRow { taskId: string; student: string; field: string; shared: string; withheld: string /* label, e.g. 'budget cap' */; blocked?: true; ts: number }
interface Ledger { record(r: Omit<LedgerRow,'ts'>): LedgerRow; list(taskId?: string): LedgerRow[]; guard(values: (string|number)[]): void }
createMemoryLedger(now?: () => number): Ledger
createSqliteLedger(db: Db, now?): Ledger              // table mesh_ledger, created on demand
toLedgerEvent(row: LedgerRow)  /* withheld:'hidden' unless the row's withheld label is 'nothing private' */: Extract<VillageEvent,{t:'ledger.entry'}>        // withheld:'hidden', blocked passes through
toAgentMessageEvent(msg: AgentMessage, labels: string[]): Extract<VillageEvent,{t:'agent.message'}>  // ids via agentId.student(); 'mediator' kept; to:'commons' for psi.blind broadcast
toQueryDeniedEvent(taskId: string, to: string, about = 'budget'): Extract<VillageEvent,{t:'agent.message'}>             // from 'mediator', kind 'query_denied'
toOptionDroppedEvent(taskId, reason) / toConflictEvent(taskId, reason)   // from 'mediator'
```

## mediator/ (pure, deterministic; every function takes `memberCount`; counts are `null` when `memberCount < 3`)
```ts
chooseStudySlot(i: { commonSlots: string[]; costTotals?: Record<string, number>; examAt?: string; minLeadHours?: number /*1*/; memberCount: number; conflictCounts?: Record<string, number> }):
  { kind: 'slot'; slot: string; costTotal: number | null } | { kind: 'conflict'; reason: 'no_common_slot'; hybrid: { slot: string } | null }
topicCoverage(i: { canTeach: Record<string, string[]>; weakTotals: Record<string, number>; memberCount: number }):
  { topic: string; weak: number | null; lead: string | null }[]     // [] when memberCount < 3
filterOptions(i: { optionIds: string[]; cantAfford: number[]; veto: number[]; memberCount: number }):
  { survivors: string[]; dropped: { optionId: string; reason: 'budget' | 'veto' }[] }  // budget wins precedence; never counts
bordaVector(ranking: readonly string[], optionIds: readonly string[]): number[]   // first gets n-1 points ... last 0; unranked 0
tallyBorda(i: { optionIds: string[]; totals: number[]; memberCount: number }): { ranking: string[]; top2: string[]; totals: number[] | null }   // ties -> original option order
simulate(i: { top2: string[]; noTotals: number[] }): string | null            // first with zero "no"
splitEvenly(totalCents: number, payers: string[]): Record<string, number>     // deterministic remainder to earliest
venmoLink(o: { payee: string; amountCents: number; note: string }): string    // https://venmo.com/<payee>?txn=charge&amount=..&note=.. (format UNVERIFIED, one-line fix)
```
`packages/mesh/src/index.ts` re-exports all of the above plus `PACKAGE_NAME`.
