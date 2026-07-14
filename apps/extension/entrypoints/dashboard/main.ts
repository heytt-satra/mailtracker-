import { getMessageTimeline, getReports, listMessages } from '../../src/api-client';
import { formatSentAt, truncateSubject } from '../../src/dashboard-format';
import { getFollowUpSuggestion, type FollowUpThresholds } from '../../src/follow-up';
import { getSettings } from '../../src/storage';
import { describeStatus } from '../../src/status-chip';
import { describeReadConfidence } from '../../src/read-confidence-chip';
import { buildReportPdf, reportPdfFilename } from '../../src/report-pdf';
import type { MessageSummary, ReportPeriod, ReportsResponse } from '@mailtrack/shared';

const signedOutNotice = document.getElementById('signedOutNotice') as HTMLParagraphElement;
const loadingEl = document.getElementById('loading') as HTMLParagraphElement;
const content = document.getElementById('content') as HTMLDivElement;
const tbody = document.getElementById('messageTableBody') as HTMLTableSectionElement;
const emptyState = document.getElementById('emptyState') as HTMLParagraphElement;
const filteredEmptyState = document.getElementById('filteredEmptyState') as HTMLParagraphElement;
const loadMoreButton = document.getElementById('loadMore') as HTMLButtonElement;
const refreshButton = document.getElementById('refresh') as HTMLButtonElement;
const searchInput = document.getElementById('searchInput') as HTMLInputElement;
const statusFilter = document.getElementById('statusFilter') as HTMLSelectElement;
const statTotalEl = document.getElementById('statTotal') as HTMLDivElement;
const statOpenedEl = document.getElementById('statOpened') as HTMLDivElement;
const statClickedEl = document.getElementById('statClicked') as HTMLDivElement;
const statFollowUpEl = document.getElementById('statFollowUp') as HTMLDivElement;

const tabRow = document.getElementById('tabRow') as HTMLDivElement;
const messagesTab = document.getElementById('messagesTab') as HTMLButtonElement;
const reportsTab = document.getElementById('reportsTab') as HTMLButtonElement;
const reportsPanel = document.getElementById('reportsPanel') as HTMLDivElement;
const reportPeriodSelect = document.getElementById('reportPeriod') as HTMLSelectElement;
const reportVolumeChangeEl = document.getElementById('reportVolumeChange') as HTMLSpanElement;
const reportLoadingEl = document.getElementById('reportLoading') as HTMLDivElement;
const reportBodyEl = document.getElementById('reportBody') as HTMLDivElement;
const reportTotalSentEl = document.getElementById('reportTotalSent') as HTMLDivElement;
const reportOpenRateEl = document.getElementById('reportOpenRate') as HTMLDivElement;
const reportClickRateEl = document.getElementById('reportClickRate') as HTMLDivElement;
const reportReplyRateEl = document.getElementById('reportReplyRate') as HTMLDivElement;
const reportBounceRateEl = document.getElementById('reportBounceRate') as HTMLDivElement;
const reportBouncesEl = document.getElementById('reportBounces') as HTMLDivElement;
const reportRepliesEl = document.getElementById('reportReplies') as HTMLDivElement;
const reportTotalOpensEl = document.getElementById('reportTotalOpens') as HTMLDivElement;
const reportTotalClicksEl = document.getElementById('reportTotalClicks') as HTMLDivElement;
const reportTimeToOpenEl = document.getElementById('reportTimeToOpen') as HTMLDivElement;
const reportMedianTimeToOpenEl = document.getElementById('reportMedianTimeToOpen') as HTMLDivElement;
const reportNotVerifiableEl = document.getElementById('reportNotVerifiable') as HTMLDivElement;
const hourHeatmapEl = document.getElementById('hourHeatmap') as HTMLDivElement;
const dayHeatmapEl = document.getElementById('dayHeatmap') as HTMLDivElement;
const breakdownBarEl = document.getElementById('breakdownBar') as HTMLDivElement;
const breakdownLegendEl = document.getElementById('breakdownLegend') as HTMLDivElement;
const topRecipientsBody = document.getElementById('topRecipientsBody') as HTMLTableSectionElement;
const reportEmptyEl = document.getElementById('reportEmpty') as HTMLParagraphElement;
const downloadReportPdfButton = document.getElementById('downloadReportPdf') as HTMLButtonElement;

