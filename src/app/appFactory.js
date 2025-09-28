'use strict';

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const path = require('path');
const fs = require('fs/promises');
const { RateController } = require('../flow-runtime/rateController');
const { FlowEngine } = require('../flow-runtime/engine');

/**
 * @typedef {Object} ClientEventHandlers
 * @property {(message: import('whatsapp-web.js').Message) => Promise<void> | void} [handleIncoming]
 * @property {(qr: string) => void} [onQR]
 * @property {() => void} [onReady]
 * @property {(message: string) => void} [onAuthFail]
 * @property {(reason: string) => void | Promise<void>} [onDisconnected]
 */

/**
 * @typedef {Object} HandlerFactoryContext
 * @property {import('whatsapp-web.js').Client} client
 * @property {import('../flow-runtime/rateController').RateController} rate
 * @property {import('../flow-runtime/engine').FlowEngine} flowEngine
 */

/**
 * @typedef {Object} AppFactoryOptions
 * @property {string} [authDir]
 * @property {(authDir: string) => import('whatsapp-web.js').Client} [clientFactory]
 * @property {import('../flow-runtime/engine').FlowEngine} [flowEngine]
 * @property {import('../flow-runtime/rateController').RateController} [rate]
 * @property {(ctx: HandlerFactoryContext) => ClientEventHandlers} [buildHandlers]
 */

/**
 * @typedef {Object} AppInstance
 * @property {import('whatsapp-web.js').Client} client
 * @property {import('../flow-runtime/rateController').RateController} rate
 * @property {import('../flow-runtime/engine').FlowEngine} flowEngine
 * @property {() => Promise<HandlerFactoryContext>} start
 * @property {() => Promise<void>} stop
 */

/** @type {readonly string[]} */
const BASE_PUPPETEER_ARGS = Object.freeze([
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--no-first-run',
  '--no-zygote',
  '--disable-extensions',
]);

/**
 * @returns {import('whatsapp-web.js').ClientOptions['puppeteer']}
 */
function createPuppeteerOptions() {
  /** @type {string[]} */
  const args = [...BASE_PUPPETEER_ARGS];
  if (process.env.PUPPETEER_SINGLE_PROCESS === '1') {
    args.push('--single-process');
  }

  /** @type {import('whatsapp-web.js').ClientOptions['puppeteer']} */
  const options = {
    headless: true,
    args,
  };

  const executablePath = process.env.CHROME_PATH;
  if (typeof executablePath === 'string' && executablePath.trim()) {
    options.executablePath = executablePath;
  }

  return options;
}

/**
 * @param {string} authDir
 * @returns {import('whatsapp-web.js').Client}
 */
function defaultClientFactory(authDir) {
  return new Client({
    authStrategy: new LocalAuth({ dataPath: authDir }),
    puppeteer: createPuppeteerOptions(),
  });
}

/**
 * @param {import('whatsapp-web.js').Client} client
 * @param {ClientEventHandlers} [handlers]
 * @returns {void}
 */
function registerHandlers(client, { handleIncoming, onQR, onReady, onAuthFail, onDisconnected } = {}) {
  if (onQR) client.on('qr', onQR);
  if (onReady) client.on('ready', onReady);
  if (onAuthFail) client.on('auth_failure', onAuthFail);
  if (onDisconnected) client.on('disconnected', onDisconnected);
  if (handleIncoming) {
    client.on('message_create', handleIncoming);
  }
}

/**
 * @param {AppFactoryOptions} [options]
 * @returns {AppInstance}
 */
