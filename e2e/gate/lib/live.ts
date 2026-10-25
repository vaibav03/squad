// The Live agent switch: scripted FakeLive by default, real Gemini only when LIVE=1 AND the hub's own probe says
// the key has credit. Budget guard: at most MAX_LIVE_AGENTS agents and ~BUDGET_USD per run.
import fs from 'node:fs';
import path from 'node:path';
import { BUDGET_USD, HUB, LIVE, MAX_LIVE_AGENTS, TMP } from './config';

export interface LiveMode {
  /** What actually answers. 'fake' means the scripted demo model, and the UI must say "Demo". */
  llm: 'gemini' | 'fake';
  demo: boolean;
  /** Why the run is on the fake, when it is. */
  reason?: string;
  /** The status notice the UI is expected to show when demo. */
  notice?: string;
}

export async function liveMode(): Promise<LiveMode> {
  let s: { llm?: string; demo?: boolean; reason?: string; notice?: string } = {};
  try {
    s = (await (await fetch(`${HUB}/v1/status`)).json()) as typeof s;
  } catch {
    /* hub down: treat as fake */
  }
  const real = s.llm === 'gemini' && !s.demo;
  if (LIVE && real) return { llm: 'gemini', demo: false };
  return {
    llm: 'fake',
    demo: true,
    reason: LIVE ? (s.reason ?? 'unknown') : 'LIVE not set',
    ...(s.notice ? { notice: s.notice } : {}),
  };
}

/** Rough per-call cost of a tiny Gemini request (prompt + short answer). Conservative on purpose. */
const COST_PER_CALL_USD = 0.01;
const LEDGER = path.join(TMP, 'live-budget.json');

export class LiveBudget {
  private calls = 0;
  private agents = new Set<string>();
  /** Returns false (and records nothing) when the next call would break the budget or the 3-agent cap. */
  allow(agent: string): boolean {
    const nextAgents = new Set([...this.agents, agent]);
    if (nextAgents.size > MAX_LIVE_AGENTS) return false;
    if ((this.calls + 1) * COST_PER_CALL_USD > BUDGET_USD) return false;
    this.agents = nextAgents;
    this.calls++;
    try {
      fs.writeFileSync(
        LEDGER,
        JSON.stringify({ calls: this.calls, agents: [...this.agents], estUsd: this.calls * COST_PER_CALL_USD }),
      );
    } catch {
      /* best effort */
    }
    return true;
  }
  get estUsd() {
    return this.calls * COST_PER_CALL_USD;
  }
}
