import { describe, expect, it } from 'vitest';

import * as ui from './index';
import { packageName } from './index';

describe('@causedeck/ui', () => {
  it('exports its package name', () => {
    expect(packageName).toBe('@causedeck/ui');
  });

  it('exports the form controls from the root', () => {
    for (const name of [
      'Input',
      'Textarea',
      'Label',
      'Field',
      'useFieldControl',
      'Select',
      'SelectTrigger',
      'Combobox',
      'Checkbox',
      'RadioGroup',
      'Switch',
      'Slider',
      'Toggle',
      'ToggleGroup',
      'Form',
      'FormField',
      'useZodForm',
    ]) {
      expect(ui, name).toHaveProperty(name);
    }
  });
});
