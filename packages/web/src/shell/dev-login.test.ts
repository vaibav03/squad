import { describe, expect, it } from 'vitest';
import { hubStudentId } from './dev-login';

describe('hubStudentId', () => {
  it('prefixes a bare picker name, and keeps seeded s_ and real-account u_ ids as they are', () => {
    expect(hubStudentId('ana')).toBe('s_ana');
    expect(hubStudentId('s_ana')).toBe('s_ana');
    expect(hubStudentId('u_a193aba6d4e4')).toBe('u_a193aba6d4e4');
  });
});
