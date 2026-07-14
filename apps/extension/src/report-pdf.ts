import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { ReportPeriod, ReportPeriodStats, ReportsResponse } from '@mailtrack/shared';

/** ADR-43. Same formatting as the dashboard's stat cards, kept here too since the PDF is generated standalone (no DOM element to read a formatted string back from). */
function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hours = minutes / 60;
  if (hours < 24) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

function pct(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * ADR-43 (detailed reports + PDF export). Builds a multi-section report
 * document entirely from already-fetched ReportsResponse data — no network
 * calls, no DOM screenshot (html2canvas would blur small text and bloat the
 * bundle); every number here is drawn straight from the same honest
 * aggregates the dashboard tab shows, just laid out for print/export.
 */
export function buildReportPdf(report: ReportsResponse, generatedAtIso: string): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const marginX = 40;
  let y = 50;

  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text('MailTrack Report', marginX, y);
  y += 22;

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(90);
  const periodLabel = report.period === 'month' ? 'Last 30 days' : 'Last 7 days';
  doc.text(`${periodLabel} · ${formatRangeLabel(report.rangeStart, report.rangeEnd)}`, marginX, y);
  y += 14;
  doc.text(`Generated ${new Date(generatedAtIso).toLocaleString()}`, marginX, y);
  y += 24;
  doc.setTextColor(0);

  y = drawSummarySection(doc, report, marginX, y);
  y = drawReadConfidenceSection(doc, report.current, marginX, y);
  y = drawTimeDistributionSection(doc, report.current, marginX, y);
  drawRecipientsSection(doc, report.current, marginX, y);

  addFooters(doc);
  return doc;
}

function formatRangeLabel(startIso: string, endIso: string): string {
  const fmt = (iso: string) => new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  return `${fmt(startIso)} – ${fmt(endIso)}`;
}

function ensureSpace(doc: jsPDF, y: number, needed: number): number {
  const pageHeight = doc.internal.pageSize.getHeight();
  if (y + needed > pageHeight - 40) {
    doc.addPage();
    return 50;
  }
  return y;
}

function sectionTitle(doc: jsPDF, title: string, x: number, y: number): number {
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(0);
  doc.text(title, x, y);
  doc.setFont('helvetica', 'normal');
  return y + 16;
}

