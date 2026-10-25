import { useState } from 'react';
import { plural } from '../../lib/plural';
import { Button } from '../../primitives/Button';
import { Chip } from '../../primitives/Chip';
import type { SourceRow } from './api';
import { askCubbie } from './askCubbie';
import { CALENDAR_KINDS, FIXTURE_LABEL, itemTypeLabel, relTime, squadLabel } from './model';

export interface ItemListProps {
  rows: SourceRow[];
  now: number;
  squadId: string | null;
  squadNames: Record<string, string>;
  /** The whole connection is a fixture: the card header already says so once, items do not repeat it. */
  fixtureConnection: boolean;
  share: ((r: SourceRow, shared: boolean) => Promise<unknown> | undefined) | undefined;
  onChanged: () => void;
  navigate?: (url: string) => void;
}

const when = (r: SourceRow, now: number): string | null => {
  const t = r.dueAt ?? r.startsAt;
  if (!t) return null;
  const d = new Date(t).toISOString().slice(0, 16).replace('T', ' ');
  return `${r.dueAt ? 'due' : 'starts'} ${d} UTC (${relTime(t, now)})`;
};

/** The imported items of one connection: type, course/event, imported-at, sharing state, share toggle, Ask Cubbie. */
export function ItemList(p: ItemListProps) {
  const [all, setAll] = useState(false);
  const rows = p.rows;
  if (rows.length === 0)
    return (
      <p className="sq-conn__meta" data-testid="items-empty">
        Nothing imported yet. Items appear here after the first sync.
      </p>
    );
  const shown = all ? rows : rows.slice(0, 8);
  return (
    <div className="sq-conn__items" data-testid="imported-items">
      <h4 className="sq-conn__h4">{plural(rows.length, 'imported item')}</h4>
      <ul className="sq-conn__itemlist" aria-label="Imported items">
        {shown.map((r) => {
          const sharedHere = !!p.squadId && r.sharedWith.includes(p.squadId);
          const shareNames = r.sharedWith.map((id) => squadLabel(id, p.squadNames));
          return (
            <li key={r.id} className="sq-conn__item" data-testid="imported-item" data-kind={r.kind}>
              <div className="sq-conn__itemmain">
                <strong className="sq-conn__itemtitle">{r.title}</strong>
                <span className="sq-conn__meta">
                  {itemTypeLabel(r.kind)}
                  {r.courseId ? ` · course ${r.courseId}` : ''}
                  {when(r, p.now) ? ` · ${when(r, p.now)}` : ''}
                </span>
                <span className="sq-conn__meta" data-testid="item-imported-at">
                  imported {relTime(r.fetchedAt, p.now)}
                </span>
              </div>
              <div className="sq-conn__itemside">
                {r.provenance === 'fixture' && !p.fixtureConnection ? (
                  <Chip tone="violet">{FIXTURE_LABEL}</Chip>
                ) : null}
                <span data-testid="item-sharing">
                  <Chip tone={shareNames.length ? 'ember' : 'neutral'}>
                    {shareNames.length ? `Shared with ${shareNames.join(', ')}` : 'Private'}
                  </Chip>
                </span>
                {p.squadId && p.share ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    data-testid="item-share-toggle"
                    onClick={() => void p.share!(r, !sharedHere)?.then(p.onChanged)}
                  >
                    {sharedHere ? 'Stop sharing' : 'Share with squad'}
                  </Button>
                ) : null}
                {CALENDAR_KINDS.has(r.kind) && !sharedHere ? (
                  <span className="sq-conn__meta">Squad sees busy time only.</span>
                ) : null}
                {p.squadId ? (
                  <Button
                    size="sm"
                    variant="primary"
                    iconStart="sparkle"
                    data-testid="ask-cubbie"
                    onClick={() => askCubbie(p.squadId!, r, p.navigate)}
                  >
                    Ask Cubbie
                  </Button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      {rows.length > 8 && !all ? (
        <Button size="sm" variant="ghost" onClick={() => setAll(true)}>
          Show all {rows.length}
        </Button>
      ) : null}
    </div>
  );
}
