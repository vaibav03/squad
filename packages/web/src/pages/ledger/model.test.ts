import { describe, expect, it } from 'vitest';
import { LedgerResponseSchema } from './model';

describe('ledger snapshot parsing', () => {
  it('accepts the hub wrapper and never keeps the owner raw withheld value', () => {
    const body = {
      taskId: 't',
      entries: [
        { student: 's_ana', field: 'budget', withheld: '$180', ts: 1 },
        { student: 's_ben', field: 'dates', shared: 'Fri-Sun' },
      ],
    };
    const out = LedgerResponseSchema.parse(body);
    expect(out[0]).toEqual({ student: 's_ana', field: 'budget', withheld: 'hidden', ts: 1 });
    expect(JSON.stringify(out)).not.toContain('$180');
    expect(LedgerResponseSchema.parse(body.entries)).toEqual(out);
  });
});
