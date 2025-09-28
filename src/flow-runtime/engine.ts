import { validateOptionFlow } from '../validation/flows';
import { buildOptionMatcher, normalizeOption, type NormalizedFlowOption } from '../validation/answers';
import { createStore } from './stateStore';

export interface FlowOption {
  readonly id: string;
  readonly text: string;
  readonly next?: string;
  readonly aliases?: readonly string[];
  readonly correct?: boolean;
}

export interface FlowNode {
  readonly id?: string;
  readonly prompt?: string;
  readonly terminal?: boolean;
  readonly options?: readonly FlowOption[];
  readonly template?: unknown;
  readonly lockOnComplete?: boolean;
}

export interface FlowDefinition {
  readonly start: string;
  readonly nodes: Record<string, FlowNode>;
}

export interface FlowState {
  readonly flow: FlowDefinition;
  readonly current: string;
}

export interface FlowStateStore {
  get(chatId: string): Promise<FlowState | null>;
  set(chatId: string, value: FlowState): Promise<void>;
  clear(chatId: string): Promise<void>;
  has(chatId: string): Promise<boolean>;
}

export type AdvanceError =
  | { ok: false; error: 'sem_fluxo_ativo' }
  | { ok: false; error: 'no_node'; nodeId: string }
  | { ok: false; error: 'input_invalido'; expected: readonly string[]; nodeId: string }
  | { ok: false; error: 'next_inexistente'; nodeId: string };

export type AdvanceSuccess =
  | { ok: true; terminal: true; prompt?: string; nodeId: string }
  | { ok: true; terminal: false; prompt?: string; options?: readonly string[]; nodeId: string };

export type AdvanceResult = AdvanceError | AdvanceSuccess;

export class FlowEngine {
  constructor(private readonly store: FlowStateStore = createStore()) {}

  async start(chatId: string, flow: FlowDefinition): Promise<{ ok: boolean; node?: FlowNode }> {
    const res = validateOptionFlow(flow, undefined, {});
    if (!res.ok) {
      return { ok: false };
    }
    await this.store.set(chatId, { flow, current: flow.start });
    return { ok: true, node: flow.nodes[flow.start] };
  }

  async getState(chatId: string): Promise<FlowState | null> {
    return this.store.get(chatId);
  }

  async isActive(chatId: string): Promise<boolean> {
    return this.store.has(chatId);
  }

  async cancel(chatId: string): Promise<void> {
    await this.store.clear(chatId);
  }

  private buildMatcher(node: FlowNode): { normalized: NormalizedFlowOption[]; match: ReturnType<typeof buildOptionMatcher> } {
    const options = Array.isArray(node.options) ? node.options : [];
    const normalized = options.map((option, index) => normalizeOption(option, index));
    const match = buildOptionMatcher(normalized);
    return { normalized, match };
  }

  async advance(chatId: string, inputRaw: string): Promise<AdvanceResult> {
    const state = await this.store.get(chatId);
    if (!state) {
      return { ok: false, error: 'sem_fluxo_ativo' };
    }
    const { flow, current } = state;
    const node = flow.nodes[current];
    if (!node) {
      await this.store.clear(chatId);
      return { ok: false, error: 'no_node', nodeId: current };
    }

    const options = Array.isArray(node.options) ? node.options : [];
    if (options.length === 0) {
      await this.store.clear(chatId);
      return { ok: true, terminal: true, prompt: node.prompt, nodeId: current };
    }

    const { normalized, match } = this.buildMatcher(node);
    const matched = match.match(inputRaw);
    if (!matched) {
      return { ok: false, error: 'input_invalido', expected: normalized.map((option) => option.text), nodeId: current };
    }

    const nextId = matched.option.next;
    if (!nextId) {
      await this.store.clear(chatId);
      return { ok: true, terminal: true, prompt: node.prompt, nodeId: current };
    }

    const nextNode = flow.nodes[nextId];
    if (!nextNode) {
      await this.store.clear(chatId);
      return { ok: false, error: 'next_inexistente', nodeId: nextId };
    }

    if (nextNode.terminal || !nextNode.options || nextNode.options.length === 0) {
      await this.store.clear(chatId);
      return { ok: true, terminal: true, prompt: nextNode.prompt, nodeId: nextId };
    }

    await this.store.set(chatId, { flow, current: nextId });
    const formattedOptions = nextNode.options?.map((option, index) => `${index + 1}. ${option.text}`) ?? [];
    return { ok: true, terminal: false, prompt: nextNode.prompt, options: formattedOptions, nodeId: nextId };
  }
}

export default FlowEngine;

export type FlowRuntimeEngine = FlowEngine;
