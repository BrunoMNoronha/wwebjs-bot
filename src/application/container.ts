import path from 'node:path';
import fs from 'node:fs/promises';
import type { Client } from 'whatsapp-web.js';
import { createApp } from '../app/appFactory';
import { createCommandRegistry } from '../app/commandRegistry';
import { FlowEngine } from '../flow-runtime/engine';
import { RateController } from '../flow-runtime/rateController';
import { MessageRouter } from './messaging/MessageRouter';
import type { MessageRouterDeps } from './messaging/MessageRouter';
import { FlowSessionService, type FlowDefinition, type FlowKey } from './services/FlowSessionService';
import flows from '../flows';
import { TEXT } from '../config/messages';
import { DEFAULT_FLOW_PROMPT_WINDOW_MS } from '../app/flowPromptTracker';

interface FlowModule<T> {
  readonly flow: T;
}

function resolveFlow<T>(entry: FlowModule<T> | T): T {
  if (entry && typeof entry === 'object' && 'flow' in entry && entry.flow) {
    return (entry as FlowModule<T>).flow;
  }
  return entry as T;
}

interface RateLimitsConfig {
  readonly perChatCooldownMs: number;
  readonly globalMaxPerInterval: number;
  readonly globalIntervalMs: number;
}

interface AuthRemovalConfig {
  readonly retries: number;
  readonly baseDelay: number;
  readonly maxDelay: number;
}

interface ReconnectConfig {
  readonly maxBackoffMs: number;
  readonly baseBackoffMs: number;
  readonly factor: number;
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
}

export interface ApplicationContainerOptions extends ApplicationContainerOverrides {}

