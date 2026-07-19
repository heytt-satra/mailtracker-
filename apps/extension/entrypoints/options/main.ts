import { cancelSubscription, createCheckout, deleteMessage, exportMessageCsv, getBillingStatus, provisionApiKey } from '../../src/api-client';
import { logInWithEmail, requestPasswordReset, signInWithGoogle, signUpWithEmail } from '../../src/auth';
import {
  getSavedAccounts,
  getSettings,
  removeSavedAccount,
  setSettings,
  switchToSavedAccount,
  upsertSavedAccount,
  type MailTrackSettings,
} from '../../src/storage';

// Element ids match the MailTrackSettings key of the same name exactly —
// keeps this list in sync with storage.ts's per-alert toggles without
// hand-writing a getter/setter pair for each one.
const NOTIFY_TOGGLE_KEYS = ['notifyOnOpen', 'notifyOnClick', 'notifyOnReply', 'notifyOnBounce', 'notifyOnHotConversation', 'notifyOnRevival', 'notifyOnFollowUp'] as const satisfies readonly (keyof MailTrackSettings)[];

const signedOutPanel = document.getElementById('signedOutPanel') as HTMLDivElement;
const signedInPanel = document.getElementById('signedInPanel') as HTMLDivElement;
const signedInEmailEl = document.getElementById('signedInEmail') as HTMLParagraphElement;

const emailInput = document.getElementById('email') as HTMLInputElement;
const passwordInput = document.getElementById('password') as HTMLInputElement;
const authStatusEl = document.getElementById('authStatus') as HTMLDivElement;
const togglePasswordBtn = document.getElementById('togglePassword') as HTMLButtonElement;
const forgotPasswordBtn = document.getElementById('forgotPassword') as HTMLButtonElement;

const apiKeyInput = document.getElementById('apiKey') as HTMLInputElement;
const trackingEnabledInput = document.getElementById('trackingEnabled') as HTMLInputElement;
const notificationsEnabledInput = document.getElementById('notificationsEnabled') as HTMLInputElement;
const bounceDetectionEnabledInput = document.getElementById('bounceDetectionEnabled') as HTMLInputElement;
const followUpNotOpenedDaysInput = document.getElementById('followUpNotOpenedDays') as HTMLInputElement;
const followUpOpenedNoReplyDaysInput = document.getElementById('followUpOpenedNoReplyDays') as HTMLInputElement;
const individualTrackingForGroupEmailsInput = document.getElementById('individualTrackingForGroupEmails') as HTMLInputElement;
const checkLinksForSafetyInput = document.getElementById('checkLinksForSafety') as HTMLInputElement;
const statusEl = document.getElementById('status') as HTMLDivElement;

const billingCard = document.getElementById('billingCard') as HTMLDivElement;
const billingBadge = document.getElementById('billingBadge') as HTMLDivElement;
const billingStatusEl = document.getElementById('billingStatus') as HTMLDivElement;
const subscribeOptionsEl = document.getElementById('subscribeOptions') as HTMLDivElement;
const cancelOptionsEl = document.getElementById('cancelOptions') as HTMLDivElement;
const subscribeMonthlyBtn = document.getElementById('subscribeMonthly') as HTMLButtonElement;
const subscribeYearlyBtn = document.getElementById('subscribeYearly') as HTMLButtonElement;
const cancelSubscriptionBtn = document.getElementById('cancelSubscriptionBtn') as HTMLButtonElement;

const accountsCard = document.getElementById('accountsCard') as HTMLDivElement;
const accountsListEl = document.getElementById('accountsList') as HTMLDivElement;
const saveAccountGmailEmailInput = document.getElementById('saveAccountGmailEmail') as HTMLInputElement;
const accountsStatusEl = document.getElementById('accountsStatus') as HTMLDivElement;

