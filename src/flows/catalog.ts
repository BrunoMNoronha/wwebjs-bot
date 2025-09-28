import type { FlowDefinition } from '../application/flows/FlowSessionService';
import { TEXT } from '../config/messages';

export const catalogFlow: FlowDefinition = {
  start: 'inicio',
  nodes: {
    inicio: {
      id: 'inicio',
      kind: 'text',
      prompt: `${TEXT.welcomeHeader}\n${TEXT.welcomeBody}`,
      promptContent: `${TEXT.welcomeHeader}\n${TEXT.welcomeBody}`,
      options: [
        { id: 'consertos', text: 'Consertos', aliases: ['1'], next: 'consertos' },
        { id: 'produtos', text: 'Produtos', aliases: ['2'], next: 'produtos' },
        { id: 'atendente', text: 'Falar com atendente', aliases: ['3'], next: 'atendente' },
      ],
    },
    consertos: {
      id: 'consertos',
      kind: 'text',
      prompt: 'Tipos de conserto:',
      promptContent: 'Tipos de conserto:',
      options: [
        { id: 'sola', text: 'Troca de sola', aliases: ['1'], next: 'final' },
        { id: 'costura', text: 'Reparo de costura', aliases: ['2'], next: 'final' },
        { id: 'voltar', text: 'Voltar', aliases: ['3'], next: 'inicio' },
      ],
    },
    produtos: {
      id: 'produtos',
      kind: 'text',
      prompt: 'Produtos disponíveis:',
      promptContent: 'Produtos disponíveis:',
      options: [
        { id: 'cadarco', text: 'Cadarços', aliases: ['1'], next: 'final' },
        { id: 'palmilha', text: 'Palmilhas', aliases: ['2'], next: 'final' },
        { id: 'voltar', text: 'Voltar', aliases: ['3'], next: 'inicio' },
      ],
    },
    atendente: {
      id: 'atendente',
      kind: 'text',
      prompt: 'Ok, conectando com um atendente...',
      promptContent: 'Ok, conectando com um atendente...',
      terminal: true,
    },
    final: {
      id: 'final',
      kind: 'text',
      prompt: 'Perfeito! Vamos seguir com essa opção. Algo mais?',
      promptContent: 'Perfeito! Vamos seguir com essa opção. Algo mais?',
      terminal: true,
    },
  },
} satisfies FlowDefinition;

export default catalogFlow;
