// The deadline engine (#494, D-048): court calendars per forum (holiday notices, vacations, weekly
// offs) and calendar-aware due dates with the rule applied stated in words.
export {
  closedReason,
  DEFAULT_WEEKLY_OFFS,
  FORUM_VACATIONS,
  loadCourtCalendar,
  type CourtCalendar,
  type LoadCourtCalendarInput,
  type VacationRange,
} from './calendar.ts';
export { computeDueDate, type DueDate, type DueDateInput } from './compute.ts';
export {
  applyDeadlineRules,
  deadlineForDirection,
  type DirectionDeadlineInput,
  type RuleDirection,
} from './direction.ts';
