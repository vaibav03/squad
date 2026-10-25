import { createExtensionAuth } from './auth';
import { HUB_BASE } from './config';
import { chromeStateStore, DEFAULT_STATE } from './state';

const store = chromeStateStore();
const auth = createExtensionAuth(HUB_BASE, store);
const $ = (id: string) => document.getElementById(id) as HTMLInputElement & HTMLElement;

async function render() {
  const s = await store.get();
  $('account-status').textContent = s.session ? 'Paired with Squad' : 'Not paired';
  $('signed-out').hidden = !!s.session;
  $('signed-in').hidden = !s.session;
  const list = $('accounts');
  list.replaceChildren(
    ...s.accounts.map((a, i) => {
      const li = document.createElement('li');
      const code = document.createElement('code');
      code.textContent = `${a.name ? `${a.name} · ` : ''}${a.origin} #${a.canvasUserId}`;
      const rm = document.createElement('button');
      rm.textContent = 'Remove';
      rm.onclick = async () => {
        const cur = await store.get();
        await store.patch({ accounts: cur.accounts.filter((_, j) => j !== i) });
        void render();
      };
      li.append(code, rm);
      return li;
    }),
  );
  if (s.accounts.length === 0) {
    const li = document.createElement('li');
    li.textContent =
      'No Canvas session seen yet: sign in to Canvas in this browser and open any Canvas page.';
    list.append(li);
  }
  $('allowed').value = s.allowedOrigins.join(', ');
  $('bound').textContent = s.bound
    ? `Last authorized: ${s.bound.origin} #${s.bound.canvasUserId}`
    : 'Nothing authorized yet.';
  $('sync').textContent = s.lastSyncOutcome ? `Last sync: ${s.lastSyncOutcome}` : 'Not synced yet.';
}
const showError = (id: string, e: unknown) => {
  $(id).textContent = e ? (e instanceof Error ? e.message : String(e)) : '';
};

$('pair').onclick = async () => {
  showError('account-error', null);
  try {
    await auth.pair($('code').value.trim());
    $('code').value = '';
    void render();
  } catch (e) {
    showError('account-error', e);
  }
};
$('sign-out').onclick = async () => {
  await auth.signOut();
  void render();
};
$('save-allowed').onclick = async () => {
  const allowed = $('allowed')
    .value.split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  if (allowed.some((o) => !/^https:\/\/[^/]+$/.test(o)))
    return showError('acc-error', 'Origins must be exact https origins');
  showError('acc-error', null);
  await store.patch({ allowedOrigins: allowed });
  void render();
};
$('reset').onclick = async () => {
  await store.patch({ ...DEFAULT_STATE });
  void render();
};
void render();
