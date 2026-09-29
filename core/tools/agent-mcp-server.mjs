#!/usr/bin/env node
// MCP stdio -> F1 Racer realtime WebSocket bridge (#201).
//
// This process deliberately has no browser dependency. A normal Chromium/
// Safari/Firefox race page opened with ?agent=1 registers the same f1_*
// controller it exposes to native WebMCP, and the room server relays these
// MCP tool calls to that one participant.
//
// Required environment:
//   F1_AGENT_SERVER=https://example.ngrok-free.app
//   F1_AGENT_TOKEN=<same >=16-char token used by the race page>
//
// Example race/lobby URL:
//   room.html?join=BMXE&roomServer=https://...&agent=1&agentToken=<token>
//
// The MCP transport is newline-delimited JSON-RPC over stdio, intentionally
// implemented here without another dependency. It supports the small server
// surface an agent needs: initialize, ping, tools/list and tools/call.

import readline from "node:readline";
import { WebSocket } from "ws";

const RAW_SERVER = (process.env.F1_AGENT_SERVER || "").trim();
const TOKEN = (process.env.F1_AGENT_TOKEN || "").trim();
const CALL_TIMEOUT_MS = Number(process.env.F1_AGENT_CALL_TIMEOUT_MS) || 8000;

function normalizeServerUrl(raw) {
  if (/^https:\/\//i.test(raw)) return raw.replace(/^https:/i, "wss:");
  if (/^http:\/\//i.test(raw)) return raw.replace(/^http:/i, "ws:");
  if (/^wss?:\/\//i.test(raw)) return raw;
  return raw ? `wss://${raw}` : "";
}

const SERVER = normalizeServerUrl(RAW_SERVER);
if (!SERVER || TOKEN.length < 16) {
  process.stderr.write(
    "[f1-agent-mcp] Set F1_AGENT_SERVER and F1_AGENT_TOKEN (>=16 chars).\n"
  );
}

const commandSchema = {
  steer: { type: "number", minimum: -1, maximum: 1, description: "-1 left, +1 right" },
  throttle: { type: "number", minimum: 0, maximum: 1 },
  brake: { type: "number", minimum: 0, maximum: 1 },
};

const MCP_TOOLS = [
  {
    name: "f1_observe",
    description: "Read the live state of the F1 Racer car bound to this bridge.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "f1_act",
    description: "Apply steer/throttle/brake immediately and hold it until the next action, release, human takeover, or lease expiry.",
    inputSchema: {
      type: "object",
      properties: { ...commandSchema, leaseMs: { type: "number", minimum: 50, maximum: 5000 } },
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
          },
        },
      },
      required: ["segments"],
    },
  },
  {
    name: "f1_release",
    description: "Drop the agent command immediately and return the car to neutral/human control.",
    inputSchema: { type: "object", properties: {} },
  },
];

let ws = null;
let attaching = null;
let callCounter = 0;
const pendingCalls = new Map();

function stderr(message) {
  process.stderr.write(`[f1-agent-mcp] ${message}\n`);
}

function rejectPending(error) {
  for (const { reject, timer } of pendingCalls.values()) {
    clearTimeout(timer);
    reject(error);
  }
  pendingCalls.clear();
}

function connectBridge() {
  if (!SERVER || TOKEN.length < 16) {
    return Promise.reject(new Error("F1 agent bridge is not configured."));
  }
  if (ws?.readyState === WebSocket.OPEN && !attaching) return Promise.resolve();
  if (attaching) return attaching;

  attaching = new Promise((resolve, reject) => {
    let settled = false;
    ws = new WebSocket(SERVER);

    const fail = (error) => {
      if (settled) return;
      settled = true;
      attaching = null;
      reject(error instanceof Error ? error : new Error(String(error)));
    };

    ws.on("open", () => {
      ws.send(JSON.stringify({ type: "agent_attach", token: TOKEN }));
    });

    ws.on("message", (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }

      if (msg.type === "agent_attached") {
        if (!settled) {
          settled = true;
          attaching = null;
          stderr(`attached to room ${msg.roomCode}, participant ${msg.participantId}`);
          resolve();
        }
        return;
      }

      if (msg.type === "agent_result" && pendingCalls.has(msg.callId)) {
        const pending = pendingCalls.get(msg.callId);
        pendingCalls.delete(msg.callId);
        clearTimeout(pending.timer);
        if (msg.ok) pending.resolve(msg.result);
        else pending.reject(new Error(msg.error || "F1 agent call failed."));
        return;
      }

      if (msg.type === "agent_detached") {
        rejectPending(new Error(`F1 agent bridge detached: ${msg.reason || "unknown"}`));
        return;
      }

      if (msg.type === "error") {
        const error = new Error(msg.message || msg.code || "F1 room server error");
        if (!settled) fail(error);
        else stderr(error.message);
      }
    });

    ws.on("error", (error) => fail(error));
    ws.on("close", () => {
      rejectPending(new Error("F1 agent bridge connection closed."));
      if (!settled) fail(new Error("F1 agent bridge connection closed before attach."));
      ws = null;
      attaching = null;
    });
  });

  return attaching;
}

async function invokeF1Tool(name, args = {}) {
  if (!MCP_TOOLS.some((tool) => tool.name === name)) throw new Error(`Unknown F1 tool: ${name}`);
  await connectBridge();
  const callId = `mcp-${process.pid}-${++callCounter}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingCalls.delete(callId);
      reject(new Error(`F1 tool timed out after ${CALL_TIMEOUT_MS}ms`));
    }, CALL_TIMEOUT_MS);
    pendingCalls.set(callId, { resolve, reject, timer });
    ws.send(JSON.stringify({ type: "agent_call", callId, tool: name, args }));
  });
}

function writeJson(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function result(id, value) {
  writeJson({ jsonrpc: "2.0", id, result: value });
}

function error(id, code, message) {
  writeJson({ jsonrpc: "2.0", id, error: { code, message } });
}

async function handleRpc(message) {
  const { id, method, params = {} } = message || {};
  if (method === "notifications/initialized" || method === "notifications/cancelled") return;

  if (method === "initialize") {
    result(id, {
      protocolVersion: params.protocolVersion || "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: { name: "f1-racer-realtime", version: "1.0.0" },
    });
    return;
  }

  if (method === "ping") {
    result(id, {});
    return;
  }

  if (method === "tools/list") {
    result(id, { tools: MCP_TOOLS });
    return;
  }

  if (method === "tools/call") {
    try {
      const value = await invokeF1Tool(params.name, params.arguments || {});
      result(id, {
        content: [{ type: "text", text: JSON.stringify(value) }],
        structuredContent: value,
        isError: false,
      });
    } catch (err) {
      result(id, {
        content: [{ type: "text", text: err?.message || String(err) }],
        isError: true,
      });
    }
    return;
  }

  if (id !== undefined) error(id, -32601, `Method not found: ${method}`);
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let message;
  try {
    message = JSON.parse(trimmed);
  } catch {
    error(null, -32700, "Parse error");
    return;
  }
  Promise.resolve(handleRpc(message)).catch((err) => {
    if (message.id !== undefined) error(message.id, -32603, err?.message || "Internal error");
  });
});

function shutdown() {
  for (const { timer } of pendingCalls.values()) clearTimeout(timer);
  pendingCalls.clear();
  try { ws?.close(); } catch {}
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
