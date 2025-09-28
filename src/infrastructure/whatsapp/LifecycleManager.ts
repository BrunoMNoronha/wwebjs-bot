import fs from 'node:fs/promises';
import type { Client } from 'whatsapp-web.js';
import { RateController } from '../../flow-runtime/rateController';

export interface AuthRemovalConfig {
  readonly retries: number;
  readonly baseDelay: number;
  readonly maxDelay: number;
}

export interface ReconnectConfig {
  readonly maxBackoffMs: number;
  readonly baseBackoffMs: number;
  readonly factor: number;
}

export interface LifecycleManagerOptions {
  readonly client: Client;
  readonly rate: RateController;
  readonly authDir: string;
  readonly authRemoval: AuthRemovalConfig;
  readonly reconnect: ReconnectConfig;
  readonly scheduler?: (fn: () => void, delay: number) => NodeJS.Timeout;
  readonly logger?: Pick<Console, 'log' | 'warn' | 'error'>;
}

export interface StartOptions {
  readonly forceInitialize?: boolean;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Implementa o padrão Facade para encapsular operações críticas do ciclo de vida
 * do cliente WhatsApp, expondo uma API única para inicialização, desligamento,
 * reautenticação segura e tentativas com backoff exponencial.
 */
export class LifecycleManager {
  private readonly client: Client;
  private readonly rate: RateController;
  private readonly authDir: string;
  private readonly authRemoval: AuthRemovalConfig;
  private readonly reconnect: ReconnectConfig;
  private readonly scheduler: (fn: () => void, delay: number) => NodeJS.Timeout;
  private readonly logger: Pick<Console, 'log' | 'warn' | 'error'>;
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;

  constructor(options: LifecycleManagerOptions) {
    this.client = options.client;
    this.rate = options.rate;
    this.authDir = options.authDir;
    this.authRemoval = options.authRemoval;
    this.reconnect = options.reconnect;
    this.scheduler = options.scheduler ?? setTimeout;
    this.logger = options.logger ?? console;

    this.client.on('disconnected', (reason: string) => {
      void this.handleDisconnected(reason);
    });
  }

  async start(options: StartOptions = {}): Promise<void> {
    this.logger.log('[lifecycle] start()');
    this.rate.start();
    if (options.forceInitialize || process.env.NODE_ENV !== 'test') {
      await this.client.initialize();
    }
    this.reconnectAttempts = 0;
  }

  async stop(): Promise<void> {
    this.logger.log('[lifecycle] stop()');
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    try {
      this.rate.stop();
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.warn(`[lifecycle] rate.stop() falhou: ${err.message}`);
    }
    try {
      await this.client.destroy();
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.warn(`[lifecycle] client.destroy() falhou: ${err.message}`);
    }
  }

  async restart(): Promise<void> {
    this.logger.log('[lifecycle] restart()');
    await this.stop();
    await this.start({ forceInitialize: true });
  }

  async safeReauth(): Promise<void> {
    this.logger.log('[reauth] iniciando safeReauth');
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    try {
      await this.client.destroy();
      this.logger.log('[reauth] cliente destruído');
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.warn(`[reauth] erro ao destruir cliente: ${err.message}`);
    }

    const removed = await this.removeAuthDirWithRetry();
    if (!removed) {
      this.logger.warn('[reauth] não foi possível remover a pasta de sessão; tentando reinit mesmo assim.');
    }

    try {
      await this.client.initialize();
      this.logger.log('✅ Reinicializado. Aguarde QR Code se necessário.');
      this.reconnectAttempts = 0;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error(`[reauth] falha ao inicializar cliente: ${err.message}`);
    }
  }

  private async removeAuthDirWithRetry(): Promise<boolean> {
    for (let attempt = 1; attempt <= this.authRemoval.retries; attempt += 1) {
      try {
        await fs.rm(this.authDir, { recursive: true, force: true });
        return true;
      } catch (error) {
        const err = error as NodeJS.ErrnoException;
        const code = err?.code ?? '';
        const retriable = code === 'EBUSY' || code === 'EPERM' || code === 'ENOENT';
        if (!retriable || attempt === this.authRemoval.retries) {
          this.logger.error(`[auth-dir] falha ao remover (${code}) após ${attempt} tentativas: ${err?.message ?? err}`);
          return false;
        }
        const delay = Math.min(
          this.authRemoval.maxDelay,
          Math.floor(this.authRemoval.baseDelay * Math.pow(1.7, attempt - 1)),
        );
        await sleep(delay);
      }
    }
    return false;
  }

  private async handleDisconnected(reason: string): Promise<void> {
    this.logger.warn(`⚠️ Cliente foi desconectado: ${reason}`);
    if (String(reason).toUpperCase() === 'LOGOUT') {
      await this.safeReauth();
      return;
    }
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      return;
    }
    const { baseBackoffMs, factor, maxBackoffMs } = this.reconnect;
    const delay = Math.min(maxBackoffMs, Math.floor(baseBackoffMs * Math.pow(factor, this.reconnectAttempts)));
    this.reconnectAttempts += 1;
    this.logger.log(`[lifecycle] reagendando initialize em ${delay}ms`);
    this.reconnectTimer = this.scheduler(async () => {
      this.reconnectTimer = null;
      try {
        await this.client.initialize();
        this.reconnectAttempts = 0;
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        this.logger.error(`[reconnect] initialize falhou: ${err.message}`);
        this.scheduleReconnect();
      }
    }, delay);
    this.reconnectTimer.unref?.();
  }
}
