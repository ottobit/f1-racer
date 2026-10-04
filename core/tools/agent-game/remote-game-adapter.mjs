import { GameAdapter, GameIntent } from "../../shared/agent-game.js";
import { AgentBridgeClient } from "../agent-mcp-common.mjs";

// Generic transport adapter for any game page implementing the game_* tool
// contract. It knows nothing about F1, Doom, steering or game-specific state.
export class RemoteGameAdapter extends GameAdapter {
  constructor({ serverUrl, token, timeoutMs = 8000 } = {}) {
    super();
    this.client = new AgentBridgeClient({
      serverUrl,
      token,
      timeoutMs,
      label: "agent-game-runtime",
    });
    this.descriptor = null;
  }

  async describe() {
    if (!this.descriptor) this.descriptor = await this.client.callTool("game_describe");
    return this.descriptor;
  }

  async observe() {
    return this.client.callTool("game_observe");
  }

  async frame(strategy = null) {
    return this.client.callTool("game_frame", { strategy });
  }

  async act(intent) {
    const gameIntent = intent instanceof GameIntent ? intent : new GameIntent(intent);
    return this.client.callTool("game_act", { intent: gameIntent });
  }

  async release() {
    return this.client.callTool("game_release");
  }

  close() {
    this.client.close();
  }
}
