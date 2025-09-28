'use strict';

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const path = require('path');
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
    onQR: handlers.onQR || (qr => qrcode.generate(qr, { small: true })),
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
