// Monthly or annual, with no client JavaScript: two radio inputs and a `group-has` rule in the plan
// cards switch the price shown. Selected state follows the checked input; focus is visible.
export function PlanToggle({
  legend,
  monthly,
  annual,
}: {
  legend: string;
  monthly: string;
  annual: string;
}) {
  const label =
    'text-ink-muted cursor-pointer rounded-md px-4 py-1.5 text-sm font-medium transition-colors duration-150 motion-reduce:transition-none';
  return (
    <fieldset className="border-line-control bg-surface-sunken inline-flex rounded-lg border p-1">
      <legend className="sr-only">{legend}</legend>
      <input
        type="radio"
        name="billing"
        id="bill-month"
        value="month"
        defaultChecked
        className="peer/m sr-only"
      />
      <label
        htmlFor="bill-month"
        className={`${label} peer-checked/m:bg-surface peer-checked/m:text-ink peer-focus-visible/m:outline-ring peer-checked/m:shadow-sm peer-focus-visible/m:outline-2`}
      >
        {monthly}
      </label>
      <input type="radio" name="billing" id="bill-year" value="year" className="peer/y sr-only" />
      <label
        htmlFor="bill-year"
        className={`${label} peer-checked/y:bg-surface peer-checked/y:text-ink peer-focus-visible/y:outline-ring peer-checked/y:shadow-sm peer-focus-visible/y:outline-2`}
      >
        {annual}
      </label>
    </fieldset>
  );
}
