import type { PollEventKind, PollUpdate } from '@mailtrack/shared';

const EVENT_VERB: Record<PollEventKind, string> = {
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
 */
export function buildNotificationText(update: PollUpdate): { title: string; message: string } {
  const who = update.recipient ?? 'a recipient';
  const subjectLine = update.subject ? ` "${update.subject}"` : '';
  return {
    title: update.event === 'bounced' ? 'MailTrack: bounced' : 'MailTrack: verified',
    message: `${who} ${EVENT_VERB[update.event]} your email${subjectLine}.`,
  };
}
