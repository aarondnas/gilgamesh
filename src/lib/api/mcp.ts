// AI assistants working with Gilgamesh over MCP (src-tauri/src/commands/mcp.rs).
import { invoke } from "@tauri-apps/api/core";

export interface AssistantStatus {
  installed: boolean;
  /** Gilgamesh is entered in the assistant's configuration. */
  connected: boolean;
  /** The entry points to another or a missing program, or is an extension from an older version. */
  outdated: boolean;
}

/** AI assistants that can work with Gilgamesh over MCP. */
export interface AssistantsStatus {
  /** Whether the app accepts tool calls. */
  running: boolean;
  desktop: AssistantStatus;
  code: AssistantStatus;
  codex: AssistantStatus;
}

/** A tool call from an assistant, handed to the page (see `mcp/host.rs`). */
export interface McpCall {
  id: number;
  name: string;
  arguments: Record<string, unknown>;
}

/** The page's answer: text for the assistant, and whether the call failed. */
export interface McpResult {
  text: string;
  isError?: boolean;
}

export const mcpApi = {
  mcpRespond: (id: number, result: McpResult) =>
    invoke<void>("mcp_respond", { id, result: { text: result.text, isError: result.isError ?? false } }),
  assistantStatus: () => invoke<AssistantsStatus>("assistant_status"),
  /** "extension": Claude Desktop shows its install dialog; "config": takes effect after restarting it. */
  assistantConnectDesktop: () => invoke<"extension" | "config">("assistant_connect_desktop"),
  assistantConnectCode: () => invoke<void>("assistant_connect_code"),
  assistantConnectCodex: () => invoke<void>("assistant_connect_codex"),
};
