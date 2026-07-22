/**
 * ADR-61 (Outlook add-in, C2). Sign-in UI — the task-pane equivalent of
 * apps/extension/entrypoints/options's auth panel, at a much smaller scale
 * (see PLAN.md's Outlook MVP scope: email/password only, no Google sign-in,
 * no billing/team/export UI — those are Gmail-only for this pass).
 */
import { logInWithEmail, signUpWithEmail } from './auth';
import { provisionApiKey } from './api-client';
import { getSettings, setSettings, type MailTrackSettings } from './storage';

const signedOutPanel = document.getElementById('signedOutPanel') as HTMLDivElement;
const signedInPanel = document.getElementById('signedInPanel') as HTMLDivElement;
const signedInEmailEl = document.getElementById('signedInEmail') as HTMLParagraphElement;
const emailInput = document.getElementById('email') as HTMLInputElement;
const passwordInput = document.getElementById('password') as HTMLInputElement;
const authStatusEl = document.getElementById('authStatus') as HTMLDivElement;
const signedInStatusEl = document.getElementById('signedInStatus') as HTMLDivElement;
const trackingEnabledInput = document.getElementById('trackingEnabled') as HTMLInputElement;

function showAuthMessage(message: string, isError: boolean): void {
  authStatusEl.textContent = message;
  authStatusEl.toggleAttribute('data-error', isError);
}

function refreshView(): void {
  const settings = getSettings();
  const signedIn = !!settings.apiKey;
  signedOutPanel.classList.toggle('hidden', signedIn);
  signedInPanel.style.display = signedIn ? '' : 'none';
  if (signedIn) {
    signedInEmailEl.textContent = settings.accountEmail ? `Signed in as ${settings.accountEmail}` : 'API key active';
    trackingEnabledInput.checked = settings.trackingEnabledByDefault;
  }
}

async function handleAuthResult(result: Awaited<ReturnType<typeof logInWithEmail>>): Promise<void> {
  if (!result.ok) {
    showAuthMessage(result.message, true);
    return;
  }
  try {
    const { apiKey, email } = await provisionApiKey(result.accessToken);
    setSettings({ apiKey, accountEmail: email });
    passwordInput.value = '';
    showAuthMessage('', false);
    refreshView();
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

trackingEnabledInput.addEventListener('change', () => {
  setSettings({ trackingEnabledByDefault: trackingEnabledInput.checked });
});

document.getElementById('signOut')?.addEventListener('click', () => {
  setSettings({ apiKey: null, accountEmail: null } satisfies Partial<MailTrackSettings>);
  signedInStatusEl.textContent = '';
  refreshView();
});

Office.onReady(() => {
  refreshView();
});
