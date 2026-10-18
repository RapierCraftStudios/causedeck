import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/** tailwind-merge taught the preset's custom scales, so `shadow-1 shadow-3` keeps only `shadow-3`. */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      shadow: ['1', '2', '3', '4'],
      text: ['xs', 'sm', 'base', 'md', 'lg', 'xl', '2xl', '3xl', 'display', 'eyebrow'],
    },
  },
});

/** Join class names conditionally and resolve Tailwind conflicts (last one wins). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
