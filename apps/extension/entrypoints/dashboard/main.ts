import { getMessageTimeline, listMessages } from '../../src/api-client';
import { formatSentAt, truncateSubject } from '../../src/dashboard-format';
import { getSettings } from '../../src/storage';
import { describeStatus } from '../../src/status-chip';
import type { MessageSummary } from '@mailtrack/shared';

const signedOutNotice = document.getElementById('signedOutNotice') as HTMLParagraphElement;
const loadingEl = document.getElementById('loading') as HTMLParagraphElement;
const content = document.getElementById('content') as HTMLDivElement;
const tbody = document.getElementById('messageTableBody') as HTMLTableSectionElement;
const emptyState = document.getElementById('emptyState') as HTMLParagraphElement;
const loadMoreButton = document.getElementById('loadMore') as HTMLButtonElement;
const refreshButton = document.getElementById('refresh') as HTMLButtonElement;
const statTotalEl = document.getElementById('statTotal') as HTMLDivElement;
const statOpenedEl = document.getElementById('statOpened') as HTMLDivElement;
const statClickedEl = document.getElementById('statClicked') as HTMLDivElement;
const COLUMN_COUNT = 5;

let apiKey: string | null = null;
let nextOffset: number | null = 0;
// Per-row expanded timeline is fetched once and cached — repeated clicks
// just toggle visibility rather than re-fetching.
const expandedRows = new Map<string, HTMLTableRowElement>();
// Summary stats accumulate across whatever pages have been loaded so far —
// labeled "loaded messages" rather than claiming to be an all-time total
// that hasn't actually been fetched yet.
let totalLoaded = 0;
let totalOpened = 0;
let totalClicked = 0;

async function init(): Promise<void> {
  const settings = await getSettings();
  apiKey = settings.apiKey;
  loadingEl.style.display = 'none';

  if (!apiKey) {
    signedOutNotice.classList.add('visible');
    return;
  }

  content.style.display = '';
  await loadPage();
}

async function resetAndReload(): Promise<void> {
  tbody.innerHTML = '';
  expandedRows.clear();
  nextOffset = 0;
  totalLoaded = 0;
  totalOpened = 0;
  totalClicked = 0;
  updateSummary();
  await loadPage();
}

function updateSummary(): void {
  statTotalEl.textContent = String(totalLoaded);
  statOpenedEl.textContent = String(totalOpened);
  statClickedEl.textContent = String(totalClicked);
}

function countCell(count: number): HTMLTableCellElement {
  const cell = document.createElement('td');
  cell.className = count > 0 ? 'count' : 'count zero';
  cell.textContent = String(count);
  return cell;
}

function buildRow(message: MessageSummary): HTMLTableRowElement {
  const row = document.createElement('tr');
  row.className = 'message-row';

  const { color, tooltip } = describeStatus(message.status);
  const statusCell = document.createElement('td');
  const badge = document.createElement('span');
  badge.className = 'badge';
  badge.style.color = color;
  badge.style.background = `${color}1a`; // ~10% tint of the status color
  badge.title = tooltip;
  badge.innerHTML = `<span class="dot" style="background:${color}"></span>${message.status}`;
  statusCell.appendChild(badge);

  const subjectCell = document.createElement('td');
  subjectCell.className = 'subject';
  subjectCell.textContent = truncateSubject(message.subject);
  subjectCell.title = message.subject ?? '';

  const sentCell = document.createElement('td');
  sentCell.className = 'muted';
  sentCell.textContent = formatSentAt(message.sentAt);

  row.append(statusCell, subjectCell, sentCell, countCell(message.openCount), countCell(message.clickCount));
  row.addEventListener('click', () => toggleDetail(message, row));
  return row;
}

