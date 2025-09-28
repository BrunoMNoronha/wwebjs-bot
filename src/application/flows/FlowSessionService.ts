import { List, type MessageContent } from 'whatsapp-web.js';
import { createFlowPromptTracker } from '../../app/flowPromptTracker';
import type { MenuTemplate, FlowTextConfig } from '../../config/messages';
import {
  buildOptionMatcher,
  normalizeOption,
  type NormalizedFlowOption,
} from '../../validation/answers';
import { createConsoleLikeLogger, type ConsoleLikeLogger } from '../../infrastructure/logging/createConsoleLikeLogger';
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
  readonly logger?: ConsoleLikeLogger;
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

interface FlowAdvanceState {
  handle(): Promise<boolean>;
}

class FlowAdvanceActiveState implements FlowAdvanceState {
  constructor(private readonly advance: () => Promise<boolean>) {}

  async handle(): Promise<boolean> {
    return this.advance();
  }
}

class FlowAdvanceInactiveState implements FlowAdvanceState {
  constructor(
    private readonly startInitial: () => Promise<boolean>,
    private readonly resumePrevious: () => Promise<boolean>,
    private readonly handleUnavailable: () => Promise<boolean>,
  ) {}

  async handle(): Promise<boolean> {
    const started = await this.startInitial();
    if (started) {
      return true;
    }

    const resumed = await this.resumePrevious();
    if (resumed) {
      return true;
    }

    return this.handleUnavailable();
  }
}

function createAdvanceState(
  isActive: boolean,
  operations: {
    readonly advanceActive: () => Promise<boolean>;
    readonly startInitial: () => Promise<boolean>;
    readonly resumePrevious: () => Promise<boolean>;
    readonly handleUnavailable: () => Promise<boolean>;
  },
): FlowAdvanceState {
  if (isActive) {
    return new FlowAdvanceActiveState(operations.advanceActive);
  }
  return new FlowAdvanceInactiveState(
    operations.startInitial,
    operations.resumePrevious,
    operations.handleUnavailable,
  );
}

export class FlowSessionService {
  private readonly tracker = createFlowPromptTracker({ windowMs: this.options.promptWindowMs });
  private readonly flows: Readonly<Record<FlowKey, FlowDefinition>>;
  private readonly strategies: ReadonlyMap<FlowKey, FlowRestartStrategy>;
  private readonly logger: ConsoleLikeLogger;

  constructor(private readonly options: FlowSessionServiceOptions) {
    this.flows = this.buildFlowRegistry();
    this.strategies = this.buildStrategies();
    this.logger = options.logger ?? createConsoleLikeLogger({ name: 'flow-session' });
  }

  private logTransition(event: string, payload: Record<string, unknown> = {}): void {
    const serialized = JSON.stringify({ event, ...payload });
    this.logger.info(`[flow-session] ${serialized}`);
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

  private getLockExpiration(): number {
    return Date.now() + this.options.lockDurationMs;
  }

  private async enforceLock(chatId: string, sendSafe: FlowSafeSender): Promise<void> {
    await this.options.conversationRecovery.lock(chatId, this.getLockExpiration());
    await sendSafe(chatId, this.options.textConfig.lockedNotice);
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
      this.logTransition('startInitialFlow.failed', { chatId });
      return false;
    }
    this.logTransition('startInitialFlow.success', { chatId, nodeId: start.node.id ?? menuFlow.start });
    await this.sendPrompt(chatId, start.node as FlowNode, 'menu', sendSafe);
    return true;
  }

  private async startInitialSessionForChat(
    chatId: string,
    engine: FlowRuntimeEngine,
    sendSafe: FlowSafeSender,
    resetDelay?: (chatId: string) => void,
  ): Promise<boolean> {
    const started = await this.startInitialFlow(chatId, engine, sendSafe);
    if (!started) {
      return false;
    }
    this.logTransition('startInitialSessionForChat.success', { chatId });
    await this.options.conversationRecovery.recordValidSelection(chatId);
    resetDelay?.(chatId);
    return true;
  }

  private async handleUnavailableFlow(context: FlowAdvanceContext): Promise<boolean> {
    await context.sendSafe(context.chatId, context.texts.flowUnavailableText);
    return true;
  }

