// The Data Ops review and correction queue (#518, D-026, D-049): low-confidence parses,
// cross-source conflicts and user-reported errors wait here for staff, with an assignee, an SLA and
// a fix. A fix to a record fans out to every workspace watching it as a correction with the
// provenance "corrected by CauseDeck review" (`review_correction`), and a fixed item can be sent to
// the fixture workbench in one action. Reviewers see the record of one item at a time, and each
// such read is audited (`staff.read`, ids only).
export * from './corrections.ts';
export * from './queue.ts';
export * from './report.ts';
