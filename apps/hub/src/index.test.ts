import { describe, expect, it } from 'vitest';
import { PACKAGE_NAME } from './index';

describe('@squad/hub', () => {
  it('loads', () => {
    expect(PACKAGE_NAME).toBe('@squad/hub');
  });
});