const DAY_LABELS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** Fixed, honesty-consistent colors — 'read'/'likely_read' are the two shades of verified engagement, the rest are explicitly not a read. */
const READ_CONFIDENCE_COLORS = { read: '#1a7f37', likelyRead: '#4c9a5f', glanced: '#c9a227', notVerifiable: '#9aa0a6', pending: '#d0d5db' } as const;

let lastReport: ReportsResponse | null = null;

const COLUMN_COUNT = 6;
const POLL_INTERVAL_MS = 5000;
const PAGE_SIZE = 50; // must match apps/backend LIST_PAGE_SIZE

let apiKey: string | null = null;
let nextOffset: number | null = 0;
let pollTimer: ReturnType<typeof setInterval> | null = null;
// Read once at init from settings — the dashboard doesn't itself edit these
// (that's the options page), so a snapshot is enough for the session.
let followUpThresholds: FollowUpThresholds = { notOpenedDays: 3, openedNoReplyDays: 5 };

// Source of truth for everything currently rendered — polling updates these
// maps in place rather than tearing down and rebuilding the table, so an
// expanded detail row survives a background refresh instead of collapsing
// out from under whoever's reading it.
const messagesById = new Map<string, MessageSummary>();
const rowsById = new Map<string, HTMLTableRowElement>();
// Expanded timeline rows, fetched once and cached — repeated clicks just
// toggle visibility rather than re-fetching.
const expandedRows = new Map<string, HTMLTableRowElement>();

async function init(): Promise<void> {
  const settings = await getSettings();
  apiKey = settings.apiKey;
  followUpThresholds = { notOpenedDays: settings.followUpNotOpenedDays, openedNoReplyDays: settings.followUpOpenedNoReplyDays };
  loadingEl.style.display = 'none';

  if (!apiKey) {
    signedOutNotice.classList.add('visible');
    return;
  }

  tabRow.style.display = '';
  content.style.display = '';
  await loadPage();
  startPolling();
}

function showMessagesTab(): void {
  messagesTab.classList.add('active');
  reportsTab.classList.remove('active');
  content.style.display = '';
  reportsPanel.classList.remove('visible');
}

function showReportsTab(): void {
  reportsTab.classList.add('active');
  messagesTab.classList.remove('active');
  content.style.display = 'none';
  reportsPanel.classList.add('visible');
  loadReport().catch(() => {
    reportLoadingEl.textContent = 'Could not load the report. Try again in a moment.';
  });
}

messagesTab.addEventListener('click', showMessagesTab);
reportsTab.addEventListener('click', showReportsTab);
reportPeriodSelect.addEventListener('change', () => {
  loadReport().catch(() => {
    reportLoadingEl.textContent = 'Could not load the report. Try again in a moment.';
  });
});

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hours = minutes / 60;
  if (hours < 24) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

