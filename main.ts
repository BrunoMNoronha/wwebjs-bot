import { config as loadEnv } from 'dotenv';
import { createApplicationContainer } from './src/application/container';
import { createConsoleLikeLogger, type ConsoleLikeLogger } from './src/infrastructure/logging/createConsoleLikeLogger';

const logger: ConsoleLikeLogger = createConsoleLikeLogger({ name: 'wwebjs-bot' });

async function main(): Promise<void> {
  loadEnv();
  const container = createApplicationContainer({ logger });
  await container.start();
}

if (require.main === module) {
  main().catch((error) => {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error('Falha ao iniciar:', err);
    process.exitCode = 1;
  });
}
