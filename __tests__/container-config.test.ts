import type { ApplicationContainer } from '../src/application/container';
import { DEFAULT_FLOW_PROMPT_WINDOW_MS } from '../src/app/flowPromptTracker';

type ContainerModule = typeof import('../src/application/container');

interface SetupResult {
  readonly createApplicationContainer: ContainerModule['createApplicationContainer'];
  readonly createCommandRegistryMock: jest.Mock;
  readonly flowSessionServiceMock: jest.Mock;
  readonly rateControllerMock: jest.Mock;
  readonly lifecycleManagerMock: jest.Mock;
}

async function loadContainer(): Promise<SetupResult> {
  jest.resetModules();

  const createCommandRegistryMock: jest.Mock = jest.fn().mockReturnValue({ run: jest.fn() });
  const flowSessionServiceMock: jest.Mock = jest.fn().mockImplementation(() => ({
    getFlowDefinition: jest.fn(),
    sendPrompt: jest.fn(),
    clearPrompt: jest.fn(),
  }));
  const flowEngineInstance = {};
  const flowEngineMock: jest.Mock = jest.fn().mockReturnValue(flowEngineInstance);
  const rateControllerMock: jest.Mock = jest.fn().mockImplementation((config: unknown) => ({
    start: jest.fn(),
    stop: jest.fn(),
    withSend: jest.fn((_: string, fn: () => Promise<unknown>) => fn()),
    config,
  }));
  const lifecycleManagerMock: jest.Mock = jest.fn().mockImplementation((options: unknown) => ({
    start: jest.fn(),
    stop: jest.fn(),
    restart: jest.fn(),
    options,
  }));
  const fakeClient = {
    on: jest.fn(),
    initialize: jest.fn(),
    destroy: jest.fn(),
  };
  const fakeRate = {
    start: jest.fn(),
    stop: jest.fn(),
    withSend: jest.fn(async (_: string, fn: () => Promise<unknown>) => fn()),
  };
  const fakeLogger = {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  const fakeApp = {
    client: fakeClient,
    rate: fakeRate,
    flowEngine: flowEngineInstance,
    start: jest.fn(),
    stop: jest.fn(),
  };
  type HandlerFactory = (ctx: {
    client: typeof fakeClient;
    rate: typeof fakeRate;
    flowEngine: typeof flowEngineInstance;
    logger: typeof fakeLogger;
  }) => unknown;
  let storedHandlerFactory: HandlerFactory | undefined;
  const builderInstance = {
    withHandlers: jest.fn().mockImplementation((factory: HandlerFactory) => {
      storedHandlerFactory = factory;
      return builderInstance;
    }),
    build: jest.fn().mockImplementation(() => {
      if (storedHandlerFactory) {
        storedHandlerFactory({
          client: fakeClient,
          rate: fakeRate,
          flowEngine: flowEngineInstance,
          logger: fakeLogger,
        });
      }
      return fakeApp;
    }),
  };
  const createWhatsAppClientBuilderMock: jest.Mock = jest.fn().mockReturnValue(builderInstance);

  jest.doMock('../src/app/commandRegistry', () => ({
    createCommandRegistry: createCommandRegistryMock,
  }));

  jest.doMock('../src/application/flows/FlowSessionService', () => ({
    FlowSessionService: flowSessionServiceMock,
  }));

  jest.doMock('../src/flow-runtime/engine', () => ({
    FlowEngine: flowEngineMock,
  }));

  jest.doMock('../src/flow-runtime/rateController', () => ({
    RateController: rateControllerMock,
  }));

  jest.doMock('../src/infrastructure/whatsapp/LifecycleManager', () => ({
    LifecycleManager: lifecycleManagerMock,
  }));

  jest.doMock('../src/infrastructure/whatsapp/ClientFactory', () => ({
    createWhatsAppClientBuilder: createWhatsAppClientBuilderMock,
  }));

  const module: ContainerModule = await import('../src/application/container');
  return {
    createApplicationContainer: module.createApplicationContainer,
    createCommandRegistryMock,
    flowSessionServiceMock,
    rateControllerMock,
    lifecycleManagerMock,
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

describe('normalização de números de ambiente', () => {
  const ORIGINAL_ENV: NodeJS.ProcessEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    jest.resetModules();
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  test('FLOW_PROMPT_WINDOW_MS inválido recorre ao fallback padrão', async (): Promise<void> => {
    process.env.FLOW_PROMPT_WINDOW_MS = 'não-numérico';

    const { createApplicationContainer, flowSessionServiceMock } = await loadContainer();
    void createApplicationContainer();

    const firstCall = flowSessionServiceMock.mock.calls[0];
    const config = firstCall?.[0] as { promptWindowMs: number } | undefined;

    expect(config?.promptWindowMs).toBe(DEFAULT_FLOW_PROMPT_WINDOW_MS);
  });

  test('FLOW_PROMPT_WINDOW_MS válido é convertido corretamente', async (): Promise<void> => {
    process.env.FLOW_PROMPT_WINDOW_MS = ' 42000 ';

    const { createApplicationContainer, flowSessionServiceMock } = await loadContainer();
    void createApplicationContainer();

    const firstCall = flowSessionServiceMock.mock.calls[0];
    const config = firstCall?.[0] as { promptWindowMs: number } | undefined;

    expect(config?.promptWindowMs).toBe(42000);
  });

  test('limites de rate usam fallback quando valores não são finitos', async (): Promise<void> => {
    process.env.RATE_PER_CHAT_COOLDOWN_MS = 'NaN';
    process.env.THROTTLE_GLOBAL_MAX = 'Infinity';
    process.env.THROTTLE_GLOBAL_INTERVAL_MS = 'texto';

    const { createApplicationContainer, rateControllerMock } = await loadContainer();
    void createApplicationContainer();

    const firstCall = rateControllerMock.mock.calls[0];
    const config = firstCall?.[0] as {
      perChatCooldownMs: number;
      globalMaxPerInterval: number;
      globalIntervalMs: number;
    } | undefined;

    expect(config?.perChatCooldownMs).toBe(1200);
    expect(config?.globalMaxPerInterval).toBe(12);
    expect(config?.globalIntervalMs).toBe(1000);
  });

  test('parâmetros de remoção de auth e reconexão respeitam fallback', async (): Promise<void> => {
    process.env.AUTH_RM_RETRIES = '';
    process.env.AUTH_RM_BASE_DELAY_MS = '   ';
    process.env.AUTH_RM_MAX_DELAY_MS = 'null';
    delete process.env.RECONNECT_MAX_BACKOFF_MS;
    process.env.RECONNECT_BASE_BACKOFF_MS = 'NaN';
    process.env.RECONNECT_BACKOFF_FACTOR = '0x10';

    const { createApplicationContainer, lifecycleManagerMock } = await loadContainer();
    const container: ApplicationContainer = createApplicationContainer();
    void container.client;

    const firstCall = lifecycleManagerMock.mock.calls[0];
    const options = firstCall?.[0] as {
      authRemoval: { retries: number; baseDelay: number; maxDelay: number };
      reconnect: { maxBackoffMs: number; baseBackoffMs: number; factor: number };
    } | undefined;

    expect(options?.authRemoval).toEqual({ retries: 10, baseDelay: 200, maxDelay: 2000 });
    expect(options?.reconnect).toEqual({ maxBackoffMs: 30000, baseBackoffMs: 1000, factor: 16 });
  });
});
