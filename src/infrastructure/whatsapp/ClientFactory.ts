import path from 'node:path';
import type { Client, ClientOptions } from 'whatsapp-web.js';
import { Client as WhatsAppClient, LocalAuth, type AuthStrategy } from 'whatsapp-web.js';
import { RateController } from '../../flow-runtime/rateController';
import { FlowEngine } from '../../flow-runtime/engine';
import { QrCodeNotifier, createDefaultQrCodeNotifierFromEnv } from './QrCodeNotifier';

export interface ClientEventHandlers {
  handleIncoming?: (message: import('whatsapp-web.js').Message) => Promise<void> | void;
  onQR?: (qr: string) => void | Promise<void>;
  onReady?: () => void;
  onAuthFail?: (message: string) => void;
  onDisconnected?: (reason: string) => void | Promise<void>;
}

export interface HandlerFactoryContext {
  readonly client: Client;
  readonly rate: RateController;
  readonly flowEngine: FlowEngine;
}

export interface WhatsAppClientApp {
  readonly client: Client;
  readonly rate: RateController;
  readonly flowEngine: FlowEngine;
  start(): Promise<HandlerFactoryContext>;
  stop(): Promise<void>;
}

export interface WhatsAppClientBuilder {
  withAuthentication(factory: (authDir: string) => AuthStrategy): WhatsAppClientBuilder;
  withAuthDirectory(directory: string): WhatsAppClientBuilder;
  withPuppeteerOptions(options: ClientOptions['puppeteer']): WhatsAppClientBuilder;
  withHandlers(factory: (ctx: HandlerFactoryContext) => ClientEventHandlers): WhatsAppClientBuilder;
  withQrCodeNotifier(notifier: QrCodeNotifier): WhatsAppClientBuilder;
  withClientFactory(factory: (options: ClientOptions) => Client): WhatsAppClientBuilder;
  build(): WhatsAppClientApp;
}

export interface WhatsAppClientBuilderOptions {
  readonly authDir?: string;
  readonly rate?: RateController;
  readonly flowEngine?: FlowEngine;
  readonly puppeteer?: ClientOptions['puppeteer'];
  readonly authFactory?: (authDir: string) => AuthStrategy;
  readonly clientFactory?: (options: ClientOptions) => Client;
  readonly qrNotifier?: QrCodeNotifier;
}

const BASE_PUPPETEER_ARGS: readonly string[] = Object.freeze([
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--no-first-run',
  '--no-zygote',
  '--disable-extensions',
]);

function createPuppeteerOptions(): ClientOptions['puppeteer'] {
  const args = [...BASE_PUPPETEER_ARGS];
  if (process.env.PUPPETEER_SINGLE_PROCESS === '1') {
    args.push('--single-process');
  }

  const options: ClientOptions['puppeteer'] = {
    headless: true,
    args,
  };

  const executablePath = process.env.CHROME_PATH;
  if (typeof executablePath === 'string' && executablePath.trim().length > 0) {
    options.executablePath = executablePath;
  }

  return options;
}

class DefaultWhatsAppClientBuilder implements WhatsAppClientBuilder {
  private authDir: string;
  private readonly rate: RateController;
  private readonly flowEngine: FlowEngine;
  private puppeteer: ClientOptions['puppeteer'];
  private authFactory: (authDir: string) => AuthStrategy;
  private clientFactory: (options: ClientOptions) => Client;
  private qrNotifier: QrCodeNotifier;
  private readonly handlerFactories: Array<(ctx: HandlerFactoryContext) => ClientEventHandlers> = [];

  constructor(options: WhatsAppClientBuilderOptions = {}) {
    this.authDir = options.authDir ?? path.resolve(process.cwd(), '.wwebjs_auth');
    this.rate = options.rate ?? new RateController({
      perChatCooldownMs: Number(process.env.RATE_PER_CHAT_COOLDOWN_MS ?? 1200),
      globalMaxPerInterval: Number(process.env.THROTTLE_GLOBAL_MAX ?? 12),
      globalIntervalMs: Number(process.env.THROTTLE_GLOBAL_INTERVAL_MS ?? 1000),
    });
    this.flowEngine = options.flowEngine ?? new FlowEngine();
    this.puppeteer = options.puppeteer ?? createPuppeteerOptions();
    this.authFactory = options.authFactory ?? ((dir) => new LocalAuth({ dataPath: dir }));
    this.clientFactory = options.clientFactory ?? ((opts) => new WhatsAppClient(opts));
    this.qrNotifier = options.qrNotifier ?? createDefaultQrCodeNotifierFromEnv();
  }

  withAuthentication(factory: (authDir: string) => AuthStrategy): WhatsAppClientBuilder {
    this.authFactory = factory;
    return this;
  }

