import { DecisionProvider, GameIntent } from "../../shared/agent-game.js";

// Deterministic baseline for every game adapter: the game itself supplies a
// bounded default candidate. This tests the generic runtime without requiring
// a model and without moving game-specific rules into the runtime.
export class DefaultDecisionProvider extends DecisionProvider {
  async decide(frame) {
    const candidates = Array.isArray(frame?.candidates) ? frame.candidates : [];
    if (!candidates.length) throw new Error("DefaultDecisionProvider: game frame has no candidates");
    const chosen = candidates.find((candidate) => candidate.id === frame.defaultCandidateId) || candidates[0];
    return new GameIntent(chosen.intent);
  }
}
