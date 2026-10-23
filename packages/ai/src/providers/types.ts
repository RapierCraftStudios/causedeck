// The provider contract. Adapters take typed input and return parsed JSON: there is no tool,
// function-calling, web or retrieval parameter anywhere on this interface.
export type {
  CallOptions,
  Provider,
  ProviderId,
  ProviderResult,
  TaskDef,
  TaskId,
  Usage,
} from '../types.ts';
