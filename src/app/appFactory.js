'use strict';

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const path = require('path');
const { RateController } = require('../flow-runtime/rateController');
const { FlowEngine } = require('../flow-runtime/engine');

function defaultClientFactory(authDir) {
  return new Client({
    authStrategy: new LocalAuth({ dataPath: authDir }),
    puppeteer: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] },
  });
}

function registerHandlers(client, { handleIncoming, onQR, onReady, onAuthFail, onDisconnected } = {}) {
  if (onQR) client.on('qr', onQR);
  if (onReady) client.on('ready', onReady);
  if (onAuthFail) client.on('auth_failure', onAuthFail);
  if (onDisconnected) client.on('disconnected', onDisconnected);
  if (handleIncoming) {
    client.on('message', handleIncoming);
    client.on('message_create', handleIncoming);
  }
}

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

  const ctx = { client, rate, flowEngine };
  const handlers = typeof buildHandlers === 'function' ? (buildHandlers(ctx) || {}) : {};

  registerHandlers(client, {
    handleIncoming: handlers.handleIncoming,
    onQR: handlers.onQR || (qr => qrcode.generate(qr, { small: true })),
    onReady: handlers.onReady || (() => console.log('✅ Cliente pronto e conectado!')),
    onAuthFail: handlers.onAuthFail || (msg => console.error('❌ Falha na autenticação', msg)),
    onDisconnected: handlers.onDisconnected,
  });

  async function start() {
    if (process.env.NODE_ENV !== 'test') {
      await client.initialize();
    }
    return ctx;
  }

  async function stop() {
    try { rate.stop(); } catch {}
    try { await client.destroy(); } catch {}
  }

  return { ...ctx, start, stop };
}

module.exports = { createApp };
