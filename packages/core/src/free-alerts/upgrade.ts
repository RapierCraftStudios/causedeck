// Upgrade prompts for the free alerts tier (#506): one line at a natural moment, never a block. The
// free features keep working whether or not the line is shown. Copy only; the surfaces that show it
// (an alert body, a brief screen) pass it through as plain text.

export const UPGRADE_MOMENTS = ['order', 'brief'] as const;
export type UpgradeMoment = (typeof UPGRADE_MOMENTS)[number];

export const UPGRADE_PROMPTS: Readonly<Record<UpgradeMoment, string>> = Object.freeze({
  order:
    'Want this order read, its directions turned into tasks and a brief prepared? See the paid plans.',
  brief: 'Hearing briefs, obligations and memory come with a paid plan. Your alerts stay free.',
});
