import { describe, expect, it } from 'vitest';
import { PACKAGE_NAME } from './index';

describe('@squad/web', () => {
  it('loads', () => {
    expect(PACKAGE_NAME).toBe('@squad/web');
  });
});
