import type { ProjectEvent } from "../../domain/types.js";

export type EventListener = (event: ProjectEvent) => void;

export interface EventBus {
  publish(event: ProjectEvent): void;
  subscribe(listener: EventListener): () => void;
}

export function createInProcessEventBus(): EventBus {
  const listeners = new Set<EventListener>();

  return {
    publish(event) {
      for (const listener of listeners) {
        listener(event);
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
