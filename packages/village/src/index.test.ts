import { describe, expect, it } from 'vitest';
import { PACKAGE_NAME } from './index';

describe('@squad/village', () => {
  it('loads', () => {
    expect(PACKAGE_NAME).toBe('@squad/village');
  });
});
