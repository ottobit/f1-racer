import { GameAdapter, GameIntent, GameObservation } from "../../shared/agent-game.js?v=1";

// F1 Racer is the first game plugin for the generic agent runtime (#377).
// Racing semantics stay here: the external runtime sees only generic
// game_describe / game_frame / game_act contracts.
export class F1RacerGameAdapter extends GameAdapter {
  constructor({ getState, drive, release }) {
    super();
    this.getState = getState;
    this.drive = drive;
    this.releaseControl = release;
  }

  async describe() {
    return {
      id: "f1-racer",
      name: "F1 Racer",
      protocolVersion: 1,
      capabilities: {
        observation: "structured",
        actions: [
          {
            name: "drive",
            description: "Pursue a bounded racing-line and pace target.",
            parameters: {
              pace: { type: "number", minimum: 0.5, maximum: 1 },
              line: { type: "number", minimum: -1, maximum: 1 },
            },
          },
        ],
        strategy: {
          goals: ["attack", "cruise", "defend", "conserve"],
          parameters: {
            overtakePolicy: ["prefer-clean", "follow"],
            pitPolicy: ["auto", "stay-out", "box"],
          },
        },
      },
    };
  }

  async observe() {
    const state = this.getState();
    return new GameObservation({
      gameId: "f1-racer",
      state,
      terminal: !!state.finished,
      timestamp: state.timestamp,
    });
  }

  async frame(strategy = null) {
    const observation = await this.observe();
    const raceState = observation.state;
    const strategyGoal = strategy?.goal || "cruise";
    const strategyParameters = strategy?.parameters || {};
    const candidates = buildCandidates(raceState, strategyGoal);
    return {
      observation,
      state: compactState(raceState, strategyGoal, strategyParameters),
      instruction: "Choose the safest fast short-horizon racing target for the next few hundred milliseconds.",
      candidates,
      defaultCandidateId: chooseDefaultCandidate(raceState, strategyGoal, strategyParameters, candidates),
    };
  }

  async act(rawIntent = {}) {
    const intent = rawIntent instanceof GameIntent ? rawIntent : new GameIntent(rawIntent);
    if (intent.action !== "drive") throw new Error(`f1-game-adapter: unsupported action ${intent.action}`);
    return this.drive({
      pace: intent.parameters.pace,
      line: intent.parameters.line,
      horizonMs: intent.horizonMs,
      confidence: intent.confidence,
    });
  }

  async release() {
    return this.releaseControl();
  }
}

function compactState(state, strategyGoal, strategyParameters) {
  return {
    speedKmh: state?.speedKmh,
    position: state?.position,
    lateralOffsetMeters: state?.lateralOffsetMeters,
    headingErrorRad: state?.headingErrorRad,
    onTrack: state?.onTrack,
    gapAheadS: state?.gapAheadS,
    gapBehindS: state?.gapBehindS,
    nextCorner: state?.nextCorner,
    nearbyCars: (state?.nearbyCars || []).slice(0, 3),
    strategy: {
      goal: strategyGoal,
      ...strategyParameters,
    },
  };
}

function buildCandidates(state, strategyGoal) {
  const basePace = {
    attack: 0.98,
    defend: 0.9,
    conserve: 0.72,
    cruise: 0.88,
  }[strategyGoal] ?? 0.88;

  const severity = Math.min(Math.max(Number(state?.nextCorner?.curvature) || 0, 0), 1);
  const pace = clamp(basePace - severity * 0.16, 0.5, 1);
  return [
    candidate("hold", "Hold a neutral racing line at the current strategic pace.", pace, 0),
    candidate("left", "Move progressively toward the left side of the racing corridor while keeping safe pace.", Math.max(0.5, pace - 0.02), -0.75),
    candidate("right", "Move progressively toward the right side of the racing corridor while keeping safe pace.", Math.max(0.5, pace - 0.02), 0.75),
    candidate("yield", "Reduce pace and hold center to avoid a risky contact or unstable situation.", Math.max(0.5, pace - 0.16), 0),
  ];
}

function candidate(id, description, pace, line) {
  return {
    id,
    description,
    intent: new GameIntent({
      action: "drive",
      parameters: { pace, line },
      horizonMs: 650,
    }),
  };
}

function chooseDefaultCandidate(state, strategyGoal, strategyParameters, candidates) {
  if (!state?.onTrack) return "yield";

  const closeAhead = (state?.nearbyCars || [])
    .find((car) => car.relative === "ahead" && Number(car.distanceMeters) < 18);
  if (closeAhead && strategyParameters.overtakePolicy !== "follow") {
    const otherSide = Math.sign(Number(closeAhead.lateralOffsetMeters) || 0);
    return otherSide > 0 ? "left" : otherSide < 0 ? "right" : "right";
  }

  if (strategyGoal === "defend" && state?.gapBehindS != null && state.gapBehindS < 0.7) {
    const direction = state?.nextCorner?.direction;
    return direction === "left" ? "left" : direction === "right" ? "right" : "hold";
  }

  return candidates.some((candidate) => candidate.id === "hold") ? "hold" : candidates[0]?.id;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
