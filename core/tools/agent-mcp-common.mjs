// Shared F1 Racer MCP bridge primitives (#296).
//
// Both the local stdio MCP process and the remote HTTP MCP endpoint use this
// module, so tool definitions, WebSocket attachment semantics and timeouts
// cannot drift between transports.

import { WebSocket } from "ws";

export const MCP_SERVER_INFO = { name: "f1-racer-realtime", version: "2.1.0" };
export const MODERN_PROTOCOL_VERSION = "2026-07-28";
export const LEGACY_PROTOCOL_VERSION = "2025-11-25";

const commandSchema = {
  steer: { type: "number", minimum: -1, maximum: 1, description: "-1 left, +1 right" },
  throttle: { type: "number", minimum: 0, maximum: 1 },
  brake: { type: "number", minimum: 0, maximum: 1 },
};

export const MCP_TOOLS = [
  {
    name: "f1_observe",
    description: "Read the live state of the F1 Racer car bound to this bridge.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "f1_act",
    description: "Apply steer/throttle/brake immediately and hold it until the next action, release, human takeover, or lease expiry.",
    inputSchema: {
      type: "object",
      properties: { ...commandSchema, leaseMs: { type: "number", minimum: 50, maximum: 5000 } },
      additionalProperties: false,
    },
  },
  {
    name: "f1_drive",
    description: "Set a bounded high-level pace/line intent. The race page converts it to frame-rate controls locally.",
    inputSchema: {
      type: "object",
      properties: {
        pace: { type: "number", minimum: 0.5, maximum: 1 },
        line: { type: "number", minimum: -1, maximum: 1 },
        horizonMs: { type: "number", minimum: 100, maximum: 5000 },
        confidence: { type: "number", minimum: 0, maximum: 1 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "f1_enqueue",
    description: "Queue up to 10 short driving segments with a total duration of at most 5000 ms.",
    inputSchema: {
      type: "object",
      properties: {
        segments: {
          type: "array",
          maxItems: 10,
          items: {
            type: "object",
            properties: { ...commandSchema, durationMs: { type: "number", minimum: 50, maximum: 5000 } },
            additionalProperties: false,
          },
        },
      },
      required: ["segments"],
      additionalProperties: false,
    },
  },
  {
    name: "f1_radio",
    description: "Send a short radio message (max 80 characters) shown to everyone in the room.",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string", maxLength: 80 } },
      required: ["text"],
      additionalProperties: false,
    },
  },
  {
    name: "f1_release",
    description: "Drop the agent command immediately and return the car to neutral/human control.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
];

export function normalizeServerUrl(raw = "") {
  const value = String(raw).trim();
  if (/^https:\/\//i.test(value)) return value.replace(/^https:/i, "wss:");
  if (/^http:\/\//i.test(value)) return value.replace(/^http:/i, "ws:");
  if (/^wss?:\/\//i.test(value)) return value;
  return value ? `wss://${value}` : "";
}

export class AgentBridgeClient {
  constructor({ serverUrl, token, timeoutMs = 8000, label = "f1-agent-mcp" }) {
    this.serverUrl = normalizeServerUrl(serverUrl);
    this.token = String(token || "").trim();
    this.timeoutMs = Number(timeoutMs) || 8000;
    this.label = label;
    this.ws = null;
    this.attaching = null;
    this.callCounter = 0;
    this.pendingCalls = new Map();
  }

  configured() {
    return !!this.serverUrl && this.token.length >= 16;
  }

  configurationError() {
    return "Set F1_AGENT_SERVER and F1_AGENT_TOKEN (>=16 chars).";
  }

  log(message) {
    process.stderr.write(`[${this.label}] ${message}\n`);
  }

  rejectPending(error) {
    for (const { reject, timer } of this.pendingCalls.values()) {
      clearTimeout(timer);
      reject(error);
    }
    this.pendingCalls.clear();
  }

  async connect() {
    if (!this.configured()) throw new Error(this.configurationError());
    if (this.ws?.readyState === WebSocket.OPEN && !this.attaching) return;
    if (this.attaching) return this.attaching;

    this.attaching = new Promise((resolve, reject) => {
      let settled = false;
      this.ws = new WebSocket(this.serverUrl);

      const fail = (error) => {
        if (settled) return;
        settled = true;
        this.attaching = null;
        reject(error instanceof Error ? error : new Error(String(error)));
      };

      this.ws.on("open", () => {
        this.ws.send(JSON.stringify({ type: "agent_attach", token: this.token }));
      });

      this.ws.on("message", (raw) => {
        let msg;
        try { msg = JSON.parse(raw.toString()); } catch { return; }

        if (msg.type === "agent_attached") {
          if (!settled) {
            settled = true;
            this.attaching = null;
            this.log(`attached to room ${msg.roomCode}, participant ${msg.participantId}`);
            resolve();
          }
          return;
        }

        if (msg.type === "agent_result" && this.pendingCalls.has(msg.callId)) {
          const pending = this.pendingCalls.get(msg.callId);
          this.pendingCalls.delete(msg.callId);
          clearTimeout(pending.timer);
          if (msg.ok) pending.resolve(msg.result);
          else pending.reject(new Error(msg.error || "F1 agent call failed."));
          return;
        }

        if (msg.type === "agent_detached") {
          this.rejectPending(new Error(`F1 agent bridge detached: ${msg.reason || "unknown"}`));
          try { this.ws.close(); } catch {}
          return;
        }

        if (msg.type === "error") {
          const error = new Error(msg.message || msg.code || "F1 room server error");
          if (!settled) fail(error);
          else this.log(error.message);
        }
      });

      this.ws.on("error", (error) => fail(error));
      this.ws.on("close", () => {
        this.rejectPending(new Error("F1 agent bridge connection closed."));
        if (!settled) fail(new Error("F1 agent bridge connection closed before attach."));
        this.ws = null;
        this.attaching = null;
      });
    });

    return this.attaching;
  }

  async callTool(name, args = {}) {
    if (!MCP_TOOLS.some((tool) => tool.name === name)) throw new Error(`Unknown F1 tool: ${name}`);
    await this.connect();
    const callId = `mcp-${process.pid}-${Date.now().toString(36)}-${++this.callCounter}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingCalls.delete(callId);
        reject(new Error(`F1 tool timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);
      this.pendingCalls.set(callId, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ type: "agent_call", callId, tool: name, args }));
    });
  }

  close() {
    this.rejectPending(new Error("F1 agent bridge client closed."));
    try { this.ws?.close(); } catch {}
    this.ws = null;
    this.attaching = null;
  }
}

export function toolResult(value, { modern = false } = {}) {
  return {
    ...(modern ? { resultType: "complete" } : {}),
    content: [{ type: "text", text: JSON.stringify(value) }],
    structuredContent: value,
    isError: false,
  };
}

export function toolError(error, { modern = false } = {}) {
  return {
    ...(modern ? { resultType: "complete" } : {}),
    content: [{ type: "text", text: error?.message || String(error) }],
    isError: true,
  };
}
