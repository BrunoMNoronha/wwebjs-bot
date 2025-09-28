import type { FlowDefinition } from '../application/flows/FlowSessionService';
import { INITIAL_MENU_TEMPLATE, TEXT } from '../config/messages';

export const menuFlow: FlowDefinition = {
  start: 'inicio',
  nodes: {
    inicio: {
      id: 'inicio',
      prompt: `${TEXT.welcomeHeader}\n${TEXT.welcomeBody}`,
      template: INITIAL_MENU_TEMPLATE,
      options: [
        { id: 'orcamento', text: 'Solicitar orçamento', aliases: ['1'], next: 'orcamento' },
        { id: 'andamento', text: 'Verificar andamento da OS', aliases: ['2'], next: 'andamento' },
        { id: 'localizacao', text: 'Localização e horário', aliases: ['3'], next: 'localizacao' },
        { id: 'outras', text: 'Outras informações', aliases: ['4'], next: 'outras' },
      ],
    },
    orcamento: {
      id: 'orcamento',
      prompt: TEXT.responses.orçamento,
      terminal: true,
    },
    andamento: {
      id: 'andamento',
      prompt: TEXT.responses.andamento,
      terminal: true,
    },
    localizacao: {
      id: 'localizacao',
      prompt: TEXT.responses.localizacao,
      terminal: true,
    },
    outras: {
      id: 'outras',
      prompt: TEXT.responses.outras,
      terminal: true,
      lockOnComplete: true,
    },
  },
} satisfies FlowDefinition;

export default menuFlow;
