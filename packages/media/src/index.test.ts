import { describe, expect, it } from 'vitest';
import { PACKAGE_NAME } from './index';

describe('@squad/media', () => {
  it('loads', () => {
    expect(PACKAGE_NAME).toBe('@squad/media');
  });
});