async function refreshView(): Promise<void> {
  const settings = await getSettings();
  const signedIn = !!settings.apiKey;
  signedOutPanel.classList.toggle('hidden', signedIn);
  signedInPanel.classList.toggle('visible', signedIn);
  billingCard.classList.toggle('visible', signedIn);
  accountsCard.classList.toggle('visible', signedIn);
  if (signedIn) {
    await renderAccounts();
    signedInEmailEl.textContent = settings.accountEmail ? `Signed in as ${settings.accountEmail}` : 'API key active';
    trackingEnabledInput.checked = settings.trackingEnabledByDefault;
    notificationsEnabledInput.checked = settings.notificationsEnabled;
    bounceDetectionEnabledInput.checked = settings.bounceDetectionEnabled;
    followUpNotOpenedDaysInput.value = String(settings.followUpNotOpenedDays);
    followUpOpenedNoReplyDaysInput.value = String(settings.followUpOpenedNoReplyDays);
    individualTrackingForGroupEmailsInput.checked = settings.individualTrackingForGroupEmails;
    checkLinksForSafetyInput.checked = settings.checkLinksForSafety;
    for (const key of NOTIFY_TOGGLE_KEYS) {
      const input = document.getElementById(key) as HTMLInputElement | null;
      if (input) input.checked = Boolean(settings[key]);
    }
    await refreshBillingStatus(settings.apiKey!);
  }
}

async function refreshBillingStatus(apiKey: string): Promise<void> {
  billingBadge.textContent = 'Checking…';
  billingBadge.className = 'plan-badge inactive';
  try {
    const { active } = await getBillingStatus(apiKey);
    billingBadge.textContent = active ? 'Subscription active' : 'No active subscription';
    billingBadge.className = active ? 'plan-badge active' : 'plan-badge inactive';
    subscribeOptionsEl.style.display = active ? 'none' : '';
    cancelOptionsEl.style.display = active ? '' : 'none';
  } catch {
    billingBadge.textContent = 'Could not check subscription status';
    billingBadge.className = 'plan-badge inactive';
  }
}

async function renderAccounts(): Promise<void> {
  const [accounts, settings] = await Promise.all([getSavedAccounts(), getSettings()]);
  accountsListEl.innerHTML = '';
  if (accounts.length === 0) {
    const empty = document.createElement('p');
    empty.id = 'accountsEmpty';
    empty.textContent = 'No accounts saved yet.';
    accountsListEl.appendChild(empty);
    return;
  }
  for (const account of accounts) {
    const isActive = account.apiKey === settings.apiKey;
    const row = document.createElement('div');
    row.className = 'account-row';
    const label = document.createElement('span');
    label.className = 'account-email';
    label.textContent = account.gmailEmail;
    if (isActive) {
      const tag = document.createElement('span');
      tag.className = 'account-active-tag';
      tag.textContent = 'Active';
      label.appendChild(tag);
    }
    const actions = document.createElement('div');
    actions.className = 'account-actions';
    if (!isActive) {
      const switchBtn = document.createElement('button');
      switchBtn.className = 'mt-btn mt-btn-ghost';
      switchBtn.textContent = 'Switch to';
      switchBtn.addEventListener('click', async () => {
        await switchToSavedAccount(account.gmailEmail);
        accountsStatusEl.textContent = `Switched to ${account.gmailEmail}.`;
        await refreshView();
      });
      actions.appendChild(switchBtn);
    }
    const removeBtn = document.createElement('button');
    removeBtn.className = 'mt-btn mt-btn-ghost';
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', async () => {
      await removeSavedAccount(account.gmailEmail);
      accountsStatusEl.textContent = `Removed ${account.gmailEmail}.`;
      await renderAccounts();
    });
    actions.appendChild(removeBtn);
    row.append(label, actions);
    accountsListEl.appendChild(row);
  }
}

document.getElementById('saveCurrentAccount')?.addEventListener('click', async () => {
  const gmailEmail = saveAccountGmailEmailInput.value.trim().toLowerCase();
  if (!gmailEmail) return;
  const settings = await getSettings();
  if (!settings.apiKey) return;
  await upsertSavedAccount({ gmailEmail, apiKey: settings.apiKey, accountEmail: settings.accountEmail });
  saveAccountGmailEmailInput.value = '';
  accountsStatusEl.textContent = `Saved. Opening ${gmailEmail} in Gmail will now switch to this MailTrack identity automatically.`;
  await renderAccounts();
});

