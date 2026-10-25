import type { BusyBlock } from './ics';
import { mondayOf } from './fixtures';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const H0 = 8,
  H1 = 20;

export function WeekGrid({ blocks }: { blocks: BusyBlock[] }) {
  const monday = mondayOf(blocks[0] ? new Date(blocks[0].start) : new Date());
  const cells = DAYS.map((_, d) =>
    blocks.flatMap((b) => {
      const s = new Date(b.start),
        e = new Date(b.end);
      const day = Math.round(
        (new Date(s.getFullYear(), s.getMonth(), s.getDate()).getTime() - monday.getTime()) /
          86_400_000,
      );
      if (day !== d) return [];
      const a = Math.max(H0, s.getHours() + s.getMinutes() / 60),
        z = Math.min(H1, e.getHours() + e.getMinutes() / 60);
      return z > a ? [{ top: (a - H0) / (H1 - H0), h: (z - a) / (H1 - H0), key: b.start }] : [];
    }),
  );
  const busyCount = cells.reduce((n, c) => n + c.length, 0);
  return (
    <figure className="sq-week" aria-label={`Week preview with ${busyCount} busy blocks`}>
      <div className="sq-week__grid" role="img" aria-label="Busy blocks by day, 8 am to 8 pm">
        <div className="sq-week__hours" aria-hidden="true">
          <span>8a</span>
          <span>12p</span>
          <span>4p</span>
          <span>8p</span>
        </div>
        {DAYS.map((d, i) => (
          <div key={d} className="sq-week__col">
            <span className="sq-week__day">{d}</span>
            <div className="sq-week__track">
              {cells[i]!.map((c) => (
                <i key={c.key} style={{ top: `${c.top * 100}%`, height: `${c.h * 100}%` }} />
              ))}
            </div>
          </div>
        ))}
      </div>
      <figcaption className="sq-week__cap">
        Only free or busy is shared. Event titles never leave your device.
      </figcaption>
    </figure>
  );
}
