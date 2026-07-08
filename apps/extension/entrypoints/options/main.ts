import { deleteMessage, exportMessageCsv } from '../../src/api-client';
import { getSettings, setSettings } from '../../src/storage';

const apiKeyInput = document.getElementById('apiKey') as HTMLInputElement;
const trackingEnabledInput = document.getElementById('trackingEnabled') as HTMLInputElement;
const notificationsEnabledInput = document.getElementById('notificationsEnabled') as HTMLInputElement;
const statusEl = document.getElementById('status') as HTMLDivElement;

async function loadSettings(): Promise<void> {
  const settings = await getSettings();
  apiKeyInput.value = settings.apiKey ?? '';
  trackingEnabledInput.checked = settings.trackingEnabledByDefault;
  notificationsEnabledInput.checked = settings.notificationsEnabled;
}

document.getElementById('save')?.addEventListener('click', async () => {
  await setSettings({
    apiKey: apiKeyInput.value.trim() || null,
    trackingEnabledByDefault: trackingEnabledInput.checked,
    notificationsEnabled: notificationsEnabledInput.checked,
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

loadSettings();
