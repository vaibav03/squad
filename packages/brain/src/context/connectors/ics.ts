export interface IcsEvent {
  uid: string;
  summary: string;
  description: string;
  start: number | null;
  end: number | null;
  url: string | null;
}

const unfold = (t: string) =>
  t
    .replace(/\r\n/g, '\n')
    .replace(/\n[ \t]/g, '')
    .split('\n');
const unescape = (v: string) => v.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');

function toMs(v: string): number | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?Z?)?$/.exec(v.trim());
  if (!m) return null;
  return Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0));
}

/** Reads UID/SUMMARY/DESCRIPTION/DTSTART/DTEND/URL (the fields a Canvas calendar feed carries). */
export function parseIcsEvents(text: string): IcsEvent[] {
  const out: IcsEvent[] = [];
  let cur: Partial<IcsEvent> | null = null;
  for (const line of unfold(text)) {
    if (line === 'BEGIN:VEVENT') cur = {};
    else if (line === 'END:VEVENT' && cur) {
      if (cur.uid)
        out.push({
          uid: cur.uid,
          summary: cur.summary ?? '',
          description: cur.description ?? '',
          start: cur.start ?? null,
          end: cur.end ?? null,
          url: cur.url ?? null,
        });
      cur = null;
    } else if (cur) {
      const i = line.indexOf(':');
      if (i < 0) continue;
      const name = line.slice(0, i).split(';')[0]!.toUpperCase();
      const value = line.slice(i + 1);
      if (name === 'UID') cur.uid = value.trim();
      else if (name === 'SUMMARY') cur.summary = unescape(value);
      else if (name === 'DESCRIPTION') cur.description = unescape(value);
      else if (name === 'DTSTART') cur.start = toMs(value);
      else if (name === 'DTEND') cur.end = toMs(value);
      else if (name === 'URL') cur.url = value.trim();
    }
  }
  return out;
}

/** Canvas puts the course code in trailing brackets: `Title [STAT 101]`. */
export function splitCanvasSummary(summary: string): { title: string; code: string | null } {
  const m = /^(.*?)\s*\[([^\]]+)\]\s*$/.exec(summary);
  return m ? { title: m[1]!.trim(), code: m[2]!.trim() } : { title: summary.trim(), code: null };
}
