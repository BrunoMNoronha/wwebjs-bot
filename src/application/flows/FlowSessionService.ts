import { createFlowPromptTracker } from '../../app/flowPromptTracker';

export interface FlowOption {
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
}

export interface FlowDefinition {
  readonly start: string;
  readonly nodes: Record<string, FlowNode>;
}

export type FlowKey = 'menu' | 'catalog';

export interface FlowModule<T> {
  readonly flow: T;
}

export interface FlowModuleRegistry {
  readonly [key: string]: FlowModule<FlowDefinition> | FlowDefinition | undefined;
}

export interface FlowSessionServiceOptions {
  readonly flowModules: FlowModuleRegistry;
  readonly overrides?: Partial<Record<FlowKey, FlowDefinition>>;
  readonly menuFlowEnabled: boolean;
  readonly promptWindowMs: number;
}

export interface FlowRuntimeEngine {
  start(chatId: string, flow: FlowDefinition): Promise<{ ok: boolean; node?: FlowNode }>;
  advance(
    chatId: string,
    inputRaw: string,
  ): Promise<
    | { ok: false; error: string; expected?: string[]; nodeId?: string }
    | { ok: true; terminal: boolean; prompt?: string; options?: string[] }
  >;
  cancel(chatId: string): Promise<void>;
  isActive(chatId: string): Promise<boolean>;
}

export type FlowSafeSender = (chatId: string, content: string) => Promise<unknown>;

export interface FlowResumeTexts {
  readonly expiredFlowText: string;
  readonly flowUnavailableText: string;
}

export interface FlowAdvanceTexts extends FlowResumeTexts {
  readonly invalidOptionText: string;
  readonly genericFlowErrorText: string;
}

export interface FlowResumeContext {
  readonly chatId: string;
  readonly input: string;
  readonly flowEngine: FlowRuntimeEngine;
  readonly sendSafe: FlowSafeSender;
  readonly texts: FlowResumeTexts;
}

export interface FlowAdvanceContext extends FlowResumeContext {
  readonly texts: FlowAdvanceTexts;
}

interface FlowRestartStrategy {
  readonly key: FlowKey;
  start(chatId: string, flowEngine: FlowRuntimeEngine): Promise<{ ok: boolean; node?: FlowNode }>;
}

class StaticFlowRestartStrategy implements FlowRestartStrategy {
  constructor(
    public readonly key: FlowKey,
    private readonly definition: FlowDefinition,
  ) {}

  async start(chatId: string, flowEngine: FlowRuntimeEngine): Promise<{ ok: boolean; node?: FlowNode }> {
    return flowEngine.start(chatId, this.definition);
  }
}

class ConditionalFlowRestartStrategy implements FlowRestartStrategy {
  constructor(
    public readonly key: FlowKey,
    private readonly definition: FlowDefinition,
    private readonly isEnabled: () => boolean,
    private readonly fallback: FlowRestartStrategy,
  ) {}

  async start(chatId: string, flowEngine: FlowRuntimeEngine): Promise<{ ok: boolean; node?: FlowNode }> {
    if (!this.isEnabled()) {
      return this.fallback.start(chatId, flowEngine);
    }
    return flowEngine.start(chatId, this.definition);
  }
}

/**
 * Implementa o *State Pattern* para retomar fluxos expirados sem espalhar
 * condicionais por toda a classe. Cada estado representa uma combinação de
 * pré-condições (prompt recente, input válido etc.) e decide se deve ou não
 * disparar um reinício.
 */
interface FlowReentryState {
  handle(): Promise<boolean>;
}

class FlowReentryContext {
  constructor(
    public readonly service: FlowSessionService,
    public readonly request: FlowResumeContext,
    public readonly previousKey: FlowKey | undefined,
    public readonly strategy: FlowRestartStrategy | undefined,
  ) {}
}

class FlowReentryNoopState implements FlowReentryState {
  constructor(private readonly context: FlowReentryContext) {}

  async handle(): Promise<boolean> {
    if (!this.context.request.input) {
      return false;
    }
    return false;
  }
}

class FlowReentryRestartState implements FlowReentryState {
  constructor(private readonly context: FlowReentryContext) {}

  async handle(): Promise<boolean> {
    const { request, service, strategy } = this.context;
    if (!strategy) {
      return false;
    }

    await request.sendSafe(request.chatId, request.texts.expiredFlowText);
    const result = await strategy.start(request.chatId, request.flowEngine);
    if (!result.ok || !result.node) {
      service.clearPrompt(request.chatId);
      await request.sendSafe(request.chatId, request.texts.flowUnavailableText);
      return true;
    }
    await service.sendPrompt(request.chatId, result.node, strategy.key, request.sendSafe);
    return true;
  }
}

function createReentryState(context: FlowReentryContext): FlowReentryState {
  if (!context.request.chatId || !/^\d+$/.test(context.request.input) || !context.previousKey) {
    return new FlowReentryNoopState(context);
  }
  if (!context.strategy) {
    return new FlowReentryNoopState(context);
  }
  return new FlowReentryRestartState(context);
}

