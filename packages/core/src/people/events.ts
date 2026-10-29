// People domain events (#82). The services emit these through an injected `PeopleEvents` port and
// never import audit or notification code; whatever attaches to the port (outward messages in the
// client's language, for one) lives elsewhere. Events are emitted only once the write has committed.

/** A contact's language preference changed: the next outward message uses `to`. */
export interface ContactLanguageChangedEvent {
  type: 'contact.language_changed';
  workspaceId: string;
  actorUserId: string;
  contactId: string;
  personId: string;
  from: string;
  to: string;
}

export type PeopleEvent = ContactLanguageChangedEvent;

/** The port the people services emit through; injected by the caller. */
export interface PeopleEvents {
  emit(event: PeopleEvent): void;
}
