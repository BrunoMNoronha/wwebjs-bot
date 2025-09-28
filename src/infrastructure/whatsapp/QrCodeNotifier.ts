import fs from 'node:fs/promises';
import path from 'node:path';
import qrcodeTerminal from 'qrcode-terminal';

export interface QrCodeStrategy {
  notify(qr: string): Promise<void> | void;
}

interface TerminalStrategyOptions {
  readonly small: boolean;
  readonly logger: Pick<Console, 'log' | 'warn'>;
}

export class TerminalQrCodeStrategy implements QrCodeStrategy {
  private readonly small: boolean;
  private readonly logger: Pick<Console, 'log' | 'warn'>;

  constructor(options: TerminalStrategyOptions) {
    this.small = options.small;
    this.logger = options.logger;
  }

  async notify(qr: string): Promise<void> {
    try {
      await new Promise<void>((resolve) => {
        let settled = false;
        const finish = (): void => {
          if (!settled) {
            settled = true;
            resolve();
          }
        };
        qrcodeTerminal.generate(qr, { small: this.small }, (ascii?: string) => {
          if (typeof ascii === 'string' && ascii.trim().length > 0) {
            this.logger.log(ascii);
          }
          finish();
        });
        setTimeout(finish, 0);
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.warn(`[qr-terminal] falha ao renderizar: ${err.message}`);
    }
  }
}

interface FileStrategyOptions {
  readonly filePath: string;
  readonly small: boolean;
  readonly logger: Pick<Console, 'log' | 'warn'>;
}

export class FileQrCodeStrategy implements QrCodeStrategy {
  private readonly filePath: string;
  private readonly small: boolean;
  private readonly logger: Pick<Console, 'log' | 'warn'>;

  constructor(options: FileStrategyOptions) {
    this.filePath = options.filePath;
    this.small = options.small;
    this.logger = options.logger;
  }

  async notify(qr: string): Promise<void> {
    try {
      const ascii = await new Promise<string>((resolve) => {
        qrcodeTerminal.generate(qr, { small: this.small }, (output?: string) => {
          resolve(String(output ?? ''));
        });
      });
      const directory = path.dirname(this.filePath);
      await fs.mkdir(directory, { recursive: true });
      await fs.writeFile(this.filePath, ascii, 'utf8');
      this.logger.log(`[qr-file] ASCII salvo em: ${this.filePath}`);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.warn(`[qr-file] falha ao salvar: ${err.message}`);
    }
  }
}

interface ImageStrategyOptions {
  readonly filePath: string;
  readonly width: number;
  readonly logger: Pick<Console, 'log' | 'warn'>;
}

export class ImageQrCodeStrategy implements QrCodeStrategy {
  private readonly filePath: string;
  private readonly width: number;
  private readonly logger: Pick<Console, 'log' | 'warn'>;

  constructor(options: ImageStrategyOptions) {
    this.filePath = options.filePath;
    this.width = options.width;
    this.logger = options.logger;
  }

  async notify(qr: string): Promise<void> {
    let qrModule: typeof import('qrcode') | null = null;
    try {
      qrModule = await import('qrcode');
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.warn(`[qr-image] pacote "qrcode" ausente ou inválido: ${err.message}`);
      return;
    }

    try {
      const directory = path.dirname(this.filePath);
      await fs.mkdir(directory, { recursive: true });
      await qrModule.toFile(this.filePath, qr, { width: this.width });
      this.logger.log(`[qr-image] arquivo gerado em: ${this.filePath}`);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.warn(`[qr-image] falha ao gerar: ${err.message}`);
    }
  }
}

export interface QrCodeNotifierOptions {
  readonly strategies: readonly QrCodeStrategy[];
  readonly showHints: boolean;
  readonly logUrl: boolean;
  readonly logger?: Pick<Console, 'log' | 'warn'>;
}

/**
 * Classe responsável por orquestrar diferentes estratégias de notificação de QR Code.
 *
 * A aplicação do padrão Strategy permite substituir a saída padrão por alternativas
 * de maior desempenho, como streaming contínuo via WebSocket ou Server-Sent Events.
 */
export class QrCodeNotifier {
  private readonly strategies: readonly QrCodeStrategy[];
  private readonly showHints: boolean;
  private readonly logUrl: boolean;
  private readonly logger: Pick<Console, 'log' | 'warn'>;

  constructor(options: QrCodeNotifierOptions) {
    this.strategies = options.strategies;
    this.showHints = options.showHints;
    this.logUrl = options.logUrl;
    this.logger = options.logger ?? console;
  }

  async notify(qr: string): Promise<void> {
    if (this.showHints) {
      this.logger.log('📲 Escaneie o QR Code: WhatsApp > Dispositivos conectados > Conectar um dispositivo');
    }

    for (const strategy of this.strategies) {
      try {
        await strategy.notify(qr);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        this.logger.warn(`[qr-notifier] estratégia falhou: ${err.message}`);
      }
    }

    if (this.logUrl) {
      const encoded = encodeURIComponent(qr);
      this.logger.log(`🔗 Visualize rapidamente: https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encoded}`);
    }
  }
}

export interface EnvConfig {
  readonly [key: string]: string | undefined;
  readonly QR_TERMINAL_ENABLED?: string;
  readonly QR_TERMINAL_SMALL?: string;
  readonly QR_SAVE_PATH?: string;
  readonly QR_IMAGE_PATH?: string;
  readonly QR_IMAGE_WIDTH?: string;
  readonly QR_SHOW_HINTS?: string;
  readonly QR_LOG_URL?: string;
}

export function createDefaultQrCodeNotifierFromEnv(env: EnvConfig = process.env, logger: Pick<Console, 'log' | 'warn'> = console): QrCodeNotifier {
  const strategies: QrCodeStrategy[] = [];
  const showTerminal = env.QR_TERMINAL_ENABLED !== '0';
  const small = env.QR_TERMINAL_SMALL !== '0';
  const savePath = env.QR_SAVE_PATH?.trim();
  const imagePath = env.QR_IMAGE_PATH?.trim();
  const imageWidth = Number(env.QR_IMAGE_WIDTH ?? 300) || 300;
  const showHints = env.QR_SHOW_HINTS !== '0';
  const logUrl = env.QR_LOG_URL !== '0';

  if (showTerminal) {
    strategies.push(new TerminalQrCodeStrategy({ small, logger }));
  }

  if (savePath) {
    strategies.push(new FileQrCodeStrategy({ filePath: savePath, small, logger }));
  }

  if (imagePath) {
    strategies.push(new ImageQrCodeStrategy({ filePath: imagePath, width: imageWidth, logger }));
  }

  return new QrCodeNotifier({ strategies, showHints, logUrl, logger });
}