  withAuthDirectory(directory: string): WhatsAppClientBuilder {
    this.authDir = directory;
    return this;
  }

  withPuppeteerOptions(options: ClientOptions['puppeteer']): WhatsAppClientBuilder {
    this.puppeteer = options;
    return this;
  }

  withHandlers(factory: (ctx: HandlerFactoryContext) => ClientEventHandlers): WhatsAppClientBuilder {
    this.handlerFactories.push(factory);
    return this;
  }

  withQrCodeNotifier(notifier: QrCodeNotifier): WhatsAppClientBuilder {
    this.qrNotifier = notifier;
    return this;
  }

  withClientFactory(factory: (options: ClientOptions) => Client): WhatsAppClientBuilder {
    this.clientFactory = factory;
    return this;
  }

  build(): WhatsAppClientApp {
    const clientOptions: ClientOptions = {
      authStrategy: this.authFactory(this.authDir),
      puppeteer: this.puppeteer,
    };

    const client = this.clientFactory(clientOptions);
    const ctx: HandlerFactoryContext = { client, rate: this.rate, flowEngine: this.flowEngine };

    const handlers = this.composeHandlers(ctx);
    this.registerHandlers(client, handlers);

    const start = async (): Promise<HandlerFactoryContext> => {
      this.rate.start();
      if (process.env.NODE_ENV !== 'test') {
        await client.initialize();
      }
      return ctx;
    };

    const stop = async (): Promise<void> => {
      try {
        this.rate.stop();
      } catch (error) {
        console.warn('[factory] rate.stop() falhou:', error);
      }
      try {
        await client.destroy();
      } catch (error) {
        console.warn('[factory] client.destroy() falhou:', error);
      }
    };

    return { client, rate: this.rate, flowEngine: this.flowEngine, start, stop };
  }

  private composeHandlers(ctx: HandlerFactoryContext): ClientEventHandlers {
    const merged: ClientEventHandlers = {};
    for (const factory of this.handlerFactories) {
      const handlers = factory(ctx) ?? {};
      if (handlers.handleIncoming) {
        merged.handleIncoming = handlers.handleIncoming;
      }
      if (handlers.onReady) {
        merged.onReady = handlers.onReady;
      }
      if (handlers.onAuthFail) {
        merged.onAuthFail = handlers.onAuthFail;
      }
      if (handlers.onQR) {
        merged.onQR = handlers.onQR;
      }
      if (handlers.onDisconnected) {
        merged.onDisconnected = handlers.onDisconnected;
      }
    }

    if (!merged.onQR) {
      merged.onQR = (qr: string) => {
        void this.qrNotifier.notify(qr);
      };
    }

    if (!merged.onReady) {
      merged.onReady = () => console.log('✅ Cliente pronto e conectado!');
    }

    if (!merged.onAuthFail) {
      merged.onAuthFail = (message: string) => console.error('❌ Falha na autenticação', message);
    }

    return merged;
  }

  private registerHandlers(client: Client, handlers: ClientEventHandlers): void {
    if (handlers.onQR) {
      client.on('qr', (qr: string) => {
        void handlers.onQR?.(qr);
      });
    }
    if (handlers.onReady) {
      client.on('ready', () => handlers.onReady?.());
    }
    if (handlers.onAuthFail) {
      client.on('auth_failure', (msg: string) => handlers.onAuthFail?.(msg));
    }
    if (handlers.onDisconnected) {
      client.on('disconnected', (reason: string) => {
        void handlers.onDisconnected?.(reason);
      });
    }
    if (handlers.handleIncoming) {
      client.on('message', async (msg: import('whatsapp-web.js').Message) => {
        try {
          await handlers.handleIncoming?.(msg);
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          console.warn('[handleIncoming] erro:', err.message);
        }
      });
      client.on('message_create', (msg: import('whatsapp-web.js').Message) => {
        try {
          console.log('[evt:message_create]', {
            from: msg?.from,
            to: msg?.to,
            fromMe: Boolean(msg?.fromMe),
            type: msg?.type,
            hasBody: Boolean(msg?.body),
            bodyPreview: String(msg?.body ?? '').slice(0, 60),
          });
        } catch (error) {
          console.warn('[evt:message_create] log falhou:', error);
        }
      });
    }
    client.on('authenticated', () => console.log('[client] authenticated'));
    client.on('loading_screen', (p: number, ms: number) => console.log('[client] loading_screen:', p, ms));
    client.on('change_state', (state: string) => console.log('[client] state:', state));
  }
}

export function createWhatsAppClientBuilder(options: WhatsAppClientBuilderOptions = {}): WhatsAppClientBuilder {
  return new DefaultWhatsAppClientBuilder(options);
}
