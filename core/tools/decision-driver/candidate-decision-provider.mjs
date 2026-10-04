import { DecisionProvider, DrivingIntent } from "./contracts.mjs";

// Generic model-backed decision provider. It knows racing semantics and
// bounded candidate intents; the injected ModelClient owns the model protocol.
export class CandidateDecisionProvider extends DecisionProvider {
  constructor({ modelClient }) {
    super();
    if (!modelClient || typeof modelClient.choose !== "function") {
      throw new Error("CandidateDecisionProvider requires a ModelClient");
    }
    this.modelClient = modelClient;
  }

  async decide(observation, strategy) {
    const candidates = buildCandidates(observation, strategy);
    const answer = await this.modelClient.choose({
      state: compactObservation(observation, strategy),
      instruction: "Choose the safest fast short-horizon racing target for the next few hundred milliseconds.",
      candidates,
    });

    const chosen = candidates.find((candidate) => candidate.id === answer?.choice) || candidates[0];
    return new DrivingIntent({
      ...chosen.intent,
      confidence: answer?.confidence,
    });
  }
}

function compactObservation(observation, strategy) {
  return {
    speedKmh: observation?.speedKmh,
    position: observation?.position,
    lateralOffsetMeters: observation?.lateralOffsetMeters,
    headingErrorRad: observation?.headingErrorRad,
    onTrack: observation?.onTrack,
    gapAheadS: observation?.gapAheadS,
    gapBehindS: observation?.gapBehindS,
    nextCorner: observation?.nextCorner,
    nearbyCars: (observation?.nearbyCars || []).slice(0, 3),
    strategy: {
      mode: strategy?.mode || "cruise",
      overtakePolicy: strategy?.overtakePolicy || "prefer-clean",
    },
  };
}

function buildCandidates(observation, strategy) {
  const basePace = {
    attack: 0.98,
    defend: 0.9,
    conserve: 0.72,
    cruise: 0.88,
  }[strategy?.mode || "cruise"] ?? 0.88;

  const corner = observation?.nextCorner || {};
  const cornerPenalty = Math.min(Math.max(Number(corner.curvature) || 0, 0), 1) * 0.16;
  const pace = Math.min(Math.max(basePace - cornerPenalty, 0.5), 1);

  return [
    {
      id: "hold",
      description: "Hold a neutral racing line at the current strategic pace.",
      intent: { pace, line: 0, horizonMs: 650 },
    },
    {
      id: "left",
      description: "Move progressively toward the left side of the racing corridor while keeping safe pace.",
      intent: { pace: Math.max(0.5, pace - 0.02), line: -0.75, horizonMs: 650 },
    },
    {
      id: "right",
      description: "Move progressively toward the right side of the racing corridor while keeping safe pace.",
      intent: { pace: Math.max(0.5, pace - 0.02), line: 0.75, horizonMs: 650 },
    },
    {
      id: "yield",
      description: "Reduce pace and hold center to avoid a risky contact or unstable situation.",
      intent: { pace: Math.max(0.5, pace - 0.16), line: 0, horizonMs: 650 },
    },
  ];
}