async function loadReport(): Promise<void> {
  if (!apiKey) return;
  reportLoadingEl.style.display = '';
  reportLoadingEl.textContent = 'Loading report…';
  reportBodyEl.style.display = 'none';
  downloadReportPdfButton.disabled = true;

  const period = reportPeriodSelect.value as ReportPeriod;
  const report = await getReports(apiKey, period);
  lastReport = report;
  const { current, volumeChangePercent } = report;

  reportTotalSentEl.textContent = String(current.totalSent);
  reportOpenRateEl.textContent = `${Math.round(current.openRate * 100)}%`;
  reportClickRateEl.textContent = `${Math.round(current.clickThroughRate * 100)}%`;
  reportReplyRateEl.textContent = `${Math.round(current.replyRate * 100)}%`;
  reportBounceRateEl.textContent = `${Math.round(current.bounceRate * 100)}%`;
  reportBouncesEl.textContent = String(current.bounceCount);
  reportRepliesEl.textContent = String(current.repliedCount);
  reportTotalOpensEl.textContent = String(current.totalOpens);
  reportTotalClicksEl.textContent = String(current.totalClicks);
  reportTimeToOpenEl.textContent = current.avgTimeToOpenMinutes !== null ? formatMinutes(current.avgTimeToOpenMinutes) : '—';
  reportMedianTimeToOpenEl.textContent = current.medianTimeToOpenMinutes !== null ? formatMinutes(current.medianTimeToOpenMinutes) : '—';
  reportNotVerifiableEl.textContent = String(current.notVerifiableCount);

  if (volumeChangePercent === null) {
    reportVolumeChangeEl.textContent = '';
    reportVolumeChangeEl.className = 'report-volume-change';
  } else {
    const sign = volumeChangePercent >= 0 ? '+' : '';
    reportVolumeChangeEl.textContent = `${sign}${volumeChangePercent}% vs previous period`;
    reportVolumeChangeEl.className = `report-volume-change ${volumeChangePercent >= 0 ? 'up' : 'down'}`;
  }

  renderReadConfidenceBreakdown(current.readConfidenceBreakdown, current.totalSent);

  hourHeatmapEl.innerHTML = '';
  const maxHourCount = Math.max(1, ...current.sendsByHourUtc);
  for (const count of current.sendsByHourUtc) {
    const bar = document.createElement('div');
    bar.className = 'hour-bar';
    bar.style.height = `${Math.max(2, (count / maxHourCount) * 80)}px`;
    bar.title = `${count} sent`;
    hourHeatmapEl.appendChild(bar);
  }

  dayHeatmapEl.innerHTML = '';
  const maxDayCount = Math.max(1, ...current.sendsByDayOfWeekUtc);
  current.sendsByDayOfWeekUtc.forEach((count, i) => {
    const wrap = document.createElement('div');
    wrap.className = 'day-bar-wrap';
    const bar = document.createElement('div');
    bar.className = 'day-bar';
    bar.style.height = `${Math.max(2, (count / maxDayCount) * 60)}px`;
    bar.title = `${count} sent`;
    const label = document.createElement('div');
    label.className = 'day-bar-label';
    label.textContent = DAY_LABELS_SHORT[i]!;
    wrap.appendChild(bar);
    wrap.appendChild(label);
    dayHeatmapEl.appendChild(wrap);
  });

  topRecipientsBody.innerHTML = '';
  for (const r of current.topRecipients) {
    const row = document.createElement('tr');
    row.innerHTML = `<td>${escapeHtml(r.recipient)}</td><td>${r.sentCount}</td><td>${r.openedCount}</td><td>${Math.round(r.openRate * 100)}%</td>`;
    topRecipientsBody.appendChild(row);
  }

  reportEmptyEl.classList.toggle('visible', current.totalSent === 0);
  reportLoadingEl.style.display = 'none';
  reportBodyEl.style.display = '';
  downloadReportPdfButton.disabled = current.totalSent === 0;
}

function renderReadConfidenceBreakdown(breakdown: ReportsResponse['current']['readConfidenceBreakdown'], totalSent: number): void {
  breakdownBarEl.innerHTML = '';
  breakdownLegendEl.innerHTML = '';

  const segments: [keyof typeof READ_CONFIDENCE_COLORS, string, number][] = [
    ['read', 'Read', breakdown.read],
    ['likelyRead', 'Likely read', breakdown.likelyRead],
    ['glanced', 'Glanced', breakdown.glanced],
    ['notVerifiable', 'Not verifiable', breakdown.notVerifiable],
    ['pending', 'Pending', breakdown.pending],
  ];

  for (const [key, label, count] of segments) {
    if (count === 0) continue;
    const share = totalSent > 0 ? count / totalSent : 0;
    const seg = document.createElement('div');
    seg.className = 'breakdown-seg';
    seg.style.width = `${share * 100}%`;
    seg.style.background = READ_CONFIDENCE_COLORS[key];
    seg.title = `${label}: ${count} (${Math.round(share * 100)}%)`;
    breakdownBarEl.appendChild(seg);

    const legendItem = document.createElement('span');
    legendItem.className = 'legend-item';
    legendItem.innerHTML = `<span class="dot" style="background:${READ_CONFIDENCE_COLORS[key]}"></span>${escapeHtml(label)}: ${count}`;
    breakdownLegendEl.appendChild(legendItem);
  }

  if (totalSent === 0) {
    const seg = document.createElement('div');
    seg.className = 'breakdown-seg';
    seg.style.width = '100%';
    seg.style.background = READ_CONFIDENCE_COLORS.pending;
    breakdownBarEl.appendChild(seg);
  }
}

downloadReportPdfButton.addEventListener('click', () => {
  if (!lastReport) return;
  const doc = buildReportPdf(lastReport, new Date().toISOString());
  doc.save(reportPdfFilename(lastReport.period, lastReport.rangeEnd));
});

function startPolling(): void {
  stopPolling();
  pollTimer = setInterval(() => {
    if (document.visibilityState !== 'visible') return; // no point burning API calls on a background tab
    pollRefresh().catch(() => {
      // A failed poll must never surface as an error to the user — it just means the next tick tries again.
    });
  }, POLL_INTERVAL_MS);
}

