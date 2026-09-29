#!/usr/bin/env node
// Remote Streamable HTTP MCP endpoint for F1 Racer (#296).
//
// This is intentionally separate from the multiplayer room server. Expose
// this process through HTTPS (reverse proxy/tunnel) when a remote MCP client
// needs it; the process itself binds to loopback by default.
//
// Environment:
//   F1_AGENT_SERVER=https://room-server.example        required
//   F1_AGENT_TOKEN=<>=16 chars>                       required
//   F1_MCP_PORT=8790                                  optional
//   F1_MCP_HOST=127.0.0.1                             optional
//   F1_MCP_AUTH_TOKEN=<bearer secret>                 strongly recommended when tunneled
//
// Endpoint:
//   POST /mcp       MCP Streamable HTTP (2026-07-28 + recent legacy handshake)
//   GET  /health    process/configuration status, no secrets
//
// The HTTP transport is stateless. The only live state is the WebSocket
// connection from this process to the one race page authorized by
// F1_AGENT_TOKEN.

import { createServer } from "node:http";
import {
  AgentBridgeClient,
  LEGACY_PROTOCOL_VERSION,
  MCP_SERVER_INFO,
  MCP_TOOLS,
  MODERN_PROTOCOL_VERSION,
  toolError,
  toolResult,
} from "./agent-mcp-common.mjs";

const PORT = Number(process.env.F1_MCP_PORT) || 8790;
const HOST = (process.env.F1_MCP_HOST || "127.0.0.1").trim();
const AUTH_TOKEN = (process.env.F1_MCP_AUTH_TOKEN || "").trim();
const MAX_BODY_BYTES = 1024 * 1024;

const bridge = new AgentBridgeClient({
  serverUrl: process.env.F1_AGENT_SERVER,
  token: process.env.F1_AGENT_TOKEN,
  timeoutMs: process.env.F1_AGENT_CALL_TIMEOUT_MS,
  label: "f1-agent-mcp-http",
});

function jsonRpcResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function jsonRpcError(id, code, message, data) {
  return {
    jsonrpc: "2.0",
    id: id ?? null,
    error: { code, message, ...(data === undefined ? {} : { data }) },
  };
}

function serverMeta() {
  return { "io.modelcontextprotocol/serverInfo": MCP_SERVER_INFO };
}

function modernResult(result) {
  return { ...result, _meta: { ...(result._meta || {}), ...serverMeta() } };
}

function isLoopback(host) {
  return host === "127.0.0.1" || host === "::1" || host === "localhost";
}

function authenticated(req) {
  if (!AUTH_TOKEN) return true;
  const header = String(req.headers.authorization || "");
  return header === `Bearer ${AUTH_TOKEN}`;
}

function sendJson(res, status, body, extraHeaders = {}) {
  const encoded = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(encoded),
    "Cache-Control": "no-store",
    ...extraHeaders,
  });
  res.end(encoded);
}

function sendEmpty(res, status, extraHeaders = {}) {
  res.writeHead(status, { "Cache-Control": "no-store", ...extraHeaders });
  res.end();
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error("Request body too large"), { status: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) throw Object.assign(new Error("Empty request body"), { status: 400 });
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("Invalid JSON"), { status: 400 });
  }
}

function requestProtocol(message, req) {
  const bodyVersion = message?.params?._meta?.["io.modelcontextprotocol/protocolVersion"];
  const headerVersion = req.headers["mcp-protocol-version"];
  return { bodyVersion, headerVersion };
}

function validateModernHeaders(message, req) {
  const { bodyVersion, headerVersion } = requestProtocol(message, req);
  if (bodyVersion !== MODERN_PROTOCOL_VERSION || headerVersion !== MODERN_PROTOCOL_VERSION) {
    return "MCP-Protocol-Version header and request _meta must both be 2026-07-28.";
  }
  if (String(req.headers["mcp-method"] || "") !== message.method) {
    return "Mcp-Method header must match the JSON-RPC method.";
  }
  if (message.method === "tools/call" && String(req.headers["mcp-name"] || "") !== String(message.params?.name || "")) {
    return "Mcp-Name header must match params.name for tools/call.";
  }
  return null;
}

function looksModern(message, req) {
  const { bodyVersion, headerVersion } = requestProtocol(message, req);
  return bodyVersion === MODERN_PROTOCOL_VERSION || headerVersion === MODERN_PROTOCOL_VERSION || message?.method === "server/discover";
}