export class FlowSessionService {
  private readonly tracker = createFlowPromptTracker({ windowMs: this.options.promptWindowMs });
  private readonly flows: Readonly<Record<FlowKey, FlowDefinition>>;
  private readonly strategies: ReadonlyMap<FlowKey, FlowRestartStrategy>;

  constructor(private readonly options: FlowSessionServiceOptions) {
    this.flows = this.buildFlowRegistry();
    this.strategies = this.buildStrategies();
  }

  private buildFlowRegistry(): Readonly<Record<FlowKey, FlowDefinition>> {
    const resolvedMenu = this.resolveFlowDefinition('menu');
    const resolvedCatalog = this.resolveFlowDefinition('catalog');
    return Object.freeze({ menu: resolvedMenu, catalog: resolvedCatalog });
  }

  private buildStrategies(): ReadonlyMap<FlowKey, FlowRestartStrategy> {
    const catalogStrategy = new StaticFlowRestartStrategy('catalog', this.flows.catalog);
    const menuStrategy = new ConditionalFlowRestartStrategy(
      'menu',
      this.flows.menu,
      () => this.options.menuFlowEnabled,
      catalogStrategy,
    );
    return new Map<FlowKey, FlowRestartStrategy>([
      ['catalog', catalogStrategy],
      ['menu', menuStrategy],
    ]);
  }

  private resolveFlowDefinition(key: FlowKey): FlowDefinition {
    if (this.options.overrides?.[key]) {
      return this.options.overrides[key] as FlowDefinition;
    }
    const moduleEntry = this.options.flowModules[key];
    if (!moduleEntry) {
      throw new Error(`Fluxo desconhecido: ${key}`);
    }
    if (typeof moduleEntry === 'object' && 'flow' in moduleEntry && moduleEntry.flow) {
      return moduleEntry.flow as FlowDefinition;
    }
    return moduleEntry as FlowDefinition;
  }

  getFlowDefinition(key: FlowKey): FlowDefinition {
    return this.flows[key];
  }

  rememberPrompt(chatId: string, flowKey?: FlowKey): void {
    this.tracker.remember(chatId, flowKey);
  }

  clearPrompt(chatId: string): void {
    this.tracker.clear(chatId);
  }

  recentFlowKey(chatId: string): FlowKey | undefined {
    const key = this.tracker.recentFlowKey(chatId);
    if (key === 'menu' || key === 'catalog') {
      return key;
    }
    return undefined;
  }

  formatPrompt(node: FlowNode | { prompt?: string; options?: readonly string[] } | undefined): string {
    if (!node) {
      return '';
    }
    const prompt = node.prompt ?? '';
    const options = Array.isArray(node.options)
      ? node.options.map((option, index) => {
        if (typeof option === 'string') {
          return option;
        }
        return `${index + 1}. ${option.text}`;
      })
      : [];
    if (prompt && options.length > 0) {
      return `${prompt}\n${options.join('\n')}`;
    }
    if (options.length > 0) {
      return options.join('\n');
    }
    return prompt;
  }

  async sendPrompt(chatId: string, node: FlowNode | undefined, flowKey: FlowKey, sendSafe: FlowSafeSender): Promise<void> {
    const text = this.formatPrompt(node);
    if (text) {
      await sendSafe(chatId, text);
    }
    this.rememberPrompt(chatId, flowKey);
  }

  async resumeIfPossible(request: FlowResumeContext): Promise<boolean> {
    const previousKey = this.recentFlowKey(request.chatId);
    const strategy = previousKey ? this.strategies.get(previousKey) : undefined;
    const state = createReentryState(new FlowReentryContext(this, request, previousKey, strategy));
    return state.handle();
  }

  async advanceOrRestart(context: FlowAdvanceContext): Promise<boolean> {
    if (!context.chatId || !context.input) {
      return false;
    }

    const active = await context.flowEngine.isActive(context.chatId);
    if (!active) {
      return this.resumeIfPossible(context);
    }

    const result = await context.flowEngine.advance(context.chatId, context.input);
    if (!result.ok) {
      if (result.error === 'input_invalido') {
        await context.sendSafe(context.chatId, context.texts.invalidOptionText);
        return true;
      }
      this.clearPrompt(context.chatId);
      try {
        await context.flowEngine.cancel(context.chatId);
      } catch (error) {
        // Ignorado: cancelamento falho não deve impedir resposta amigável.
      }
      await context.sendSafe(context.chatId, context.texts.genericFlowErrorText);
      return true;
    }

    if (result.terminal) {
      if (result.prompt) {
        await context.sendSafe(context.chatId, result.prompt);
      }
      this.rememberPrompt(context.chatId);
      return true;
    }

    const formatted = this.formatPrompt({ prompt: result.prompt, options: result.options ?? [] });
    if (formatted) {
      await context.sendSafe(context.chatId, formatted);
    }
    this.rememberPrompt(context.chatId);
    return true;
  }
}
