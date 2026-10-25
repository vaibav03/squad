import { useEffect, useState, type ReactNode } from 'react';
import { Avatar } from '../primitives/Avatar';
import { Badge } from '../primitives/Badge';
import { Button } from '../primitives/Button';
import { Card } from '../primitives/Card';
import { Chip } from '../primitives/Chip';
import { EmptyState, ErrorState, OfflineState } from '../primitives/EmptyState';
import { Icon } from '../primitives/Icon';
import { ICON_NAMES } from '../primitives/icon-names';
import { IconButton } from '../primitives/IconButton';
import { Markdown } from '../primitives/Markdown';
import { Notice } from '../primitives/Notice';
import { ProgressBar } from '../primitives/ProgressBar';
import { RadioCards } from '../primitives/RadioCards';
import { Sheet } from '../primitives/Sheet';
import { Skeleton } from '../primitives/Skeleton';
import { Spinner } from '../primitives/Spinner';
import { StatusDot } from '../primitives/StatusDot';
import { StatusChip } from '../primitives/StatusChip';
import { Stepper } from '../primitives/Stepper';
import { Switch } from '../primitives/Switch';
import { TabPanel, Tabs } from '../primitives/Tabs';
import { TextField } from '../primitives/TextField';
import { useToast } from '../primitives/Toast';
import { useCalmMode } from '../hooks/useCalmMode';
import { useTheme, type ThemeChoice } from '../shell/useTheme';
import type { GalleryStory } from '../shell/types';
import { PALETTE, SEMANTIC } from './tokens-list';
import './gallery.css';

const extra = import.meta.glob<{ stories: GalleryStory[] }>('../{overlays,pages/*}/gallery.tsx', {
  eager: true,
});

