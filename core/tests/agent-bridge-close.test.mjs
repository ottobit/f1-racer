// Regression test for #398: a race page that registers an agent bridge and
// closes (or re-registers) with no controller attached must not crash the
// room server. Run: node --test core/tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const SERVER = fileURLToPath(new URL("../server/room-server.mjs", import.meta.url));
const PORT = 18000 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}`;

function startServer() {
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, PORT: String(PORT), KEEP_AWAKE_URL: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (d) => { stderr += d; });
  const ready = new Promise((resolve, reject) => {
    child.stdout.on("data", (d) => { if (String(d).includes("listening")) resolve(); });
    child.once("exit", (code) => reject(new Error(`server exited ${code}: ${stderr}`)));
  });
  return { child, ready, stderr: () => stderr };
}

function open() {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
  const queue = [];
  const waiters = [];
  ws.on("message", (raw) => {
    const msg = JSON.parse(raw.toString());
    const i = waiters.findIndex((w) => w.type === msg.type || msg.type === "error");
    if (i >= 0) waiters.splice(i, 1)[0].resolve(msg); else queue.push(msg);
  });
  const next = (type) => {
    const i = queue.findIndex((m) => m.type === type || m.type === "error");
    if (i >= 0) return Promise.resolve(queue.splice(i, 1)[0]);
    return new Promise((resolve) => waiters.push({ type, resolve }));
  };
  const request = (msg, reply) => { ws.send(JSON.stringify(msg)); return next(reply); };
  return new Promise((resolve) => ws.once("open", () => resolve({ ws, request })));
}

const closed = (ws) => new Promise((resolve) => { ws.once("close", resolve); ws.close(); });
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function healthy() {
  const res = await fetch(`${BASE}/health`);
  return res.status === 200;
}

test("bridge without controller: re-register and page close keep the server alive", async () => {
  const server = startServer();
  try {
    await server.ready;
    const page = await open();
    const created = await page.request({ type: "create_room", reqId: 1, nickname: "tev1" }, "room_created");
    assert.equal(created.type, "room_created");

    const first = await page.request({ type: "agent_bridge_register", reqId: 2 }, "agent_bridge_registered");
    assert.equal(first.type, "agent_bridge_registered");
    // bridge_replaced path: the old bridge has no controller either.
    const second = await page.request({ type: "agent_bridge_register", reqId: 3 }, "agent_bridge_registered");
    assert.equal(second.type, "agent_bridge_registered", JSON.stringify(second));

    // race_page_closed path.
    await closed(page.ws);
    await delay(200);
    assert.equal(server.child.exitCode, null, `server died: ${server.stderr()}`);
    assert.ok(await healthy());
  } finally {
    server.child.kill();
  }
});
