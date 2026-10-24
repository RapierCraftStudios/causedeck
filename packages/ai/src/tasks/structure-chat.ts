import { z } from 'zod';

import type { TaskDef } from '../types.ts';
import { confidence, isoDate } from './shared.ts';

/** Most messages one call may carry (the import cap, #526). */
export const STRUCTURE_CHAT_MAX_MESSAGES = 5000;

const message = z.object({
  /** The message id the caller sent; every item must cite one. */
  ref: z.string().min(1).max(200),
  ts: z.string().min(1).max(40),
  sender: z.string().min(1).max(200),
  text: z.string().min(1),
});

/**
 * Only an internal chat (the lawyer's own team) is ever structured: `chatType` is the literal
 * `internal`, so a `client` chat fails input validation before any provider is reached.
 */
const input = z.object({
  chatType: z.literal('internal'),
  messages: z.array(message).min(1).max(STRUCTURE_CHAT_MAX_MESSAGES),
});

const item = z.object({
  title: z.string().min(1).max(500),
  /** A date that appears literally in the quoted message, or null. */
  dueDate: isoDate.nullable(),
  ref: z.string().min(1).max(200),
  ts: z.string().min(1).max(40),
  sender: z.string().min(1).max(200),
  /** A verbatim span of the cited message. */
  quote: z.string().min(1).max(2000),
  /** The message relays an instruction that came from the client. */
  clientInstruction: z.boolean(),
  confidence,
});

const output = z.object({ items: z.array(item).max(500), confidence });

export type StructureChatInput = z.infer<typeof input>;
export type StructureChatOutput = z.infer<typeof output>;
export type StructureChatItem = z.infer<typeof item>;

export const structureChat: TaskDef<StructureChatInput, StructureChatOutput> = {
  id: 'structure_chat',
  input,
  output,
  providers: ['bedrock'],
  maxOutputTokens: 2048,
  promptId: 'structure_chat.v1',
  defaultLevel: 2,
};
