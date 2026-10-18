// packages/ui lint: the shared React config plus the design-token rules from #129.
import { loggerContentRestrictions } from '@causedeck/config/eslint/base';
import react from '@causedeck/config/eslint/react';

/** Tailwind utilities that take a colour. `bg-[#fff]`, `text-[oklch(...)]` etc. are banned. */
const COLOR_UTILITIES =
  '(bg|text|border|border-[xytrblse]|ring|ring-offset|outline|fill|stroke|decoration|divide|placeholder|caret|accent|shadow|inset-shadow|drop-shadow|from|via|to)';
const COLOR_VALUES = '(#|rgba?\\(|hsla?\\(|oklch\\(|oklab\\(|lab\\(|lch\\(|hwb\\(|color:)';

/** Each pattern is matched against string literals and template chunks (class names). */
export const tokenPatterns = [
  {
    pattern: `(^|[\\s:"'\`])!?${COLOR_UTILITIES}-\\[${COLOR_VALUES}`,
    message:
      'Arbitrary colour values are not allowed in packages/ui; use a token utility (bg-surface, text-ink, ...).',
  },
  {
    pattern: `(^|[\\s:"'\`])!?-?z-(\\[|\\d)`,
    message: 'Numeric z-index is not allowed; use the stacking tokens (z-dropdown, z-modal, ...).',
  },
  {
    pattern: `(^|[\\s:"'\`])!?(rounded(-[a-z]+)?|shadow|duration|delay|ease)-\\[(?!var\\()`,
    message:
      'Arbitrary radius, shadow, duration or easing values are not allowed; use the tokens (rounded-md, shadow-2, duration-(--dur-fast), ease-standard).',
  },
];

const selectorsFor = ({ pattern, message }) =>
  [`Literal[value=/${pattern}/]`, `TemplateElement[value.raw=/${pattern}/]`].map((selector) => ({
    selector,
    message,
  }));

export const tokenRestrictions = tokenPatterns.flatMap(selectorsFor);

/** @type {import('eslint').Linter.Config[]} */
export default [
  ...react,
  { ignores: ['storybook-static/**'] },
  {
    files: ['**/*.{ts,tsx}'],
    // Tests hold banned class names as fixture data (e.g. the rule's own tests).
    ignores: ['**/*.test.{ts,tsx}', '**/__tests__/**'],
    rules: {
      // Keep the shared logger-content restrictions: this list replaces the base one.
      'no-restricted-syntax': ['error', ...loggerContentRestrictions, ...tokenRestrictions],
    },
  },
];
