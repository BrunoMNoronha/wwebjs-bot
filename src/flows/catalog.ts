import type { FlowDefinition } from '../application/flows/FlowSessionService';
import { TEXT } from '../config/messages';

export const catalogFlow: FlowDefinition = {
  start: 'inicio',
  nodes: {
    inicio: {
      id: 'inicio',
      prompt: `${TEXT.welcomeHeader}\n${TEXT.welcomeBody}`,
      options: [
        { id: 'consertos', text: 'Consertos', aliases: ['1'], next: 'consertos' },
        { id: 'produtos', text: 'Produtos', aliases: ['2'], next: 'produtos' },
        { id: 'atendente', text: 'Falar com atendente', aliases: ['3'], next: 'atendente' },
      ],
    },
    consertos: {
      id: 'consertos',
      prompt: 'Tipos de conserto:',
      options: [
        { id: 'sola', text: 'Troca de sola', aliases: ['1'], next: 'final' },
        { id: 'costura', text: 'Reparo de costura', aliases: ['2'], next: 'final' },
        { id: 'voltar', text: 'Voltar', aliases: ['3'], next: 'inicio' },
      ],
    },
    produtos: {
      id: 'produtos',
      prompt: 'Produtos disponíveis:',
      options: [
        { id: 'cadarco', text: 'Cadarços', aliases: ['1'], next: 'final' },
        { id: 'palmilha', text: 'Palmilhas', aliases: ['2'], next: 'final' },
        { id: 'voltar', text: 'Voltar', aliases: ['3'], next: 'inicio' },
      ],
    },
    atendente: {
      id: 'atendente',
      prompt: 'Ok, conectando com um atendente...',
      terminal: true,
    },
    final: {
      id: 'final',
      prompt: 'Perfeito! Vamos seguir com essa opção. Algo mais?',
      terminal: true,
    },
  },
} satisfies FlowDefinition;

export default catalogFlow;
