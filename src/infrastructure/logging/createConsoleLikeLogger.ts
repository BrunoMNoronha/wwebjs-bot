import { formatWithOptions } from 'node:util';
import pino, {
  destination as createDestination,
  transport as createTransport,
  type DestinationStream,
  type Level,
  type LoggerOptions,
  type TransportSingleOptions,
} from 'pino';

/**
 * Adapta uma instância do Pino para o contrato mínimo de um `console`.
 * Implementa o padrão Adapter para permitir a troca do backend de logging
 * sem alterar o restante da aplicação.
 */
export interface ConsoleLikeLogger {
  log(message?: unknown, ...optionalParams: readonly unknown[]): void;
  info(message?: unknown, ...optionalParams: readonly unknown[]): void;
  warn(message?: unknown, ...optionalParams: readonly unknown[]): void;
  error(message?: unknown, ...optionalParams: readonly unknown[]): void;
  debug?(message?: unknown, ...optionalParams: readonly unknown[]): void;
}

export interface ConsoleLikeLoggerOptions {
  readonly level?: Level;
  readonly name?: string;
  readonly base?: LoggerOptions['base'];
  readonly destination?: DestinationStream | string | number;
  readonly transport?: TransportSingleOptions;
}

function formatMessage(args: readonly unknown[]): string {
  const normalizedArgs: unknown[] = Array.from(args);
  if (normalizedArgs.length === 0 || (normalizedArgs.length === 1 && typeof normalizedArgs[0] === 'undefined')) {
    return '';
  }
  return formatWithOptions({ colors: false, depth: 5 }, ...normalizedArgs);
}

function resolveDestination(options: ConsoleLikeLoggerOptions): DestinationStream {
  if (options.transport) {
    return createTransport(options.transport);
  }
  if (options.destination) {
    if (typeof options.destination === 'object' && 'write' in options.destination) {
      return options.destination as DestinationStream;
    }
    return createDestination(options.destination);
  }
  return createDestination({ sync: false });
}

export function createConsoleLikeLogger(options: ConsoleLikeLoggerOptions = {}): ConsoleLikeLogger {
  const level: Level = options.level ?? ((process.env.LOG_LEVEL as Level | undefined) ?? 'info');
  const destination: DestinationStream = resolveDestination(options);

  const logger = pino(
    {
      name: options.name ?? 'wwebjs-bot',
      level,
      base: options.base ?? { service: options.name ?? 'wwebjs-bot' },
    },
    destination,
  );

  const bind = (
    method: 'info' | 'warn' | 'error' | 'debug',
  ): ((message?: unknown, ...optionalParams: readonly unknown[]) => void) => {
    return (message?: unknown, ...optionalParams: readonly unknown[]): void => {
      const formatted: string = formatMessage([message, ...optionalParams]);
      if (method === 'debug' && typeof logger.debug !== 'function') {
        return;
      }
      let target: ((msg: string) => void) | undefined;
      if (method === 'info') {
        target = logger.info.bind(logger);
      } else if (method === 'warn') {
        target = logger.warn.bind(logger);
      } else if (method === 'error') {
        target = logger.error.bind(logger);
      } else if (typeof logger.debug === 'function') {
        target = logger.debug.bind(logger);
      }
      if (!target) {
        return;
      }
      target.call(logger, formatted);
    };
  };

  return {
    log: bind('info'),
    info: bind('info'),
    warn: bind('warn'),
    error: bind('error'),
    debug: bind('debug'),
  };
}
