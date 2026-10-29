// In-app help state (#94): per-member dismissed coachmarks. Content, search and the shortcut sheet
// live in apps/web; only state that must persist per user is a core concern.
export { dismissCoachmark, listDismissedCoachmarks, type HelpActor } from './state.ts';
