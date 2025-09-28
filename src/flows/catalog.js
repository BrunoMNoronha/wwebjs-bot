'use strict';

const { FLOW } = require('../config/messages');

// Fluxo de exemplo mais rico (catálogo simplificado)
// Usa o validador já existente em src/validation/flows para manter a integridade
const flow = {
  start: 'inicio',
  nodes: {
    inicio: {
      prompt: FLOW.catalog.inicio,
      options: [
        { id: 'consertos', text: 'Consertos', next: 'consertos' },
        { id: 'produtos', text: 'Produtos', next: 'produtos' },
        { id: 'falar', text: 'Falar com atendente', next: 'atendente' },
      ],
    },
    consertos: {
      prompt: FLOW.catalog.consertos,
      options: [
        { id: 'sola', text: 'Troca de sola', next: 'final' },
        { id: 'costura', text: 'Reparo de costura', next: 'final' },
        { id: 'voltar', text: 'Voltar', next: 'inicio' },
      ],
    },
    produtos: {
      prompt: FLOW.catalog.produtos,
      options: [
        { id: 'cadarco', text: 'Cadarços', next: 'final' },
        { id: 'palmilha', text: 'Palmilhas', next: 'final' },
        { id: 'voltar', text: 'Voltar', next: 'inicio' },
      ],
    },
    atendente: { prompt: FLOW.catalog.atendente, terminal: true, options: [] },
    final: { prompt: FLOW.catalog.final, terminal: true, options: [] },
  },
};

module.exports = { flow };
