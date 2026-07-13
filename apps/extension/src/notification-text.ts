import type { PollEventKind, PollUpdate } from '@mailtrack/shared';

const EVENT_VERB: Record<Exclude<PollEventKind, 'hot_conversation' | 'revival'>, string> = {
  opened: 'opened',
  clicked: 'clicked a link in',
  replied: 'replied to',
  bounced: 'could not be delivered to',
};

/**
 * Builds the notification's title/message from the recipient + subject the
 * backend now sends alongside each event, instead of the previous generic
 * "Recipient opened your tracked email" — that told you SOMETHING happened,
 * never WHO to or WHICH email, which matters the moment more than one
 * tracked send is in flight at once.
 *
 * Hot Conversation and Revival (see engagement-alerts.ts) don't fit the
 * simple "{who} {verb} your email" shape the other four events share, so
 * they're phrased separately rather than forced through EVENT_VERB.
 */
export function buildNotificationText(update: PollUpdate): { title: string; message: string } {
  const who = update.recipient ?? 'a recipient';
  const subjectLine = update.subject ? ` "${update.subject}"` : '';

  if (update.event === 'hot_conversation') {
    return {
      title: 'MailTrack: hot conversation 🔥',
      message: `${who} is actively engaging with your email${subjectLine} — opened it several times in the last hour.`,
    };
  }
  if (update.event === 'revival') {
    return {
      title: 'MailTrack: revived 👋',
      message: `${who} just reopened your email${subjectLine} after it had gone quiet for a while.`,
    };
  }

  return {
    title: update.event === 'bounced' ? 'MailTrack: bounced' : 'MailTrack: verified',
    message: `${who} ${EVENT_VERB[update.event]} your email${subjectLine}.`,
  };
}
