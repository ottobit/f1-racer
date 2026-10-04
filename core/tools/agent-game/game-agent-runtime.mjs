// Generic X x Y runtime (#377):
// X is any GameAdapter, Y is any StrategyProvider/DecisionProvider stack.
// The runtime never branches on a game id, action name or model vendor.
export class GameAgentRuntime {
  constructor({
    game,
    strategist,
    decisionProvider,
    strategyIntervalMs = 1000,
    decisionIntervalMs = 150,
    onDecision = () => {},
    onError = (error) => process.stderr.write(`[agent-game] ${error.message}\n`),
  }) {
    this.game = game;
    this.strategist = strategist;
    this.decisionProvider = decisionProvider;
    this.strategyIntervalMs = Math.max(100, Number(strategyIntervalMs) || 1000);
    this.decisionIntervalMs = Math.max(80, Number(decisionIntervalMs) || 150);
    this.onDecision = onDecision;
    this.onError = onError;
    this.running = false;
    this.strategy = null;
    this.lastStrategyAt = 0;
    this.descriptor = null;
  }

  async start() {
    if (this.running) return;
    this.running = true;
    this.descriptor = await this.game.describe();

    while (this.running) {
      const startedAt = Date.now();
      try {
        let frame = await this.game.frame(this.strategy);
        let observation = frame?.observation;

        if (!this.strategy || startedAt - this.lastStrategyAt >= this.strategyIntervalMs) {
          this.strategy = await this.strategist.decideStrategy(observation, {
            descriptor: this.descriptor,
            now: startedAt,
          });
          this.lastStrategyAt = startedAt;
          frame = await this.game.frame(this.strategy);
          observation = frame?.observation;
        }

        if (observation?.terminal) {
          this.stop();
          break;
        }

        const intent = await this.decisionProvider.decide(frame, {
          descriptor: this.descriptor,
          observation,
          strategy: this.strategy,
          now: startedAt,
        });
        await this.game.act(intent);
        this.onDecision({
          descriptor: this.descriptor,
          observation,
          strategy: this.strategy,
          intent,
        });
      } catch (error) {
        this.onError(error);
      }

      const wait = Math.max(0, this.decisionIntervalMs - (Date.now() - startedAt));
      if (this.running && wait) await delay(wait);
    }

    try { await this.game.release(); } catch {}
  }

  stop() {
    this.running = false;
  }

  close() {
    this.stop();
    this.game.close();
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
