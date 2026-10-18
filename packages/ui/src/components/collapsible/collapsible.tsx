import { Collapsible as CollapsiblePrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';

import { cn } from '../../lib/cn';

/** Height animates 200 ms (`--dur-base`); instant under reduced motion. */
export const collapsibleContentClasses = [
  'overflow-hidden',
  'data-[state=open]:animate-collapsible-down data-[state=closed]:animate-collapsible-up',
  'duration-(--dur-base) ease-standard',
].join(' ');

export function Collapsible(props: ComponentProps<typeof CollapsiblePrimitive.Root>) {
  return <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />;
}

/** Unstyled trigger: use `asChild` with a `Button`. */
export function CollapsibleTrigger(props: ComponentProps<typeof CollapsiblePrimitive.Trigger>) {
  return <CollapsiblePrimitive.Trigger data-slot="collapsible-trigger" {...props} />;
}

export function CollapsibleContent({
  className,
  ...props
}: ComponentProps<typeof CollapsiblePrimitive.Content>) {
  return (
    <CollapsiblePrimitive.Content
      data-slot="collapsible-content"
      className={cn(collapsibleContentClasses, className)}
      {...props}
    />
  );
}
