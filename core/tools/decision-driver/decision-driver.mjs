#!/usr/bin/env node
import { CandidateDecisionProvider } from "./candidate-decision-provider.mjs";
import { DriverOrchestrator } from "./driver-orchestrator.mjs";
import { RelayAgentPort } from "./relay-agent-port.mjs";
import { RulesDecisionProvider } from "./rules-decision-provider.mjs";
import { StaticStrategyProvider } from "./static-strategy-provider.mjs";
import { SystemOneModelClient } from "./system-one-model-client.mjs";

// Single composition root: concrete strategy, decision and model-protocol
// variants are selected here. The orchestrator and race runtime never switch
// on concrete types.
const providerName = envName("F1_DECISION_PROVIDER", "rules");
const strategyProviderName = envName("F1_STRATEGY_PROVIDER", "static");
const modelClientName = envName("F1_MODEL_CLIENT", "systemone");
const serverUrl = process.env.F1_AGENT_SERVER;
const token = process.env.F1_AGENT_TOKEN;

const strategyProviders = {
  static: () => new StaticStrategyProvider({
    mode: process.env.F1_STRATEGY_MODE || "cruise",
    overtakePolicy: process.env.F1_OVERTAKE_POLICY || "prefer-clean",
    pitPolicy: process.env.F1_PIT_POLICY || "auto",
  }),
};

const modelClients = {
  systemone: () => new SystemOneModelClient({
    baseUrl: process.env.F1_MODEL_BASE_URL || "http://localhost:11434",
    model: process.env.F1_MODEL || "nimble",
    keepAlive: process.env.F1_MODEL_KEEP_ALIVE || "5m",
  }),
};

const createStrategyProvider = requireFactory("F1_STRATEGY_PROVIDER", strategyProviderName, strategyProviders);
const createModelClient = providerName === "model"
  ? requireFactory("F1_MODEL_CLIENT", modelClientName, modelClients)
  : null;

const decisionProviders = {
  rules: () => new RulesDecisionProvider(),
  model: () => new CandidateDecisionProvider({ modelClient: createModelClient() }),
};
const createDecisionProvider = requireFactory("F1_DECISION_PROVIDER", providerName, decisionProviders);

const port = new RelayAgentPort({
  serverUrl,
  token,
  timeoutMs: process.env.F1_AGENT_CALL_TIMEOUT_MS,
});

const orchestrator = new DriverOrchestrator({
  strategist: createStrategyProvider(),
  decisionProvider: createDecisionProvider(),
  agentPort: port,
  strategyIntervalMs: process.env.F1_STRATEGY_INTERVAL_MS || 1000,
  decisionIntervalMs: process.env.F1_DECISION_INTERVAL_MS || 150,
  onDecision({ observation, strategy, intent }) {
    const line = [
      `P${observation?.position ?? "?"}`,
      `${Math.round(observation?.speedKmh || 0)}km/h`,
      `strategy=${strategy.mode}`,
      `pace=${intent.pace.toFixed(2)}`,
      `line=${intent.line.toFixed(2)}`,
      intent.confidence == null ? null : `conf=${intent.confidence.toFixed(2)}`,
    ].filter(Boolean).join(" ");
    process.stdout.write(`${line}\n`);
  },
});

const stop = () => {
  orchestrator.stop();
  setTimeout(() => {
    orchestrator.close();
    process.exit(0);
  }, 100).unref();
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

process.stdout.write(
  `[decision-driver] strategy=${strategyProviderName} decision=${providerName}` +
  (providerName === "model" ? ` modelClient=${modelClientName} model=${process.env.F1_MODEL || "nimble"}` : "") +
  ` server=${serverUrl || "(missing)"}\n`
);
await orchestrator.start();

function envName(name, fallback) {
  return (process.env[name] || fallback).trim().toLowerCase();
}

function requireFactory(name, selected, factories) {
  const factory = factories[selected];
  if (factory) return factory;
  throw new Error(`Unknown ${name} "${selected}". Use: ${Object.keys(factories).join(", ")}`);
}