async function handleRpc(message, req) {
  if (!message || message.jsonrpc !== "2.0" || typeof message.method !== "string") {
    return { status: 400, body: jsonRpcError(message?.id, -32600, "Invalid Request") };
  }

  const modern = looksModern(message, req);
  if (modern) {
    const mismatch = validateModernHeaders(message, req);
    if (mismatch) {
      return {
        status: 400,
        body: jsonRpcError(message.id, -32602, "HeaderMismatch", { message: mismatch }),
      };
    }
  }

  // Legacy Streamable HTTP notifications are accepted without a body.
  if (message.id === undefined && message.method === "notifications/initialized") {
    return { status: 202, body: null };
  }

  if (message.method === "server/discover") {
    return {
      status: 200,
      body: jsonRpcResult(message.id, modernResult({
        resultType: "complete",
        supportedVersions: [MODERN_PROTOCOL_VERSION],
        capabilities: { tools: {} },
        instructions: "Control exactly one F1 Racer participant through f1_observe, f1_act, f1_enqueue and f1_release.",
        ttlMs: 300000,
        cacheScope: "private",
      })),
    };
  }

  if (message.method === "initialize") {
    const requested = message.params?.protocolVersion;
    const protocolVersion = requested === LEGACY_PROTOCOL_VERSION ? requested : LEGACY_PROTOCOL_VERSION;
    return {
      status: 200,
      body: jsonRpcResult(message.id, {
        protocolVersion,
        capabilities: { tools: {} },
        serverInfo: MCP_SERVER_INFO,
      }),
      headers: { "MCP-Protocol-Version": protocolVersion },
    };
  }

  if (message.method === "ping") {
    return {
      status: 200,
      body: jsonRpcResult(message.id, modern ? modernResult({ resultType: "complete" }) : {}),
    };
  }

  if (message.method === "tools/list") {
    const result = modern
      ? modernResult({
          resultType: "complete",
          tools: MCP_TOOLS,
          ttlMs: 300000,
          cacheScope: "private",
        })
      : { tools: MCP_TOOLS };
    return { status: 200, body: jsonRpcResult(message.id, result) };
  }

  if (message.method === "tools/call") {
    const name = message.params?.name;
    if (!MCP_TOOLS.some((tool) => tool.name === name)) {
      return { status: 200, body: jsonRpcError(message.id, -32602, `Unknown tool: ${name || ""}`) };
    }
    try {
      const value = await bridge.callTool(name, message.params?.arguments || {});
      const result = toolResult(value, { modern });
      return {
        status: 200,
        body: jsonRpcResult(message.id, modern ? modernResult(result) : result),
      };
    } catch (error) {
      const result = toolError(error, { modern });
      return {
        status: 200,
        body: jsonRpcResult(message.id, modern ? modernResult(result) : result),
      };
    }
  }

  return { status: 200, body: jsonRpcError(message.id, -32601, `Method not found: ${message.method}`) };
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (req.method === "GET" && url.pathname === "/health") {
    sendJson(res, 200, {
      status: "ok",
      configured: bridge.configured(),
      endpoint: "/mcp",
      protocolVersions: [MODERN_PROTOCOL_VERSION, LEGACY_PROTOCOL_VERSION],
      auth: AUTH_TOKEN ? "bearer" : "none",
    });
    return;
  }

  if (url.pathname !== "/mcp") {
    sendJson(res, 404, { error: "Not found" });
    return;
  }

  if (req.method === "OPTIONS") {
    sendEmpty(res, 204, {
      "Allow": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept, MCP-Protocol-Version, Mcp-Method, Mcp-Name",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    });
    return;
  }

  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" }, { "Allow": "POST, OPTIONS" });
    return;
  }

  if (!authenticated(req)) {
    sendJson(res, 401, jsonRpcError(null, -32001, "Unauthorized"), {
      "WWW-Authenticate": 'Bearer realm="f1-racer-mcp"',
    });
    return;
  }

  try {
    const message = await readJson(req);
    const response = await handleRpc(message, req);
    if (response.body === null) sendEmpty(res, response.status, response.headers);
    else sendJson(res, response.status, response.body, response.headers);
  } catch (error) {
    sendJson(
      res,
      error.status || 500,
      jsonRpcError(null, error.status === 400 ? -32700 : -32603, error.message || "Internal error")
    );
  }
});

server.listen(PORT, HOST, () => {
  process.stderr.write(
    `[f1-agent-mcp-http] listening on http://${HOST}:${PORT}/mcp; bridge=${bridge.configured() ? "configured" : "NOT configured"}; auth=${AUTH_TOKEN ? "bearer" : "none"}\n`
  );
  if (!AUTH_TOKEN && !isLoopback(HOST)) {
    process.stderr.write("[f1-agent-mcp-http] WARNING: non-loopback bind without F1_MCP_AUTH_TOKEN.\n");
  }
  if (!bridge.configured()) {
    process.stderr.write(`[f1-agent-mcp-http] ${bridge.configurationError()}\n`);
  }
});

function shutdown() {
  bridge.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1000).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
