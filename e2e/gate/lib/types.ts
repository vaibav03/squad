export type StepId = 'S1' | 'S2' | 'S3' | 'S4' | 'S5' | 'S6' | 'S7' | 'S8' | 'S9' | 'S10';
export type VariantId = `V${number}`;
export type Mode = 'fixture' | 'real';

export type Status =
  | 'PASS'
  | 'FAIL'
  | 'BLOCKED' // external precondition missing; carries reason + runbook
  | 'NOT_BUILT' // owner branch is not on main yet; carries owner
  | 'SKIPPED'; // by flag (for example GATE_REAL unset)

export interface AssertionResult {
  name: string;
  pass: boolean;
  detail?: string;
}

export interface StepResult {
  id: string; // S1..S10 or V1..V12
  title: string;
  mode: Mode;
  status: Status;
  /** BLOCKED / SKIPPED: short code. NOT_BUILT: unused. FAIL: first failing assertion. */
  reason?: string;
  runbook?: string; // anchor in docs/qa/RELEASE-GATE.md
  owner?: string[]; // NOT_BUILT: owner branches that are not landed
  assertions: AssertionResult[];
  /** NOT_BUILT only: assertions that could already be exercised against what is on main (never counted as PASS). */
  preview?: AssertionResult[];
  evidence: string[]; // repo-relative paths (screenshots, logs)
  notes: string[];
  label: string; // "fixture", "fixture/degraded", "demo" ... what a PASS means
  ms: number;
  at: string;
}

export interface Blocker {
  code: string;
  reason: string;
  runbook: string;
}

/** A probe says which branch owns a capability and how to recognise that it is on this tree. */
export interface Probe {
  owner: string; // branch name, e.g. feature/context-store
  /** Built when the branch is merged into HEAD, or when every listed file exists (and contains the text). */
  files?: { path: string; contains?: string }[];
  why: string;
}
