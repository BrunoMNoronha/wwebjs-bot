import path from 'node:path';
import type { Client, MessageContent } from 'whatsapp-web.js';
import { createCommandRegistry } from '../app/commandRegistry';
import { FlowEngine } from '../flow-runtime/engine';
import { RateController } from '../flow-runtime/rateController';
import { MessageRouter } from './messaging/MessageRouter';
import type { MessageRouterDeps } from './messaging/MessageRouter';
import { FlowSessionService, type FlowDefinition, type FlowKey } from './flows/FlowSessionService';
import flows from '../flows';
import {
  TEXT,
  INITIAL_MENU_TEMPLATE,
  FALLBACK_MENU_TEMPLATE,
  LOCK_DURATION_MS,
  RESPONSE_BASE_DELAY_MS,
  RESPONSE_DELAY_FACTOR,
  FUZZY_SUGGESTION_THRESHOLD,
  FUZZY_CONFIRMATION_THRESHOLD,
} from '../config/messages';
import { DEFAULT_FLOW_PROMPT_WINDOW_MS } from '../app/flowPromptTracker';
import { createWhatsAppClientBuilder, type WhatsAppClientApp } from '../infrastructure/whatsapp/ClientFactory';
import { createDefaultQrCodeNotifierFromEnv } from '../infrastructure/whatsapp/QrCodeNotifier';
import { LifecycleManager, type AuthRemovalConfig, type ReconnectConfig } from '../infrastructure/whatsapp/LifecycleManager';
import { createConsoleLikeLogger, type ConsoleLikeLogger } from '../infrastructure/logging/createConsoleLikeLogger';
import { createStore } from '../flow-runtime/stateStore';
import { ConversationRecoveryService } from './messaging/ConversationRecoveryService';
import { ResponseDelayManager, type ResponseDelayManagerOptions } from './messaging/ResponseDelayManager';
import {
  ClientMessageSender,
  DelayedMessageSender,
  RateLimitedMessageSender,
  type MessageSender,
} from './messaging/MessageSender';

interface RateLimitsConfig {
  readonly perChatCooldownMs: number;
  readonly globalMaxPerInterval: number;
  readonly globalIntervalMs: number;
}

interface ApplicationContainerConfig {
  readonly authDir: string;
  readonly ownerId: string;
  readonly allowSelfAdmin: boolean;
  readonly menuFlowEnabled: boolean;
  readonly flowPromptWindowMs: number;
  readonly shouldExitOnShutdown: boolean;
  readonly flowUnavailableText: string;
  readonly shutdownNotice: string;
  readonly restartNotice: string;
  readonly expiredFlowText: string;
  readonly invalidOptionText: string;
  readonly genericFlowErrorText: string;
  readonly rateLimits: RateLimitsConfig;
  readonly authRemoval: AuthRemovalConfig;
  readonly reconnect: ReconnectConfig;
}

interface ApplicationContainerOverrides {
  readonly authDir?: string;
  readonly ownerId?: string;
  readonly allowSelfAdmin?: boolean;
  readonly menuFlowEnabled?: boolean;
  readonly flowPromptWindowMs?: number;
  readonly shouldExitOnShutdown?: boolean;
  readonly flowUnavailableText?: string;
  readonly shutdownNotice?: string;
  readonly restartNotice?: string;
  readonly expiredFlowText?: string;
  readonly invalidOptionText?: string;
  readonly genericFlowErrorText?: string;
  readonly rateLimits?: Partial<RateLimitsConfig>;
  readonly authRemoval?: Partial<AuthRemovalConfig>;
  readonly reconnect?: Partial<ReconnectConfig>;
  readonly flows?: Partial<Record<FlowKey, FlowDefinition>>;
  readonly logger?: ConsoleLikeLogger;
  readonly responseDelay?: Partial<ResponseDelayManagerOptions>;
}

export interface ApplicationContainerOptions extends ApplicationContainerOverrides {}

