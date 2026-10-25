// The status incident write path (#770) touches only platform tables, so its `@causedeck/core`
// exports are registered as not-a-service with the reason; the core guard test checks the export list.
import { describe, expect, it } from 'vitest';

import { NOT_A_SERVICE, SERVICE_TESTS } from './cross-tenant-registry.ts';

describe('cross-tenant registry: status incidents', () => {
  it.each([
    'createIncident',
    'addIncidentUpdate',
    'listIncidents',
    'INCIDENT_TEMPLATES',
    'IncidentAdminError',
  ])('registers %s as not a service, with a reason', (name) => {
    expect(NOT_A_SERVICE[name]?.length).toBeGreaterThan(0);
    expect(SERVICE_TESTS[name]).toBeUndefined();
  });
});
