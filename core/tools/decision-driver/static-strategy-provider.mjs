import { StrategyDirective, StrategyProvider } from "./contracts.mjs";

export class StaticStrategyProvider extends StrategyProvider {
  constructor(directive = {}) {
    super();
    this.directive = new StrategyDirective(directive);
  }

  async decideStrategy() {
    return this.directive;
  }
}
