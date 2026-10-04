import { AgentPort } from "./contracts.mjs";
import { AgentBridgeClient } from "../agent-mcp-common.mjs";

// Directly reuses the existing Render room agent relay. MCP is not required
// for a local model runner; remote MCP clients can use a different AgentPort.
export class RelayAgentPort extends AgentPort {
  constructor({ serverUrl, token, timeoutMs = 8000 } = {}) {
    super();
    this.client = new AgentBridgeClient({
      serverUrl,
      token,
      timeoutMs,
      label: "f1-decision-driver",
    });
  }

  async observe() {
    return this.client.callTool("f1_observe");
  }

  async drive(intent) {
    return this.client.callTool("f1_drive", intent);
  }

  async release() {
    return this.client.callTool("f1_release");
  }

  close() {
    this.client.close();
  }
}
