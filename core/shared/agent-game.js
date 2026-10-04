// Shared, game-agnostic agent runtime contracts (#377).
// Pure data/interfaces only: safe for both browser and Node imports.

export class GameAdapter {
  async describe() {
    throw new Error("GameAdapter.describe() not implemented");
  }

  async observe() {
    throw new Error("GameAdapter.observe() not implemented");
  }

  async frame(_strategy) {
    throw new Error("GameAdapter.frame() not implemented");
  }

  async act(_intent) {
    throw new Error("GameAdapter.act() not implemented");
  }

  async release() {
    throw new Error("GameAdapter.release() not implemented");
  }

  close() {}
}

export class StrategyProvider {
  async decideStrategy(_observation, _context = {}) {
    throw new Error("StrategyProvider.decideStrategy() not implemented");
  }
}

export class DecisionProvider {
  async decide(_frame, _context = {}) {
    throw new Error("DecisionProvider.decide() not implemented");
  }
}

export class ModelClient {
  async choose(_request) {
    throw new Error("ModelClient.choose() not implemented");
  }
}

export class GameObservation {
  constructor({ gameId, state = {}, terminal = false, timestamp = Date.now() } = {}) {
    this.gameId = String(gameId || "unknown");
    this.state = state && typeof state === "object" ? state : {};
    this.terminal = !!terminal;
    this.timestamp = Number(timestamp) || Date.now();
    Object.freeze(this);
  }
}

export class GameIntent {
  constructor({ action, parameters = {}, horizonMs = 750, confidence = null } = {}) {
    if (!action) throw new Error("GameIntent requires an action");
    this.action = String(action);
    this.parameters = parameters && typeof parameters === "object" ? { ...parameters } : {};
    this.horizonMs = clampNumber(horizonMs, 100, 5000, 750);
    this.confidence = confidence == null ? null : clampNumber(confidence, 0, 1, null);
    Object.freeze(this.parameters);
    Object.freeze(this);
  }
}

export class StrategyDirective {
  constructor({ goal = "default", parameters = {} } = {}) {
    this.goal = String(goal || "default");
    this.parameters = parameters && typeof parameters === "object" ? { ...parameters } : {};
    Object.freeze(this.parameters);
    Object.freeze(this);
  }
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(number, min), max);
}
