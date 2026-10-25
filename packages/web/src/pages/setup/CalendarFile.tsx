import { useRef, useState, type ChangeEvent } from 'react';
import { Button } from '../../primitives/Button';
import { Notice } from '../../primitives/Notice';
import { HubError, postCalendar } from './api';
import { parseIcs, redactedIcs } from './ics';

/** The secondary choice of the Availability step: import a calendar (.ics) file instead of connecting Google. */
export function CalendarFile({
  hubUrl,
  token,
  onImported,
}: {
  hubUrl: string;
  token: string | null;
  onImported: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [found, setFound] = useState<number | null>(null);
  const onPick = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (!/\.ics$/i.test(f.name) && f.type !== 'text/calendar') {
      setError(`${f.name} is not a calendar (.ics) file.`);
      return;
    }
    const blocks = parseIcs(await f.text());
    if (blocks.length === 0) {
      setError('We could not find any timed events in that file.');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await postCalendar({ hubUrl, token }, { ics: redactedIcs(blocks), name: f.name });
      setFound(blocks.length);
      onImported();
    } catch (err) {
      setError(
        err instanceof HubError && err.code === 'offline'
          ? 'Cannot reach Squad. Try again in a moment.'
          : 'We could not send that calendar to your agent.',
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="sq-setup__stack">
      <p className="sq-setup__lede">
        Export an .ics file from Google, Apple or Outlook. Only free or busy times are kept, never
        what the event is.
      </p>
      <input
        ref={input}
        className="sq-sr-only"
        type="file"
        accept=".ics,text/calendar"
        onChange={onPick}
        tabIndex={-1}
        aria-hidden="true"
      />
      <div className="sq-setup__inline">
        <Button
          variant="secondary"
          iconStart="upload"
          loading={busy}
          onClick={() => input.current?.click()}
        >
          Import a calendar file
        </Button>
      </div>
      {found !== null ? (
        <Notice tone="ok" title={`We found ${found} busy ${found === 1 ? 'block' : 'blocks'}`}>
          Read from your calendar file.
        </Notice>
      ) : null}
      {error ? (
        <Notice tone="error" title="Calendar problem" onDismiss={() => setError(null)}>
          {error}
        </Notice>
      ) : null}
    </div>
  );
}
