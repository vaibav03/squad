import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
} from 'react';
import type { ChatAttachment } from '@squad/core';
import { Icon } from '../../primitives/Icon';
import { Spinner } from '../../primitives/Spinner';
import type { ChatApi } from './api';
import { chatErrorText } from './api';
import { parseDiscussTrigger } from '../../live/trigger';
import {
  ACCEPT_IMAGES,
  COUNTER_FROM,
  MAX_ATTACHMENTS,
  MAX_TEXT,
  activeMention,
  applyMention,
  matchMentions,
  uploadProblem,
} from './model';

export interface ComposerHandle {
  focus(): void;
  fill(text: string): void;
  /**
   * Runs the composer's key handling for a native keydown aimed at its textarea (the village dock stops keys at the
   * window in the capture phase, so React never sees them). Returns true when the key was used up (it closed the
   * mention list), so the dock must not treat an Escape as its own.
   */
  keydown(e: globalThis.KeyboardEvent): boolean;
}

interface KeyLike {
  key: string;
  shiftKey: boolean;
  nativeEvent: { isComposing?: boolean };
  preventDefault(): void;
  stopPropagation(): void;
}

interface Draft {
  key: string;
  name: string;
  preview?: string;
  status: 'uploading' | 'ready' | 'error';
  att?: ChatAttachment;
  error?: string;
}

export interface ComposerProps {
  api: ChatApi | null;
  chatKind: 'group' | 'dm';
  onSend: (input: { text: string; files: ChatAttachment[] }) => Promise<boolean> | boolean | void;
  /** sending is paused (offline, session over); drafting still works */
  paused?: string | null;
  compact?: boolean;
  /** `discuss: <topic>` was typed: offer to watch it live in the Live panel instead of sending. */
  onDiscuss?: (topic: string) => void;
  /** left-side slot in the row (the '+' action menu); never affects the textarea's min width */
  leading?: React.ReactNode;
}

const MAX_H = 144;

