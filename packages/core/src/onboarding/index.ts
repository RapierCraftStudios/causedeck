// Zero-entry onboarding (#501, D-048): discovering an advocate's cases from their identifiers
// through delegated searches, staged on an import batch for the confirm grid. Nothing is applied here.
export * from './discover.ts';
// The wizard on top (#92): resumable state per member and workspace, the M1 practice profile saved
// as confirmed `manual` memory, and the chamber's delegation defaults and brief format.
export {
  completeOnboardingStep,
  findResumableOnboarding,
  getOnboardingState,
  startOnboarding,
  type CompletedStep,
  type OnboardingActor,
  type OnboardingStateView,
  type ResumableOnboarding,
} from './state.ts';
export { saveOnboardingCourts, saveOnboardingProfile } from './profile.ts';
export { getChamberDefaults, saveChamberBriefFormat, saveChamberDelegation } from './chamber.ts';
export { getFirstCourtDay, type FirstCourtDay } from './first-day.ts';
