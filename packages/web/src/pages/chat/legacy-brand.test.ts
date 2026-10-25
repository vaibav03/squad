import { describe, expect, it } from 'vitest';
import {
  displayAssistantName,
  displayAssistantText,
  displayLegacyMentions,
} from './legacy-brand';
import { senderSpeech } from './model';

describe('legacy assistant branding (render-time only)', () => {
  it('shows legacy assistant authors as Nook', () => {
    expect(displayAssistantName('Cubbie', 'cubbie')).toBe('Nook');
    expect(displayAssistantName('Cubbie')).toBe('Nook');
    expect(displayAssistantName('Squad', 'cubbie')).toBe('Nook');
    expect(displayAssistantName('Nook', 'cubbie')).toBe('Nook');
    expect(displayAssistantName('Tutor', 'tutor')).toBe('Tutor');
  });
  it('speaks "Nook, bot" for a legacy Cubbie author', () => {
    const s = { kind: 'persona', id: 'cubbie', name: 'Cubbie' } as never;
    expect(senderSpeech(s, 'u1')).toBe('Nook, bot');
  });
  it('shows legacy mentions as @nook in any casing, without touching plain words', () => {
    expect(displayLegacyMentions('@cubbie what is a z-score?')).toBe('@nook what is a z-score?');
    expect(displayLegacyMentions('hi @Cubbi and @SQUAD, ask (@cubbie)')).toBe(
      'hi @nook and @nook, ask (@nook)',
    );
    expect(displayLegacyMentions('Open the plan in Squad. A cubbie is a nook.')).toBe(
      'Open the plan in Squad. A cubbie is a nook.',
    );
    expect(displayLegacyMentions('mail me@cubbie.com')).toBe('mail me@cubbie.com');
  });
  it('assistant text also renames its own old name but keeps the product name', () => {
    expect(displayAssistantText('Hi, I am Cubbie. Ask @cubbie about the Squad app.')).toBe(
      'Hi, I am Nook. Ask @nook about the Squad app.',
    );
  });
});
