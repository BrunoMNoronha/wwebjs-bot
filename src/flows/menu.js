'use strict';

const { TEXT } = require('../config/messages');

// Fluxo de menu principal compatível com a engine atual (prompt + options + terminal)
const flow = {
  start: 'inicio',
  nodes: {
    inicio: {
      prompt: '👟 Sapataria Alves 👟\nComo podemos te ajudar hoje?',
      options: [
        { id: 'orcamento', text: 'Solicitar orçamento', aliases: ['1'], next: 'end_orcamento' },
        { id: 'andamento', text: 'Verificar andamento', aliases: ['2'], next: 'end_andamento' },
        { id: 'localizacao', text: 'Nossa localização', aliases: ['3'], next: 'end_localizacao' },
        { id: 'duvidas', text: 'Tirar dúvidas', aliases: ['4'], next: 'end_duvidas' },
        { id: 'atendente', text: 'Falar com atendente', aliases: ['5'], next: 'end_atendente' },
      ],
    },
    end_orcamento:   { terminal: true, prompt: TEXT.answers.orcamento, options: [] },
    end_andamento:   { terminal: true, prompt: TEXT.answers.andamento, options: [] },
    end_localizacao: { terminal: true, prompt: TEXT.answers.localIntro, options: [] },
    end_duvidas:     { terminal: true, prompt: TEXT.answers.duvidas, options: [] },
    end_atendente:   { terminal: true, prompt: TEXT.answers.atendente, options: [] },
  },
};

module.exports = { flow };
