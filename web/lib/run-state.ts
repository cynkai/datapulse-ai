import type { AgentEvent } from "./agent-events";
import { isLinerSearchFailure } from "./trust-signals.ts";

export type ConnectionState = "idle" | "connecting" | "streaming" | "complete" | "error" | "liner_error" | "cancelled";

export function nextStateForEvent(state: ConnectionState, event: AgentEvent): ConnectionState {
  switch (event.kind) {
    case "completion":
      return event.ok ? "complete" : state === "liner_error" ? "liner_error" : "error";
    case "error":
      return isLinerSearchFailure({ code: event.code ?? "agent_run_failed", message: event.message }) ? "liner_error" : "error";
    case "event":
    case "malformed":
      return state === "connecting" ? "streaming" : state;
  }
}
