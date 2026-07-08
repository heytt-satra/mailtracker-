/**
 * Minimal local ambient types for the subset of the InboxSDK surface
 * MailTrack actually uses, verified against https://inboxsdk.github.io/inboxsdk-docs/
 * (compose/, conversations/) during Phase 2 implementation. `@inboxsdk/core`
 * ships no reliable published type definitions across versions, so hand
 * declaring the used surface is more robust than fighting `any`-laden
 * inferred types from the package itself.
 */

export interface PresendingEvent {
  cancel: () => void;
}

export interface SentEvent {
  getThreadID: () => string;
  getMessageID: () => string;
}

export interface ComposeView {
  getHTMLContent: () => string;
  setBodyHTML: (html: string) => void;
  getSubject: () => string;
  send: (options?: { sendAndArchive?: boolean }) => void;
  on(event: 'presending', handler: (event: PresendingEvent) => void): void;
  on(event: 'sent', handler: (event: SentEvent) => void): void;
}

export interface MessageView {
  getMessageIDAsync: () => Promise<string>;
  addAttachmentIcon: (descriptor: { iconUrl: string; tooltip: string }) => void;
}

export interface InboxSDKInstance {
  Compose: {
    registerComposeViewHandler: (handler: (composeView: ComposeView) => void) => void;
  };
  Conversations: {
    registerMessageViewHandlerAll: (handler: (messageView: MessageView) => void) => void;
  };
}