// Registered once at module scope, not inside startPolling() — that gets
// called again on every manual "Refresh now" click, and re-registering this
// listener each time would stack up duplicate handlers, firing pollRefresh()
// multiple times per visibility change.
document.addEventListener('visibilitychange', () => {
  // Catch up immediately when the tab regains focus, rather than waiting up to POLL_INTERVAL_MS.
  if (document.visibilityState === 'visible') pollRefresh().catch(() => {});
});

function stopPolling(): void {
  if (pollTimer !== null) clearInterval(pollTimer);
  pollTimer = null;
}

async function resetAndReload(): Promise<void> {
  tbody.innerHTML = '';
  expandedRows.clear();
  messagesById.clear();
  rowsById.clear();
  nextOffset = 0;
  await loadPage();
}

/** Client-side filter over already-loaded rows — no extra API calls, since everything visible is already in messagesById. */
function matchesFilter(message: MessageSummary): boolean {
  const query = searchInput.value.trim().toLowerCase();
  if (query) {
    const haystack = `${message.recipient ?? ''} ${message.subject ?? ''}`.toLowerCase();
    if (!haystack.includes(query)) return false;
  }

  const filter = statusFilter.value;
  if (!filter) return true;
  if (filter === 'replied') return message.reply !== null;
  if (filter === 'bounced') return message.bounce !== null;
  if (filter === 'read') return message.readConfidence === 'read';
  if (filter === 'likely_read') return message.readConfidence === 'likely_read';
  if (filter === 'not_verifiable') return message.readConfidence === 'not_verifiable';
  if (filter === 'needs_followup') return getFollowUpSuggestion(message, Date.now(), followUpThresholds) !== null;
  return true;
}

/** Re-applies search/status filtering to every currently-rendered row — called after any render mutation and on every filter-input change. */
function applyFilter(): void {
  let visibleCount = 0;
  for (const [msgId, row] of rowsById) {
    const message = messagesById.get(msgId);
    const visible = message ? matchesFilter(message) : false;
    row.style.display = visible ? '' : 'none';
    if (!visible) {
      const detail = expandedRows.get(msgId);
      if (detail) detail.style.display = 'none';
    }
    if (visible) visibleCount++;
  }
  filteredEmptyState.style.display = tbody.children.length > 0 && visibleCount === 0 ? '' : 'none';
}

function updateSummary(): void {
  const all = [...messagesById.values()];
  const now = Date.now();
  statTotalEl.textContent = String(all.length);
  statOpenedEl.textContent = String(all.filter((m) => m.openCount > 0).length);
  statClickedEl.textContent = String(all.filter((m) => m.clickCount > 0).length);
  statFollowUpEl.textContent = String(all.filter((m) => getFollowUpSuggestion(m, now, followUpThresholds) !== null).length);
}

function countCell(count: number): HTMLTableCellElement {
  const cell = document.createElement('td');
  cell.className = count > 0 ? 'count' : 'count zero';
  cell.textContent = String(count);
  return cell;
}

/** Applies a message's current data to an existing row's cells — used by both first render and every poll refresh. */
function paintRow(row: HTMLTableRowElement, message: MessageSummary): void {
  const { color, tooltip } = describeStatus(message.status);
  const [statusCell, readConfidenceCell, identifierCell, sentCell, opensCell, clicksCell] = Array.from(
    row.children,
  ) as HTMLTableCellElement[];

  // A bounce is more important than the ordinary status ladder and
  // deliberately overrides its display (ADR-20): "sent" would otherwise sit
  // there looking normal forever for a message that never actually arrived.
  statusCell.innerHTML = message.bounce
    ? `<span class="badge" style="color:#d93025;background:#d9302533" title="${escapeHtml(message.bounce.reason)}"><span class="dot" style="background:#d93025"></span>Bounced</span>`
    : `<span class="badge" style="color:${color};background:${color}1a" title="${tooltip}"><span class="dot" style="background:${color}"></span>${message.status}</span>`;

  const readChip = describeReadConfidence(message.readConfidence);
  readConfidenceCell.innerHTML = readChip
    ? `<span class="badge" style="color:${readChip.color};background:${readChip.color}1a" title="${escapeHtml(message.readEvidence ?? '')}"><span class="dot" style="background:${readChip.color}"></span>${readChip.label}</span>`
    : '<span class="muted">—</span>';

  identifierCell.className = 'identifier';
  identifierCell.title = message.recipient ?? '';
  identifierCell.innerHTML = '';
  const primary = document.createElement('div');
  primary.textContent = message.recipient || '(no recipient)';
  const followUp = getFollowUpSuggestion(message, Date.now(), followUpThresholds);
  if (followUp) {
    const badge = document.createElement('span');
    badge.className = 'follow-up-badge';
    badge.title = followUp.text;
    badge.textContent = '⏰ Follow up';
    primary.appendChild(badge);
  }
  identifierCell.appendChild(primary);
  if (message.subject) {
    const subjectLine = document.createElement('span');
    subjectLine.className = 'subject-line';
    subjectLine.textContent = truncateSubject(message.subject, 60);
    identifierCell.appendChild(subjectLine);
  }

  sentCell.className = 'muted';
  sentCell.textContent = formatSentAt(message.sentAt);

  opensCell.className = message.openCount > 0 ? 'count' : 'count zero';
  opensCell.textContent = String(message.openCount);
  clicksCell.className = message.clickCount > 0 ? 'count' : 'count zero';
  clicksCell.textContent = String(message.clickCount);
}

