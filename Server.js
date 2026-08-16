const express = require("express");
const cors = require("cors");
const { InferenceClient } = require("@huggingface/inference");

const app = express();

app.use(cors());
app.use(express.json({ limit: "2mb" }));

const PORT = process.env.PORT || 3000;
const MODEL = "Qwen/Qwen3-32B";
const HF_TOKEN = process.env.HF_TOKEN;

if (!HF_TOKEN) {
  console.error("ERRO: HF_TOKEN não configurado.");
}

const hf = new InferenceClient(HF_TOKEN);

const conversations = new Map();
const MAX_MESSAGES = 20;

const SYSTEM_PROMPT = `
Você é a Adaptra.AI, uma inteligência artificial criada por Jheymison.

Seu nome é Adaptra.AI.
Seu criador é Jheymison.

Se perguntarem quem é seu criador, responda:
"Meu criador é Jheymison. 😊"

REGRAS DE CONVERSA:

1. Entenda o contexto das mensagens anteriores.
2. Não trate cada mensagem como uma conversa nova.
3. Se o usuário responder algo curto, interprete usando o contexto.
4. Não repita perguntas já respondidas.
5. Não peça novamente informações que o usuário já forneceu.
6. Se já tiver informações suficientes, execute a tarefa.
7. Faça perguntas somente quando realmente necessário.
8. Seja natural, amigável e objetiva.
9. Responda em português do Brasil.
10. Não invente informações sobre sua identidade.

EXEMPLO:

Usuário:
"Quero uma ideia de vídeo."

Adaptra:
"Claro! Qual é o tema?"

Usuário:
"Tecnologia e curto."

A resposta correta deve continuar a tarefa.

Exemplo:
"Perfeito! 🚀 Para um vídeo curto sobre tecnologia, uma ideia seria: '3 tecnologias que parecem coisa de filme, mas já existem'."

NÃO responda explicando o que é tecnologia.

Outro exemplo:

Usuário:
"Quero criar um jogo."

Adaptra:
"Que tipo de jogo?"

Usuário:
"RPG 2D."

Continue ajudando a criar o RPG 2D.

Você deve manter continuidade na conversa.
`;

function getHistory(sessionId) {

  if (!sessionId) {
    sessionId = "default";
  }

  if (!conversations.has(sessionId)) {
    conversations.set(sessionId, []);
  }

  return conversations.get(sessionId);
}

function trimHistory(history) {

  while (history.length > MAX_MESSAGES) {
    history.shift();
  }

  return history;
}

function getReply(result) {

  return (
    result?.choices?.[0]?.message?.content ||
    ""
  ).trim();
}

async function chat(req, res) {

  try {

    const body = req.body || {};

    const sessionId =
      typeof body.sessionId === "string" &&
      body.sessionId.trim()
        ? body.sessionId.trim()
        : "default";

    let prompt = body.prompt || body.message;

    if (
      !prompt &&
      Array.isArray(body.messages)
    ) {

      const lastUser = [...body.messages]
        .reverse()
        .find(
          item =>
            item &&
            item.role === "user" &&
            typeof item.content === "string"
        );

      if (lastUser) {
        prompt = lastUser.content;
      }
    }

    if (
      typeof prompt !== "string" ||
      !prompt.trim()
    ) {

      return res.status(400).json({
        success: false,
        error: "Digite uma mensagem."
      });

    }

    const history = getHistory(sessionId);

    history.push({
      role: "user",
      content: prompt.trim()
    });

    trimHistory(history);

    console.log(
      `[CHAT] sessão=${sessionId} mensagens=${history.length}`
    );

    const result = await hf.chatCompletion({

      model: MODEL,

      messages: [
        {
          role: "system",
          content: SYSTEM_PROMPT
        },
        ...history
      ],

      max_tokens: 700,
      temperature: 0.7,
      top_p: 0.9

    });

    const reply = getReply(result);

    if (!reply) {
      throw new Error(
        "O modelo não retornou texto."
      );
    }

    history.push({
      role: "assistant",
      content: reply
    });

    trimHistory(history);

    return res.json({

      success: true,

      reply: reply,

      response: reply,

      model: MODEL,

      version: "3.6",

      sessionId: sessionId

    });

  } catch (error) {

    console.error(
      "[ERRO CHAT]",
      error
    );

    return res.status(500).json({

      success: false,

      error:
        "Não consegui responder agora.",

      details:
        error?.message ||
        "Erro desconhecido"

    });

  }

}

// =====================================================
// ROTAS
// =====================================================

app.get("/", (req, res) => {

  res.json({

    success: true,

    app: "Adaptra.AI",

    version: "3.6",

    status: "online",

    model: MODEL,

    context: true

  });

});

app.get("/health", (req, res) => {

  res.json({

    success: true,

    status: "online",

    version: "3.6",

    hfToken:
      Boolean(HF_TOKEN)

  });

});

app.post("/chat", chat);

app.post("/api/chat", chat);

app.post("/falar", chat);

app.post("/clear", (req, res) => {

  const sessionId =
    req.body?.sessionId || "default";

  conversations.delete(sessionId);

  res.json({

    success: true,

    message: "Memória da conversa limpa."

  });

});

app.use((req, res) => {

  res.status(404).json({

    success: false,

    error: "Rota não encontrada.",

    path: req.path

  });

});

// =====================================================
// SERVIDOR
// =====================================================

app.listen(PORT, () => {

  console.log(
    `Adaptra.AI 3.6 online na porta ${PORT}`
  );

  console.log(
    `Modelo: ${MODEL}`
  );

  console.log(
    `Contexto: ATIVO`
  );

  console.log(
    `HF_TOKEN: ${
      HF_TOKEN
        ? "CONFIGURADO"
        : "AUSENTE"
    }`
  );

});
