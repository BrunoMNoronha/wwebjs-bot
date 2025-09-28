import { List, type MessageContent } from 'whatsapp-web.js';
import { createFlowPromptTracker } from '../../app/flowPromptTracker';
import type { MenuTemplate, FlowTextConfig } from '../../config/messages';
import {
  buildOptionMatcher,
  normalizeOption,
  type NormalizedFlowOption,
} from '../../validation/answers';
import type {
  AdvanceResult,
  FlowDefinition as RuntimeFlowDefinition,
  FlowNode as RuntimeFlowNode,
  FlowOption as RuntimeFlowOption,
  FlowEngine as FlowRuntimeEngine,
} from '../../flow-runtime/engine';
import { ConversationRecoveryService, type AttemptStatus } from '../messaging/ConversationRecoveryService';

export interface FlowOption extends RuntimeFlowOption {}

type FlowPrompt =
  | { readonly kind: 'text'; readonly promptContent: string }
  | { readonly kind: 'list'; readonly promptContent: MenuTemplate };

export type FlowNode = (RuntimeFlowNode & FlowPrompt & { readonly lockOnComplete?: boolean });

export interface FlowDefinition extends RuntimeFlowDefinition {
  readonly nodes: Record<string, FlowNode>;
}

export type FlowKey = 'menu' | 'catalog';

export interface FlowModule<T> {
  readonly flow: T;
}

export type FlowModuleRegistry = Readonly<Record<FlowKey, FlowModule<FlowDefinition>>>;

export interface FlowSessionServiceOptions {
  readonly flowModules: FlowModuleRegistry;
  readonly overrides?: Partial<Record<FlowKey, FlowDefinition>>;
  readonly menuFlowEnabled: boolean;
  readonly promptWindowMs: number;
  readonly conversationRecovery: ConversationRecoveryService;
  readonly textConfig: FlowTextConfig;
  readonly initialMenuTemplate: MenuTemplate;
  readonly fallbackMenuTemplate: MenuTemplate;
  readonly lockDurationMs: number;
  readonly fuzzySuggestionThreshold: number;
  readonly fuzzyConfirmationThreshold: number;
}