function createApp({
  authDir = path.resolve(process.cwd(), '.wwebjs_auth'),
  clientFactory = defaultClientFactory,
  flowEngine = new FlowEngine(),
  rate = new RateController({
    perChatCooldownMs: Number(process.env.RATE_PER_CHAT_COOLDOWN_MS || 1200),
    globalMaxPerInterval: Number(process.env.THROTTLE_GLOBAL_MAX || 12),
    globalIntervalMs: Number(process.env.THROTTLE_GLOBAL_INTERVAL_MS || 1000),
  }),
  buildHandlers, // (ctx) => { handleIncoming, onQR, onReady, onAuthFail, onDisconnected }
} = {}) {
  const client = clientFactory(authDir);
  rate.start();

  /** @type {HandlerFactoryContext} */
  const ctx = { client, rate, flowEngine };
  /** @type {ClientEventHandlers} */
  const handlers = typeof buildHandlers === 'function' ? (buildHandlers(ctx) || {}) : {};

  registerHandlers(client, {
    handleIncoming: handlers.handleIncoming,
    onQR: handlers.onQR || (async (qr) => {
      const termEnabled = process.env.QR_TERMINAL_ENABLED !== '0';
      const small = process.env.QR_TERMINAL_SMALL !== '0';
      const savePath = (process.env.QR_SAVE_PATH || '').trim();
      const imagePath = (process.env.QR_IMAGE_PATH || '').trim();

      // Mensagem de ajuda
      const showHints = process.env.QR_SHOW_HINTS !== '0';
      if (showHints) {
        console.log('📲 Escaneie o QR Code para conectar: WhatsApp > Dispositivos conectados > Conectar um dispositivo');
      }

      // Exibir no terminal
      if (termEnabled) {
        try {
          qrcode.generate(qr, { small }, (str) => {
            // Quando callback é fornecida, a lib retorna o ASCII ao invés de imprimir automaticamente
            if (typeof str === 'string' && str) {
              console.log(str);
            }
          });
        } catch (e) {
          console.warn('[qr] falha ao gerar QR no terminal:', e?.message || e);
        }
      }

      // Salvar ASCII em arquivo, se configurado
      if (savePath) {
        try {
          await new Promise((resolve) => {
            qrcode.generate(qr, { small }, async (ascii) => {
              try {
                const dir = path.dirname(savePath);
                await fs.mkdir(dir, { recursive: true });
                await fs.writeFile(savePath, String(ascii || ''), 'utf8');
                console.log(`[qr] ASCII salvo em: ${savePath}`);
              } catch (err) {
                console.warn('[qr] falha ao salvar ASCII em arquivo:', err?.message || err);
              }
              resolve();
            });
          });
        } catch (e) {
          console.warn('[qr] erro inesperado ao salvar ASCII:', e?.message || e);
        }
      }

      // Salvar imagem (PNG/SVG) com require dinâmico, se configurado
      if (imagePath) {
        try {
          // require dinâmico para não exigir dependência quando não usada
          const QR = (() => { try { return require('qrcode'); } catch { return null; } })();
          if (!QR) {
            console.warn('[qr] pacote "qrcode" não instalado; pulei geração de imagem.');
          } else {
            const dir = path.dirname(imagePath);
            await fs.mkdir(dir, { recursive: true });
            await QR.toFile(imagePath, qr, { width: 300 });
            console.log(`[qr] imagem salva em: ${imagePath}`);
          }
        } catch (e) {
          console.warn('[qr] falha ao gerar imagem de QR:', e?.message || e);
        }
      }

      // URL para visualização rápida num navegador (não faz chamada de rede)
      if (process.env.QR_LOG_URL !== '0') {
        try {
          const encoded = encodeURIComponent(qr);
          const url = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encoded}`;
          console.log(`[qr] Abra no navegador se preferir: ${url}`);
        } catch {}
      }
    }),
    onReady: handlers.onReady || (() => console.log('✅ Cliente pronto e conectado!')),
    onAuthFail: handlers.onAuthFail || (msg => console.error('❌ Falha na autenticação', msg)),
    onDisconnected: handlers.onDisconnected,
  });

  /**
   * @returns {Promise<HandlerFactoryContext>}
   */
  async function start() {
    if (process.env.NODE_ENV !== 'test') {
      await client.initialize();
    }
    return ctx;
  }

  /**
   * @returns {Promise<void>}
   */
  async function stop() {
    try { rate.stop(); } catch {}
    try { await client.destroy(); } catch {}
  }

  return { ...ctx, start, stop };
}

module.exports = { createApp };
