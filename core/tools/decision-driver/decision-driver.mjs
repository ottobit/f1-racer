#!/usr/bin/env node
import { DriverOrchestrator } from "./driver-orchestrator.mjs";
import { JevDecisionProvider } from "./jev-decision-provider.mjs";
import { RelayAgentPort } from "./relay-agent-port.mjs";
import { RulesDecisionProvider } from "./rules-decision-provider.mjs";
import { StaticStrategyProvider } from "./static-strategy-provider.mjs";
import { SystemOneModelClient } from "./system-one-model-client.mjs";

// Single composition root: concrete provider/transport selection happens here
// and nowhere in the orchestrator or race runtime.
const providerName = (process.env.F1_DECISION_PROVIDER || "rules").trim().toLowerCase();
const serverUrl = process.env.F1_AGENT_SERVER;
const token = process.env.F1_AGENT_TOKEN;

const strategist = new StaticStrategyProvider({
  mode: process.env.F1_STRATEGY_MODE || "cruise",
  overtakePolicy: process.env.F1_OVERTAKE_POLICY || "prefer-clean",
  pitPolicy: process.env.F1_PIT_POLICY || "auto",
});

const decisionProviders = {
  rules: () => new RulesDecisionProvider(),
  jev: () => new JevDecisionProvider({
    modelClient: new SystemOneModelClient({
      baseUrl: process.env.F1_MODEL_BASE_URL || "http://localhost:11434",
      model: process.env.F1_MODEL || "nimble",
      keepAlive: process.env.F1_MODEL_KEEP_ALIVE || "5m",
    }),
  }),
};

const createDecisionProvider = decisionProviders[providerName];
if (!createDecisionProvider) {
  throw new Error(`Unknown F1_DECISION_PROVIDER "${providerName}". Use: ${Object.keys(decisionProviders).join(", ")}`);
}

const port = new RelayAgentPort({
  serverUrl,
  token,
  timeoutMs: process.env.F1_AGENT_CALL_TIMEOUT_MS,
});

const orchestrator = new DriverOrchestrator({
  strategist,
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

process.stdout.write(`[decision-driver] provider=${providerName} server=${serverUrl || "(missing)"}\n`);
await orchestrator.start();
