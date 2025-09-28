// Global teardown safety: try stopping app/rate if imported inadvertidamente durante os testes
afterAll(async () => {
  try {
    const mod = require('./main');
    await mod?.app?.stop?.();
    mod?.rate?.stop?.();
  } catch {}
});
