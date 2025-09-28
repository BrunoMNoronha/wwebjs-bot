'use strict';

function sleep(ms) { return new Promise(res => setTimeout(res, ms)); }

class RateController {
  constructor(opts = {}) {
    const isTest = process.env.NODE_ENV === 'test';
    this.isTest = isTest;
    this.perChatCooldownMs = isTest ? 0 : Number(opts.perChatCooldownMs ?? 1500);
    this.globalMaxPerInterval = isTest ? Number.MAX_SAFE_INTEGER : Number(opts.globalMaxPerInterval ?? 10);
    this.globalIntervalMs = isTest ? 1 : Number(opts.globalIntervalMs ?? 1000);
    this._lastSendAtByChat = new Map();
    this._tokens = this.globalMaxPerInterval;
    this._refill = null;
  }

  start() {
    if (this.isTest) return; // sem rate limit em teste
    if (this._refill) return;
    this._tokens = this.globalMaxPerInterval;
    const timer = setInterval(() => {
      this._tokens = this.globalMaxPerInterval;
    }, this.globalIntervalMs);
    timer.unref?.();
    this._refill = timer;
  }

  stop() {
    if (this._refill) clearInterval(this._refill);
    this._refill = null;
    this._tokens = this.globalMaxPerInterval;
  }

  async withSend(chatId, fn) {
    if (this.isTest) return fn();
    const now = Date.now();
    const last = this._lastSendAtByChat.get(chatId) || 0;
    const waitMs = Math.max(0, last + this.perChatCooldownMs - now);
    if (waitMs > 0) await sleep(waitMs);

    while (this._tokens <= 0) {
      await sleep(Math.max(5, Math.floor(this.globalIntervalMs / 4)));
    }
    this._tokens -= 1;

    try {
      return await fn();
    } finally {
      this._lastSendAtByChat.set(chatId, Date.now());
    }
  }
}

module.exports = { RateController };
