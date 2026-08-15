const express = require("express");
const cors = require("cors");
const { InferenceClient } = require("@huggingface/inference");

const app = express();

const PORT = process.env.PORT || 3000;
const HF_TOKEN = process.env.HF_TOKEN;

// ===============================
// CONFIGURAÇÃO
// ===============================

app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type"]
}));

app.use(express.json({ limit: "2mb" }));

const hf = HF_TOKEN
  ? new InferenceClient(HF_TOKEN)
  : null;

// Modelo de conversa.
// O Hugging Face escolhe automaticamente um provider compatível
// quando provider: "auto" é utilizado.
const CHAT_MODEL = "Qwen/Qwen3-4B-Instruct-2507";

const IMAGE_MODEL = "black-forest-labs/FLUX.1-schnell";

// Memória temporária do servidor.
// Importante: reiniciar o Render apaga esta memória.
const conversations = new Map();

// ===============================
// PERSONALIDADE DA ADAPTRA
// ===============================

const SYSTEM_PROMPT = `
Você é a Adaptra.AI, uma assistente virtual brasileira.

Sua personalidade:
- amigável
- inteligente
- natural
- paciente
- objetiva
- curiosa
- prestativa
- conversa como uma pessoa, sem parecer robótica

Idioma:
- responda sempre em português do Brasil, salvo se o usuário pedir outro idioma.

Estilo:
- não repita a mesma resposta sem motivo
- não peça para o usuário explicar novamente algo que já foi explicado
- use o contexto anterior da conversa
- responda diretamente primeiro
- faça perguntas apenas quando realmente forem necessárias
- não invente informações
- se não souber algo, diga claramente que não sabe
- use emojis com moderação
- não transforme toda resposta em uma lista
- mantenha respostas simples quando a pergunta for simples
- seja mais detalhada quando o usuário pedir detalhes

Contexto do projeto:
A Adaptra.AI está sendo desenvolvida por Jheymison.

Quando perguntarem:
"quem é seu criador?"
"quem desenvolveu você?"
"quem é seu desenvolvedor?"
responda:
"Meu criador é Jheymison. 🤖"

Não diga que foi criada pela OpenAI.
Não invente outro criador.

Se o usuário estiver desenvolvendo um projeto, ajude passo a passo.
Se ele disser algo como "quero criar um jogo", continue o assunto usando o contexto da conversa.

Você não deve responder apenas:
"Pode me explicar melhor?"
quando já houver informação suficiente.

Exemplo:
Usuário: "Quero criar um jogo."
Resposta adequada:
"Claro! 🎮 Podemos criar. Você quer fazer um jogo 2D, 3D, para celular ou navegador?"

Usuário: "Um RPG 2D."
Resposta adequada:
"Sim! Podemos montar um RPG 2D. Podemos começar pelo personagem, mapa, combate, monstros, itens e sistema de níveis."

Usuário: "Consegue fazer?"
Resposta adequada:
"Consigo te ajudar a construir. Podemos começar pela estrutura do jogo e depois adicionar cada sistema."

Nunca repita uma pergunta de esclarecimento se o usuário já respondeu.
`;

// ===============================
// FUNÇÕES AUXILIARES
// ===============================

function cleanText(text) {
  if (!text) return "";

  return String(text)
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<\|im_end\|>/gi, "")
    .replace(/<\|endoftext\|>/gi, "")
    .trim();
}

function getConversation(id) {
  const key = String(id || "default");

  if (!conversations.has(key)) {
    conversations.set(key, []);
  }

  return conversations.get(key);
}

function limitHistory(messages) {
  return messages.slice(-20);
}

// ===============================
// ROTA PRINCIPAL
// ===============================

app.get("/", (req, res) => {
  res.json({
    online: true,
    app: "Adaptra.AI",
    version: "3.5",
    creator: "Jheymison",
    chat: true,
    imageGeneration: true,
    status: HF_TOKEN ? "ready" : "missing_HF_TOKEN"
  });
});

// ===============================
// STATUS
// ===============================

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    adaptra: "online",
    version: "3.5",
    huggingface: Boolean(HF_TOKEN)
  });
});

// ===============================
// CHAT
// ===============================

