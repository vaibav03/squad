import { describe, expect, it } from 'vitest';
import { parseSession } from './session';

describe('session parsing', () => {
  it('accepts a valid session', () => {
    expect(parseSession('{"userId":"ana","name":"Ana","token":"t"}')).toEqual({
      userId: 'ana',
      name: 'Ana',
      token: 't',
      avatarUrl: undefined,
    });
  });
  it.each([null, '', 'nope', '[]', '{"userId":1}', '{"userId":"","name":"","token":""}'])(
    'rejects %s',
    (raw) => {
      expect(parseSession(raw)).toBeNull();
    },
  );
});
