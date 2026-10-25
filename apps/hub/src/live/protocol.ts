// The text the engine relays to each agent, and the parser FakeLive uses on it (one format, both sides).
import { LIVE_PERSONAS, type LivePersonaId } from '@squad/core';
import type { LivePage } from './types';

export const personaName = (id: LivePersonaId): string =>
  LIVE_PERSONAS.find((p) => p.id === id)?.name ?? id;

export type UserKind = 'say' | 'lost' | 'simpler' | 'disagree' | 'summarize';

export interface RelayInput {
  topic: string;
  pages: LivePage[];
  /** Recent room lines, oldest first, as `Name: text`. */
  room: string[];
  user?: { kind: UserKind; text: string; to?: LivePersonaId };
  you: LivePersonaId;
  turn: number;
  next: LivePersonaId;
  close?: boolean;
}

const SRC_CHARS = 500;
const MAX_SRC = 3;

export function buildRelay(r: RelayInput): string {
  const src = r.pages
    .slice(0, MAX_SRC)
    .map((p) => `[${p.file} p.${p.page}] ${p.text.replace(/\s+/g, ' ').slice(0, SRC_CHARS)}`)
    .join('\n');
  const lines = [`TOPIC: ${r.topic}`];
  lines.push(src ? `SOURCES:\n${src}` : 'SOURCES: none (say plainly when you are unsure)');
  if (r.room.length) lines.push(`ROOM:\n${r.room.join('\n')}`);
  if (r.user)
    lines.push(
      `USER (${r.user.kind})${r.user.to ? ` [to ${personaName(r.user.to)}]` : ''}: ${r.user.text}`,
    );
  lines.push(
    r.close
      ? `TURN ${r.turn} | YOU: ${personaName(r.you)} | CLOSE: give the closing summary now.`
      : `TURN ${r.turn} | YOU: ${personaName(r.you)} | NEXT: ${personaName(r.next)} | Speak 1 to 3 short sentences, then hand over by name.`,
  );
  return lines.join('\n');
}

export interface ParsedRelay {
  topic: string;
  sources: { file: string; page: number; text: string }[];
  user?: { kind: UserKind; text: string; to?: string };
  turn: number;
  next?: string;
  close: boolean;
}

export function parseRelay(text: string): ParsedRelay {
  const topic = /^TOPIC: (.*)$/m.exec(text)?.[1]?.trim() ?? 'the topic';
  const sources = [...text.matchAll(/^\[([^[\]\n]+?) p\.(\d+)\] (.*)$/gm)].map((m) => ({
    file: m[1]!.trim(),
    page: Number(m[2]),
    text: m[3]!,
  }));
  const u = /^USER \((\w+)\)(?: \[to ([^\]]+)\])?: (.*)$/m.exec(text);
  const turn = Number(/TURN (\d+)/.exec(text)?.[1] ?? 1);
  const next = /NEXT: (\w+)/.exec(text)?.[1];
  return {
    topic,
    sources,
    ...(u ? { user: { kind: u[1] as UserKind, text: u[3]!, ...(u[2] ? { to: u[2] } : {}) } } : {}),
    turn,
    ...(next ? { next } : {}),
    close: /\| CLOSE:/.test(text),
  };
}

export function systemInstruction(persona: LivePersonaId, others: LivePersonaId[]): string {
  const p = LIVE_PERSONAS.find((x) => x.id === persona)!;
  return [
    `You are ${p.name}, one member of a small AI study group discussing a student's topic out loud. ${p.stance}`,
    `The other members are: ${others.map(personaName).join(', ')}. The student listens and may interrupt.`,
    'One speaker at a time: you only speak when you get a message that says YOUR TURN.',
    'Speak 1 to 3 short sentences. Address the next member by name when handing over.',
    'Only cite what is in SOURCES, using the exact marker form [file p.N]. If SOURCES is none or does not cover it, say it is general reasoning.',
    'Never mention grades, scores or private details about any student. You are an AI study group: say when you are unsure.',
    'When the message says CLOSE, give a brief closing summary: what you agreed, where you disagreed, and next steps.',
    persona === 'chair'
      ? 'As Chair you open the discussion, steer it every few turns, and call decisions.'
      : '',
  ]
    .filter(Boolean)
    .join(' ');
}
