export interface ListRow {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
}

export interface ListSection {
  readonly title: string;
  readonly rows: readonly ListRow[];
}

export interface MenuTemplate {
  readonly title: string;
  readonly body: string;
  readonly buttonText: string;
  readonly sections: readonly ListSection[];
}

export interface SuggestionTexts {
  readonly suggestionPrompt: (optionTitle: string) => string;
  readonly confirmHint: string;
}

export interface FlowTextConfig {
  readonly welcomeHeader: string;
  readonly welcomeBody: string;
  readonly friendlyRetry: string;
  readonly fallbackRetry: string;
  readonly fallbackClosure: string;
  readonly lockedNotice: string;
  readonly resumedNotice: string;
  readonly awaitingAgent: string;
  readonly invalidWhileLocked: string;
  readonly suggestion: SuggestionTexts;
  readonly responses: {
    readonly orçamento: string;
    readonly andamento: string;
    readonly localizacao: string;
    readonly outras: string;
  };
}

export const TEXT: FlowTextConfig = {
  welcomeHeader: '👟 Sapataria Alves 👟',
  welcomeBody:
    'Como podemos te ajudar hoje? Escolha uma das opções no menu abaixo ou toque no botão correspondente.',
  friendlyRetry:
    'Não consegui identificar sua solicitação. Por favor, utilize o menu para escolher uma das opções disponíveis.',
  fallbackRetry:
    'Ainda não entendi sua necessidade. Você pode encerrar e aguardar um atendente ou voltar para o menu principal.',
  fallbackClosure:
    'Tudo bem! Vamos encerrar por aqui e um atendente dará continuidade assim que possível. Muito obrigado pelo contato!',
  lockedNotice:
    'Estamos finalizando seu atendimento anterior. Assim que um atendente estiver disponível, a conversa será retomada automaticamente.',
  resumedNotice:
    'Obrigado por aguardar! Vamos retomar o atendimento a partir do menu principal.',
  awaitingAgent:
    'Sua dúvida foi encaminhada para nossa equipe. Em até alguns instantes um atendente continuará o atendimento.',
  invalidWhileLocked:
    'Recebemos sua mensagem e manteremos o atendimento em espera por alguns minutos. Em breve retornaremos.',
  suggestion: {
    suggestionPrompt: (optionTitle: string): string =>
      `Encontrei uma opção parecida com o que você digitou: "${optionTitle}". Essa é a escolha correta? Responda com "sim" ou selecione outra opção no menu.`,
    confirmHint: 'Se preferir outra opção, basta escolher direto no menu.',
  },
  responses: {
    orçamento:
      'Perfeito!\nEnvie uma foto do seu tênis/bolsa/sapato e descreva brevemente o que precisa (ex.: troca de sola, limpeza, restauração).\nNosso time vai analisar e enviar o orçamento inicial com prazo estimado.',
    andamento:
      'Certo!\nPor favor, informe o número da sua Ordem de Serviço (OS) ou o telefone cadastrado.\nAssim consigo consultar no sistema e trazer mais informações.',
    localizacao:
      'Estamos na:\n📍 C12 Bloco O Lote 07/14, Loja 05 – Taguatinga Centro, Brasília – DF.\n\n🕒 Horário de funcionamento:\nSegunda a Sexta: 09h – 17h\nSábado: 09h – 13h\n\n👉 Clique aqui para abrir no Google Maps: https://maps.app.goo.gl/oP1C3Q9eBDjx96Eu6',
    outras:
      'Claro!\nVocê pode perguntar sobre:\n- Tipos de serviços que realizamos\n- Valores médios e prazos\n- Parcerias e indicações\n\nDigite sua dúvida e eu vou te ajudar. Caso prefira, um atendente dará continuidade em instantes.',
  },
};

export const INITIAL_MENU_TEMPLATE: MenuTemplate = {
  title: 'Atendimento Sapataria Alves',
  body: 'Selecione como podemos te ajudar. Você pode tocar na opção desejada para continuar.',
  buttonText: 'Ver opções',
  sections: [
    {
      title: 'Serviços principais',
      rows: [
        { id: 'orcamento', title: 'Solicitar orçamento', description: 'Envie fotos e receba uma estimativa inicial.' },
        { id: 'andamento', title: 'Verificar andamento da OS', description: 'Consulte o status da sua ordem de serviço.' },
        { id: 'localizacao', title: 'Localização e horário', description: 'Endereço completo e horários de atendimento.' },
        { id: 'outras', title: 'Outras informações', description: 'Envie dúvidas gerais ou pedidos específicos.' },
      ],
    },
  ],
};

export const FALLBACK_MENU_TEMPLATE: MenuTemplate = {
  title: 'Posso te ajudar de outra forma?',
  body: 'Não se preocupe! Escolha uma opção abaixo para seguir com o atendimento.',
  buttonText: 'Continuar atendimento',
  sections: [
    {
      title: 'Próximos passos',
      rows: [
        { id: 'aguardar_atendente', title: 'Encerrar e aguardar atendente', description: 'Vamos finalizar por aqui e avisar nossa equipe.' },
        { id: 'voltar_menu', title: 'Voltar ao menu principal', description: 'Reabrir as opções iniciais.' },
      ],
    },
  ],
};

export const LOCK_DURATION_MS = 15 * 60 * 1000;
export const RESPONSE_BASE_DELAY_MS = 5_000;
export const RESPONSE_DELAY_FACTOR = 1.5;
export const FUZZY_SUGGESTION_THRESHOLD = 0.45;
export const FUZZY_CONFIRMATION_THRESHOLD = 0.75;