function buildRow(message: MessageSummary): HTMLTableRowElement {
  const row = document.createElement('tr');
  row.className = 'message-row';
  // Placeholder cells — paintRow fills them in immediately below, but the
  // element references need to exist first since paintRow reads row.children.
  row.append(
    document.createElement('td'),
    document.createElement('td'),
    document.createElement('td'),
    document.createElement('td'),
    countCell(0),
    countCell(0),
  );
  paintRow(row, message);
  row.addEventListener('click', () => toggleDetail(message.msgId, row));
  return row;
}

async function loadPage(): Promise<void> {
  if (!apiKey || nextOffset === null) return;
  loadMoreButton.style.display = 'none';

  const { messages, nextOffset: newNextOffset } = await listMessages(apiKey, nextOffset);
  nextOffset = newNextOffset;

  for (const message of messages) {
    messagesById.set(message.msgId, message);
    const row = buildRow(message);
    rowsById.set(message.msgId, row);
    tbody.appendChild(row);
  }
  updateSummary();

  emptyState.style.display = tbody.children.length === 0 ? '' : 'none';
  loadMoreButton.style.display = nextOffset !== null ? '' : 'none';
  applyFilter();
}

/** Re-fetches every currently-loaded page and updates rows in place — new messages get prepended, existing ones repainted, nothing collapses. */
async function pollRefresh(): Promise<void> {
  if (!apiKey) return;
  const pagesLoaded = Math.max(1, Math.ceil(messagesById.size / PAGE_SIZE));
  const seenThisPoll = new Set<string>();

  for (let page = 0; page < pagesLoaded; page++) {
    const { messages } = await listMessages(apiKey, page * PAGE_SIZE);
    for (const message of messages) {
      seenThisPoll.add(message.msgId);
      messagesById.set(message.msgId, message);
      const existingRow = rowsById.get(message.msgId);
      if (existingRow) {
        paintRow(existingRow, message);
      } else {
        // A genuinely new message appeared since the last load — list is
        // newest-first, so it belongs at the top.
        const row = buildRow(message);
        rowsById.set(message.msgId, row);
        tbody.prepend(row);
      }
    }
    if (messages.length < PAGE_SIZE) break;
  }

  updateSummary();
  emptyState.style.display = tbody.children.length === 0 ? '' : 'none';
  applyFilter();
}

