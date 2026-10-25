import { describe, expect, it } from 'vitest';
import { addressesTrip } from './chat';

describe('addressesTrip (shared mention parser)', () => {
  it.each([
    '@cubbie plan a trip to Cabo',
    '@cubbi plan a trip to Cabo',
    '@Squad vote 2',
    'ok @planner what now?',
    '@council can we go?',
  ])('addressed: %s', (t) => expect(addressesTrip(t)).toBe(true));

  it.each([
    'plan a trip to Cabo',
    'mail me@cubbie.com about the trip',
    'she said "@cubbie plan it" yesterday',
    '@cubbies plan a trip',
    'see https://x.test/@cubbie',
    '@tutor explain z-scores',
  ])('not addressed: %s', (t) => expect(addressesTrip(t)).toBe(false));
});
