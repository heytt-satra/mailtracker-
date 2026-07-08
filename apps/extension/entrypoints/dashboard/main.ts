import { getMessageTimeline, listMessages } from '../../src/api-client';
import { formatSentAt, truncateSubject } from '../../src/dashboard-format';
import { getSettings } from '../../src/storage';
import { describeStatus } from '../../src/status-chip';

const signedOutNotice = document.getElementById('signedOutNotice') as HTMLParagraphElement;
const loadingEl = document.getElementById('loading') as HTMLParagraphElement;
const table = document.getElementById('messageTable') as HTMLTableElement;
const tbody = document.getElementById('messageTableBody') as HTMLTableSectionElement;
const emptyState = document.getElementById('emptyState') as HTMLParagraphElement;
const loadMoreButton = document.getElementById('loadMore') as HTMLButtonElement;

let apiKey: string | null = null;
let nextOffset: number | null = 0;
// Per-row expanded timeline is fetched once and cached — repeated clicks
// just toggle visibility rather than re-fetching.
const expandedRows = new Map<string, HTMLTableRowElement>();

async function init(): Promise<void> {
  const settings = await getSettings();
  apiKey = settings.apiKey;
  loadingEl.style.display = 'none';

  if (!apiKey) {
    signedOutNotice.classList.add('visible');
    return;
  }

  table.style.display = '';
  await loadPage();
}

async function loadPage(): Promise<void> {
  if (!apiKey || nextOffset === null) return;
  loadMoreButton.style.display = 'none';

  const { messages, nextOffset: newNextOffset } = await listMessages(apiKey, nextOffset);
  nextOffset = newNextOffset;

  for (const message of messages) {
    const row = document.createElement('tr');
    row.className = 'message-row';

    const { color, tooltip } = describeStatus(message.status);
    const statusCell = document.createElement('td');
    statusCell.innerHTML = `<span class="status-dot" style="background:${color}"></span>${message.status}`;
    statusCell.title = tooltip;

    const subjectCell = document.createElement('td');
    subjectCell.className = 'subject';
    subjectCell.textContent = truncateSubject(message.subject);
    subjectCell.title = message.subject ?? '';

    const sentCell = document.createElement('td');
    sentCell.textContent = formatSentAt(message.sentAt);

    row.append(statusCell, subjectCell, sentCell);
    row.addEventListener('click', () => toggleDetail(message.msgId, row));
    tbody.appendChild(row);
  }

  emptyState.style.display = tbody.children.length === 0 ? '' : 'none';
  loadMoreButton.style.display = nextOffset !== null ? '' : 'none';
}

async function toggleDetail(msgId: string, row: HTMLTableRowElement): Promise<void> {
  const existing = expandedRows.get(msgId);
  if (existing) {
    existing.style.display = existing.style.display === 'none' ? '' : 'none';
    return;
  }
  if (!apiKey) return;

  const detailRow = document.createElement('tr');
  detailRow.className = 'detail-row';
  const cell = document.createElement('td');
  cell.colSpan = 3;
  cell.textContent = 'Loading timeline…';
  detailRow.appendChild(cell);
  row.after(detailRow);
  expandedRows.set(msgId, detailRow);

  try {
    const { events } = await getMessageTimeline(apiKey, msgId);
    cell.innerHTML = '';
    if (events.length === 0) {
      cell.textContent = 'No events yet.';
    }
    for (const event of events) {
      const eventEl = document.createElement('div');
      eventEl.className = event.suppressed ? 'event suppressed' : 'event';
      const kindLabel = event.kind === 'link_click' ? 'Click' : 'Pixel fetch';
      eventEl.innerHTML = `<span class="verdict">${kindLabel} — ${event.verdict}</span> (${formatSentAt(event.occurredAt)})<br/><span class="reason">${escapeHtml(event.reason)}</span>`;
      cell.appendChild(eventEl);
    }
  } catch {
    cell.textContent = 'Could not load this message’s timeline. Try again later.';
  }
}

function escapeHtml(input: string): string {
  const div = document.createElement('div');
  div.textContent = input;
  return div.innerHTML;
}

loadMoreButton.addEventListener('click', loadPage);

init();
