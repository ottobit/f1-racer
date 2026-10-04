import { StrategyDirective, StrategyProvider } from "../../shared/agent-game.js";

export class StaticStrategyProvider extends StrategyProvider {
  constructor({ goal = "default", parameters = {} } = {}) {
    super();
    this.directive = new StrategyDirective({ goal, parameters });
  }

  async decideStrategy() {
    return this.directive;
  }
}