  private async advanceActiveSession(context: FlowAdvanceContext): Promise<boolean> {
    this.logTransition('advanceActiveSession.begin', { chatId: context.chatId });
    const result = await context.flowEngine.advance(context.chatId, context.input);
    return this.processAdvanceResult(context, result);
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
      this.logTransition('handleSuggestionConfirmation.accepted', {
        chatId: context.chatId,
        optionId,
      });
      return this.advanceWithInput(context, optionId);
    }
    if (negative.includes(normalizedInput)) {
      const status = await this.options.conversationRecovery.recordInvalidAttempt(context.chatId, {
        skipIfAwaitingConfirmation: true,
      });
      this.logTransition('handleSuggestionConfirmation.rejected', {
        chatId: context.chatId,
        attempts: status.attempts,
        phase: status.phase,
      });
      return this.handleInvalidAttempt(context, status);
    }
    this.logTransition('handleSuggestionConfirmation.ignored', { chatId: context.chatId });
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
      this.logTransition('handleFallbackResponse.invalid', {
        chatId: context.chatId,
        attempts: attempts.attempts,
      });
      return this.handleInvalidAttempt(context, attempts);
    }

    if (match === 'voltar_menu') {
      await this.options.conversationRecovery.recordValidSelection(context.chatId);
      await context.sendSafe(context.chatId, this.options.textConfig.resumedNotice);
      await this.sendInitialMenu(context.chatId, context.sendSafe);
      context.resetDelay?.(context.chatId);
      this.logTransition('handleFallbackResponse.menu', { chatId: context.chatId });
      return true;
    }

    await this.finishWithLock(context, this.options.textConfig.fallbackClosure);
    this.logTransition('handleFallbackResponse.locked', { chatId: context.chatId });
    return true;
  }

  private async finishWithLock(context: FlowAdvanceContext, message: string): Promise<void> {
    await context.sendSafe(context.chatId, message);
    await this.enforceLock(context.chatId, context.sendSafe);
    this.clearPrompt(context.chatId);
    this.logTransition('finishWithLock', { chatId: context.chatId });
  }

  private async sendInitialMenu(chatId: string, sendSafe: FlowSafeSender): Promise<void> {
    await sendSafe(chatId, `${this.options.textConfig.welcomeHeader}\n${this.options.textConfig.welcomeBody}`);
    const message = this.formatPrompt({ kind: 'list', promptContent: this.options.initialMenuTemplate });
    await sendSafe(chatId, message);
    this.rememberPrompt(chatId, 'menu');
    this.logTransition('sendInitialMenu', { chatId });
  }

  private async sendFallbackMenu(chatId: string, sendSafe: FlowSafeSender): Promise<void> {
    const message = this.formatPrompt({ kind: 'list', promptContent: this.options.fallbackMenuTemplate });
    await sendSafe(chatId, message);
    this.rememberPrompt(chatId, 'menu');
    this.logTransition('sendFallbackMenu', { chatId });
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
      this.logTransition('handleInvalidAttempt.locked', { chatId: context.chatId, attempts: status.attempts });
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
      this.logTransition('handleInvalidAttempt.fallback', {
        chatId: context.chatId,
        attempts: status.attempts,
      });
      return true;
    }
    await context.sendSafe(context.chatId, this.options.textConfig.friendlyRetry);
    const message = this.formatPrompt({ kind: 'list', promptContent: this.options.initialMenuTemplate });
    await context.sendSafe(context.chatId, message);
    this.rememberPrompt(context.chatId, 'menu');
    this.logTransition('handleInvalidAttempt.retry', {
      chatId: context.chatId,
      attempts: status.attempts,
    });
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
          this.logTransition('processAdvanceResult.invalidOption.other', {
            chatId: context.chatId,
            nodeId: result.nodeId,
          });
          return true;
        }
        const options = this.extractOptionsForNode(result.nodeId);
        const suggested = await this.trySuggest(context.chatId, context.input, options, context.sendSafe);
        if (suggested) {
          this.logTransition('processAdvanceResult.suggested', { chatId: context.chatId, nodeId: result.nodeId });
          return true;
        }
        const status = await this.options.conversationRecovery.recordInvalidAttempt(context.chatId);
        this.logTransition('processAdvanceResult.invalidOption.menu', {
          chatId: context.chatId,
          nodeId: result.nodeId,
          attempts: status.attempts,
        });
        return this.handleInvalidAttempt(context, status);
      }
      this.clearPrompt(context.chatId);
      try {
        await context.flowEngine.cancel(context.chatId);
      } catch (error) {
        void error;
      }
      await context.sendSafe(context.chatId, context.texts.genericFlowErrorText);
      this.logTransition('processAdvanceResult.genericError', { chatId: context.chatId });
      return true;
    }

    if (result.terminal) {
      const entry = result.nodeId ? this.getNodeEntry(result.nodeId) : undefined;
      const shouldLock = entry?.node.lockOnComplete === true;
      if (result.prompt) {
        await context.sendSafe(context.chatId, result.prompt);
      }
      await this.options.conversationRecovery.recordValidSelection(context.chatId);
      if (!shouldLock) {
        context.resetDelay?.(context.chatId);
        this.logTransition('processAdvanceResult.terminal', {
          chatId: context.chatId,
          nodeId: result.nodeId,
          lock: false,
        });
      } else {
        await this.enforceLock(context.chatId, context.sendSafe);
        this.logTransition('processAdvanceResult.terminal', {
          chatId: context.chatId,
          nodeId: result.nodeId,
          lock: true,
        });
      }
      this.rememberPrompt(context.chatId);
      return true;
    }

    const entry = this.getNodeEntry(result.nodeId);
    if (!entry) {
      this.logTransition('processAdvanceResult.missingEntry', { chatId: context.chatId, nodeId: result.nodeId });
      return true;
    }
    await this.sendPrompt(context.chatId, entry.node, entry.key, context.sendSafe);
    await this.options.conversationRecovery.recordValidSelection(context.chatId);
    context.resetDelay?.(context.chatId);
    this.logTransition('processAdvanceResult.advance', {
      chatId: context.chatId,
      nodeId: result.nodeId,
      flowKey: entry.key,
    });
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
      this.logTransition('advanceOrRestart.locked', {
        chatId: context.chatId,
        lockedUntil: lockStatus.lockedUntil,
      });
      return true;
    }

    const normalizedInput = context.input.trim().toLowerCase();
    if (await this.handleSuggestionConfirmation(context, normalizedInput)) {
      this.logTransition('advanceOrRestart.suggestionConfirmation', { chatId: context.chatId });
      return true;
    }

    if (await this.handleFallbackResponse(context, normalizedInput)) {
      this.logTransition('advanceOrRestart.fallbackResponse', { chatId: context.chatId });
      return true;
    }

    const active = await context.flowEngine.isActive(context.chatId);
    this.logTransition('advanceOrRestart.stateSelected', {
      chatId: context.chatId,
      state: active ? 'active' : 'inactive',
    });
    const state = createAdvanceState(active, {
      advanceActive: () => this.advanceActiveSession(context),
      startInitial: () =>
        this.startInitialSessionForChat(
          context.chatId,
          context.flowEngine,
          context.sendSafe,
          context.resetDelay,
        ),
      resumePrevious: () => this.resumeIfPossible(context),
      handleUnavailable: () => this.handleUnavailableFlow(context),
    });
    return state.handle();
  }

  async ensureInitialMenu(options: {
    readonly chatId: string;
    readonly flowEngine: FlowRuntimeEngine;
    readonly sendSafe: FlowSafeSender;
    readonly resetDelay?: (chatId: string) => void;
    readonly flowUnavailableText: string;
  }): Promise<boolean> {
    const started = await this.startInitialSessionForChat(
      options.chatId,
      options.flowEngine,
      options.sendSafe,
      options.resetDelay,
    );
    if (started) {
      this.logTransition('ensureInitialMenu.started', { chatId: options.chatId });
      return true;
    }
    await options.sendSafe(options.chatId, options.flowUnavailableText);
    this.logTransition('ensureInitialMenu.unavailable', { chatId: options.chatId });
    return true;
  }
}
