import { Avatar as AvatarPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';

import { cn } from '../../lib/cn';

const SIZES = {
  sm: 'size-6 text-xs',
  md: 'size-8 text-xs',
  lg: 'size-10 text-sm',
} as const;

export type AvatarSize = keyof typeof SIZES;

/** First grapheme of a string; Indic clusters (e.g. மீ, ಗೌ) stay whole. */
function firstGrapheme(word: string): string {
  const segments = new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(word);
  for (const { segment } of segments) return segment;
  return '';
}

/** Up to two initials from a name: first and last word. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/u).filter(Boolean);
  const first = words[0];
  if (first === undefined) return '';
  const last = words.length > 1 ? words[words.length - 1] : undefined;
  return [first, last]
    .filter((word): word is string => word !== undefined)
    .map((word) => firstGrapheme(word).toLocaleUpperCase())
    .join('');
}

export interface AvatarProps extends Omit<ComponentProps<typeof AvatarPrimitive.Root>, 'children'> {
  /** The person's name: the image's alt text and the source of the fallback initials. */
  name: string;
  /** Photo URL. Initials show until it loads, and if it fails. */
  src?: string;
  size?: AvatarSize;
}

/** Person avatar: photo with an initials fallback. */
export function Avatar({ name, src, size = 'md', className, ...props }: AvatarProps) {
  return (
    <AvatarPrimitive.Root
      data-slot="avatar"
      data-size={size}
      className={cn(
        'relative inline-flex shrink-0 overflow-hidden rounded-full select-none',
        'border-line border',
        SIZES[size],
        className,
      )}
      {...props}
    >
      {src === undefined ? null : (
        <AvatarPrimitive.Image
          data-slot="avatar-image"
          src={src}
          alt={name}
          className="aspect-square size-full object-cover"
        />
      )}
      <AvatarPrimitive.Fallback
        data-slot="avatar-fallback"
        role="img"
        aria-label={name}
        className="bg-surface-sunken text-ink-muted flex size-full items-center justify-center font-sans font-medium"
      >
        <span aria-hidden="true">{initials(name)}</span>
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  );
}