function normalizeBooleanEnv(value: string | null | undefined): boolean | undefined {
  if (value == null) {
    return undefined;
  }

  const trimmedValue: string = value.trim();
  if (trimmedValue === '') {
    return undefined;
  }

  const lowerCasedValue: string = trimmedValue.toLowerCase();
  if (lowerCasedValue === '1' || lowerCasedValue === 'true' || lowerCasedValue === 'yes') {
    return true;
  }

  if (lowerCasedValue === '0' || lowerCasedValue === 'false' || lowerCasedValue === 'no') {
    return false;
  }

  return undefined;
}

function normalizeNumberEnv(value: string | undefined, fallback: number): number {
  if (typeof value !== 'string') {
    return fallback;
  }

  const trimmedValue: string = value.trim();
  if (trimmedValue === '') {
    return fallback;
  }

  const parsedValue: number = Number(trimmedValue);
  if (!Number.isFinite(parsedValue)) {
    return fallback;
  }

  return parsedValue;
}

function createConfig(overrides: ApplicationContainerOverrides): ApplicationContainerConfig {
  const authDir = overrides.authDir ?? path.resolve(process.cwd(), process.env.WWEBJS_AUTH_DIR ?? '.wwebjs_auth');
  const ownerId = overrides.ownerId ?? process.env.OWNER_ID ?? '';
  const allowSelfAdmin = overrides.allowSelfAdmin ?? process.env.ALLOW_SELF_ADMIN === '1';
  const menuFlowEnabled = overrides.menuFlowEnabled ?? process.env.MENU_FLOW === '1';
  const flowPromptWindowMs = overrides.flowPromptWindowMs
    ?? normalizeNumberEnv(process.env.FLOW_PROMPT_WINDOW_MS, DEFAULT_FLOW_PROMPT_WINDOW_MS);
  const normalizedExitOnShutdown: boolean | undefined = normalizeBooleanEnv(process.env.EXIT_ON_SHUTDOWN);
  const shouldExitOnShutdown = overrides.shouldExitOnShutdown
    ?? (normalizedExitOnShutdown ?? (process.env.NODE_ENV !== 'test'));
  const flowUnavailableText = overrides.flowUnavailableText ?? 'Fluxo indisponível no momento.';
  const shutdownNotice = overrides.shutdownNotice ?? 'Encerrando o bot com segurança…';
  const restartNotice = overrides.restartNotice ?? 'Reiniciando o bot…';
  const flowTexts = (TEXT as unknown as { flow?: { expired?: string } }).flow;
  const expiredFlowText = overrides.expiredFlowText ?? flowTexts?.expired ?? 'Sua sessão anterior foi encerrada.';
  const invalidOptionText = overrides.invalidOptionText ?? 'Não entendi. Por favor, escolha uma das opções listadas.';
  const genericFlowErrorText = overrides.genericFlowErrorText ?? 'Ocorreu um erro no fluxo. Encerrando.';
  const rateLimits: RateLimitsConfig = {
    perChatCooldownMs: overrides.rateLimits?.perChatCooldownMs
      ?? normalizeNumberEnv(process.env.RATE_PER_CHAT_COOLDOWN_MS, 1200),
    globalMaxPerInterval: overrides.rateLimits?.globalMaxPerInterval
      ?? normalizeNumberEnv(process.env.THROTTLE_GLOBAL_MAX, 12),
    globalIntervalMs: overrides.rateLimits?.globalIntervalMs
      ?? normalizeNumberEnv(process.env.THROTTLE_GLOBAL_INTERVAL_MS, 1000),
  };
  const authRemoval: AuthRemovalConfig = {
    retries: overrides.authRemoval?.retries
      ?? normalizeNumberEnv(process.env.AUTH_RM_RETRIES, 10),
    baseDelay: overrides.authRemoval?.baseDelay
      ?? normalizeNumberEnv(process.env.AUTH_RM_BASE_DELAY_MS, 200),
    maxDelay: overrides.authRemoval?.maxDelay
      ?? normalizeNumberEnv(process.env.AUTH_RM_MAX_DELAY_MS, 2000),
  };
  const reconnect: ReconnectConfig = {
    maxBackoffMs: overrides.reconnect?.maxBackoffMs
      ?? normalizeNumberEnv(process.env.RECONNECT_MAX_BACKOFF_MS, 30000),
    baseBackoffMs: overrides.reconnect?.baseBackoffMs
      ?? normalizeNumberEnv(process.env.RECONNECT_BASE_BACKOFF_MS, 1000),
    factor: overrides.reconnect?.factor
      ?? normalizeNumberEnv(process.env.RECONNECT_BACKOFF_FACTOR, 2),
  };
  return {
    authDir,
    ownerId,
    allowSelfAdmin,
    menuFlowEnabled,
    flowPromptWindowMs,
    shouldExitOnShutdown,
    flowUnavailableText,
    shutdownNotice,
    restartNotice,
    expiredFlowText,
    invalidOptionText,
    genericFlowErrorText,
    rateLimits,
    authRemoval,
    reconnect,
  };
}

