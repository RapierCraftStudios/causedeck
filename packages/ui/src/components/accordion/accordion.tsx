import { ChevronDown } from 'lucide-react';
import { Accordion as AccordionPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';

import { cn } from '../../lib/cn';

/** Height animates 200 ms (`--dur-base`); tokens/motion.css makes it instant under reduced motion. */
export const accordionContentClasses = [
  'overflow-hidden text-sm text-ink-muted',
  'data-[state=open]:animate-accordion-down data-[state=closed]:animate-accordion-up',
  'duration-(--dur-base) ease-standard',
].join(' ');

export function Accordion(props: ComponentProps<typeof AccordionPrimitive.Root>) {
  return <AccordionPrimitive.Root data-slot="accordion" {...props} />;
}

export function AccordionItem({
  className,
  ...props
}: ComponentProps<typeof AccordionPrimitive.Item>) {
  return (
    <AccordionPrimitive.Item
      data-slot="accordion-item"
      className={cn('border-line border-b last:border-b-0', className)}
      {...props}
    />
  );
}

export function AccordionTrigger({
  className,
  children,
  ...props
}: ComponentProps<typeof AccordionPrimitive.Trigger>) {
  return (
    <AccordionPrimitive.Header className="flex">
      <AccordionPrimitive.Trigger
        data-slot="accordion-trigger"
        className={cn(
          'text-ink flex flex-1 items-start justify-between gap-4 rounded-sm py-3 text-start',
          'ease-standard text-sm font-medium transition-colors duration-(--dur-fast)',
          'active:text-ink-muted underline-offset-4 hover:underline',
          'focus-visible:outline-ring outline-offset-2 focus-visible:outline-2',
          'disabled:pointer-events-none disabled:opacity-50',
          'pointer-coarse:min-h-(--hit)',
          '[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
          '[&[data-state=open]>[data-slot=accordion-chevron]]:rotate-180',
          className,
        )}
        {...props}
      >
        {children}
        <ChevronDown
          aria-hidden="true"
          data-slot="accordion-chevron"
          className="text-ink-subtle ease-standard mt-0.5 transition-transform duration-(--dur-base)"
        />
      </AccordionPrimitive.Trigger>
    </AccordionPrimitive.Header>
  );
}

export function AccordionContent({
  className,
  children,
  ...props
}: ComponentProps<typeof AccordionPrimitive.Content>) {
  return (
    <AccordionPrimitive.Content
      data-slot="accordion-content"
      className={accordionContentClasses}
      {...props}
    >
      <div className={cn('pb-3', className)}>{children}</div>
    </AccordionPrimitive.Content>
  );
}
