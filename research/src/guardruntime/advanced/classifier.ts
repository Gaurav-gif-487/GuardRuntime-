import type { Reversibility, ToolCall, ToolDescriptor } from "../types";
export interface CompensationRegistry {
  hasCompensatingAction(toolName: string): boolean;
}
export interface ReversibilityPredictor {
  predict(request: ToolCall, tool: ToolDescriptor): Promise<Reversibility> | Reversibility;
}
export class AdvancedReversibilityClassifier {
  constructor(
    private readonly compensationRegistry: CompensationRegistry,
    private readonly predictor?: ReversibilityPredictor,
  ) {}
  async classifyReversibility(
    request: ToolCall,
    descriptor: ToolDescriptor,
  ): Promise<Reversibility> {
    const predicted = this.predictor
      ? await this.predictor.predict(request, descriptor)
      : descriptor.reversibility;
    if (
      predicted === "recoverable" &&
      !this.compensationRegistry.hasCompensatingAction(request.tool)
    )
      return "destructive";
    return predicted;
  }
}