export const Composer = forwardRef<ComposerHandle, ComposerProps>(function Composer(
  { api, chatKind, onSend, paused, compact, onDiscuss, leading },
  ref,
) {
  const [text, setText] = useState('');
  const [caret, setCaret] = useState(0);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [pickerOff, setPickerOff] = useState(false);
  const [active, setActive] = useState(0);
  const [drag, setDrag] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;
  const listId = useId();
  const hintId = useId();
  const counterId = useId();

  useImperativeHandle(ref, () => ({
    keydown: (e) => {
      let used = false;
      onKeyDown({
        key: e.key,
        shiftKey: e.shiftKey,
        nativeEvent: e,
        preventDefault: () => e.preventDefault(),
        stopPropagation: () => {
          used = true;
        },
      });
      return used;
    },
    focus: () => area.current?.focus(),
    fill: (t) => {
      setText(t);
      setPickerOff(true);
      requestAnimationFrame(() => {
        const el = area.current;
        if (el) {
          el.focus();
          el.setSelectionRange(t.length, t.length);
        }
      });
    },
  }));

  // auto-grow
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_H)}px`;
    el.style.overflowY = el.scrollHeight > MAX_H ? 'auto' : 'hidden';
  }, [text]);

  useEffect(
    () => () => {
      for (const d of draftsRef.current)
        if (d.preview && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(d.preview);
    },
    [],
  );

  const mention = chatKind === 'group' && !pickerOff ? activeMention(text, caret) : null;
  const options = mention ? matchMentions(mention.query) : [];
  const open = options.length > 0;
  const act = Math.min(active, Math.max(0, options.length - 1));

  const addFiles = useCallback(
    (files: File[]) => {
      if (!api) return;
      setProblem(null);
      const room = MAX_ATTACHMENTS - draftsRef.current.length;
      const take = files.slice(0, Math.max(0, room));
      if (files.length > take.length) setProblem(`You can attach up to ${MAX_ATTACHMENTS} images.`);
      for (const f of take) {
        const bad = uploadProblem(f);
        const key = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const preview =
          typeof URL.createObjectURL === 'function' ? URL.createObjectURL(f) : undefined;
        if (bad) {
          setProblem(bad);
          if (preview) URL.revokeObjectURL(preview);
          continue;
        }
        setDrafts((d) => [...d, { key, name: f.name, preview, status: 'uploading' }]);
        api.upload(f).then(
          (att) =>
            setDrafts((d) => d.map((x) => (x.key === key ? { ...x, status: 'ready', att } : x))),
          (e) =>
            setDrafts((d) =>
              d.map((x) =>
                x.key === key
                  ? { ...x, status: 'error', error: chatErrorText(e, 'The upload failed.') }
                  : x,
              ),
            ),
        );
      }
    },
    [api],
  );

  const removeDraft = (key: string) =>
    setDrafts((d) => {
      const x = d.find((y) => y.key === key);
      if (x?.preview && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(x.preview);
      return d.filter((y) => y.key !== key);
    });

  const uploading = drafts.some((d) => d.status === 'uploading');
  const ready = drafts.filter((d) => d.status === 'ready' && d.att);
  const over = text.length > MAX_TEXT;
  const empty = !text.trim() && ready.length === 0;
  const blocked = !!paused || uploading || over || empty;

  const discussTopic = onDiscuss ? parseDiscussTrigger(text) : null;
  const submit = () => {
    if (blocked) return;
    const files = ready.map((d) => d.att!);
    const body = text.trim();
    // clear first: the send is optimistic and a failure keeps the message in the thread with Retry
    setText('');
    setPickerOff(false);
    setProblem(null);
    for (const d of drafts)
      if (d.preview && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(d.preview);
    setDrafts([]);
    void onSend({ text: body, files });
    requestAnimationFrame(() => area.current?.focus());
  };

  const pick = (i: number) => {
    const opt = options[i];
    if (!opt || !mention) return;
    const r = applyMention(text, caret, mention, opt);
    setText(r.text);
    setPickerOff(true);
    requestAnimationFrame(() => {
      const el = area.current;
      if (el) {
        el.focus();
        el.setSelectionRange(r.caret, r.caret);
        setCaret(r.caret);
      }
    });
  };

  const onKeyDown = (e: KeyLike) => {
    if (open) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive((act + 1) % options.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((act - 1 + options.length) % options.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        pick(act);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setPickerOff(true);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
      return;
    }
    if (e.key === 'Escape') area.current?.blur();
  };

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const imgs = [...e.clipboardData.files].filter((f) => f.type.startsWith('image/'));
    if (imgs.length) {
      e.preventDefault();
      addFiles(imgs);
    }
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    addFiles([...e.dataTransfer.files]);
  };

  const showCounter = text.length >= COUNTER_FROM;
  const hint =
    chatKind === 'dm'
      ? 'Private chat. No @ needed, Cubbie reads every message.'
      : 'Type @ to ask Cubbie. Shift+Enter for a new line.';
  return (
    <div
      className={['sqc-composer', compact && 'is-compact', drag && 'is-drop']
        .filter(Boolean)
        .join(' ')}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDrag(true);
        }
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={onDrop}
    >
      {paused ? (
        <p className="sqc-composer__paused" role="status" data-testid="chat-paused">
          <Icon name="alert" size={14} />
          {paused}
        </p>
      ) : null}
      {drafts.length ? (
        <ul className="sqc-drafts" aria-label="Attached images">
          {drafts.map((d) => (
            <li key={d.key} className="sqc-draft" data-status={d.status} title={d.error}>
              {d.preview ? <img src={d.preview} alt="" /> : <Icon name="image" size={18} />}
              {d.status === 'uploading' ? (
                <span className="sqc-draft__state">
                  <Spinner size={14} label="Uploading" />
                </span>
              ) : null}
              {d.status === 'error' ? (
                <span className="sqc-draft__state is-error">
                  <Icon name="alert" size={14} />
                </span>
              ) : null}
              <button
                type="button"
                className="sqc-draft__x"
                aria-label={`Remove ${d.name || 'image'}`}
                onClick={() => removeDraft(d.key)}
              >
                <Icon name="x" size={12} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {problem ? (
        <p className="sqc-composer__problem" role="alert">
          <Icon name="alert" size={14} />
          {problem}
        </p>
      ) : null}
      <div className="sqc-composer__row">
        {leading ? (
          <div className="sqc-composer__lead" data-slot="composer-leading">
            {leading}
          </div>
        ) : null}
        <input
          ref={file}
          type="file"
          hidden
          multiple
          accept={ACCEPT_IMAGES.join(',')}
          data-testid="chat-file-input"
          onChange={(e) => {
            addFiles([...(e.target.files ?? [])]);
            e.target.value = '';
          }}
        />
        <button
          type="button"
          className="sqc-iconbtn"
          aria-label="Attach image"
          disabled={!api || drafts.length >= MAX_ATTACHMENTS}
          onClick={() => file.current?.click()}
        >
          <Icon name="image" size={20} />
        </button>
        <div className="sqc-composer__field">
          {open ? (
            <ul className="sqc-mentions" role="listbox" id={listId} aria-label="Mention">
              {options.map((o, i) => (
                <li
                  key={o.id}
                  id={`${listId}-${o.id}`}
                  role="option"
                  aria-selected={i === act}
                  className="sqc-mention"
                  data-testid={`chat-mention-${o.id}`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(i);
                  }}
                  onMouseMove={() => setActive(i)}
                >
                  <span className="sqc-mention__name">{o.insert}</span>
                  <span className="sqc-mention__hint">{o.hint}</span>
                </li>
              ))}
            </ul>
          ) : null}
          <textarea
            ref={area}
            className="sqc-composer__input"
            data-testid="chat-composer-input"
            rows={1}
            value={text}
            placeholder={chatKind === 'dm' ? 'Message Cubbie' : 'Message the squad'}
            aria-label="Message"
            aria-describedby={`${hintId}${showCounter ? ` ${counterId}` : ''}`}
            role={chatKind === 'group' ? 'combobox' : undefined}
            aria-autocomplete={chatKind === 'group' ? 'list' : undefined}
            aria-haspopup={chatKind === 'group' ? 'listbox' : undefined}
            aria-expanded={chatKind === 'group' ? open : undefined}
            aria-controls={chatKind === 'group' && open ? listId : undefined}
            aria-activedescendant={open ? `${listId}-${options[act]!.id}` : undefined}
            enterKeyHint="send"
            autoComplete="off"
            onChange={(e) => {
              setText(e.target.value);
              setCaret(e.target.selectionStart);
              setPickerOff(false);
              setActive(0);
            }}
            onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
          />
        </div>
        <button
          type="button"
          className="sqc-send"
          data-testid="chat-send"
          aria-label="Send message"
          title={paused ?? undefined}
          data-state={paused ? 'paused' : uploading ? 'uploading' : empty ? 'empty' : 'ready'}
          disabled={blocked}
          onClick={submit}
        >
          <Icon name="send" size={18} />
        </button>
      </div>
      {discussTopic && onDiscuss ? (
        <div className="sqc-composer__discuss" role="group" aria-label="Live discussion">
          <span>Send it to Cubbie, or watch the table talk it through live.</span>
          <button
            type="button"
            className="sqc-link"
            data-testid="chat-discuss-live"
            onClick={() => {
              onDiscuss(discussTopic);
              setText('');
            }}
          >
            Watch it live
          </button>
        </div>
      ) : null}
      <span className="sq-sr-only" role="status" aria-live="polite">
        {open ? `${options.length} suggestion${options.length === 1 ? '' : 's'}` : ''}
      </span>
      <div className="sqc-composer__foot">
        <span id={hintId} className="sqc-composer__hint">
          {hint}
        </span>
        {showCounter ? (
          <span
            id={counterId}
            className={`sqc-composer__count${over ? ' is-over' : ''}`}
            role={over ? 'alert' : undefined}
          >
            {text.length} / {MAX_TEXT}
          </span>
        ) : null}
      </div>
    </div>
  );
});
