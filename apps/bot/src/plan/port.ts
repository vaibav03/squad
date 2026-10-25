// What the chat skill needs from the shared study plan. The hub implements it (apps/hub/src/chat/engine.ts) over its
// plan service, so the bot never touches plan storage and tests can use a fake.
import type { ChatCard, ChatCitation, PlanReply, ProvenanceHint } from '@squad/core';

export interface PlanSayOut {
  /** Plain text for the chat. Group-safe: aggregate or public plan facts only. */
  text: string;
  card?: ChatCard;
  /** Verified material the plan was built from (chips), or the label the fallback plan states about itself. */
  citations?: ChatCitation[];
  provenance?: ProvenanceHint;
  /** Extra lines only the asking student may see (sent as a DM). */
  privateText?: string;
  ok: boolean;
}

export interface PlanPort {
  /** Propose a plan for the squad (group chat only). Never throws; failures come back as `ok:false` text. */
  propose(studentId: string, squadId: string, o: { examDate?: string }): Promise<PlanSayOut>;
  reply(studentId: string, squadId: string, r: PlanReply): Promise<PlanSayOut>;
  done(studentId: string, squadId: string, ref: string): Promise<PlanSayOut>;
  /** Cheap state for routing and scoring. */
  state(
    studentId: string,
    squadId: string,
  ): { proposed: boolean; pendingMe: boolean; active: boolean; ownsOpen(ref: string): boolean };
}
