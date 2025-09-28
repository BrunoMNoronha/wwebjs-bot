"use strict";

/**
 * @typedef {import('../infrastructure/logging/createConsoleLikeLogger').ConsoleLikeLogger} ConsoleLikeLogger
 */

// Armazena estado do fluxo por chatId -> { flow, current }
// Backend pluggable: memória (default) ou Redis (via REDIS_URL/REDIS_HOST/PORT)

class MemoryStore {
  constructor() {
    this.map = new Map();
    this.ttlMap = new Map(); // chatId -> timeoutId
    this.ttlSec = Number(process.env.FLOW_TTL_SECONDS || 1800); // 30 min
  }
  async get(chatId) {
    return this.map.get(chatId) || null;
  }
  async set(chatId, value) {
    this.map.set(chatId, value);
    if (this.ttlSec > 0) {
      clearTimeout(this.ttlMap.get(chatId));
      const to = setTimeout(() => {
        this.map.delete(chatId);
        this.ttlMap.delete(chatId);
      }, this.ttlSec * 1000);
      to.unref?.();
      this.ttlMap.set(chatId, to);
    }
  }
  async clear(chatId) {
    this.map.delete(chatId);
    clearTimeout(this.ttlMap.get(chatId));
    this.ttlMap.delete(chatId);
  }
  async has(chatId) {
    return this.map.has(chatId);
  }
}

class RedisStore {
  constructor(redisClient) {
    this.redis = redisClient;
    this.ttlSec = Number(process.env.FLOW_TTL_SECONDS || 1800);
    this.prefix = process.env.FLOW_REDIS_PREFIX || 'wwebjs:flow:';
  }
  key(chatId) { return this.prefix + chatId; }
  async get(chatId) {
    const raw = await this.redis.get(this.key(chatId));
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  }
  async set(chatId, value) {
    const payload = JSON.stringify(value);
    if (this.ttlSec > 0) {
      await this.redis.set(this.key(chatId), payload, 'EX', this.ttlSec);
    } else {
      await this.redis.set(this.key(chatId), payload);
    }
  }
  async clear(chatId) { await this.redis.del(this.key(chatId)); }
  async has(chatId) { return Boolean(await this.redis.exists(this.key(chatId))); }
}

/**
 * @param {ConsoleLikeLogger} [logger=console]
 */
function createRedisClientFromEnv(logger = console) {
  const isTest = process.env.NODE_ENV === 'test';
  const hasUrl = !!process.env.REDIS_URL;
  const hasHost = !!process.env.REDIS_HOST;
  if (isTest) return null; // nunca usa Redis em testes
  if (!hasUrl && !hasHost) return null;
  let Redis;
  try {
    // require dinâmico para não quebrar quando não instalado
    Redis = require('ioredis');
  } catch (e) {
    logger.warn('[flow-store] ioredis não instalado; usando MemoryStore.');
    return null;
  }
  try {
    const client = hasUrl
      ? new Redis(process.env.REDIS_URL)
      : new Redis({
          host: process.env.REDIS_HOST,
          port: Number(process.env.REDIS_PORT || 6379),
          password: process.env.REDIS_PASSWORD || undefined,
        });
    client.on('error', err => logger.warn('[flow-store] Redis error:', err?.message || err));
    return client;
  } catch (e) {
    logger.warn('[flow-store] Falha ao criar cliente Redis; usando MemoryStore.');
    return null;
  }
}

/**
 * Cria a store de estado de fluxo.
 * Permite escolher explicitamente via env/param o driver desejado.
 *
 * Precedência de escolha do driver:
 *  1) Parâmetro options.driver ("memory" | "redis")
 *  2) Variável de ambiente FLOW_STORE ("memory" | "redis")
 *  3) Auto-detecção (Redis via env; caso contrário, memória)
 *
 * @param {{ driver?: 'memory' | 'redis', redisClient?: any }} [options]
 * @param {ConsoleLikeLogger} [logger=console]
 * @returns {MemoryStore | RedisStore}
 */
function createStore(options = {}, logger = console) {
  const pref = (options.driver || process.env.FLOW_STORE || '').toLowerCase().trim();

  if (pref === 'memory') {
    return new MemoryStore();
  }

  if (pref === 'redis') {
    const client = options.redisClient || createRedisClientFromEnv(logger);
    if (client) return new RedisStore(client);
    logger.warn('[flow-store] Driver "redis" solicitado porém indisponível; usando MemoryStore.');
    return new MemoryStore();
  }

  // Auto-detecção padrão
  const client = createRedisClientFromEnv(logger);
  if (client) return new RedisStore(client);
  return new MemoryStore();
}

module.exports = { createStore, MemoryStore, RedisStore };
