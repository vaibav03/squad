import { useRef, useState } from 'react';
import { CitationChip } from '../../components/source-viewer';
import { Button, Chip, EmptyState, Icon, Notice, TextField } from '../../primitives';
import {
  CATALOGUE_SAMPLE_LABEL,
  CATALOGUE_TEMPLATE_CSV,
  CATALOGUE_TEMPLATE_JSON,
  TOPIC_FILTERS,
  TOPIC_LABEL,
  filterPolicy,
  plural,
  policyLineText,
  topicCounts,
  parseCatalogue,
  type CatalogueParse,
} from './model';
import type { CatalogueState, PolicyPanel as Policy, PolicyTopic } from './types';

/* ----------------------------------------------------------------- policy */

export function PolicyPanel({
  policy,
  courseId,
  canEdit,
  onPaste,
  onUpload,
}: {
  policy: Policy | null;
  courseId?: string;
  canEdit: boolean;
  onPaste: (text: string) => Promise<void>;
  onUpload: (file: File) => void;
}) {
  const [topic, setTopic] = useState<PolicyTopic | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const pick = useRef<HTMLInputElement>(null);
  const lines = policy?.lines ?? [];
  const counts = topicCounts(lines);
  const shown = filterPolicy(lines, topic);
  return (
    <section className="cr-panel" aria-labelledby="cr-pol-h" data-testid="policy-panel">
      <header className="cr-panel__head">
        <div>
          <h2 id="cr-pol-h" className="cr-panel__title">
            Syllabus policy
          </h2>
          <p className="cr-muted">
            The lines below are copied word for word. Squad never rewrites a policy.
          </p>
        </div>
      </header>
      {lines.length > 0 && (
        <>
          <div className="cr-chips" role="group" aria-label="Filter by topic">
            {TOPIC_FILTERS.map((t) => (
              <Chip
                key={t}
                selected={topic === t}
                onSelect={() => setTopic(topic === t ? null : t)}
              >
                {`${TOPIC_LABEL[t]} ${counts[t]}`}
              </Chip>
            ))}
          </div>
          <ul className="cr-policy">
            {shown.map((l) => (
              <li key={l.n} className="cr-quote" data-testid="policy-line" data-topic={l.topic}>
                <span className="cr-quote__n" aria-label={`Line ${l.n}`}>
                  {l.n}
                </span>
                <div>
                  <blockquote data-testid="policy-text">{policyLineText(l)}</blockquote>
                  <p className="cr-quote__label">
                    <Chip>{TOPIC_LABEL[l.topic]}</Chip>
                    <span className="cr-quote__tag">verbatim from syllabus</span>
                    {policy?.sourceFile && (
                      <CitationChip
                        citation={{
                          file: policy.sourceFile,
                          page: 1,
                          quote: policyLineText(l),
                          courseId,
                        }}
                      />
                    )}
                  </p>
                  <p className="cr-muted cr-quote__note">Quoted by hwpolicy exactly as written.</p>
                </div>
              </li>
            ))}
          </ul>
          {shown.length === 0 && <p className="cr-muted">No lines on this topic.</p>}
        </>
      )}
      {lines.length === 0 && (
        <div data-testid="policy-empty">
          <EmptyState
            icon="file"
            title="No syllabus policy yet"
            body="Upload your syllabus or paste its policy text. Homework, AI and collaboration rules show up here exactly as written."
          />
        </div>
      )}
      {canEdit && (
        <div className="cr-form">
          <TextField
            label="Paste syllabus text"
            multiline
            rows={4}
            value={text}
            onChange={setText}
            data-testid="policy-text-input"
          />
          <div className="cr-row">
            <Button
              variant="primary"
              disabled={!text.trim()}
              loading={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await onPaste(text);
                  setText('');
                } finally {
                  setBusy(false);
                }
              }}
              data-testid="policy-save"
            >
              Read policy from text
            </Button>
            <Button variant="secondary" iconStart="upload" onClick={() => pick.current?.click()}>
              Upload syllabus file
            </Button>
            <input
              ref={pick}
              className="cr-vh"
              type="file"
              accept=".pdf,.txt,.md"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) onUpload(f);
              }}
            />
          </div>
        </div>
      )}
    </section>
  );
}

/* -------------------------------------------------------------- catalogue */