app.post("/chat", async (req, res) => {
  try {
    if (!HF_TOKEN || !hf) {
      return res.status(500).json({
        success: false,
        error: "HF_TOKEN não configurado no Render."
      });
    }

    const {
      message,
      conversationId = "default",
      history = []
    } = req.body || {};

    if (
      typeof message !== "string" ||
      !message.trim()
    ) {
      return res.status(400).json({
        success: false,
        error: "Envie uma mensagem válida."
      });
    }

    const userMessage = message.trim();

    // Recupera a conversa do servidor.
    const serverHistory = getConversation(conversationId);

    // Se o frontend enviou histórico, usamos ele.
    // Caso contrário, usamos o histórico temporário do servidor.
    let previousMessages =
      Array.isArray(history) && history.length
        ? history
        : serverHistory;

    previousMessages = previousMessages
      .filter(m =>
        m &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string"
      )
      .slice(-16);

    const messages = [
      {
        role: "system",
        content: SYSTEM_PROMPT
      },
      ...previousMessages,
      {
        role: "user",
        content: userMessage
      }
    ];

    const result = await hf.chatCompletion({
      model: CHAT_MODEL,
      provider: "auto",
      messages,
      max_tokens: 500,
      temperature: 0.7,
      top_p: 0.9
    });

    let answer =
      result?.choices?.[0]?.message?.content || "";

    answer = cleanText(answer);

    if (!answer) {
      throw new Error("A IA não retornou texto.");
    }

    // Salva somente a conversa recente.
    serverHistory.push(
      {
        role: "user",
        content: userMessage
      },
      {
        role: "assistant",
        content: answer
      }
    );

    conversations.set(
      String(conversationId),
      limitHistory(serverHistory)
    );

    res.json({
      success: true,
      answer,
      conversationId,
      model: CHAT_MODEL
    });

  } catch (error) {
    console.error("ERRO NO CHAT:", error);

    res.status(500).json({
      success: false,
      error: "Não consegui responder agora.",
      details:
        process.env.NODE_ENV === "development"
          ? error.message
          : undefined
    });
  }
});

// ===============================
// GERADOR DE IMAGENS
// ===============================

app.post("/generate", async (req, res) => {
  try {
    if (!HF_TOKEN || !hf) {
      return res.status(500).json({
        success: false,
        error: "HF_TOKEN não configurado no Render."
      });
    }

    const { prompt } = req.body || {};

    if (
      typeof prompt !== "string" ||
      !prompt.trim()
    ) {
      return res.status(400).json({
        success: false,
        error: "Digite uma descrição para a imagem."
      });
    }

    console.log("Gerando imagem:", prompt);

    const image = await hf.textToImage({
      model: IMAGE_MODEL,
      provider: "auto",
      inputs: prompt.trim()
    });

    const buffer = Buffer.from(
      await image.arrayBuffer()
    );

    res.status(200);
    res.set("Content-Type", "image/png");
    res.set("Cache-Control", "no-store");
    res.send(buffer);

  } catch (error) {
    console.error("ERRO NA GERAÇÃO:", error);

    res.status(500).json({
      success: false,
      error: "Não foi possível gerar a imagem.",
      details: error.message || "Erro desconhecido"
    });
  }
});

// ===============================
// LIMPAR CONVERSA
// ===============================

app.post("/clear", (req, res) => {
  const { conversationId = "default" } = req.body || {};

  conversations.delete(String(conversationId));

  res.json({
    success: true,
    message: "Conversa limpa."
  });
});

// ===============================
// 404
// ===============================

app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: "Rota não encontrada."
  });
});

// ===============================
// ERROS DO EXPRESS
// ===============================

app.use((error, req, res, next) => {
  console.error("ERRO:", error);

  res.status(500).json({
    success: false,
    error: "Erro interno do servidor."
  });
});

// ===============================
// INICIAR SERVIDOR
// ===============================

app.listen(PORT, () => {
  console.log("=================================");
  console.log("🤖 Adaptra.AI 3.5");
  console.log("👤 Criador: Jheymison");
  console.log(`🌐 Porta: ${PORT}`);
  console.log(`🔐 HF_TOKEN: ${HF_TOKEN ? "OK" : "AUSENTE"}`);
  console.log("💬 Chat: /chat");
  console.log("🖼️ Imagens: /generate");
  console.log("=================================");
});
