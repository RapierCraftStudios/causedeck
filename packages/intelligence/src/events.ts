// Events the pipeline emits (#45). The pipeline calls no other module: downstream work (order
// extraction #46, cause-list ingestion #57, near-duplicate merge or chain at L3) attaches to this
// port elsewhere, on the injected-port pattern of the graph and court events. Payload schemas
// live in `@causedeck/validators`.
import type {
  CaptureClassifiedEvent,
  DocumentNearDuplicateEvent,
  DocumentPipelineEvent,
  DocumentProcessedEvent,
} from '@causedeck/validators';

export type {
  CaptureClassifiedEvent,
  DocumentNearDuplicateEvent,
  DocumentPipelineEvent,
  DocumentProcessedEvent,
};

export interface IntelligenceEvents {
  emit(event: DocumentPipelineEvent): void | Promise<void>;
}

/** Drops every event: the default until a subscriber is attached. */
export const noEvents: IntelligenceEvents = { emit: () => undefined };

/** Collects events in memory, for tests. */
export function createEventLog(): IntelligenceEvents & {
  readonly events: DocumentPipelineEvent[];
} {
  const events: DocumentPipelineEvent[] = [];
  return {
    events,
    emit(event) {
      events.push(event);
    },
  };
}