async function startCheckout(plan: 'monthly' | 'yearly'): Promise<void> {
  const settings = await getSettings();
  if (!settings.apiKey) return;
  billingStatusEl.textContent = 'Opening checkout…';
  try {
    const { checkoutUrl } = await createCheckout(settings.apiKey, { plan });
    chrome.tabs.create({ url: checkoutUrl });
    billingStatusEl.textContent = 'Complete your payment in the new tab, then come back and refresh this page.';
  } catch {
    billingStatusEl.textContent = 'Could not start checkout. Try again in a moment.';
  }
}

subscribeMonthlyBtn.addEventListener('click', () => startCheckout('monthly'));
subscribeYearlyBtn.addEventListener('click', () => startCheckout('yearly'));

cancelSubscriptionBtn.addEventListener('click', async () => {
  if (!confirm('Cancel your MailTrack subscription? You can resubscribe anytime.')) return;
  const settings = await getSettings();
  if (!settings.apiKey) return;
  cancelSubscriptionBtn.disabled = true;
  billingStatusEl.textContent = 'Cancelling…';
  try {
    const { message } = await cancelSubscription(settings.apiKey);
    billingStatusEl.textContent = message;
    await refreshBillingStatus(settings.apiKey);
  } catch {
    billingStatusEl.textContent = 'Could not cancel your subscription. Try again in a moment.';
  } finally {
    cancelSubscriptionBtn.disabled = false;
  }
});

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

document.getElementById('googleSignIn')?.addEventListener('click', async () => {
  const googleBtn = document.getElementById('googleSignIn') as HTMLButtonElement | null;
  if (googleBtn) googleBtn.disabled = true;
  showAuthMessage('Continuing with Google…', false);
  await handleAuthResult(await signInWithGoogle());
  if (googleBtn) googleBtn.disabled = false;
});

togglePasswordBtn.addEventListener('click', () => {
  const showing = passwordInput.type === 'text';
  passwordInput.type = showing ? 'password' : 'text';
  togglePasswordBtn.textContent = showing ? 'Show' : 'Hide';
  togglePasswordBtn.setAttribute('aria-pressed', String(!showing));
  togglePasswordBtn.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
});

forgotPasswordBtn.addEventListener('click', async () => {
  const email = emailInput.value.trim();
  if (!email) {
    showAuthMessage('Enter your email above first, then click "Forgot password?"', true);
    return;
  }
  forgotPasswordBtn.disabled = true;
  showAuthMessage('Sending reset link…', false);
  await requestPasswordReset(email);
  forgotPasswordBtn.disabled = false;
  // Deliberately the SAME message regardless of whether the email actually
  // has an account — a "forgot password" form that says "no account with
  // that email" lets anyone enumerate registered addresses. Supabase's own
  // resetPasswordForEmail behaves the same way for this exact reason.
  showAuthMessage('If an account exists for that email, a reset link is on its way.', false);
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
  // Clamp to the same [1, 90] range the inputs enforce visually — a pasted
  // or programmatically-set out-of-range value shouldn't silently persist.
  const notOpenedDays = Math.min(90, Math.max(1, Number(followUpNotOpenedDaysInput.value) || 3));
  const openedNoReplyDays = Math.min(90, Math.max(1, Number(followUpOpenedNoReplyDaysInput.value) || 5));
  const notifyToggles = Object.fromEntries(
    NOTIFY_TOGGLE_KEYS.map((key) => [key, (document.getElementById(key) as HTMLInputElement | null)?.checked ?? true]),
  ) as Record<(typeof NOTIFY_TOGGLE_KEYS)[number], boolean>;
  await setSettings({
    trackingEnabledByDefault: trackingEnabledInput.checked,
    notificationsEnabled: notificationsEnabledInput.checked,
    bounceDetectionEnabled: bounceDetectionEnabledInput.checked,
    followUpNotOpenedDays: notOpenedDays,
    followUpOpenedNoReplyDays: openedNoReplyDays,
    individualTrackingForGroupEmails: individualTrackingForGroupEmailsInput.checked,
    checkLinksForSafety: checkLinksForSafetyInput.checked,
    ...notifyToggles,
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