interface ApplicationContainerState {
  app: WhatsAppClientApp | null;
  lifecycle: LifecycleManager | null;
}

export interface ApplicationContainer {
  readonly client: Client;
  readonly rate: RateController;
  readonly flowEngine: FlowEngine;
  start(): Promise<void>;
  stop(): Promise<void>;
}

type FlowStateStore = ConstructorParameters<typeof FlowEngine>[0];

export function createApplicationContainer(options: ApplicationContainerOptions = {}): ApplicationContainer {
  const config = createConfig(options);
  const logger: ConsoleLikeLogger = options.logger ?? createConsoleLikeLogger({ name: 'wwebjs-bot' });

  const conversationRecovery = new ConversationRecoveryService();
  const responseDelayManager = new ResponseDelayManager({
    baseDelayMs: options.responseDelay?.baseDelayMs ?? RESPONSE_BASE_DELAY_MS,
    factor: options.responseDelay?.factor ?? RESPONSE_DELAY_FACTOR,
  });

  const flowSessionService = new FlowSessionService({
    flowModules: flows,
    overrides: options.flows,
    menuFlowEnabled: config.menuFlowEnabled,
    promptWindowMs: config.flowPromptWindowMs,
    conversationRecovery,
    textConfig: TEXT,
    initialMenuTemplate: INITIAL_MENU_TEMPLATE,
    fallbackMenuTemplate: FALLBACK_MENU_TEMPLATE,
    lockDurationMs: LOCK_DURATION_MS,
    fuzzySuggestionThreshold: FUZZY_SUGGESTION_THRESHOLD,
    fuzzyConfirmationThreshold: FUZZY_CONFIRMATION_THRESHOLD,
    logger,
  });

  const menuFlow = flowSessionService.getFlowDefinition('menu');
  const catalogFlow = flowSessionService.getFlowDefinition('catalog');

  const flowStore: FlowStateStore = createStore({}, logger) as FlowStateStore;
  const flowEngine = new FlowEngine(flowStore);
  const rate = new RateController({
    perChatCooldownMs: config.rateLimits.perChatCooldownMs,
    globalMaxPerInterval: config.rateLimits.globalMaxPerInterval,
    globalIntervalMs: config.rateLimits.globalIntervalMs,
  });

  const state: ApplicationContainerState = {
    app: null,
    lifecycle: null,
  };

  function getApp(): WhatsAppClientApp {
    if (state.app) {
      return state.app;
    }

    const lifecycleRef: { current: LifecycleManager | null } = { current: null };

    const qrNotifier = createDefaultQrCodeNotifierFromEnv(process.env, logger);

    const builder = createWhatsAppClientBuilder({
      authDir: config.authDir,
      flowEngine,
      rate,
      qrNotifier,
      logger,
    });

    builder.withHandlers(({ client }) => {
        const baseSender: MessageSender = new ClientMessageSender(client);
        const rateLimited: MessageSender = new RateLimitedMessageSender(baseSender, rate);
        const delayed: MessageSender = new DelayedMessageSender(rateLimited, responseDelayManager);

        const sendSafe = async (chatId: string, content: MessageContent): Promise<unknown> => {
          return delayed.send(chatId, content);
        };

        const commandRegistry = createCommandRegistry({
          sendSafe,
          sendFlowPrompt: (chatId, node, flowKey) => {
            const normalizedKey: FlowKey = flowKey === 'menu' ? 'menu' : 'catalog';
            return flowSessionService.sendPrompt(chatId, node, normalizedKey, sendSafe);
          },
          clearFlowPrompt: (chatId) => flowSessionService.clearPrompt(chatId),
          flowEngine,
          menuFlow,
          catalogFlow,
          menuFlowEnabled: config.menuFlowEnabled,
          gracefulShutdown: async ({ exit = config.shouldExitOnShutdown } = {}) => {
            const lifecycle = lifecycleRef.current;
            if (!lifecycle) {
              throw new Error('LifecycleManager não inicializado');
            }
            await lifecycle.stop();
            if (exit && process.env.NODE_ENV !== 'test') {
              process.exit(0);
            }
          },
          gracefulRestart: async () => {
            const lifecycle = lifecycleRef.current;
            if (!lifecycle) {
              throw new Error('LifecycleManager não inicializado');
            }
            await lifecycle.restart();
          },
          welcomeText: `${TEXT.welcomeHeader}\n${TEXT.welcomeBody}`,
          flowUnavailableText: config.flowUnavailableText,
          shutdownNotice: config.shutdownNotice,
          restartNotice: config.restartNotice,
          shouldExitOnShutdown: config.shouldExitOnShutdown,
          logger,
        });

        const messageRouterDeps: MessageRouterDeps = {
          commandRegistry,
          flowEngine,
          flowSessionService,
          sendSafe,
          resetDelay: (chatId) => responseDelayManager.reset(chatId),
          flowUnavailableText: config.flowUnavailableText,
          expiredFlowText: config.expiredFlowText,
          invalidOptionText: config.invalidOptionText,
          genericFlowErrorText: config.genericFlowErrorText,
          conversationRecovery,
        };

        const messageRouter = new MessageRouter(messageRouterDeps);

        const handleIncoming = async (message: import('whatsapp-web.js').Message): Promise<void> => {
          if (!message) {
            return;
          }
          const raw = typeof message.body === 'string' ? message.body : '';
          const normalizedBody = raw.toLowerCase().trim();
          const fromJid = message.from ?? '';
          const toJid = message.to ?? '';

          if (fromJid.endsWith('@g.us') || toJid.endsWith('@g.us')) {
            return;
          }
          if (fromJid === 'status@broadcast' || toJid === 'status@broadcast') {
            return;
          }
          const isStatus = 'isStatus' in message ? Boolean((message as { isStatus?: boolean }).isStatus) : false;
          const isBroadcast = 'broadcast' in message
            ? Boolean((message as { broadcast?: boolean }).broadcast)
            : 'isBroadcast' in message
              ? Boolean((message as { isBroadcast?: boolean }).isBroadcast)
              : false;
          if (isStatus || isBroadcast) {
            return;
          }

          const fromSelf = Boolean(message.fromMe);
          const isOwner = Boolean((fromJid && fromJid === config.ownerId) || (message.author && message.author === config.ownerId));
          if (fromSelf && !(config.allowSelfAdmin && isOwner)) {
            return;
          }
          const chatId = message.from ?? '';
          await messageRouter.route({
            message,
            normalizedBody,
            rawBody: raw,
            chatId,
            fromSelf,
            isOwner,
          });
        };

        return { handleIncoming };
      });

    const appInstance = builder.build();
    const lifecycle = new LifecycleManager({
      client: appInstance.client,
      rate,
      authDir: config.authDir,
      authRemoval: config.authRemoval,
      reconnect: config.reconnect,
      logger,
    });
    lifecycleRef.current = lifecycle;

    state.app = appInstance;
    state.lifecycle = lifecycle;
    return appInstance;
  }

  return {
    get client(): Client {
      return getApp().client;
    },
    get rate(): RateController {
      return rate;
    },
    get flowEngine(): FlowEngine {
      return flowEngine;
    },
    async start(): Promise<void> {
      getApp();
      if (!state.lifecycle) {
        throw new Error('LifecycleManager não inicializado');
      }
      await state.lifecycle.start();
    },
    async stop(): Promise<void> {
      if (!state.lifecycle) {
        return;
      }
      await state.lifecycle.stop();
    },
  };
}
