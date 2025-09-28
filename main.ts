import { config as loadEnv } from 'dotenv';
import { createApplicationContainer } from './src/application/container';

async function main(): Promise<void> {
  loadEnv();
  const container = createApplicationContainer();
  await container.start();
}

if (require.main === module) {
  main().catch((error) => {
    console.error('Falha ao iniciar:', (error as Error)?.message ?? error);
    process.exitCode = 1;
  });
}
