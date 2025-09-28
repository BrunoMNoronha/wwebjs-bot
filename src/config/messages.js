'use strict';

// Textos de mensagens e respostas
const TEXT = {
  welcome:
    '👟 *Bem-vindo à Sapataria Alves - UPA DO TENIS* 👞\n\n' +
    'Como podemos te ajudar hoje?\n\n' +
    '1️⃣ - Solicitar um orçamento\n' +
    '2️⃣ - Verificar andamento do serviço\n' +
    '3️⃣ - Nossa localização\n' +
    '4️⃣ - Tirar dúvidas\n' +
    '5️⃣ - Falar com um atendente\n\n' +
    'Digite o número da opção desejada ou use nossos menus interativos:',
  answers: {
    orcamento:
      'Para solicitar um orçamento, por favor, envie uma foto clara do seu calçado e descreva o serviço que você precisa.',
    andamento:
      'Para verificar o andamento do seu serviço, por favor, informe o número da sua ordem de serviço.',
    localIntro:
      'Nossa loja fica na *Rua dos Sapateiros, 123 - Centro*.',
    duvidas:
      'Certo! Qual é a sua dúvida? Um de nossos especialistas responderá em breve.',
    atendente:
      'Por favor, aguarde. Estamos te transferindo para um de nossos atendentes.',
  },
};

// Estrutura do menu de lista (WhatsApp List)
const LIST = {
  body: 'Selecione um dos serviços abaixo para continuar.',
  buttonText: 'Nossos Serviços',
  title: 'Menu de Serviços',
  sections: [
    {
      title: 'Atendimento Rápido',
      rows: [
        { id: 'orcamento', title: 'Solicitar Orçamento', description: 'Envie fotos do seu calçado para uma pré-análise.' },
        { id: 'andamento', title: 'Verificar Andamento', description: 'Consulte o status do seu conserto.' },
        { id: 'localizacao', title: 'Nossa Localização', description: 'Receba o endereço e o mapa da nossa loja.' },
      ],
    },
    {
      title: 'Fale Conosco',
      rows: [
        { id: 'duvidas', title: 'Tirar Dúvidas', description: 'Veja as perguntas mais frequentes.' },
        { id: 'atendente', title: 'Falar com Atendente', description: 'Conectando você com nossa equipe.' },
      ],
    },
  ],
};

// Estrutura dos botões (WhatsApp Buttons)
const BUTTONS = {
  body: 'Selecione uma das opções abaixo:',
  title: 'Sapataria Alves - UPA DO TENIS',
  footer: 'Atendimento Rápido',
  items: [
    { id: 'btn_orcamento', body: 'Solicitar Orçamento' },
    { id: 'btn_andamento', body: 'Verificar Serviço' },
    { id: 'btn_atendente', body: 'Falar com Atendente' },
  ],
};

// Informações de localização padrão
const LOCATION = {
  lat: -23.5505,
  lng: -46.6333,
  description: 'Sapataria Alves - UPA DO TENIS\nC12 Bloco O Loja 5, Taguatinga Centro - DF',
};

// Mensagens dos fluxos
const FLOW = {
  catalog: {
    inicio: 'Olá! Escolha uma categoria:',
    consertos: 'Tipos de conserto:',
    produtos: 'Produtos disponíveis:',
    atendente: 'Ok, conectando com um atendente...',
    final: 'Perfeito! Vamos seguir com essa opção. Algo mais?',
  },
};

module.exports = { TEXT, LIST, BUTTONS, LOCATION, FLOW };