function Section({
  id,
  title,
  note,
  children,
}: {
  id: string;
  title: string;
  note?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="sq-g__section" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`} className="sq-g__h2">
        {title}
      </h2>
      {note ? <p className="sq-g__note">{note}</p> : null}
      {children}
    </section>
  );
}
const Row = ({ label, children }: { label?: string; children: ReactNode }) => (
  <div className="sq-g__row">
    {label ? <span className="sq-g__label">{label}</span> : null}
    <div className="sq-g__cells">{children}</div>
  </div>
);

function Swatch({ name, css }: { name: string; css: string }) {
  const [hex, setHex] = useState('');
  useEffect(() => {
    const probe = document.createElement('span');
    probe.style.color = `var(${css})`;
    document.body.appendChild(probe);
    const rgb = getComputedStyle(probe).color;
    probe.remove();
    const m = rgb.match(/\d+(\.\d+)?/g);
    if (m && m.length >= 3)
      setHex(
        '#' +
          m
            .slice(0, 3)
            .map((n) => Math.round(Number(n)).toString(16).padStart(2, '0'))
            .join(''),
      );
  }, [css]);
  return (
    <div className="sq-g__swatch">
      <span className="sq-g__chip" style={{ background: `var(${css})` }} />
      <span>
        <b>{name}</b>
        <i>{hex}</i>
      </span>
    </div>
  );
}

const SECTIONS = [
  'buttons',
  'chips',
  'status',
  'forms',
  'tabs',
  'cards',
  'feedback',
  'overlays',
  'avatars',
  'stepper',
  'markdown',
  'icons',
  'color',
  'type',
  'motion',
  'stories',
];

export default function Gallery() {
  const [theme, setTheme] = useTheme();
  const [calm, setCalm] = useCalmMode();
  const [phone, setPhone] = useState(false);
  const [tab, setTab] = useState('one');
  const [pill, setPill] = useState('a');
  const [radio, setRadio] = useState('calm');
  const [text, setText] = useState('');
  const [sw, setSw] = useState(true);
  const [sheet, setSheet] = useState<null | 'bottom' | 'right' | 'center'>(null);
  const [level, setLevel] = useState(0.5);
  const [bump, setBump] = useState(0);
  const { toast } = useToast();
  const themes: ThemeChoice[] = ['system', 'light', 'dark'];
  const stories = Object.values(extra).flatMap((m) => m.stories ?? []);

  return (
    <div className="sq-g">
      <header className="sq-g__bar">
        <strong className="sq-g__brand">Squad gallery</strong>
        <nav className="sq-g__nav" aria-label="Sections">
          {SECTIONS.map((s) => (
            <a key={s} href={`#${s}`}>
              {s}
            </a>
          ))}
        </nav>
        <div className="sq-g__tools">
          <div className="sq-g__seg" role="radiogroup" aria-label="Theme">
            {themes.map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={theme === t}
                onClick={() => setTheme(t)}
              >
                {t}
              </button>
            ))}
          </div>
          <Switch checked={calm} onCheckedChange={setCalm} label="Calm" />
          <Switch checked={phone} onCheckedChange={setPhone} label="Phone frame" />
        </div>
      </header>

      <main className={`sq-g__main${phone ? ' is-phone' : ''}`}>
        <Section
          id="buttons"
          title="Buttons and icon buttons"
          note="Default, hover (forced), pressed via click, disabled, loading. Focus ring: tab to any control."
        >
          {(['primary', 'secondary', 'ghost', 'danger'] as const).map((v) => (
            <Row key={v} label={v}>
              <Button variant={v}>Label</Button>
              <Button variant={v} data-force-state="hover">
                Hover
              </Button>
              <Button variant={v} iconStart="plus">
                With icon
              </Button>
              <Button variant={v} iconEnd="arrow-right">
                Next
              </Button>
              <Button variant={v} loading>
                Saving
              </Button>
              <Button variant={v} disabled>
                Disabled
              </Button>
              <Button variant={v} size="sm">
                Small
              </Button>
              <Button variant={v} size="lg">
                Large
              </Button>
            </Row>
          ))}
          <Row label="icon buttons">
            <IconButton label="Play" icon="play" />
            <IconButton label="Play, hover" icon="play" data-force-state="hover" />
            <IconButton label="Mute" icon="mute" variant="secondary" pressed />
            <IconButton label="Add" icon="plus" variant="primary" />
            <IconButton label="Delete" icon="trash" variant="danger" />
            <IconButton label="Disabled" icon="x" disabled />
          </Row>
        </Section>

        <Section id="chips" title="Chips and badges">
          <Row label="chips">
            <Chip>Neutral</Chip>
            <Chip tone="ok" icon="check">
              Ready
            </Chip>
            <Chip tone="alert" icon="alert">
              Failed
            </Chip>
            <Chip tone="ember">Waiting</Chip>
            <Chip tone="violet" icon="sparkle">
              Thinking
            </Chip>
            <Chip selected onSelect={() => {}}>
              Selected
            </Chip>
            <Chip onSelect={() => {}}>Choose</Chip>
            <Chip onRemove={() => {}}>Removable</Chip>
          </Row>
          <Row label="badges">
            <Badge count={3} />
            <Badge count={12} tone="ember" />
            <Badge count={140} tone="alert" />
            <StatusChip status="ok" label="Online" />
            <StatusChip status="working" label="Thinking" />
          </Row>
        </Section>

        <Section
          id="status"
          title="Status dots"
          note="Never color alone: each has a glyph and a label."
        >
          <Row>
            <StatusDot status="live" pulse />
            <StatusDot status="idle" />
            <StatusDot status="busy" label="Waiting" />
            <StatusDot status="offline" />
            <StatusDot status="error" />
          </Row>
        </Section>

        <Section id="forms" title="Inputs, switch, radio cards">
          <div className="sq-g__grid">
            <TextField
              label="Default"
              value={text}
              onChange={setText}
              placeholder="Type here"
              hint="Helpful hint text."
            />
            <TextField label="Filled" value="Ana Rivera" onChange={() => {}} />
            <TextField
              label="Error"
              value="12ab"
              onChange={() => {}}
              error="Enter a 10-digit phone number."
            />
            <TextField label="Disabled" value="Locked" onChange={() => {}} disabled />
            <TextField
              label="With affixes"
              value=""
              onChange={() => {}}
              prefix="+1"
              suffix="US"
              placeholder="555 010 0101"
            />
            <TextField
              label="Multiline"
              value=""
              onChange={() => {}}
              multiline
              placeholder="Say something"
            />
          </div>
          <Row label="switch">
            <Switch checked={sw} onCheckedChange={setSw} label="Calm mode" />
            <Switch checked={false} onCheckedChange={() => {}} label="Off" />
            <Switch checked disabled onCheckedChange={() => {}} label="Disabled" />
          </Row>
          <RadioCards
            legend="Voice"
            value={radio}
            onValueChange={setRadio}
            options={[
              {
                value: 'calm',
                label: 'Calm professor',
                description: 'Slow, warm, patient',
                trailing: (
                  <IconButton
                    label="Preview Calm professor"
                    icon="play"
                    variant="secondary"
                    size="sm"
                  />
                ),
              },
              {
                value: 'hype',
                label: 'Hype coach',
                description: 'Quick and upbeat',
                trailing: (
                  <IconButton
                    label="Preview Hype coach"
                    icon="play"
                    variant="secondary"
                    size="sm"
                  />
                ),
              },
              {
                value: 'off',
                label: 'Unavailable voice',
                description: 'Disabled state',
                disabled: true,
              },
            ]}
          />
        </Section>

        <Section id="tabs" title="Tabs">
          <Tabs
            value={tab}
            onValueChange={setTab}
            label="Underline tabs"
            items={[
              { value: 'one', label: 'Overview', icon: 'home' },
              { value: 'two', label: 'Details', badge: <Badge count={2} /> },
              { value: 'three', label: 'Disabled', disabled: true },
            ]}
            panelId="g1"
          />
          <TabPanel value="one" active={tab === 'one'} panelId="g1">
            <p className="sq-g__note">Overview panel</p>
          </TabPanel>
          <TabPanel value="two" active={tab === 'two'} panelId="g1">
            <p className="sq-g__note">Details panel</p>
          </TabPanel>
          <Tabs
            variant="pill"
            value={pill}
            onValueChange={setPill}
            label="Pill tabs"
            panelId="g2"
            items={[
              { value: 'a', label: 'Study buddy' },
              { value: 'b', label: 'Chapter expert' },
              { value: 'c', label: 'Examiner' },
              { value: 'd', label: 'Dean' },
            ]}
          />
        </Section>

        <Section id="cards" title="Cards">
          <div className="sq-g__grid">
            {(['default', 'raised', 'inset'] as const).map((t) => (
              <Card key={t} tone={t}>
                <Card.Header>
                  <strong>{t}</strong>
                  <Badge count={1} />
                </Card.Header>
                <Card.Body>Flat on pages. Floating things get a shadow.</Card.Body>
                <Card.Footer>
                  <Button size="sm">Action</Button>
                </Card.Footer>
              </Card>
            ))}
            <Card interactive>
              <Card.Body>
                <strong>Interactive</strong>
                <br />
                Hover and press me.
              </Card.Body>
            </Card>
            <div className="sq-scene sq-g__night">
              <Card tone="glass">
                <Card.Body>
                  <strong>Glass (over canvas)</strong>
                  <br />
                  Always night.
                </Card.Body>
              </Card>
            </div>
          </div>
        </Section>

        <Section id="feedback" title="Notices, states, progress">
          <div className="sq-g__stack">
            <Notice tone="info" title="Heads up">
              Your calendar syncs once a day.
            </Notice>
            <Notice tone="ok" title="Saved">
              Persona updated.
            </Notice>
            <Notice
              tone="warn"
              title="Almost out of quota"
              action={<Button size="sm">Details</Button>}
            >
              Voice previews are cached.
            </Notice>
            <Notice tone="error" title="Upload failed" onDismiss={() => {}}>
              chapter-5.pdf is larger than 50 MB.
            </Notice>
          </div>
          <Row label="progress">
            <div className="sq-g__w">
              <ProgressBar value={0.6} label="Reading chapter 5" />
            </div>
            <div className="sq-g__w">
              <ProgressBar label="Working" />
            </div>
            <div className="sq-g__w">
              <ProgressBar value={1} tone="ok" label="Done" />
            </div>
          </Row>
          <Row label="loading">
            <Spinner />
            <Skeleton shape="circle" />
            <div className="sq-g__w">
              <Skeleton />
              <br />
              <Skeleton width="60%" />
            </div>
            <Skeleton shape="block" width={160} />
          </Row>
          <div className="sq-g__grid">
            <Card>
              <EmptyState
                icon="book"
                title="Nothing here yet"
                body="Agents will post here when they start talking."
                action={
                  <Button size="sm" variant="primary">
                    Open village
                  </Button>
                }
              />
            </Card>
            <Card>
              <ErrorState onRetry={() => {}} />
            </Card>
            <Card>
              <OfflineState onRetry={() => {}} />
            </Card>
          </div>
        </Section>

        <Section id="overlays" title="Sheets and toasts">
          <Row>
            <Button onClick={() => setSheet('bottom')}>Bottom sheet</Button>
            <Button onClick={() => setSheet('right')}>Side sheet</Button>
            <Button onClick={() => setSheet('center')}>Modal</Button>
            <Button onClick={() => toast({ title: 'Persona saved', tone: 'ok' })}>Toast ok</Button>
            <Button
              onClick={() =>
                toast({
                  title: 'Could not save',
                  body: 'Check your connection.',
                  tone: 'error',
                  action: { label: 'Retry', onAction: () => {} },
                })
              }
            >
              Toast error
            </Button>
            <Button
              onClick={() =>
                toast({ title: 'Heads up', body: 'Queued behind the first.', tone: 'info' })
              }
            >
              Toast info
            </Button>
          </Row>
          {sheet ? (
            <Sheet
              open
              onClose={() => setSheet(null)}
              side={sheet}
              title="Discard changes?"
              description="You changed the voice for Dean."
              footer={
                <>
                  <Button variant="ghost" onClick={() => setSheet(null)}>
                    Keep editing
                  </Button>
                  <Button variant="danger" onClick={() => setSheet(null)}>
                    Discard
                  </Button>
                </>
              }
            >
              <p>Your edits will be lost.</p>
            </Sheet>
          ) : null}
        </Section>

        <Section id="avatars" title="Avatars">
          <Row label="sizes">
            {(['xs', 'sm', 'md', 'lg'] as const).map((s) => (
              <Avatar key={s} name="Ana Rivera" size={s} src="/avatars/ana.png" />
            ))}
            <Avatar name="Dean" size="md" />
          </Row>
          <Row label="states">
            <Avatar name="Dean" size="lg" src="/avatars/ben.png" state="idle" />
            <Avatar name="Dean" size="lg" src="/avatars/ben.png" state="talking" level={level} />
            <Avatar name="Dean" size="lg" src="/avatars/ben.png" state="muted" />
            <Avatar name="Dean" size="lg" src="/avatars/ben.png" state="offline" />
            <Avatar name="Dean" size="lg" frame="portrait" src="/avatars/chi.png" />
          </Row>
          <label className="sq-g__slider">
            Talking level{' '}
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={level}
              onChange={(e) => setLevel(Number(e.target.value))}
            />
          </label>
        </Section>

        <Section id="stepper" title="Stepper">
          <Stepper
            steps={[
              { id: 'phone', label: 'Phone' },
              { id: 'courses', label: 'Courses' },
              { id: 'calendar', label: 'Calendar' },
              { id: 'persona', label: 'Buddy' },
            ]}
            current="calendar"
            completed={['phone', 'courses']}
            onStepClick={() => {}}
          />
          <Stepper
            orientation="vertical"
            steps={[
              { id: 'a', label: 'Link phone' },
              { id: 'b', label: 'Add courses' },
              { id: 'c', label: 'Share calendar' },
            ]}
            current="b"
            completed={['a']}
          />
        </Section>

        <Section id="markdown" title="Markdown">
          <Card>
            <Markdown>
              {
                'The **mitochondria** makes ATP. See `glycolysis` for the first step [cite: ch5.pdf p.12]\n\n- Krebs cycle\n- Electron transport\n\nRead [the chapter](https://example.com) or [bad](javascript:alert(1)).'
              }
            </Markdown>
          </Card>
        </Section>

        <Section id="icons" title="Icons">
          <ul className="sq-g__icons">
            {ICON_NAMES.map((n) => (
              <li key={n}>
                <Icon name={n} size={24} />
                <span>{n}</span>
              </li>
            ))}
          </ul>
        </Section>

        <Section id="color" title="Color tokens" note="Read live from tokens.css.">
          <h3 className="sq-g__h3">Palette (28)</h3>
          <div className="sq-g__swatches">
            {PALETTE.map((p) => (
              <Swatch key={p} name={p.replace('--sq-', '')} css={p} />
            ))}
          </div>
          <h3 className="sq-g__h3">Semantic</h3>
          <div className="sq-g__swatches">
            {SEMANTIC.map((p) => (
              <Swatch key={p} name={p.replace('--', '')} css={p} />
            ))}
          </div>
        </Section>

        <Section id="type" title="Type, spacing, radius, shadow">
          <div className="sq-g__type">
            <p style={{ font: '600 var(--text-2xl)/var(--lh-2xl) var(--font-sans)' }}>
              Page title 28/34
            </p>
            <p style={{ font: '600 var(--text-xl)/var(--lh-xl) var(--font-sans)' }}>
              Card heading 22/30
            </p>
            <p style={{ font: '600 var(--text-lg)/var(--lh-lg) var(--font-sans)' }}>
              Panel title 18/28
            </p>
            <p>Body 16/24: Ask the Chapter 5 expert about glycolysis.</p>
            <p style={{ font: '400 var(--text-sm)/var(--lh-sm) var(--font-sans)' }}>
              Secondary 14/20
            </p>
            <p style={{ font: '500 var(--text-xs)/var(--lh-xs) var(--font-sans)' }}>Label 12/16</p>
            <p className="sq-pixel-text" style={{ fontSize: 'var(--text-pixel-sm)' }}>
              Jersey 10 sm 18.667 Q2 of 5
            </p>
            <p className="sq-pixel-text" style={{ fontSize: 'var(--text-pixel-md)' }}>
              Jersey 10 md 28
            </p>
            <p className="sq-pixel-text" style={{ fontSize: 'var(--text-pixel-lg)' }}>
              Jersey 10 lg 37
            </p>
            <p style={{ font: '400 8px/1 var(--font-pixel-caps)', letterSpacing: '0.06em' }}>
              SILKSCREEN LIVE REPLAY STEP 2
            </p>
          </div>
          <div className="sq-g__scale">
            {[1, 2, 3, 4, 5, 6, 8, 10, 12, 16].map((n) => (
              <span
                key={n}
                style={{ width: `var(--space-${n})`, height: `var(--space-${n})` }}
                title={`space-${n}`}
              />
            ))}
          </div>
          <Row label="radius">
            {['sm', 'md', 'lg', 'xl'].map((r) => (
              <span key={r} className="sq-g__box" style={{ borderRadius: `var(--radius-${r})` }}>
                {r}
              </span>
            ))}
          </Row>
          <Row label="shadow">
            {[1, 2, 3].map((n) => (
              <span key={n} className="sq-g__box" style={{ boxShadow: `var(--shadow-${n})` }}>
                shadow-{n}
              </span>
            ))}
            <span className="sq-g__box" style={{ boxShadow: 'var(--shadow-glow)' }}>
              glow
            </span>
          </Row>
        </Section>

        <Section
          id="motion"
          title="Motion curves"
          note="Three curves only. Reduced motion or Calm removes the movement."
        >
          <Row>
            <Button onClick={() => setBump((b) => b + 1)}>Replay</Button>
          </Row>
          {(['out', 'in-out', 'drawer'] as const).map((c) => (
            <div key={`${c}${bump}`} className="sq-g__track">
              <span className="sq-g__trackname">ease-{c}</span>
              <span className="sq-g__dot" style={{ animationTimingFunction: `var(--ease-${c})` }} />
            </div>
          ))}
        </Section>

        <Section id="stories" title="Overlays and pages">
          {stories.length === 0 ? (
            <EmptyState
              icon="sparkle"
              title="No stories contributed yet"
              body="Export stories from overlays/gallery.tsx or pages/<name>/gallery.tsx."
            />
          ) : (
            stories.map((s) => (
              <div key={s.id} id={`story-${s.id}`}>
                <h3 className="sq-g__h3">{s.title}</h3>
                {s.render()}
              </div>
            ))
          )}
        </Section>
      </main>
    </div>
  );
}