async function loadPage(): Promise<void> {
  if (!apiKey || nextOffset === null) return;
  loadMoreButton.style.display = 'none';

  const { messages, nextOffset: newNextOffset } = await listMessages(apiKey, nextOffset);
  nextOffset = newNextOffset;

  for (const message of messages) {
    tbody.appendChild(buildRow(message));
    totalLoaded++;
    if (message.openCount > 0) totalOpened++;
    if (message.clickCount > 0) totalClicked++;
  }
  updateSummary();

  emptyState.style.display = tbody.children.length === 0 ? '' : 'none';
  loadMoreButton.style.display = nextOffset !== null ? '' : 'none';
}

async function toggleDetail(message: MessageSummary, row: HTMLTableRowElement): Promise<void> {
  const existing = expandedRows.get(message.msgId);
  if (existing) {
    existing.style.display = existing.style.display === 'none' ? '' : 'none';
    return;
  }
  if (!apiKey) return;

  const detailRow = document.createElement('tr');
  detailRow.className = 'detail-row';
  const cell = document.createElement('td');
  cell.colSpan = COLUMN_COUNT;

  const meta = document.createElement('div');
  meta.className = 'detail-meta';
  const idLabel = document.createElement('span');
  idLabel.textContent = 'Message ID:';
  const idValue = document.createElement('code');
  idValue.className = 'msg-id';
  idValue.textContent = message.msgId;
  const copyBtn = document.createElement('button');
  copyBtn.className = 'copy-btn';
  copyBtn.textContent = 'Copy';
  copyBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    navigator.clipboard.writeText(message.msgId).then(() => {
      copyBtn.textContent = 'Copied';
      setTimeout(() => (copyBtn.textContent = 'Copy'), 1500);
    });
  });
  meta.append(idLabel, idValue, copyBtn);

  const stats = document.createElement('div');
  stats.className = 'detail-stats';
  stats.innerHTML = `
    <span>Opened <strong>${message.openCount}</strong> time${message.openCount === 1 ? '' : 's'}</span>
    <span>Clicked <strong>${message.clickCount}</strong> time${message.clickCount === 1 ? '' : 's'}</span>
    ${message.firstOpenedAt ? `<span>First opened <strong>${formatSentAt(message.firstOpenedAt)}</strong></span>` : ''}
    ${message.lastOpenedAt && message.lastOpenedAt !== message.firstOpenedAt ? `<span>Last opened <strong>${formatSentAt(message.lastOpenedAt)}</strong></span>` : ''}
  `;

  const timelineHeader = document.createElement('div');
  timelineHeader.className = 'muted';
  timelineHeader.style.marginBottom = '0.4rem';
  timelineHeader.textContent = 'Event timeline';

  const timelineContainer = document.createElement('div');
  timelineContainer.textContent = 'Loading timeline…';

  cell.append(meta, stats, timelineHeader, timelineContainer);
  detailRow.appendChild(cell);
  row.after(detailRow);
  expandedRows.set(message.msgId, detailRow);

  try {
    const { events } = await getMessageTimeline(apiKey, message.msgId);
    timelineContainer.innerHTML = '';
    if (events.length === 0) {
      timelineContainer.textContent = 'No events yet.';
    }
    for (const event of events) {
      const eventEl = document.createElement('div');
      eventEl.className = event.suppressed ? 'event suppressed' : 'event';
      const kindLabel = event.kind === 'link_click' ? 'Click' : 'Pixel fetch';
      eventEl.innerHTML = `<span class="verdict">${kindLabel} — ${event.verdict}</span> (${formatSentAt(event.occurredAt)})<br/><span class="reason">${escapeHtml(event.reason)}</span>`;
      timelineContainer.appendChild(eventEl);
    }
  } catch {
    timelineContainer.textContent = 'Could not load this message’s timeline. Try again later.';
  }
}

function escapeHtml(input: string): string {
  const div = document.createElement('div');
  div.textContent = input;
  return div.innerHTML;
}

loadMoreButton.addEventListener('click', loadPage);
refreshButton.addEventListener('click', resetAndReload);

init();
