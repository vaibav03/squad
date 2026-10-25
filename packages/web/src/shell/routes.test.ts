import { describe, expect, it } from 'vitest';
import { squadNav, squadRouteMeta } from './routes';

describe('route registry', () => {
  it('has unique keys and paths under /squad', () => {
    expect(new Set(squadRouteMeta.map((r) => r.key)).size).toBe(squadRouteMeta.length);
    expect(new Set(squadRouteMeta.map((r) => r.path)).size).toBe(squadRouteMeta.length);
    for (const r of squadRouteMeta) expect(r.path.startsWith('/squad')).toBe(true);
  });
  it('nav is ordered, params-free, with four primary entries', () => {
    const orders = squadNav.map((n) => n.order);
    expect([...orders].sort((a, b) => a - b)).toEqual(orders);
    for (const n of squadNav) expect(n.to).not.toContain(':');
    expect(squadNav.filter((n) => n.primary)).toHaveLength(4);
  });
});