interface AppInstance {
  readonly client: Client;
  readonly rate: RateController;
  readonly flowEngine: FlowEngine;
  start(): Promise<unknown>;
  stop(): Promise<void>;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function removeAuthDirWithRetry(dir: string, config: AuthRemovalConfig): Promise<boolean> {
  for (let attempt = 1; attempt <= config.retries; attempt += 1) {
    try {
      await fs.rm(dir, { recursive: true, force: true });
      return true;
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      const code = err?.code ?? '';
      const retriable = code === 'EBUSY' || code === 'EPERM' || code === 'ENOENT';
      if (!retriable || attempt === config.retries) {
        console.error(`[auth-dir] falha ao remover (${code}) após ${attempt} tentativas:`, err?.message ?? err);
        return false;
      }
      const delay = Math.min(
        config.maxDelay,
        Math.floor(config.baseDelay * Math.pow(1.7, attempt - 1)),
      );
      await sleep(delay);
    }
  }
  return false;
}

async function safeReauth(
  client: Client,
  authDir: string,
  authRemoval: AuthRemovalConfig,
): Promise<void> {
  console.log('[reauth] iniciando safeReauth');
  try {
    await client.destroy();
    console.log('[reauth] cliente destruído');
  } catch (error) {
    const err = error as Error;
    console.warn('[reauth] erro ao destruir cliente:', err?.message ?? error);
  }
  const removed = await removeAuthDirWithRetry(authDir, authRemoval);
  if (!removed) {
    console.warn('[reauth] não foi possível remover a pasta de sessão; tentando reinit mesmo assim.');
  }
  try {
    await client.initialize();
    console.log('✅ Reinicializado. Aguarde QR Code se necessário.');
  } catch (error) {
    const err = error as Error;
    console.error('[reauth] falha ao inicializar cliente:', err?.message ?? error);
  }
}

function createConfig(overrides: ApplicationContainerOverrides): ApplicationContainerConfig {
  const authDir = overrides.authDir ?? path.resolve(process.cwd(), process.env.WWEBJS_AUTH_DIR ?? '.wwebjs_auth');
  const ownerId = overrides.ownerId ?? process.env.OWNER_ID ?? '';
  const allowSelfAdmin = overrides.allowSelfAdmin ?? process.env.ALLOW_SELF_ADMIN === '1';
  const menuFlowEnabled = overrides.menuFlowEnabled ?? process.env.MENU_FLOW === '1';
  const flowPromptWindowMs = overrides.flowPromptWindowMs ?? Number(process.env.FLOW_PROMPT_WINDOW_MS ?? DEFAULT_FLOW_PROMPT_WINDOW_MS);
  const shouldExitOnShutdown = overrides.shouldExitOnShutdown
    ?? (process.env.EXIT_ON_SHUTDOWN != null
      ? process.env.EXIT_ON_SHUTDOWN === '1'
      : process.env.NODE_ENV !== 'test');
  const flowUnavailableText = overrides.flowUnavailableText ?? 'Fluxo indisponível no momento.';
  const shutdownNotice = overrides.shutdownNotice ?? 'Encerrando o bot com segurança…';
  const restartNotice = overrides.restartNotice ?? 'Reiniciando o bot…';
  const flowTexts = (TEXT as unknown as { flow?: { expired?: string } }).flow;
  const expiredFlowText = overrides.expiredFlowText ?? flowTexts?.expired ?? 'Sua sessão anterior foi encerrada.';
  const invalidOptionText = overrides.invalidOptionText ?? 'Não entendi. Por favor, escolha uma das opções listadas.';
  const genericFlowErrorText = overrides.genericFlowErrorText ?? 'Ocorreu um erro no fluxo. Encerrando.';
  const rateLimits: RateLimitsConfig = {
    perChatCooldownMs: overrides.rateLimits?.perChatCooldownMs ?? Number(process.env.RATE_PER_CHAT_COOLDOWN_MS ?? 1200),
    globalMaxPerInterval: overrides.rateLimits?.globalMaxPerInterval ?? Number(process.env.THROTTLE_GLOBAL_MAX ?? 12),
    globalIntervalMs: overrides.rateLimits?.globalIntervalMs ?? Number(process.env.THROTTLE_GLOBAL_INTERVAL_MS ?? 1000),
  };
  const authRemoval: AuthRemovalConfig = {
    retries: overrides.authRemoval?.retries ?? Number(process.env.AUTH_RM_RETRIES ?? 10),
    baseDelay: overrides.authRemoval?.baseDelay ?? Number(process.env.AUTH_RM_BASE_DELAY_MS ?? 200),
    maxDelay: overrides.authRemoval?.maxDelay ?? Number(process.env.AUTH_RM_MAX_DELAY_MS ?? 2000),
  };
  const reconnect: ReconnectConfig = {
    maxBackoffMs: overrides.reconnect?.maxBackoffMs ?? Number(process.env.RECONNECT_MAX_BACKOFF_MS ?? 30000),
    baseBackoffMs: overrides.reconnect?.baseBackoffMs ?? Number(process.env.RECONNECT_BASE_BACKOFF_MS ?? 1000),
    factor: overrides.reconnect?.factor ?? Number(process.env.RECONNECT_BACKOFF_FACTOR ?? 2),
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
  app: AppInstance | null;
  reconnectAttempts: number;
}

export interface ApplicationContainer {
  readonly client: Client;
  readonly rate: RateController;
  readonly flowEngine: FlowEngine;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export function createApplicationContainer(options: ApplicationContainerOptions = {}): ApplicationContainer {
  const config = createConfig(options);

  const resolvedFlows = flows as Record<string, FlowModule<FlowDefinition> | FlowDefinition>;
  const catalogFlow = options.flows?.catalog ?? resolveFlow<FlowDefinition>(resolvedFlows.catalog);
  const menuFlow = options.flows?.menu ?? resolveFlow<FlowDefinition>(resolvedFlows.menu);

  const flowEngine = new FlowEngine();
  const rate = new RateController({
    perChatCooldownMs: config.rateLimits.perChatCooldownMs,
    globalMaxPerInterval: config.rateLimits.globalMaxPerInterval,
    globalIntervalMs: config.rateLimits.globalIntervalMs,
  });
  const flowSessionService = new FlowSessionService({
    menuFlow,
    catalogFlow,
    menuFlowEnabled: config.menuFlowEnabled,
    promptWindowMs: config.flowPromptWindowMs,
  });

  const state: ApplicationContainerState = {
    app: null,
    reconnectAttempts: 0,
  };

  function getApp(): AppInstance {
    if (state.app) {
      return state.app;
    }

    const appInstance = createApp({
      authDir: config.authDir,
      flowEngine,
      rate,
      buildHandlers: ({ client }) => {
        const sendSafe = async (chatId: string, content: string): Promise<unknown> => {
          return rate.withSend(chatId, () => client.sendMessage(chatId, content));
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
          gracefulShutdown: async ({ exit = config.shouldExitOnShutdown } = {}) => {
            try { rate.stop(); } catch (error) { console.warn('[shutdown] rate.stop():', error); }
            try { await client.destroy(); } catch (error) { console.warn('[shutdown] client.destroy():', error); }
            if (exit && process.env.NODE_ENV !== 'test') {
              process.exit(0);
            }
          },
          gracefulRestart: async () => {
            try { rate.stop(); } catch (error) { console.warn('[restart] rate.stop():', error); }
            try { await client.destroy(); } catch (error) { console.warn('[restart] client.destroy():', error); }
            rate.start();
            try { await client.initialize(); } catch (error) { console.error('[restart] initialize:', error); }
          },
          welcomeText: TEXT.welcome,
          flowUnavailableText: config.flowUnavailableText,
          shutdownNotice: config.shutdownNotice,
          restartNotice: config.restartNotice,
          shouldExitOnShutdown: config.shouldExitOnShutdown,
        });

        const messageRouterDeps: MessageRouterDeps = {
          commandRegistry,
          flowEngine,
          flowSessionService,
          sendSafe,
          flowUnavailableText: config.flowUnavailableText,
          expiredFlowText: config.expiredFlowText,
          invalidOptionText: config.invalidOptionText,
          genericFlowErrorText: config.genericFlowErrorText,
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

        const onDisconnected = async (reason: string): Promise<void> => {
          console.log('⚠️ Cliente foi desconectado', reason);
          if (String(reason).toUpperCase() === 'LOGOUT') {
            await safeReauth(client, config.authDir, config.authRemoval);
            state.reconnectAttempts = 0;
            return;
          }
          const { baseBackoffMs, factor, maxBackoffMs } = config.reconnect;
          const delay = Math.min(maxBackoffMs, Math.floor(baseBackoffMs * Math.pow(factor, state.reconnectAttempts)));
          state.reconnectAttempts += 1;
          console.log('[boot] onDisconnected: reagendando initialize em', delay, 'ms');
          setTimeout(() => {
            client.initialize().catch((error) => console.error('[reconnect] initialize falhou:', error));
          }, delay);
        };

        return { handleIncoming, onDisconnected };
      },
    }) as AppInstance;

    state.app = appInstance;
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
      const app = getApp();
      await app.start();
    },
    async stop(): Promise<void> {
      if (!state.app) {
        return;
      }
      await state.app.stop();
    },
  };
}