async function toggleDetail(msgId: string, row: HTMLTableRowElement): Promise<void> {
  const existing = expandedRows.get(msgId);
  if (existing) {
    existing.style.display = existing.style.display === 'none' ? '' : 'none';
    return;
  }
  if (!apiKey) return;
  const message = messagesById.get(msgId);
  if (!message) return;

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
  // ADR-22: show distinct viewing sessions alongside raw opens — "5 opens
  // across 3 sessions" is the honest answer to "how many times did they open it".
  const opensLabel =
    message.sessionCount && message.sessionCount !== message.openCount
      ? `<span>Opened <strong>${message.openCount}</strong> time${message.openCount === 1 ? '' : 's'} across <strong>${message.sessionCount}</strong> session${message.sessionCount === 1 ? '' : 's'}</span>`
      : `<span>Opened <strong>${message.openCount}</strong> time${message.openCount === 1 ? '' : 's'}</span>`;
  stats.innerHTML = `
    ${message.subject ? `<span>Subject <strong>${escapeHtml(message.subject)}</strong></span>` : ''}
    ${opensLabel}
    <span>Clicked <strong>${message.clickCount}</strong> time${message.clickCount === 1 ? '' : 's'}</span>
    ${message.firstOpenedAt ? `<span>First opened <strong>${formatSentAt(message.firstOpenedAt)}</strong></span>` : ''}
    ${message.lastOpenedAt && message.lastOpenedAt !== message.firstOpenedAt ? `<span>Last opened <strong>${formatSentAt(message.lastOpenedAt)}</strong></span>` : ''}
    ${message.minEngagedSeconds !== null ? `<span>Engaged <strong>&ge; ${message.minEngagedSeconds}s</strong> (proven minimum)</span>` : ''}
    ${message.depthReached ? `<span>Depth <strong>reached the ${message.depthReached === 'bottom' ? 'end' : 'middle'} of a long message</strong></span>` : ''}
  `;

  let readEvidenceEl: HTMLDivElement | null = null;
  if (message.readEvidence) {
    readEvidenceEl = document.createElement('div');
    readEvidenceEl.className = 'read-evidence';
    const chip = describeReadConfidence(message.readConfidence);
    readEvidenceEl.innerHTML = chip
      ? `<span class="badge" style="color:${chip.color};background:${chip.color}1a"><span class="dot" style="background:${chip.color}"></span>${chip.label}</span> ${escapeHtml(message.readEvidence)}`
      : escapeHtml(message.readEvidence);
  }

  let bounceEvidenceEl: HTMLDivElement | null = null;
  if (message.bounce) {
    bounceEvidenceEl = document.createElement('div');
    bounceEvidenceEl.className = 'read-evidence';
    bounceEvidenceEl.innerHTML = `<span class="badge" style="color:#d93025;background:#d9302533"><span class="dot" style="background:#d93025"></span>Bounced</span> ${escapeHtml(message.bounce.reason)} (detected ${formatSentAt(message.bounce.detectedAt)})`;
  }

  let followUpEl: HTMLDivElement | null = null;
  const followUpSuggestion = getFollowUpSuggestion(message, Date.now(), followUpThresholds);
  if (followUpSuggestion) {
    followUpEl = document.createElement('div');
    followUpEl.className = 'read-evidence';
    followUpEl.innerHTML = `<span class="follow-up-badge">⏰ Follow up</span> ${escapeHtml(followUpSuggestion.text)}`;
  }

  const timelineHeader = document.createElement('div');
  timelineHeader.className = 'muted';
  timelineHeader.style.marginBottom = '0.4rem';
  timelineHeader.textContent = 'Event timeline';

  const timelineContainer = document.createElement('div');
  timelineContainer.textContent = 'Loading timeline…';

  cell.append(
    meta,
    stats,
    ...(bounceEvidenceEl ? [bounceEvidenceEl] : []),
    ...(readEvidenceEl ? [readEvidenceEl] : []),
    ...(followUpEl ? [followUpEl] : []),
    timelineHeader,
    timelineContainer,
  );
  detailRow.appendChild(cell);
  row.after(detailRow);
  expandedRows.set(msgId, detailRow);

  try {
    const { events } = await getMessageTimeline(apiKey, msgId);
    timelineContainer.innerHTML = '';
    if (events.length === 0) {
      timelineContainer.textContent = 'No events yet.';
    }
    for (const event of events) {
      const eventEl = document.createElement('div');
      eventEl.className = event.suppressed ? 'event suppressed' : 'event';
      const kindLabel = event.kind === 'link_click' ? 'Click' : 'Pixel fetch';
      // ADR-30: show WHICH link was clicked, not just "a link" — truncated so a long
      // tracking-redirect-laden URL doesn't blow out the row.
      const urlLine = event.clickedUrl ? `<br/><span class="reason clicked-url" title="${escapeHtml(event.clickedUrl)}">→ ${escapeHtml(truncateSubject(event.clickedUrl, 70))}</span>` : '';
      eventEl.innerHTML = `<span class="verdict">${kindLabel} — ${event.verdict}</span> (${formatSentAt(event.occurredAt)})<br/><span class="reason">${escapeHtml(event.reason)}</span>${urlLine}`;
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
refreshButton.addEventListener('click', () => {
  resetAndReload().then(() => startPolling());
});
searchInput.addEventListener('input', applyFilter);
statusFilter.addEventListener('change', applyFilter);

init();