function drawSummarySection(doc: jsPDF, report: ReportsResponse, x: number, startY: number): number {
  let y = sectionTitle(doc, 'Summary', x, startY);
  const c = report.current;

  const rows: [string, string][] = [
    ['Sent', String(c.totalSent)],
    ['Verified opens', `${c.verifiedOpenCount} (${pct(c.openRate)})`],
    ['Total opens (all fetches)', String(c.totalOpens)],
    ['Messages clicked', `${c.clickCount} (${pct(c.clickThroughRate)})`],
    ['Total clicks', String(c.totalClicks)],
    ['Replies', `${c.repliedCount} (${pct(c.replyRate)})`],
    ['Bounces', `${c.bounceCount} (${pct(c.bounceRate)})`],
    ['Not verifiable', String(c.notVerifiableCount)],
    ['Avg. time to open', c.avgTimeToOpenMinutes !== null ? formatMinutes(c.avgTimeToOpenMinutes) : 'No verified opens yet'],
    ['Median time to open', c.medianTimeToOpenMinutes !== null ? formatMinutes(c.medianTimeToOpenMinutes) : 'No verified opens yet'],
  ];
  if (report.volumeChangePercent !== null) {
    const sign = report.volumeChangePercent >= 0 ? '+' : '';
    rows.push(['Volume vs. previous period', `${sign}${report.volumeChangePercent}%`]);
  }

  autoTable(doc, {
    startY: y,
    margin: { left: x, right: x },
    tableWidth: 'wrap',
    body: rows,
    theme: 'plain',
    styles: { fontSize: 10, cellPadding: 3 },
    columnStyles: { 0: { fontStyle: 'bold' } },
  });

  return (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 24;
}

function drawReadConfidenceSection(doc: jsPDF, current: ReportPeriodStats, x: number, startY: number): number {
  let y = ensureSpace(doc, startY, 90);
  y = sectionTitle(doc, 'Read confidence breakdown', x, y);

  const b = current.readConfidenceBreakdown;
  const rows: [string, string][] = [
    ['Read (open + click, or a reply)', String(b.read)],
    ['Likely read (verified open)', String(b.likelyRead)],
    ['Glanced', String(b.glanced)],
    ['Not verifiable (honest abstention)', String(b.notVerifiable)],
    ['Pending (no verdict yet)', String(b.pending)],
  ];
  autoTable(doc, {
    startY: y,
    margin: { left: x, right: x },
    tableWidth: 'wrap',
    body: rows,
    theme: 'plain',
    styles: { fontSize: 10, cellPadding: 3 },
  });

  return (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 24;
}

function drawTimeDistributionSection(doc: jsPDF, current: ReportPeriodStats, x: number, startY: number): number {
  let y = ensureSpace(doc, startY, 140);
  y = sectionTitle(doc, 'When emails were sent', x, y);

  doc.setFontSize(9);
  doc.setTextColor(90);
  doc.text('By hour (UTC), sends per hour:', x, y);
  y += 12;
  const peakHour = current.sendsByHourUtc.reduce((best, count, hour) => (count > current.sendsByHourUtc[best]! ? hour : best), 0);
  const hourSummary = current.sendsByHourUtc.some((n) => n > 0)
    ? `Peak hour: ${String(peakHour).padStart(2, '0')}:00 UTC (${current.sendsByHourUtc[peakHour]} sends)`
    : 'No sends recorded in this period.';
  doc.text(hourSummary, x, y);
  y += 18;

  doc.setTextColor(0);
  const dayRows: [string, string][] = current.sendsByDayOfWeekUtc.map((count, i) => [DAY_LABELS[i]!, String(count)]);
  autoTable(doc, {
    startY: y,
    margin: { left: x, right: x },
    tableWidth: 'wrap',
    head: [['Day of week (UTC)', 'Sent']],
    body: dayRows,
    theme: 'striped',
    styles: { fontSize: 9, cellPadding: 3 },
    headStyles: { fillColor: [230, 230, 230], textColor: 20 },
  });

  return (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 24;
}

function drawRecipientsSection(doc: jsPDF, current: ReportPeriodStats, x: number, startY: number): void {
  const y = ensureSpace(doc, startY, 60);
  sectionTitle(doc, `Recipients (${current.topRecipients.length})`, x, y);

  if (current.topRecipients.length === 0) {
    doc.setFontSize(10);
    doc.setTextColor(90);
    doc.text('No tracked emails with a recipient in this period.', x, y + 18);
    return;
  }

  autoTable(doc, {
    startY: y + 8,
    margin: { left: x, right: x },
    head: [['Recipient', 'Sent', 'Opened', 'Open rate']],
    body: current.topRecipients.map((r) => [r.recipient, String(r.sentCount), String(r.openedCount), pct(r.openRate)]),
    theme: 'striped',
    styles: { fontSize: 9, cellPadding: 3, overflow: 'ellipsize' },
    headStyles: { fillColor: [230, 230, 230], textColor: 20 },
    columnStyles: { 1: { cellWidth: 65, halign: 'right' }, 2: { cellWidth: 65, halign: 'right' }, 3: { cellWidth: 75, halign: 'right' } },
  });
}

function addFooters(doc: jsPDF): void {
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(150);
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    doc.text('MailTrack — verified opens only, never a raw pixel fetch.', 40, pageHeight - 20);
    doc.text(`${i} / ${pageCount}`, pageWidth - 60, pageHeight - 20);
  }
}

export function reportPdfFilename(period: ReportPeriod, rangeEnd: string): string {
  const dateStr = new Date(rangeEnd).toISOString().slice(0, 10);
  return `mailtrack-report-${period}-${dateStr}.pdf`;
}