function download(name: string, body: string, type: string) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function CataloguePanel({
  catalogue,
  canImport,
  onImport,
}: {
  catalogue: CatalogueState | null;
  canImport: boolean;
  onImport: (parsed: CatalogueParse, body: string, contentType: string) => Promise<void>;
}) {
  const [parsed, setParsed] = useState<{
    p: CatalogueParse;
    body: string;
    type: string;
    name: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const pick = useRef<HTMLInputElement>(null);
  const read = async (f: File) => {
    const body = await f.text();
    const type = /json/i.test(f.name) || /json/i.test(f.type) ? 'application/json' : 'text/csv';
    setParsed({ p: parseCatalogue(body, f.name), body, type, name: f.name });
  };
  const bad = parsed ? parsed.p.issues.length > 0 || !!parsed.p.fatal : false;
  return (
    <section className="cr-panel" aria-labelledby="cr-cat-h" data-testid="catalogue-panel">
      <header className="cr-panel__head">
        <div>
          <h2 id="cr-cat-h" className="cr-panel__title">
            Planner catalogue
          </h2>
          <p className="cr-muted">Course times the planner uses across all your courses.</p>
        </div>
        {catalogue?.sample && (
          <span data-testid="catalogue-sample-badge">
            <Chip tone="ember" icon="info">
              {CATALOGUE_SAMPLE_LABEL}
            </Chip>
          </span>
        )}
      </header>
      {catalogue && catalogue.rows.length > 0 && (
        <div className="cr-table-wrap">
          <table className="cr-table">
            <thead>
              <tr>
                <th scope="col">Code</th>
                <th scope="col">Title</th>
                <th scope="col">Days</th>
                <th scope="col">Time</th>
              </tr>
            </thead>
            <tbody>
              {catalogue.rows.map((r) => (
                <tr key={r.code}>
                  <th scope="row">{r.code}</th>
                  <td>{r.title}</td>
                  <td>{r.days}</td>
                  <td>
                    {r.start} to {r.end}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {canImport && (
        <>
          <div
            className="cr-drop cr-drop--sm"
            data-drag={drag || undefined}
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              const f = e.dataTransfer.files[0];
              if (f) void read(f);
            }}
            data-testid="catalogue-drop"
          >
            <span className="cr-drop__icon" aria-hidden="true">
              <Icon name="upload" size={20} />
            </span>
            <p className="cr-drop__title">Drop a CSV or JSON catalogue</p>
            <div className="cr-row">
              <Button
                variant="secondary"
                onClick={() => pick.current?.click()}
                data-testid="catalogue-choose"
              >
                Choose file
              </Button>
              <Button
                variant="ghost"
                onClick={() =>
                  download('catalogue-template.csv', CATALOGUE_TEMPLATE_CSV, 'text/csv')
                }
              >
                Download CSV template
              </Button>
              <Button
                variant="ghost"
                onClick={() =>
                  download('catalogue-template.json', CATALOGUE_TEMPLATE_JSON, 'application/json')
                }
              >
                JSON template
              </Button>
            </div>
            <input
              ref={pick}
              className="cr-vh"
              type="file"
              accept=".csv,.json"
              tabIndex={-1}
              aria-hidden="true"
              data-testid="catalogue-input"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) void read(f);
              }}
            />
          </div>
          {parsed && (
            <div className="cr-stack" data-testid="catalogue-result">
              {parsed.p.fatal && (
                <Notice tone="error" title={`${parsed.name} could not be read`}>
                  {parsed.p.fatal}
                </Notice>
              )}
              {parsed.p.issues.length > 0 && (
                <Notice
                  tone="error"
                  title={`${plural(parsed.p.issues.length, 'problem')} to fix in ${parsed.name}`}
                >
                  <ul className="cr-issues">
                    {parsed.p.issues.map((i, k) => (
                      <li key={k} data-testid="catalogue-issue">
                        <strong>Row {i.row}:</strong> {i.message}
                      </li>
                    ))}
                  </ul>
                </Notice>
              )}
              {!bad && (
                <Notice tone="ok" title={`${plural(parsed.p.rows.length, 'course')} look good`}>
                  Importing replaces the sample catalogue.
                </Notice>
              )}
              <div className="cr-row">
                <Button
                  variant="primary"
                  disabled={bad}
                  loading={busy}
                  data-testid="catalogue-import"
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await onImport(parsed.p, parsed.body, parsed.type);
                      setParsed(null);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Import catalogue
                </Button>
                <Button variant="ghost" onClick={() => setParsed(null)}>
                  Clear
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
