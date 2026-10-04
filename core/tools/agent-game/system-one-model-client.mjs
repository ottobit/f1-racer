import { ModelClient } from "../../shared/agent-game.js";

// Protocol adapter only. The agent runtime and games see the normalized
// ModelClient.choose() contract, never System One request/response details.
export class SystemOneModelClient extends ModelClient {
  constructor({ baseUrl = "http://localhost:11434", model = "nimble", keepAlive = "5m", fetchImpl = fetch } = {}) {
    super();
    this.baseUrl = String(baseUrl).replace(/\/+$/, "");
    this.model = String(model || "nimble");
    this.keepAlive = keepAlive;
    this.fetchImpl = fetchImpl;
  }

  async choose({ state, instruction, candidates }) {
    const criteria = Object.fromEntries(
      candidates.map((candidate) => [candidate.id, candidate.description])
    );

    const response = await this.fetchImpl(`${this.baseUrl}/v1/systemone`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        state,
        questions: {
          choice: {
            type: "choice",
            instructions: instruction,
            criteria,
          },
        },
        keep_alive: this.keepAlive,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`System One request failed: ${response.status} ${body.slice(0, 300)}`);
    }

    const payload = await response.json();
    const answer = payload?.answers?.choice;
    if (!answer?.choice) throw new Error("System One response has no choice answer");
    return {
      choice: String(answer.choice),
      confidence: Number.isFinite(Number(answer.confidence)) ? Number(answer.confidence) : null,
      probabilities: answer.probabilities || null,
      usage: payload?.usage || null,
    };
  }
}
