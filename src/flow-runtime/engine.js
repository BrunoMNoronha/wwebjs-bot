'use strict';

const { validateOptionFlow } = require('../validation/flows');
const { buildOptionMatcher } = require('../validation/answers');
const { createStore } = require('./stateStore');

// Engine simples para conduzir fluxos por chatId
class FlowEngine {
  constructor(store = createStore()) {
    this.store = store;
  }

  // Inicia um fluxo para o chatId, validando-o
  async start(chatId, flow) {
    const res = validateOptionFlow(flow, undefined, {});
    if (!res.ok) {
      return { ok: false, error: 'Fluxo inválido', details: res.errors };
    }
    await this.store.set(chatId, { flow, current: flow.start });
    return { ok: true, node: flow.nodes[flow.start] };
  }

  async getState(chatId) {
    return this.store.get(chatId);
  }

  async isActive(chatId) {
    return this.store.has(chatId);
  }

  async cancel(chatId) {
    await this.store.clear(chatId);
  }

  // Avança o fluxo com uma entrada de usuário; retorna o próximo prompt (ou terminal)
  async advance(chatId, inputRaw) {
    const st = await this.store.get(chatId);
    if (!st) return { ok: false, error: 'Sem fluxo ativo' };
    const { flow, current } = st;
    const node = flow.nodes[current];
    if (!node || !Array.isArray(node.options) || node.options.length === 0) {
      await this.store.clear(chatId);
      return { ok: true, terminal: true, prompt: node?.prompt };
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
