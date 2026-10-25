import { describe, expect, it } from 'vitest';
import { absolutizeLinks, pageNameOf, publicWebBase } from './outbound-links';

const WEB = 'https://squad.example.org';

describe('absolutizeLinks', () => {
  it('turns the not-connected reply into plain text with an absolute URL', () => {
    const t =
      'Nothing is connected yet: connect Canvas or Google in [Connections](/squad/connections).';
    expect(absolutizeLinks(t, `${WEB}/`)).toBe(
      'Nothing is connected yet: connect Canvas or Google in Connections https://squad.example.org/squad/connections.',
    );
  });

  it('no public URL: the page name, no link, no markdown', () => {
    const t = 'connect Canvas or Google in [Connections](/squad/connections).';
    expect(absolutizeLinks(t, undefined)).toBe('connect Canvas or Google in Connections.');
    expect(absolutizeLinks(t, 'not a url')).toBe('connect Canvas or Google in Connections.');
  });

  it('handles council, message and trip links, bare or markdown', () => {
    expect(absolutizeLinks('See /squad?council=cn_abc123def456 now', WEB)).toBe(
      `See ${WEB}/squad?council=cn_abc123def456 now`,
    );
    expect(absolutizeLinks('Open the board: /squad?council=cn_abc123def456.', null)).toBe(
      'Open the board: the Council board.',
    );
    expect(absolutizeLinks('[chat](/squad?m=m_1)', null)).toBe('chat');
    expect(absolutizeLinks('Open the Trip page in Squad: /squad/trips/t_9', WEB)).toBe(
      `Open the Trip page in Squad: ${WEB}/squad/trips/t_9`,
    );
    expect(absolutizeLinks('Open /squad/trips/t_9)', null)).toBe('Open the Trip page)');
  });

  it('absolute markdown links lose the syntax; absolute bare URLs and plain text stay', () => {
    expect(absolutizeLinks('[doc](https://a.example/x)', null)).toBe('doc https://a.example/x');
    expect(absolutizeLinks('go to https://a.example/squad/x and /v1/thing', WEB)).toBe(
      'go to https://a.example/squad/x and /v1/thing',
    );
    expect(absolutizeLinks('no links here', WEB)).toBe('no links here');
  });

  it('helpers', () => {
    expect(publicWebBase('http://localhost:5392/')).toBe('http://localhost:5392');
    expect(publicWebBase('')).toBeNull();
    expect(pageNameOf('/squad/connections')).toBe('the Connections page');
    expect(pageNameOf('/squad')).toBe('Squad');
  });
});
