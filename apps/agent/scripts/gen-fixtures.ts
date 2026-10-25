// Regenerates fixtures/*.json and fixtures/ics/*.ics from the test kit's demo profiles (one source of truth).
import { mkdirSync, writeFileSync } from 'node:fs';
import { demoProfiles, TRIP_OPTIONS, WINDOWS } from '@squad/mesh';

mkdirSync('fixtures/ics', { recursive: true });
const peers: Record<string, string> = {};
demoProfiles().forEach((p, i) => {
  writeFileSync(`fixtures/${p.id}.json`, `${JSON.stringify(p, null, 2)}\n`);
  peers[p.id] = `http://localhost:${4101 + i}`;
  const fmt = (iso: string) => iso.replace(/[-:]/g, '').replace('.000', '');
  const body = p.calendar
    .map(
      (e, k) =>
        `BEGIN:VEVENT\r\nUID:${p.id}-${k}@squad.local\r\nDTSTART:${fmt(e.start)}\r\nDTEND:${fmt(e.end)}\r\nSUMMARY:${e.title}\r\nEND:VEVENT`,
    )
    .join('\r\n');
  writeFileSync(
    `fixtures/ics/${p.id}.ics`,
    `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//squad//mock//EN\r\n${body}\r\nEND:VCALENDAR\r\n`,
  );
});
writeFileSync('fixtures/peers.json', `${JSON.stringify(peers, null, 2)}\n`);
writeFileSync(
  'fixtures/trips.json',
  `${JSON.stringify({ squadId: 'squad_1', window: WINDOWS.trip, options: TRIP_OPTIONS }, null, 2)}\n`,
);
writeFileSync(
  'fixtures/study.json',
  `${JSON.stringify({ squadId: 'squad_1', window: WINDOWS.study, topics: ['dynamic-programming', 'graphs'], examAt: '2026-11-05T00' }, null, 2)}\n`,
);
console.log('fixtures written');
