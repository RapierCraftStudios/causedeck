/// <reference types="vite/client" />
// Storybook docs blocks for the #7 design tokens. Colours, motion and z-index come from the typed
// mirror in tokens/tokens.ts; type and spacing scales are read from the token CSS itself, so these
// pages can never drift from the source.
import type { ReactNode } from 'react';

import spacingCss from '../../tokens/spacing-radius-shadow.css?raw';
import typographyCss from '../../tokens/typography.css?raw';
import { COLOR_TOKENS, motion, zIndex } from '../../tokens/tokens';

/** Custom property names declared in the `:root` block of a token stylesheet, in source order. */
export function declaredTokens(css: string, prefix: string): string[] {
  const root = /:root\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
  const names = [...root.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1] ?? '');
  return [...new Set(names.filter((name) => name.startsWith(prefix)))];
}

function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <table className="text-ink w-full border-collapse text-sm">
      <thead>
        <tr className="border-line-strong border-b text-start">
          {head.map((cell) => (
            <th key={cell} className="text-ink-muted py-2 pe-4 text-start font-medium">
              {cell}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}

const Code = ({ children }: { children: ReactNode }) => (
  <code className="text-ink font-mono text-xs">{children}</code>
);

export function ColourTokens() {
  const pairs = COLOR_TOKENS.filter((name) => !name.endsWith('-soft'));
  return (
    <Table head={['Token', 'Swatch', 'Soft']}>
      {pairs.map((name) => {
        const soft = `${name}-soft`;
        const hasSoft = (COLOR_TOKENS as readonly string[]).includes(soft);
        return (
          <tr key={name} className="border-line border-b">
            <td className="py-2 pe-4">
              <Code>--{name}</Code>
            </td>
            <td className="py-2 pe-4">
              <span
                className="border-line block h-8 w-24 rounded-sm border"
                style={{ background: `var(--${name})` }}
              />
            </td>
            <td className="py-2 pe-4">
              {hasSoft ? (
                <span
                  className="border-line block h-8 w-24 rounded-sm border"
                  style={{ background: `var(--${soft})` }}
                />
              ) : null}
            </td>
          </tr>
        );
      })}
    </Table>
  );
}

export function TypeTokens() {
  const sizes = declaredTokens(typographyCss, '--text-').filter((n) => !n.includes('--', 2));
  return (
    <Table head={['Token', 'Sample']}>
      {sizes.map((name) => (
        <tr key={name} className="border-line border-b">
          <td className="py-2 pe-4">
            <Code>{name}</Code>
          </td>
          <td className="py-2 pe-4">
            <span
              style={{ fontSize: `var(${name})`, lineHeight: `var(${name}--line-height)` }}
              className="font-serif"
            >
              M/s Kaveri Textiles v. State of Tamil Nadu
            </span>
          </td>
        </tr>
      ))}
      {declaredTokens(typographyCss, '--font-').map((name) => (
        <tr key={name} className="border-line border-b">
          <td className="py-2 pe-4">
            <Code>{name}</Code>
          </td>
          <td className="py-2 pe-4" style={{ fontFamily: `var(${name})` }}>
            Hearing on 14 Nov · வழக்கு · ಪ್ರಕರಣ
          </td>
        </tr>
      ))}
    </Table>
  );
}

export function SpacingTokens() {
  return (
    <div className="flex flex-col gap-8">
      <Table head={['Space', 'Size']}>
        {declaredTokens(spacingCss, '--space-').map((name) => (
          <tr key={name} className="border-line border-b">
            <td className="py-2 pe-4">
              <Code>{name}</Code>
            </td>
            <td className="py-2 pe-4">
              <span className="bg-accent block h-3" style={{ width: `var(${name})` }} />
            </td>
          </tr>
        ))}
      </Table>
      <Table head={['Radius / shadow', 'Sample']}>
        {[
          ...declaredTokens(spacingCss, '--radius-'),
          ...declaredTokens(spacingCss, '--shadow-'),
        ].map((name) => (
          <tr key={name} className="border-line border-b">
            <td className="py-2 pe-4">
              <Code>{name}</Code>
            </td>
            <td className="py-3 pe-4">
              <span
                className="border-line bg-surface-raised block size-12 border"
                style={
                  name.startsWith('--radius-')
                    ? { borderRadius: `var(${name})` }
                    : { boxShadow: `var(${name})` }
                }
              />
            </td>
          </tr>
        ))}
      </Table>
    </div>
  );
}

export function MotionTokens() {
  return (
    <div className="flex flex-col gap-8">
      <Table head={['Duration', 'ms', 'CSS']}>
        {Object.entries(motion.duration).map(([name, ms]) => (
          <tr key={name} className="border-line border-b">
            <td className="py-2 pe-4">{name}</td>
            <td className="py-2 pe-4 tabular-nums">{ms}</td>
            <td className="py-2 pe-4">
              <Code>--dur-{name}</Code>
            </td>
          </tr>
        ))}
      </Table>
      <Table head={['Easing', 'Curve', 'CSS']}>
        {Object.entries(motion.easing).map(([name, curve]) => (
          <tr key={name} className="border-line border-b">
            <td className="py-2 pe-4">{name}</td>
            <td className="py-2 pe-4">
              <Code>{curve}</Code>
            </td>
            <td className="py-2 pe-4">
              <Code>--ease-{name}</Code>
            </td>
          </tr>
        ))}
        <tr className="border-line border-b">
          <td className="py-2 pe-4">spring</td>
          <td className="py-2 pe-4">
            <Code>
              stiffness {motion.spring.stiffness}, damping {motion.spring.damping}
            </Code>
          </td>
          <td className="py-2 pe-4">
            <Code>--ease-spring</Code>
          </td>
        </tr>
      </Table>
      <Table head={['Layer', 'z-index', 'Utility']}>
        {Object.entries(zIndex).map(([name, value]) => (
          <tr key={name} className="border-line border-b">
            <td className="py-2 pe-4">{name}</td>
            <td className="py-2 pe-4 tabular-nums">{value}</td>
            <td className="py-2 pe-4">
              <Code>z-{name}</Code>
            </td>
          </tr>
        ))}
      </Table>
    </div>
  );
}
