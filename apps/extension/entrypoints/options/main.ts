import { deleteMessage, exportMessageCsv, provisionApiKey } from '../../src/api-client';
import { logInWithEmail, signUpWithEmail } from '../../src/auth';
import { getSettings, setSettings } from '../../src/storage';

const signedOutPanel = document.getElementById('signedOutPanel') as HTMLDivElement;
const signedInPanel = document.getElementById('signedInPanel') as HTMLDivElement;
const signedInEmailEl = document.getElementById('signedInEmail') as HTMLParagraphElement;

const emailInput = document.getElementById('email') as HTMLInputElement;
const passwordInput = document.getElementById('password') as HTMLInputElement;
const authStatusEl = document.getElementById('authStatus') as HTMLDivElement;

const apiKeyInput = document.getElementById('apiKey') as HTMLInputElement;
const trackingEnabledInput = document.getElementById('trackingEnabled') as HTMLInputElement;
const notificationsEnabledInput = document.getElementById('notificationsEnabled') as HTMLInputElement;
const bounceDetectionEnabledInput = document.getElementById('bounceDetectionEnabled') as HTMLInputElement;
const statusEl = document.getElementById('status') as HTMLDivElement;

async function refreshView(): Promise<void> {
  const settings = await getSettings();
  const signedIn = !!settings.apiKey;
  signedOutPanel.classList.toggle('hidden', signedIn);
  signedInPanel.classList.toggle('visible', signedIn);
  if (signedIn) {
    signedInEmailEl.textContent = settings.accountEmail ? `Signed in as ${settings.accountEmail}` : 'API key active';
    trackingEnabledInput.checked = settings.trackingEnabledByDefault;
    notificationsEnabledInput.checked = settings.notificationsEnabled;
    bounceDetectionEnabledInput.checked = settings.bounceDetectionEnabled;
  }
}

function showAuthMessage(message: string, isError: boolean): void {
  authStatusEl.textContent = message;
  authStatusEl.toggleAttribute('data-error', isError);
}

async function handleAuthResult(result: Awaited<ReturnType<typeof signUpWithEmail>>): Promise<void> {
  if (!result.ok) {
    showAuthMessage(result.message, true);
    return;
  }
  try {
    const { apiKey, email } = await provisionApiKey(result.accessToken);
    await setSettings({ apiKey, accountEmail: email });
    passwordInput.value = '';
    showAuthMessage('', false);
    await refreshView();
  } catch {
    showAuthMessage('Signed in, but could not reach MailTrack to issue an API key. Try again in a moment.', true);
  }
}

document.getElementById('logIn')?.addEventListener('click', async () => {
  showAuthMessage('Logging in…', false);
  await handleAuthResult(await logInWithEmail(emailInput.value.trim(), passwordInput.value));
});

document.getElementById('signUp')?.addEventListener('click', async () => {
  showAuthMessage('Signing up…', false);
  await handleAuthResult(await signUpWithEmail(emailInput.value.trim(), passwordInput.value));
});

document.getElementById('saveApiKey')?.addEventListener('click', async () => {
  const apiKey = apiKeyInput.value.trim();
  if (!apiKey) return;
  await setSettings({ apiKey, accountEmail: null });
  await refreshView();
});

document.getElementById('signOut')?.addEventListener('click', async () => {
  await setSettings({ apiKey: null, accountEmail: null });
  await refreshView();
});

document.getElementById('save')?.addEventListener('click', async () => {
  await setSettings({
    trackingEnabledByDefault: trackingEnabledInput.checked,
    notificationsEnabled: notificationsEnabledInput.checked,
    bounceDetectionEnabled: bounceDetectionEnabledInput.checked,
  });
  statusEl.textContent = 'Saved.';
  setTimeout(() => (statusEl.textContent = ''), 2000);
});

document.getElementById('export')?.addEventListener('click', async () => {
  const msgId = (document.getElementById('exportMsgId') as HTMLInputElement).value.trim();
  const settings = await getSettings();
  if (!msgId || !settings.apiKey) return;
  const csv = await exportMessageCsv(settings.apiKey, msgId);
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `mailtrack-${msgId}.csv`;
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById('delete')?.addEventListener('click', async () => {
  const msgId = (document.getElementById('deleteMsgId') as HTMLInputElement).value.trim();
  const settings = await getSettings();
  if (!msgId || !settings.apiKey) return;
  if (!confirm(`Delete all tracking data for message ${msgId}? This cannot be undone.`)) return;
  await deleteMessage(settings.apiKey, msgId);
  alert('Deleted.');
});

refreshView();
