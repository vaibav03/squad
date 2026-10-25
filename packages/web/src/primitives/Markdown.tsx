import type { ReactNode } from 'react';
import { Icon } from './Icon';
import './markdown.css';

const SAFE = /^(https?:|mailto:)/i;

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re =
    /(\[cite:\s*([^\]]+)\])|(\*\*([^*]+)\*\*)|(\*([^*]+)\*)|(`([^`]+)`)|(\[([^\]]+)\]\(([^)\s]+)\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${key}-${i++}`;
    if (m[1])
      out.push(
        <span key={k} className="sq-md__cite">
          <Icon name="file" size={12} />
          {m[2]!.trim()}
        </span>,
      );
    else if (m[3]) out.push(<strong key={k}>{m[4]}</strong>);
    else if (m[5]) out.push(<em key={k}>{m[6]}</em>);
    else if (m[7]) out.push(<code key={k}>{m[8]}</code>);
    else if (m[9]) {
      const href = m[11]!;
      out.push(
        SAFE.test(href) ? (
          <a key={k} href={href} target="_blank" rel="noopener noreferrer">
            {m[10]}
          </a>
        ) : (
          <span key={k}>{m[10]}</span>
        ),
      );
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Tiny safe renderer. Never injects HTML: everything is React text nodes. */
export function Markdown({ children, className }: { children: string; className?: string }) {
  const blocks = children.replace(/\r\n/g, '\n').split(/\n{2,}/);
  return (
    <div className={['sq-md', className].filter(Boolean).join(' ')}>
      {blocks.map((b, bi) => {
        const lines = b.split('\n');
        if (lines.every((l) => /^\s*[-*]\s+/.test(l))) {
          return (
            <ul key={bi}>
              {lines.map((l, li) => (
                <li key={li}>{inline(l.replace(/^\s*[-*]\s+/, ''), `${bi}-${li}`)}</li>
              ))}
            </ul>
          );
        }
        if (lines.every((l) => /^\s*\d+\.\s+/.test(l))) {
          return (
            <ol key={bi}>
              {lines.map((l, li) => (
                <li key={li}>{inline(l.replace(/^\s*\d+\.\s+/, ''), `${bi}-${li}`)}</li>
              ))}
            </ol>
          );
        }
        return (
          <p key={bi}>
            {lines.map((l, li) => (
              <span key={li}>
                {li > 0 ? <br /> : null}
                {inline(l, `${bi}-${li}`)}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}
