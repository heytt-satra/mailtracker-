import { listMessages, provisionApiKey } from '../../src/api-client';
import { logInWithEmail, signInWithGoogle, signUpWithEmail } from '../../src/auth';
import { getSettings, setSettings } from '../../src/storage';
import { describeStatus } from '../../src/status-chip';
import { describeReadConfidence } from '../../src/read-confidence-chip';
import { formatSentAt } from '../../src/dashboard-format';
import type { MessageSummary } from '@mailtrack/shared';

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const loading = el('loading');
const signedOut = el('signedOut');
const signedIn = el('signedIn');
const authMsg = el('authMsg');
const msgList = el<HTMLUListElement>('msgList');
const emptyState = el('emptyState');
const trackingToggle = el<HTMLInputElement>('trackingToggle');

const POPUP_RECENT_COUNT = 6;
const POLL_MS = 5000;

let apiKey: string | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;

async function init(): Promise<void> {
  const settings = await getSettings();
  apiKey = settings.apiKey;
  loading.classList.add('hidden');

  if (!apiKey) {
    signedOut.classList.remove('hidden');
    return;
  }
  signedIn.classList.remove('hidden');
  trackingToggle.checked = settings.trackingEnabledByDefault;
  await refresh();
  pollTimer = setInterval(() => {
    refresh().catch(() => {});
  }, POLL_MS);
}

function escapeHtml(input: string): string {
  const d = document.createElement('div');
  d.textContent = input;
  return d.innerHTML;
}

function badge(label: string, color: string, title = ''): string {
  return `<span class="mt-badge" style="color:${color};background:${color}1a"${title ? ` title="${escapeHtml(title)}"` : ''}><span class="dot" style="background:${color}"></span>${label}</span>`;
}

function renderMessage(m: MessageSummary): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'msg';

  // A bounce or reply is the headline state; otherwise the read-confidence
  // badge (falling back to the plain status) is the most informative glance.
  let badgeHtml: string;
  if (m.bounce) {
    badgeHtml = badge('Bounced', 'var(--red)', m.bounce.reason);
  } else if (m.reply) {
    badgeHtml = badge('Replied', 'var(--green)', 'Recipient replied — definitive proof they read it');
  } else {
    const rc = describeReadConfidence(m.readConfidence);
    badgeHtml = rc ? badge(rc.label, rc.color, m.readEvidence ?? '') : badge(m.status, describeStatus(m.status).color);
  }

  const opensLabel = m.sessionCount && m.sessionCount !== m.openCount ? `${m.openCount} opens · ${m.sessionCount} sessions` : `${m.openCount} open${m.openCount === 1 ? '' : 's'}`;
  const clicksLabel = m.clickCount > 0 ? ` · ${m.clickCount} click${m.clickCount === 1 ? '' : 's'}` : '';

  li.innerHTML = `
    <div class="who">
      <div class="r">${escapeHtml(m.recipient || '(no recipient)')}</div>
      <div class="meta">${formatSentAt(m.sentAt)} · ${opensLabel}${clicksLabel}</div>
    </div>
    <div class="counts">${badgeHtml}</div>
  `;
  return li;
}

async function refresh(): Promise<void> {
  if (!apiKey) return;
  const { messages } = await listMessages(apiKey, 0);

  el('sTotal').textContent = String(messages.length);
  el('sOpened').textContent = String(messages.filter((m) => m.openCount > 0 || m.status === 'replied').length);
  el('sReplied').textContent = String(messages.filter((m) => m.reply || m.status === 'replied').length);

  msgList.innerHTML = '';
  const recent = messages.slice(0, POPUP_RECENT_COUNT);
  for (const m of recent) msgList.appendChild(renderMessage(m));
  emptyState.classList.toggle('hidden', messages.length > 0);
}

function showAuth(message: string, isError: boolean): void {
  authMsg.textContent = message;
  authMsg.toggleAttribute('data-error', isError);
}

async function handleAuth(result: Awaited<ReturnType<typeof logInWithEmail>>): Promise<void> {
  if (!result.ok) {
    showAuth(result.message, true);
    return;
  }
  try {
    const { apiKey: key, email } = await provisionApiKey(result.accessToken);
    await setSettings({ apiKey: key, accountEmail: email });
    showAuth('', false);
    // Re-enter the signed-in flow in place rather than forcing a reopen.
    loading.classList.add('hidden');
    signedOut.classList.add('hidden');
    apiKey = key;
    signedIn.classList.remove('hidden');
    const settings = await getSettings();
    trackingToggle.checked = settings.trackingEnabledByDefault;
    await refresh();
    if (!pollTimer) pollTimer = setInterval(() => refresh().catch(() => {}), POLL_MS);
  } catch {
    showAuth('Signed in, but could not reach MailTrack to issue a key. Try again in a moment.', true);
  }
}

el('logIn').addEventListener('click', async () => {
  showAuth('Logging in…', false);
  await handleAuth(await logInWithEmail(el<HTMLInputElement>('email').value.trim(), el<HTMLInputElement>('password').value));
});
el('signUp').addEventListener('click', async () => {
  showAuth('Signing up…', false);
  await handleAuth(await signUpWithEmail(el<HTMLInputElement>('email').value.trim(), el<HTMLInputElement>('password').value));
});
document.getElementById('googleSignIn')?.addEventListener('click', async () => {
  const googleBtn = document.getElementById('googleSignIn') as HTMLButtonElement | null;
  if (googleBtn) googleBtn.disabled = true;
  showAuth('Continuing with Google…', false);
  await handleAuth(await signInWithGoogle());
  if (googleBtn) googleBtn.disabled = false;
});
el<HTMLInputElement>('password').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') el('logIn').click();
});

trackingToggle.addEventListener('change', () => {
  setSettings({ trackingEnabledByDefault: trackingToggle.checked }).catch(() => {});
});

el('openDashboard').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
  window.close();
});
el('openOptions').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
  window.close();
});

init();
