'use strict';

/**
 * @typedef {Object} FlowPromptEntry
 * @property {number} at
 * @property {string} flow
 */

/**
 * @typedef {Object} FlowPromptTracker
 * @property {(chatId: string, flowKey?: string) => void} remember
 * @property {(chatId: string) => void} clear
 * @property {(chatId: string) => FlowPromptEntry | undefined} get
 * @property {(chatId: string) => boolean} isRecent
 * @property {(chatId: string) => string | undefined} recentFlowKey
 */

const DEFAULT_FLOW_PROMPT_WINDOW_MS = 2 * 60 * 1000;

/**
 * Implementa um pequeno *State Tracker* (variação do pattern *State*) para
 * controlar prompts de fluxos por chat. A API é pensada para uso imutável,
 * retornando um objeto congelado que expõe apenas operações de alto nível,
 * evitando vazamento da estrutura interna.
 *
 * @param {{ windowMs?: number }} [options]
 * @returns {FlowPromptTracker}
 */
function createFlowPromptTracker({ windowMs = DEFAULT_FLOW_PROMPT_WINDOW_MS } = {}) {
  /** @type {Map<string, FlowPromptEntry>} */
  const entries = new Map();

  /**
   * Atualiza (ou cria) um registro para o chat.
   *
   * @param {string} chatId
   * @param {string} [flowKey]
   * @returns {void}
   */
  const remember = (chatId, flowKey) => {
    if (!chatId) return;
    const previous = entries.get(chatId);
    const resolvedKey = flowKey ?? previous?.flow;
    if (!resolvedKey) return;
    entries.set(chatId, { at: Date.now(), flow: resolvedKey });
  };

  /**
   * Remove o registro do chat.
   *
   * @param {string} chatId
   * @returns {void}
   */
  const clear = (chatId) => {
    if (!chatId) return;
    entries.delete(chatId);
  };

  /**
   * Recupera o registro completo (principalmente para testes ou logging).
   *
   * @param {string} chatId
   * @returns {FlowPromptEntry | undefined}
   */
  const get = (chatId) => {
    if (!chatId) return undefined;
    return entries.get(chatId);
  };

  /**
   * Indica se o prompt armazenado ainda é considerado recente.
   *
   * @param {string} chatId
   * @returns {boolean}
   */
  const isRecent = (chatId) => {
    const entry = get(chatId);
    if (!entry) return false;
    return Date.now() - entry.at <= windowMs;
  };

  /**
   * Retorna a chave do fluxo se o prompt for recente.
   *
   * @param {string} chatId
   * @returns {string | undefined}
   */
  const recentFlowKey = (chatId) => {
    if (!isRecent(chatId)) return undefined;
    return get(chatId)?.flow;
  };

  return Object.freeze({ remember, clear, get, isRecent, recentFlowKey });
}

module.exports = {
  createFlowPromptTracker,
  DEFAULT_FLOW_PROMPT_WINDOW_MS,
};
