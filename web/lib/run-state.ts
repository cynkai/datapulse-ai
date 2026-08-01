import type { AgentEvent } from "./agent-events";

export type ConnectionState = "idle" | "connecting" | "streaming" | "complete" | "error" | "cancelled";

export function nextStateForEvent(state: ConnectionState, event: AgentEvent): ConnectionState {
  switch (event.kind) {
    case "completion":
      return event.ok ? "complete" : "error";
    case "error":
      return "error";
    case "event":
    case "malformed":
      return state === "connecting" ? "streaming" : state;
  }
}
