'use strict';

const { validateOptionFlow } = require('../validation/flows');
const { buildOptionMatcher } = require('../validation/answers');
const { createStore } = require('./stateStore');

/**
 * @typedef {Object} FlowOption
 * @property {string} text
 * @property {string} [next]
 * @property {string[]} [aliases]
 * @property {boolean} [correct]
 */

/**
 * @typedef {Object} FlowNode
 * @property {string} [id]
 * @property {string} [prompt]
 * @property {boolean} [terminal]
 * @property {FlowOption[]} [options]
 */

/**
 * @typedef {Object} FlowDefinition
 * @property {string} start
 * @property {Record<string, FlowNode>} nodes
 */

/**
 * @typedef {Object} FlowState
 * @property {FlowDefinition} flow
 * @property {string} current
 */

/**
 * @typedef {{
 *   get(chatId: string): Promise<FlowState | null>,
 *   set(chatId: string, value: FlowState): Promise<void>,
 *   clear(chatId: string): Promise<void>,
 *   has(chatId: string): Promise<boolean>
 * }} FlowStateStore
 */

// Engine simples para conduzir fluxos por chatId
class FlowEngine {
  /**
   * @param {FlowStateStore} [store]
   */
  constructor(store = createStore()) {
    /** @type {FlowStateStore} */
    this.store = store;
  }

  // Inicia um fluxo para o chatId, validando-o
  /**
   * @param {string} chatId
   * @param {FlowDefinition} flow
   * @returns {Promise<{ ok: true, node: FlowNode } | { ok: false, error: string, details?: string[] }>}
   */
  async start(chatId, flow) {
    const res = validateOptionFlow(flow, undefined, {});
    if (!res.ok) {
      return { ok: false, error: 'Fluxo inválido', details: res.errors };
    }
    await this.store.set(chatId, { flow, current: flow.start });
    return { ok: true, node: flow.nodes[flow.start] };
  }

  /**
   * @param {string} chatId
   * @returns {Promise<FlowState | null>}
   */
  async getState(chatId) {
    return this.store.get(chatId);
  }

  /**
   * @param {string} chatId
   * @returns {Promise<boolean>}
   */
  async isActive(chatId) {
    return this.store.has(chatId);
  }

  /**
   * @param {string} chatId
   * @returns {Promise<void>}
   */
  async cancel(chatId) {
    await this.store.clear(chatId);
  }

  // Avança o fluxo com uma entrada de usuário; retorna o próximo prompt (ou terminal)
  /**
   * @param {string} chatId
   * @param {string} inputRaw
   * @returns {Promise<
   *   | { ok: false, error: string, expected?: string[], nodeId?: string }
   *   | {
   *       ok: true,
   *       terminal: boolean,
   *       prompt: string | undefined,
   *       options?: string[]
   *     }
   * >}
   */
  async advance(chatId, inputRaw) {
    const st = await this.store.get(chatId);
    if (!st) return { ok: false, error: 'Sem fluxo ativo' };
    const { flow, current } = st;
    const node = flow.nodes[current];
    if (!node) {
      await this.store.clear(chatId);
      return { ok: false, error: 'no_node', nodeId: current };
    }

    if (!Array.isArray(node.options) || node.options.length === 0) {
      await this.store.clear(chatId);
      return { ok: true, terminal: true, prompt: node.prompt };
    }

    const matcher = buildOptionMatcher(node.options);
    const m = matcher.match(inputRaw);
    if (!m) {
      return { ok: false, error: 'input_invalido', expected: node.options.map(o => o.text) };
    }
    const nextId = m.option.next;
    if (!nextId) {
      await this.store.clear(chatId);
      return { ok: true, terminal: true, prompt: node.prompt };
    }

    const nextNode = flow.nodes[nextId];
    if (!nextNode) {
      await this.store.clear(chatId);
      return { ok: false, error: 'next_inexistente' };
    }

    // Se terminal: encerra
    if (nextNode.terminal || !nextNode.options || nextNode.options.length === 0) {
      await this.store.clear(chatId);
      return { ok: true, terminal: true, prompt: nextNode.prompt };
    }

    // Avança e retorna próximo prompt
    await this.store.set(chatId, { flow, current: nextId });
    return {
      ok: true,
      terminal: false,
      prompt: nextNode.prompt,
      options: nextNode.options.map((o, i) => `${i + 1}. ${o.text}`),
    };
  }
}

module.exports = { FlowEngine };
