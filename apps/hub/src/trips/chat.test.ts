import { describe, expect, it } from 'vitest';
import { addressesTrip, parseCreate, parseLooseTrip } from './chat';

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

describe('@planner trip intents', () => {
  it('@planner plan a trip to <place> uses the normal create parser', () => {
    expect(parseCreate('@planner plan a trip to Cabo in March')).toMatchObject({
      destination: 'Cabo',
      month: 3,
    });
  });
  it('@planner ... trip ... without a planning verb still starts the trip flow', () => {
    expect(parseLooseTrip('@planner trip to Lisbon in June')).toMatchObject({
      destination: 'Lisbon',
      month: 6,
    });
    expect(parseLooseTrip('@planner can we do a trip?')).toBe('no_destination');
  });
  it('it is planner-only and never fires for study plans or other agents', () => {
    expect(parseLooseTrip('@tutor trip to Lisbon')).toBeNull();
    expect(parseLooseTrip('@cubbie trip to Lisbon')).toBeNull();
    expect(parseLooseTrip('@planner study plan for the exam on Nov 12')).toBeNull();
    expect(parseLooseTrip('@planner what should I do first?')).toBeNull();
  });
});
