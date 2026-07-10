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

/** Confirmed shape via InboxSDK's common-data-types docs: name may be empty, emailAddress always present. */
export interface Contact {
  name: string;
  emailAddress: string;
}

export interface ComposeView {
  getHTMLContent: () => string;
  setBodyHTML: (html: string) => void;
  getSubject: () => string;
  getToRecipients: () => Contact[];
  send: (options?: { sendAndArchive?: boolean }) => void;
  on(event: 'presending', handler: (event: PresendingEvent) => void): void;
  on(event: 'sent', handler: (event: SentEvent) => void): void;
}

export interface ThreadView {
  /** Confirmed against thread-view.d.ts in the installed package (ADR-21). getThreadID() is deprecated there; the async form is current. */
  getThreadIDAsync: () => Promise<string>;
}

export interface MessageView {
  getMessageIDAsync: () => Promise<string>;
  addAttachmentIcon: (descriptor: { iconUrl: string; tooltip: string }) => void;
  /**
   * ADR-20/ADR-21. Confirmed against the installed package's own type
   * declaration (node_modules/@inboxsdk/core/src/platform-implementation-js/views/conversations/message-view.d.ts
   * and thread-view.d.ts) rather than assumed from docs — see PLAN.md ADR-20
   * for why that verification mattered here.
   */
  isLoaded: () => boolean;
  /** @throws if isLoaded() is false — check first, or use the 'load' event below. */
  getSender: () => Contact;
  /** @throws if isLoaded() is false — same caveat as getSender(). */
  getBodyElement: () => HTMLElement;
  getThreadView: () => ThreadView;
  on(event: 'load', handler: (data: { messageView: MessageView }) => void): void;
}

export interface InboxSDKInstance {
  Compose: {
    registerComposeViewHandler: (handler: (composeView: ComposeView) => void) => void;
  };
  Conversations: {
    registerMessageViewHandlerAll: (handler: (messageView: MessageView) => void) => void;
  };
}
