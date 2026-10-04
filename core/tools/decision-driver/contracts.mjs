// Domain contracts for the provider-agnostic decision driver (#377).
// Concrete variants live behind these one-level families; callers never
// switch on concrete types after composition.

export class StrategyProvider {
  async decideStrategy(_observation, _context = {}) {
    throw new Error("StrategyProvider.decideStrategy() not implemented");
  }
}

export class DecisionProvider {
  async decide(_observation, _strategy, _context = {}) {
    throw new Error("DecisionProvider.decide() not implemented");
  }
}

export class ModelClient {
  async choose(_request) {
    throw new Error("ModelClient.choose() not implemented");
  }
}

export class AgentPort {
  async observe() {
    throw new Error("AgentPort.observe() not implemented");
  }

  async drive(_intent) {
    throw new Error("AgentPort.drive() not implemented");
  }

  async release() {
    throw new Error("AgentPort.release() not implemented");
  }

  close() {}
}

export class DrivingIntent {
  constructor({ pace = 0.86, line = 0, horizonMs = 750, confidence = null } = {}) {
    this.pace = clampNumber(pace, 0.5, 1, 0.86);
    this.line = clampNumber(line, -1, 1, 0);
    this.horizonMs = clampNumber(horizonMs, 100, 5000, 750);
    this.confidence = confidence == null ? null : clampNumber(confidence, 0, 1, null);
    Object.freeze(this);
  }
}

export class StrategyDirective {
  constructor({ mode = "cruise", overtakePolicy = "prefer-clean", pitPolicy = "auto", targetDriverId = null } = {}) {
    this.mode = ["attack", "cruise", "defend", "conserve"].includes(mode) ? mode : "cruise";
    this.overtakePolicy = String(overtakePolicy || "prefer-clean");
    this.pitPolicy = String(pitPolicy || "auto");
    this.targetDriverId = targetDriverId == null ? null : String(targetDriverId);
    Object.freeze(this);
  }
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(number, min), max);
}
