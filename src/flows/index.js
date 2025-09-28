'use strict';

const fs = require('fs');
const path = require('path');

/**
 * @typedef {{ id: string, text: string, next?: string, aliases?: string[], correct?: boolean }} FlowNodeOption
 */
/**
 * @typedef {{ prompt?: string, terminal?: boolean, options?: FlowNodeOption[] }} FlowNode
 */
/**
 * @typedef {{ start: string, nodes: Record<string, FlowNode> }} FlowDefinition
 */
/** @typedef {{ flow: FlowDefinition }} FlowModule */

/**
 * Normaliza o módulo carregado para sempre expor `{ flow }`.
 * @param {unknown} mod
 * @returns {FlowModule}
 */
function normalizeFlowModule(mod) {
  if (mod && typeof mod === 'object') {
    const maybeModule = /** @type {{ flow?: FlowDefinition, default?: unknown }} */ (mod);
    if (maybeModule.flow) {
      return /** @type {FlowModule} */ (maybeModule);
    }
    if (maybeModule.default) {
      return normalizeFlowModule(maybeModule.default);
    }
  }
  return { flow: /** @type {FlowDefinition} */ (mod) };
}

/**
 * Carrega todos os fluxos presentes neste diretório seguindo o padrão Registry.
 * @returns {Record<string, FlowModule>}
 */
function loadFlowModules() {
  return fs
    .readdirSync(__dirname)
    .filter(file => file.endsWith('.js') && file !== 'index.js')
    .sort()
    .reduce((acc, file) => {
      const key = path.basename(file, '.js');
      const required = require(path.join(__dirname, file));
      acc[key] = normalizeFlowModule(required);
      return acc;
    }, /** @type {Record<string, FlowModule>} */ ({}));
}

const registry = loadFlowModules();

/**
 * Novos fluxos são descobertos automaticamente: basta adicionar um novo arquivo
 * `.js` neste diretório e ele será registrado ao iniciar a aplicação.
 */
module.exports = registry;
