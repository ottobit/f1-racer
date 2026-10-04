import { DecisionProvider, GameIntent } from "../../shared/agent-game.js";

// Model-backed but game-agnostic. The game adapter supplies state, instruction
// and bounded candidate intents; the ModelClient only chooses one candidate.
export class CandidateDecisionProvider extends DecisionProvider {
  constructor({ modelClient }) {
    super();
    if (!modelClient || typeof modelClient.choose !== "function") {
      throw new Error("CandidateDecisionProvider requires a ModelClient");
    }
    this.modelClient = modelClient;
  }

  async decide(frame) {
    const candidates = Array.isArray(frame?.candidates) ? frame.candidates : [];
    if (!candidates.length) throw new Error("CandidateDecisionProvider: game frame has no candidates");

    const answer = await this.modelClient.choose({
      state: frame.state,
      instruction: frame.instruction,
      candidates,
    });

    const chosen = candidates.find((candidate) => candidate.id === answer?.choice)
      || candidates.find((candidate) => candidate.id === frame.defaultCandidateId)
      || candidates[0];

    return new GameIntent({
      ...chosen.intent,
      confidence: answer?.confidence ?? chosen.intent?.confidence ?? null,
    });
  }
}
