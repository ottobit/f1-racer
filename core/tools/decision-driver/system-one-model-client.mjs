import { ModelClient } from "./contracts.mjs";

// Infrastructure-only client for Ollama's Jev-style /v1/systemone endpoint.
// It knows the wire protocol, not racing semantics.
export class SystemOneModelClient extends ModelClient {
  constructor({ baseUrl = "http://localhost:11434", model = "nimble", keepAlive = "5m", fetchImpl = fetch } = {}) {
    super();
    this.baseUrl = String(baseUrl).replace(/\/+$/, "");
    this.model = String(model || "nimble");
    this.keepAlive = keepAlive;
    this.fetchImpl = fetchImpl;
  }

  async decide({ state, questions }) {
    const response = await this.fetchImpl(`${this.baseUrl}/v1/systemone`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        state,
        questions,
        keep_alive: this.keepAlive,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`System One request failed: ${response.status} ${body.slice(0, 300)}`);
    }
    return response.json();
  }
}
