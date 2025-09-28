import type { ApplicationContainer } from '../src/application/container';

type ContainerModule = typeof import('../src/application/container');

interface SetupResult {
  readonly createApplicationContainer: ContainerModule['createApplicationContainer'];
  readonly createCommandRegistryMock: jest.Mock;
}

async function loadContainer(): Promise<SetupResult> {
  jest.resetModules();

  const createCommandRegistryMock: jest.Mock = jest.fn().mockReturnValue({ run: jest.fn() });

  jest.doMock('../src/app/commandRegistry', () => ({
    createCommandRegistry: createCommandRegistryMock,
  }));

  const module: ContainerModule = await import('../src/application/container');
  return {
    createApplicationContainer: module.createApplicationContainer,
    createCommandRegistryMock,
  };
}

function getShouldExitOnShutdown(mock: jest.Mock): boolean {
  const firstCall: unknown[] | undefined = mock.mock.calls[0];
  if (!firstCall) {
    throw new Error('createCommandRegistry não foi chamado');
  }
  const args = firstCall[0] as { shouldExitOnShutdown: boolean };
  return args.shouldExitOnShutdown;
}

describe('normalização de EXIT_ON_SHUTDOWN', () => {
  const ORIGINAL_ENV: NodeJS.ProcessEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    jest.resetModules();
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  test('valor ausente utiliza fallback padrão baseado em NODE_ENV', async () => {
    delete process.env.EXIT_ON_SHUTDOWN;
    process.env.NODE_ENV = 'test';

    const { createApplicationContainer, createCommandRegistryMock } = await loadContainer();
    const container: ApplicationContainer = createApplicationContainer();
    void container.client;

    expect(getShouldExitOnShutdown(createCommandRegistryMock)).toBe(false);
  });

  test('valor vazio ou whitespace é tratado como ausente', async () => {
    process.env.EXIT_ON_SHUTDOWN = '  ';
    process.env.NODE_ENV = 'production';

    const { createApplicationContainer, createCommandRegistryMock } = await loadContainer();
    const container: ApplicationContainer = createApplicationContainer();
    void container.client;

    expect(getShouldExitOnShutdown(createCommandRegistryMock)).toBe(true);
  });

  test('valor "0" desabilita a finalização do processo', async () => {
    process.env.EXIT_ON_SHUTDOWN = '0';
    process.env.NODE_ENV = 'production';

    const { createApplicationContainer, createCommandRegistryMock } = await loadContainer();
    const container: ApplicationContainer = createApplicationContainer();
    void container.client;

    expect(getShouldExitOnShutdown(createCommandRegistryMock)).toBe(false);
  });

  test('valor "1" força a finalização do processo', async () => {
    process.env.EXIT_ON_SHUTDOWN = '1';
    process.env.NODE_ENV = 'test';

    const { createApplicationContainer, createCommandRegistryMock } = await loadContainer();
    const container: ApplicationContainer = createApplicationContainer();
    void container.client;

    expect(getShouldExitOnShutdown(createCommandRegistryMock)).toBe(true);
  });
});