export type FlowSafeSender = (chatId: string, content: MessageContent) => Promise<unknown>;

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
  readonly resetDelay?: (chatId: string) => void;
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
    const result = await flowEngine.start(chatId, this.definition);
    if (result.ok && result.node) {
      return { ok: true, node: result.node as FlowNode };
    }
    return result as { ok: boolean; node?: FlowNode };
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
    const result = await flowEngine.start(chatId, this.definition);
    if (result.ok && result.node) {
      return { ok: true, node: result.node as FlowNode };
    }
    return result as { ok: boolean; node?: FlowNode };
  }
}

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
    await service.sendPrompt(request.chatId, result.node as FlowNode, strategy.key, request.sendSafe);
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
    const override = this.options.overrides?.[key];
    if (override) {
      return override;
    }
    const moduleEntry = this.options.flowModules[key];
    if (!moduleEntry) {
      const availableKeys = Object.keys(this.options.flowModules);
      const availableList = availableKeys.length > 0 ? availableKeys.join(', ') : 'nenhum';
      throw new Error(`Fluxo desconhecido: ${key}. Disponíveis: ${availableList}`);
    }
    if (!moduleEntry.flow) {
      throw new Error(`Módulo de fluxo sem definição: ${key}`);
    }
    return moduleEntry.flow;
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

  private formatPrompt(prompt: FlowPrompt): MessageContent {
    if (prompt.kind === 'text') {
      return prompt.promptContent;
    }

    const sections = prompt.promptContent.sections.map((section) => ({
      title: section.title,
      rows: section.rows.map((row) => ({ ...row })),
    }));
    const list = new List(
      prompt.promptContent.body,
      prompt.promptContent.buttonText,
      sections,
      prompt.promptContent.title,
    );
    return list as MessageContent;
  }

  async sendPrompt(chatId: string, node: FlowNode | undefined, flowKey: FlowKey, sendSafe: FlowSafeSender): Promise<void> {
    if (!node) {
      return;
    }
    if (node.kind === 'list' && typeof node.prompt === 'string' && node.prompt.trim()) {
      await sendSafe(chatId, node.prompt);
    }
    const message = this.formatPrompt(node);
    await sendSafe(chatId, message);
    this.rememberPrompt(chatId, flowKey);
  }

  async resumeIfPossible(request: FlowResumeContext): Promise<boolean> {
    const previousKey = this.recentFlowKey(request.chatId);
    const strategy = previousKey ? this.strategies.get(previousKey) : undefined;
    const state = createReentryState(new FlowReentryContext(this, request, previousKey, strategy));
    return state.handle();
  }

  private async startInitialFlow(
    chatId: string,
    engine: FlowRuntimeEngine,
    sendSafe: FlowSafeSender,
  ): Promise<boolean> {
    const menuFlow = this.getFlowDefinition('menu');
    const start = await engine.start(chatId, menuFlow);
    if (!start.ok || !start.node) {
      return false;
    }
    await this.sendPrompt(chatId, start.node as FlowNode, 'menu', sendSafe);
    return true;
  }

  private async handleSuggestionConfirmation(
    context: FlowAdvanceContext,
    normalizedInput: string,
  ): Promise<boolean> {
    const suggestion = await this.options.conversationRecovery.peekPendingSuggestion(context.chatId);
    if (!suggestion) {
      return false;
    }

    const affirmative = ['sim', 's', 'isso', 'claro'];
    const negative = ['nao', 'não', 'n', 'negativo'];
    if (affirmative.includes(normalizedInput)) {
      const resolved = await this.options.conversationRecovery.consumePendingSuggestion(context.chatId);
      const optionId = resolved?.optionId ?? suggestion.optionId;
      return this.advanceWithInput(context, optionId);
    }
    if (negative.includes(normalizedInput)) {
      const status = await this.options.conversationRecovery.recordInvalidAttempt(context.chatId, {
        skipIfAwaitingConfirmation: true,
      });
      return this.handleInvalidAttempt(context, status);
    }
    return false;
  }

  private matchFallbackInput(input: string): 'aguardar_atendente' | 'voltar_menu' | null {
    const normalized = input.trim().toLowerCase();
    if (!normalized) {
      return null;
    }
    if (
      normalized === '1'
      || normalized.includes('aguardar')
      || normalized === 'aguardar_atendente'
    ) {
      return 'aguardar_atendente';
    }
    if (normalized === '2' || normalized.includes('voltar') || normalized === 'voltar_menu') {
      return 'voltar_menu';
    }
    return null;
  }

  private async handleFallbackResponse(context: FlowAdvanceContext, input: string): Promise<boolean> {
    const status = await this.options.conversationRecovery.getAttempts(context.chatId);
    if (status.phase !== 'fallback') {
      return false;
    }
    const match = this.matchFallbackInput(input);
    if (!match) {
      const attempts = await this.options.conversationRecovery.recordInvalidAttempt(context.chatId);
      return this.handleInvalidAttempt(context, attempts);
    }

    if (match === 'voltar_menu') {
      await this.options.conversationRecovery.recordValidSelection(context.chatId);
      await context.sendSafe(context.chatId, this.options.textConfig.resumedNotice);
      await this.sendInitialMenu(context.chatId, context.sendSafe);
      context.resetDelay?.(context.chatId);
      return true;
    }

    await this.finishWithLock(context, this.options.textConfig.fallbackClosure);
    return true;
  }

  private async finishWithLock(context: FlowAdvanceContext, message: string): Promise<void> {
    await context.sendSafe(context.chatId, message);
    await this.options.conversationRecovery.lock(
      context.chatId,
      Date.now() + this.options.lockDurationMs,
    );
    await context.sendSafe(context.chatId, this.options.textConfig.lockedNotice);
    this.clearPrompt(context.chatId);
    context.resetDelay?.(context.chatId);
  }

  private async sendInitialMenu(chatId: string, sendSafe: FlowSafeSender): Promise<void> {
    await sendSafe(chatId, `${this.options.textConfig.welcomeHeader}\n${this.options.textConfig.welcomeBody}`);
    const message = this.formatPrompt({ kind: 'list', promptContent: this.options.initialMenuTemplate });
    await sendSafe(chatId, message);
    this.rememberPrompt(chatId, 'menu');
  }

  private async sendFallbackMenu(chatId: string, sendSafe: FlowSafeSender): Promise<void> {
    const message = this.formatPrompt({ kind: 'list', promptContent: this.options.fallbackMenuTemplate });
    await sendSafe(chatId, message);
    this.rememberPrompt(chatId, 'menu');
  }

  private async trySuggest(
    chatId: string,
    input: string,
    options: readonly NormalizedFlowOption[] | undefined,
    sendSafe: FlowSafeSender,
  ): Promise<boolean> {
    if (!options || options.length === 0) {
      return false;
    }
    const matcher = buildOptionMatcher(options);
    const match = matcher.matchOption(input, {
      minimumConfidence: this.options.fuzzySuggestionThreshold,
    });
    if (!match || match.kind !== 'suggestion') {
      return false;
    }
    if (match.confidence >= this.options.fuzzyConfirmationThreshold) {
      await this.options.conversationRecovery.setPendingSuggestion(chatId, {
        optionId: match.option.id,
        optionText: match.option.text,
        confidence: match.confidence,
      });
      await sendSafe(chatId, this.options.textConfig.suggestion.suggestionPrompt(match.option.text));
      await sendSafe(chatId, this.options.textConfig.suggestion.confirmHint);
      return true;
    }
    return false;
  }

  private async handleInvalidAttempt(
    context: FlowAdvanceContext,
    status: AttemptStatus,
  ): Promise<boolean> {
    if (status.attempts >= 3) {
      await this.finishWithLock(context, this.options.textConfig.fallbackClosure);
      return true;
    }
    if (status.phase === 'fallback') {
      await context.sendSafe(context.chatId, this.options.textConfig.fallbackRetry);
      const message = this.formatPrompt({
        kind: 'list',
        promptContent: this.options.fallbackMenuTemplate,
      });
      await context.sendSafe(context.chatId, message);
      this.rememberPrompt(context.chatId, 'menu');
      return true;
    }
    await context.sendSafe(context.chatId, this.options.textConfig.friendlyRetry);
    const message = this.formatPrompt({ kind: 'list', promptContent: this.options.initialMenuTemplate });
    await context.sendSafe(context.chatId, message);
    this.rememberPrompt(context.chatId, 'menu');
    return true;
  }

  private async advanceWithInput(context: FlowAdvanceContext, input: string): Promise<boolean> {
    const result = await context.flowEngine.advance(context.chatId, input);
    return this.processAdvanceResult(context, result);
  }

  private async processAdvanceResult(context: FlowAdvanceContext, result: AdvanceResult): Promise<boolean> {
    if (!result.ok) {
      if (result.error === 'input_invalido') {
        const entry = this.getNodeEntry(result.nodeId);
        if (!entry || entry.key !== 'menu') {
          await context.sendSafe(context.chatId, context.texts.invalidOptionText);
          return true;
        }
        const options = this.extractOptionsForNode(result.nodeId);
        const suggested = await this.trySuggest(context.chatId, context.input, options, context.sendSafe);
        if (suggested) {
          return true;
        }
        const status = await this.options.conversationRecovery.recordInvalidAttempt(context.chatId);
        return this.handleInvalidAttempt(context, status);
      }
      this.clearPrompt(context.chatId);
      try {
        await context.flowEngine.cancel(context.chatId);
      } catch (error) {
        void error;
      }
      await context.sendSafe(context.chatId, context.texts.genericFlowErrorText);
      return true;
    }

    if (result.terminal) {
      if (result.prompt) {
        await context.sendSafe(context.chatId, result.prompt);
      }
      await this.options.conversationRecovery.recordValidSelection(context.chatId);
      context.resetDelay?.(context.chatId);
      if (result.nodeId) {
        const entry = this.getNodeEntry(result.nodeId);
        if (entry?.node.lockOnComplete) {
          await this.options.conversationRecovery.lock(
            context.chatId,
            Date.now() + this.options.lockDurationMs,
          );
          await context.sendSafe(context.chatId, this.options.textConfig.lockedNotice);
        }
      }
      this.rememberPrompt(context.chatId);
      return true;
    }

    const entry = this.getNodeEntry(result.nodeId);
    if (!entry) {
      return true;
    }
    await this.sendPrompt(context.chatId, entry.node, entry.key, context.sendSafe);
    await this.options.conversationRecovery.recordValidSelection(context.chatId);
    context.resetDelay?.(context.chatId);
    return true;
  }

  private getNodeEntry(nodeId: string): { node: FlowNode; key: FlowKey } | undefined {
    const menuNode = this.flows.menu.nodes[nodeId];
    if (menuNode) {
      return { node: menuNode, key: 'menu' };
    }
    const catalogNode = this.flows.catalog.nodes[nodeId];
    if (catalogNode) {
      return { node: catalogNode, key: 'catalog' };
    }
    return undefined;
  }

  private extractOptionsForNode(nodeId: string): NormalizedFlowOption[] | undefined {
    const entry = this.getNodeEntry(nodeId);
    const options = entry?.node.options;
    if (!options || options.length === 0) {
      return undefined;
    }
    return options.map((option, index) => normalizeOption(option, index));
  }

  async advanceOrRestart(context: FlowAdvanceContext): Promise<boolean> {
    if (!context.chatId) {
      return false;
    }
    if (!context.input) {
      return false;
    }

    const lockStatus = await this.options.conversationRecovery.getLockStatus(context.chatId);
    if (lockStatus.locked) {
      await context.sendSafe(context.chatId, this.options.textConfig.invalidWhileLocked);
      return true;
    }

    const normalizedInput = context.input.trim().toLowerCase();
    if (await this.handleSuggestionConfirmation(context, normalizedInput)) {
      return true;
    }

    if (await this.handleFallbackResponse(context, normalizedInput)) {
      return true;
    }

    const active = await context.flowEngine.isActive(context.chatId);
    if (!active) {
      const resumed = await this.resumeIfPossible(context);
      if (resumed) {
        return true;
      }
      const started = await this.startInitialFlow(context.chatId, context.flowEngine, context.sendSafe);
      if (!started) {
        await context.sendSafe(context.chatId, context.texts.flowUnavailableText);
        return true;
      }
      await this.options.conversationRecovery.recordValidSelection(context.chatId);
      context.resetDelay?.(context.chatId);
      return true;
    }

    const result = await context.flowEngine.advance(context.chatId, context.input);
    return this.processAdvanceResult(context, result);
  }
}
