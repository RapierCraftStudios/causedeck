// The people domain (#82, part 1 of 3): client contacts, the reachable details (phone, email,
// language) of an existing client, and who may see and change them. Contacts sit beside the
// matter graph's `person` rows and link to matters through its role edges, written only by
// `setRoleEdge`. There is no prospect or lead state, no export, no bulk messaging and no portal
// invite. See docs/engineering/core-domains.md.
export {
  archiveContact,
  createContact,
  linkToMatter,
  listContacts,
  undoContactChange,
  updateContact,
  UNLINKED_AFTER_MS,
  type ContactView,
  type PeopleActor,
  type PeopleDeps,
} from './contacts.ts';
export type { ContactLanguageChangedEvent, PeopleEvent, PeopleEvents } from './events.ts';
