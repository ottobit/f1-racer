#!/usr/bin/env node
// Local stdio MCP adapter for F1 Racer (#201/#296).
//
// Claude/Codex can launch this process locally. Remote ChatGPT-style clients
// use agent-mcp-http.mjs instead; both transports share the same bridge
// client and shared f1_* tool definitions from agent-mcp-common.mjs.

import readline from "node:readline";
import {
  AgentBridgeClient,
  LEGACY_PROTOCOL_VERSION,
  MCP_SERVER_INFO,
  MCP_TOOLS,
  toolError,
  toolResult,
} from "./agent-mcp-common.mjs";

const bridge = new AgentBridgeClient({
  serverUrl: process.env.F1_AGENT_SERVER,
  token: process.env.F1_AGENT_TOKEN,
  timeoutMs: process.env.F1_AGENT_CALL_TIMEOUT_MS,
  label: "f1-agent-mcp",
});

if (!bridge.configured()) process.stderr.write(`[f1-agent-mcp] ${bridge.configurationError()}\n`);

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
      protocolVersion: params.protocolVersion || LEGACY_PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: MCP_SERVER_INFO,
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
      result(id, toolResult(await bridge.callTool(params.name, params.arguments || {})));
    } catch (err) {
      result(id, toolError(err));
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
  bridge.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
