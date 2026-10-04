#!/usr/bin/env node
import { CandidateDecisionProvider } from "./candidate-decision-provider.mjs";
import { DefaultDecisionProvider } from "./default-decision-provider.mjs";
import { GameAgentRuntime } from "./game-agent-runtime.mjs";
import { RemoteGameAdapter } from "./remote-game-adapter.mjs";
import { StaticStrategyProvider } from "./static-strategy-provider.mjs";
import { SystemOneModelClient } from "./system-one-model-client.mjs";

// Composition root only. This is the one place allowed to select concrete
// game/model/provider variants. The runtime itself is X x Y agnostic.
const gameAdapterName = envName("AGENT_GAME_ADAPTER", "remote");
const decisionProviderName = envName("AGENT_DECISION_PROVIDER", process.env.F1_DECISION_PROVIDER || "default");
const strategyProviderName = envName("AGENT_STRATEGY_PROVIDER", "static");
const modelClientName = envName("AGENT_MODEL_CLIENT", process.env.F1_MODEL_CLIENT || "systemone");

const serverUrl = process.env.GAME_SERVER || process.env.F1_AGENT_SERVER;
const token = process.env.GAME_TOKEN || process.env.F1_AGENT_TOKEN;

const gameAdapters = {
  remote: () => new RemoteGameAdapter({
    serverUrl,
    token,
    timeoutMs: process.env.GAME_CALL_TIMEOUT_MS || process.env.F1_AGENT_CALL_TIMEOUT_MS,
  }),
};

const strategyProviders = {
  static: () => new StaticStrategyProvider(staticStrategyConfig()),
};

const modelClients = {
  systemone: () => new SystemOneModelClient({
    baseUrl: process.env.AGENT_MODEL_BASE_URL || process.env.F1_MODEL_BASE_URL || "http://localhost:11434",
    model: process.env.AGENT_MODEL || process.env.F1_MODEL || "nimble",
    keepAlive: process.env.AGENT_MODEL_KEEP_ALIVE || process.env.F1_MODEL_KEEP_ALIVE || "5m",
  }),
};

const createGame = requireFactory("AGENT_GAME_ADAPTER", gameAdapterName, gameAdapters);
const createStrategyProvider = requireFactory("AGENT_STRATEGY_PROVIDER", strategyProviderName, strategyProviders);
const createModelClient = ["model", "candidate"].includes(decisionProviderName)
  ? requireFactory("AGENT_MODEL_CLIENT", modelClientName, modelClients)
  : null;

const decisionProviders = {
  default: () => new DefaultDecisionProvider(),
  rules: () => new DefaultDecisionProvider(), // legacy alias while #378 is draft
  model: () => new CandidateDecisionProvider({ modelClient: createModelClient() }),
  candidate: () => new CandidateDecisionProvider({ modelClient: createModelClient() }),
};
const createDecisionProvider = requireFactory("AGENT_DECISION_PROVIDER", decisionProviderName, decisionProviders);

const runtime = new GameAgentRuntime({
  game: createGame(),
  strategist: createStrategyProvider(),
  decisionProvider: createDecisionProvider(),
  strategyIntervalMs: process.env.AGENT_STRATEGY_INTERVAL_MS || process.env.F1_STRATEGY_INTERVAL_MS || 1000,
  decisionIntervalMs: process.env.AGENT_DECISION_INTERVAL_MS || process.env.F1_DECISION_INTERVAL_MS || 150,
  onDecision({ descriptor, observation, strategy, intent }) {
    const state = observation?.state || {};
    process.stdout.write(
      `[${descriptor?.id || observation?.gameId || "game"}] ` +
      `goal=${strategy?.goal || "default"} action=${intent.action} ` +
      `state=${summarizeState(state)}\n`
    );
  },
});

const stop = () => {
  runtime.stop();
  setTimeout(() => {
    runtime.close();
    process.exit(0);
  }, 100).unref();
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

process.stdout.write(
  `[agent-game] gameAdapter=${gameAdapterName} strategy=${strategyProviderName} ` +
  `decision=${decisionProviderName}` +
  (["model", "candidate"].includes(decisionProviderName)
    ? ` modelClient=${modelClientName} model=${process.env.AGENT_MODEL || process.env.F1_MODEL || "nimble"}`
    : "") +
  ` server=${serverUrl || "(missing)"}\n`
);

await runtime.start();

function envName(name, fallback) {
  return String(process.env[name] || fallback || "").trim().toLowerCase();
}

function staticStrategyConfig() {
  const raw = String(process.env.AGENT_STRATEGY_JSON || "").trim();
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      return {
        goal: parsed?.goal || "default",
        parameters: parsed?.parameters || {},
      };
    } catch (error) {
      throw new Error(`AGENT_STRATEGY_JSON is not valid JSON: ${error.message}`);
    }
  }

  const parameters = {};
  if (process.env.F1_OVERTAKE_POLICY) parameters.overtakePolicy = process.env.F1_OVERTAKE_POLICY;
  if (process.env.F1_PIT_POLICY) parameters.pitPolicy = process.env.F1_PIT_POLICY;
  return {
    goal: process.env.AGENT_STRATEGY_GOAL || process.env.F1_STRATEGY_MODE || "default",
    parameters,
  };
}

function requireFactory(name, selected, factories) {
  const factory = factories[selected];
  if (factory) return factory;
  throw new Error(`Unknown ${name} "${selected}". Use: ${Object.keys(factories).join(", ")}`);
}

function summarizeState(state) {
  if (Number.isFinite(Number(state.speedKmh))) {
    return `P${state.position ?? "?"} ${Math.round(state.speedKmh)}km/h`;
  }
  const keys = Object.keys(state).slice(0, 3);
  return keys.length ? keys.map((key) => `${key}=${String(state[key]).slice(0, 24)}`).join(" ") : "ready";
}
