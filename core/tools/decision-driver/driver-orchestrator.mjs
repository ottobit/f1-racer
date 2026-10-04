// Coordinates three independent clocks without knowing concrete providers or
// transports. Strategy and decision variants are injected at construction.
export class DriverOrchestrator {
  constructor({
    strategist,
    decisionProvider,
    agentPort,
    strategyIntervalMs = 1000,
    decisionIntervalMs = 150,
    onDecision = () => {},
    onError = (error) => process.stderr.write(`[decision-driver] ${error.message}\n`),
  }) {
    this.strategist = strategist;
    this.decisionProvider = decisionProvider;
    this.agentPort = agentPort;
    this.strategyIntervalMs = Math.max(100, Number(strategyIntervalMs) || 1000);
    this.decisionIntervalMs = Math.max(80, Number(decisionIntervalMs) || 150);
    this.onDecision = onDecision;
    this.onError = onError;
    this.running = false;
    this.strategy = null;
    this.lastStrategyAt = 0;
  }

  async start() {
    if (this.running) return;
    this.running = true;
    while (this.running) {
      const startedAt = Date.now();
      try {
        const observation = await this.agentPort.observe();
        if (!this.running) break;

        if (!this.strategy || startedAt - this.lastStrategyAt >= this.strategyIntervalMs) {
          this.strategy = await this.strategist.decideStrategy(observation, { now: startedAt });
          this.lastStrategyAt = startedAt;
        }

        if (observation?.finished) {
          this.stop();
          break;
        }

        const intent = await this.decisionProvider.decide(observation, this.strategy, { now: startedAt });
        await this.agentPort.drive(intent);
        this.onDecision({ observation, strategy: this.strategy, intent });
      } catch (error) {
        this.onError(error);
      }

      const wait = Math.max(0, this.decisionIntervalMs - (Date.now() - startedAt));
      if (this.running && wait) await delay(wait);
    }
    try { await this.agentPort.release(); } catch {}
  }

  stop() {
    this.running = false;
  }

  close() {
    this.stop();
    this.agentPort.close();
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
