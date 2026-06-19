/**
 * In-memory registry of chat generations running on the server.
 *
 * A generation keeps running after the client disconnects — the route handler
 * is a detached async function — so this registry lets a reconnecting client
 * observe an in-progress generation and lets a stop request abort it.
 *
 * Keyed by chatId: a chat has at most one active generation at a time.
 */
import type { ChatStreamEvent, GenerationStatus } from "@ariadne/shared";

/** A registered generation — its public status plus an abort handle. */
export interface LiveGeneration extends GenerationStatus {
  controller: AbortController;
}

const registry = new Map<string, LiveGeneration>();

export interface BeginGenerationInput {
  chatId: string;
  messageId: string;
  agentMode: boolean;
  controller: AbortController;
}

/** Register a new generation; returns its mutable entry. */
export function beginGeneration(input: BeginGenerationInput): LiveGeneration {
  const entry: LiveGeneration = {
    chatId: input.chatId,
    messageId: input.messageId,
    startedAt: new Date().toISOString(),
    agentMode: input.agentMode,
    content: "",
    statusText: "",
    agentSteps: [],
    controller: input.controller,
  };
  registry.set(input.chatId, entry);
  return entry;
}

/** Is a generation currently registered for this chat? */
export function isGenerating(chatId: string): boolean {
  return registry.has(chatId);
}

/** Fold a stream event into the entry so its partial state stays current. */
export function applyEventToGeneration(entry: LiveGeneration, event: ChatStreamEvent): void {
  switch (event.type) {
    case "delta":
      entry.content += event.text;
      break;
    case "status":
      entry.statusText = event.text;
      break;
    case "agent_plan":
      entry.agentSteps = event.steps.map((s) => ({ ...s }));
      break;
    case "agent_step": {
      const idx = entry.agentSteps.findIndex((s) => s.id === event.step.id);
      if (idx >= 0) entry.agentSteps[idx] = { ...event.step };
      else entry.agentSteps.push({ ...event.step });
      break;
    }
    default:
      break;
  }
}

/** Remove a generation. Pass `entry` to make the delete identity-guarded — it
 *  only removes the registry slot if it still holds THIS generation, so a
 *  finishing generation can never delete a different one that took its chatId
 *  slot in the interim. */
export function endGeneration(chatId: string, entry?: LiveGeneration): void {
  if (entry && registry.get(chatId) !== entry) return;
  registry.delete(chatId);
}

/** A serialisable snapshot of the active generation for a chat, or null. */
export function getGenerationStatus(chatId: string): GenerationStatus | null {
  const e = registry.get(chatId);
  if (!e) return null;
  return {
    chatId: e.chatId,
    messageId: e.messageId,
    startedAt: e.startedAt,
    agentMode: e.agentMode,
    content: e.content,
    statusText: e.statusText,
    agentSteps: e.agentSteps,
  };
}

/** Abort the active generation for a chat. Returns true if one was running. */
export function abortGeneration(chatId: string): boolean {
  const e = registry.get(chatId);
  if (!e) return false;
  e.controller.abort();
  return true;
}
