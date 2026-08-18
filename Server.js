"use strict";

const express = require("express");
const cors = require("cors");

const app = express();

const PORT = process.env.PORT || 3000;

/* =========================================================
   MIDDLEWARE
========================================================= */

app.use(cors());

app.use(
  express.json({
    limit: "10mb"
  })
);

/* =========================================================
   CONFIGURAÇÃO
========================================================= */

const HF_TOKEN = process.env.HF_TOKEN || "";

const HF_CHAT_MODEL =
  process.env.HF_CHAT_MODEL ||
  "meta-llama/Llama-3.1-8B-Instruct";

const CLOUDFLARE_ACCOUNT_ID =
  process.env.CLOUDFLARE_ACCOUNT_ID || "";

const CLOUDFLARE_API_TOKEN =
  process.env.CLOUDFLARE_API_TOKEN || "";

const CLOUDFLARE_IMAGE_MODEL =
  process.env.CLOUDFLARE_IMAGE_MODEL ||
  "@cf/black-forest-labs/flux-1-schnell";

/* =========================================================
   MEMÓRIA TEMPORÁRIA
========================================================= */

const memoryStore = new Map();
const conversationsStore = new Map();
const projectsStore = new Map();

/* =========================================================
   UTILIDADES
========================================================= */

function now() {
  return new Date().toISOString();
}

function createId(prefix) {
  return (
    prefix +
    "_" +
    Date.now().toString(36) +
    "_" +
    Math.random().toString(36).slice(2, 8)
  );
}

function cleanText(text) {
  return String(text || "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<\|im_end\|>/g, "")
    .replace(/<\|endoftext\|>/g, "")
    .trim();
}

function getUserId(req) {
  return (
    req.body?.userId ||
    req.query?.userId ||
    req.headers["x-user-id"] ||
    "default-user"
  );
}

/* =========================================================
   HOME
========================================================= */

app.get("/", (req, res) => {
  res.json({
    success: true,
    name: "Adaptra.AI",
    version: "3.6",
    message: "Backend da Adaptra.AI está funcionando.",
    provider: {
      chat: "Hugging Face",
      image: "Cloudflare Workers AI"
    },
    routes: {
      health: "/health",
      chat: "/chat",
      generate: "/generate",
      memory: "/memory",
      conversations: "/conversations",
      projects: "/projects"
    }
  });
});

/* =========================================================
   HEALTH
========================================================= */

app.get("/health", (req, res) => {
  res.json({
    success: true,
    status: "online",
    service: "Adaptra.AI Backend",
    version: "3.6",

    providers: {
      chat: "Hugging Face",
      image: "Cloudflare Workers AI"
    },

    models: {
      chat: HF_CHAT_MODEL,
      image: CLOUDFLARE_IMAGE_MODEL
    },

    apiConfigured: {
      huggingFace: !!HF_TOKEN,
      cloudflare:
        !!CLOUDFLARE_ACCOUNT_ID &&
        !!CLOUDFLARE_API_TOKEN
    },

    features: {
      chat: true,
      imageGeneration: true,
      memory: true,
      conversations: true,
      projects: true
    },

    timestamp: now()
  });
});

/* =========================================================
   CHAT
========================================================= */

app.post("/chat", async (req, res) => {
  try {
    const {
      message,
      history = [],
      conversationId
    } = req.body;

    const userId = getUserId(req);

    if (!message || !String(message).trim()) {
      return res.status(400).json({
        success: false,
        error: "Mensagem vazia."
      });
    }

    if (!HF_TOKEN) {
      return res.status(500).json({
        success: false,
        error:
          "HF_TOKEN não está configurado no Render."
      });
    }

    let safeHistory = Array.isArray(history)
      ? history
          .filter(item => {
            return (
              item &&
              (
                item.role === "user" ||
                item.role === "assistant"
              ) &&
              typeof item.content === "string"
            );
          })
          .slice(-10)
      : [];

    if (conversationId) {
      const conversation =
        conversationsStore.get(conversationId);

      if (
        conversation &&
        conversation.userId === userId
      ) {
        safeHistory =
          conversation.messages.slice(-10);
      }
    }

    const userMemories =
      memoryStore.get(userId) || [];

    const memoryContext =
      userMemories
        .slice(-20)
        .map(item =>
          "- " +
          item.key +
          ": " +
          item.value
        )
        .join("\n");

    const systemPrompt = `
Você é a Adaptra.AI, uma inteligência artificial brasileira.

Responda em português do Brasil.

Seja amigável, inteligente, clara e objetiva.

Ajude o usuário com programação, projetos,
jogos, ideias e assuntos gerais.

Não invente informações quando não tiver certeza.

MEMÓRIAS DO USUÁRIO:
${memoryContext || "Nenhuma memória disponível."}
`;

    const messages = [
      {
        role: "system",
        content: systemPrompt
      },
      ...safeHistory,
      {
        role: "user",
        content: String(message)
      }
    ];

    const response = await fetch(
      "https://router.huggingface.co/v1/chat/completions",
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
          "Authorization":
            `Bearer ${HF_TOKEN}`
        },

        body: JSON.stringify({
          model: HF_CHAT_MODEL,
          messages,
          temperature: 0.7,
          max_tokens: 1200
        })
      }
    );

    let data;

    try {
      data = await response.json();
    } catch {
      return res.status(500).json({
        success: false,
        error:
          "A Hugging Face não retornou JSON."
      });
    }

    if (!response.ok) {
      console.error(
        "HF CHAT ERROR:",
        data
      );

      return res.status(response.status).json({
        success: false,
        error:
          data?.error?.message ||
          data?.error ||
          "Erro na API da Hugging Face."
      });
    }

    const reply = cleanText(
      data?.choices?.[0]?.message?.content
    );

    if (!reply) {
      return res.status(500).json({
        success: false,
        error:
          "A IA não retornou uma resposta."
      });
    }

    /* -------------------------------------------------------
       SALVAR CONVERSA
    ------------------------------------------------------- */

    if (conversationId) {
      let conversation =
        conversationsStore.get(conversationId);

      if (!conversation) {
        conversation = {
          id: conversationId,
          userId,
          title: String(message).slice(0, 60),
          messages: [],
          createdAt: now(),
          updatedAt: now()
        };
      }

      if (conversation.userId === userId) {
        conversation.messages.push(
          {
            role: "user",
            content: String(message),
            createdAt: now()
          },
          {
            role: "assistant",
            content: reply,
            createdAt: now()
          }
        );

        conversation.messages =
          conversation.messages.slice(-40);

        conversation.updatedAt = now();

        conversationsStore.set(
          conversationId,
          conversation
        );
      }
    }

    return res.json({
      success: true,
      reply,
      conversationId:
        conversationId || null,
      memoriesUsed:
        userMemories.length
    });

  } catch (error) {
    console.error(
      "CHAT ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      error:
        error.message ||
        "Erro interno no chat."
    });
  }
});

/* =========================================================
   GERAÇÃO DE IMAGEM
   CLOUDFLARE WORKERS AI
========================================================= */

app.post("/generate", async (req, res) => {
  try {
    const {
      prompt,
      seed,
      steps
    } = req.body;

    if (!prompt || !String(prompt).trim()) {
      return res.status(400).json({
        success: false,
        error:
          "Descreva a imagem que deseja criar."
      });
    }

    if (
      !CLOUDFLARE_ACCOUNT_ID ||
      !CLOUDFLARE_API_TOKEN
    ) {
      return res.status(500).json({
        success: false,
        error:
          "Cloudflare não está configurada no Render."
      });
    }

    const url =
      `https://api.cloudflare.com/client/v4/accounts/` +
      `${CLOUDFLARE_ACCOUNT_ID}` +
      `/ai/run/` +
      `${CLOUDFLARE_IMAGE_MODEL}`;

    console.log(
      "🎨 Gerando imagem com Cloudflare:",
      CLOUDFLARE_IMAGE_MODEL
    );

    const body = {
      prompt: String(prompt).trim()
    };

    if (
      Number.isInteger(seed)
    ) {
      body.seed = seed;
    }

    if (
      Number.isInteger(steps) &&
      steps >= 1 &&
      steps <= 8
    ) {
      body.steps = steps;
    }

    const response = await fetch(
      url,
      {
        method: "POST",

        headers: {
          "Authorization":
            `Bearer ${CLOUDFLARE_API_TOKEN}`,

          "Content-Type":
            "application/json"
        },

        body:
          JSON.stringify(body)
      }
    );

    let data;

    try {
      data = await response.json();
    } catch {
      const text =
        await response.text();

      console.error(
        "CLOUDFLARE NON JSON:",
        text
      );

      return res.status(502).json({
        success: false,
        error:
          "A Cloudflare não retornou uma resposta válida."
      });
    }

    if (!response.ok) {
      console.error(
        "CLOUDFLARE IMAGE ERROR:",
        data
      );

      return res.status(
        response.status
      ).json({
        success: false,
        error:
          data?.errors?.[0]?.message ||
          data?.error ||
          "Erro na geração da imagem pela Cloudflare.",
        details:
          data?.errors || null
      });
    }

    /*
      FLUX retorna:

      {
        result: {
          image: "BASE64..."
        },
        success: true
      }
    */

    const base64 =
      data?.result?.image;

    if (!base64) {
      console.error(
        "Resposta sem imagem:",
        data
      );

      return res.status(500).json({
        success: false,
        error:
          "A Cloudflare não retornou a imagem."
      });
    }

    /*
      O HTML poderá usar diretamente:
      <img src="data:image/jpeg;base64,...">
    */

    const image =
      `data:image/jpeg;base64,${base64}`;

    return res.json({
      success: true,
      provider: "Cloudflare Workers AI",
      model: CLOUDFLARE_IMAGE_MODEL,
      prompt: String(prompt),
      image,
      imageUrl: image
    });

  } catch (error) {
    console.error(
      "IMAGE ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      error:
        error.message ||
        "Erro interno na geração da imagem."
    });
  }
});

/* =========================================================
   MEMÓRIA — LISTAR
========================================================= */

app.get("/memory", (req, res) => {
  const userId = getUserId(req);

  const memories =
    memoryStore.get(userId) || [];

  res.json({
    success: true,
    userId,
    count: memories.length,
    memories
  });
});

/* =========================================================
   MEMÓRIA — SALVAR
========================================================= */

app.post("/memory", (req, res) => {
  const userId = getUserId(req);

  const {
    key,
    value
  } = req.body;

  if (!key || !value) {
    return res.status(400).json({
      success: false,
      error:
        "key e value são obrigatórios."
    });
  }

  let memories =
    memoryStore.get(userId) || [];

  const existing =
    memories.find(
      item =>
        item.key.toLowerCase() ===
        String(key).toLowerCase()
    );

  if (existing) {
    existing.value = String(value);
    existing.updatedAt = now();
  } else {
    memories.push({
      id: createId("mem"),
      key: String(key),
      value: String(value),
      createdAt: now(),
      updatedAt: now()
    });
  }

  if (memories.length > 100) {
    memories =
      memories.slice(-100);
  }

  memoryStore.set(
    userId,
    memories
  );

  res.json({
    success: true,
    message: "Memória salva.",
    memory:
      memories[memories.length - 1]
  });
});

/* =========================================================
   MEMÓRIA — APAGAR UMA
========================================================= */

app.delete(
  "/memory/:id",
  (req, res) => {
    const userId = getUserId(req);

    const memories =
      memoryStore.get(userId) || [];

    const index =
      memories.findIndex(
        item =>
          item.id === req.params.id
      );

    if (index === -1) {
      return res.status(404).json({
        success: false,
        error:
          "Memória não encontrada."
      });
    }

    const removed =
      memories.splice(index, 1)[0];

    memoryStore.set(
      userId,
      memories
    );

    res.json({
      success: true,
      message: "Memória apagada.",
      memory: removed
    });
  }
);

/* =========================================================
   MEMÓRIA — APAGAR TODAS
========================================================= */

app.delete(
  "/memory",
  (req, res) => {
    const userId = getUserId(req);

    memoryStore.delete(
      userId
    );

    res.json({
      success: true,
      message:
        "Todas as memórias foram apagadas."
    });
  }
);

/* =========================================================
   CONVERSAS — CRIAR
========================================================= */

app.post(
  "/conversations",
  (req, res) => {
    const userId = getUserId(req);

    const title =
      String(
        req.body?.title ||
        "Nova conversa"
      ).slice(0, 100);

    const id =
      createId("conv");

    const conversation = {
      id,
      userId,
      title,
      messages: [],
      createdAt: now(),
      updatedAt: now()
    };

    conversationsStore.set(
      id,
      conversation
    );

    res.json({
      success: true,
      conversation
    });
  }
);

/* =========================================================
   CONVERSAS — LISTAR
========================================================= */

app.get(
  "/conversations",
  (req, res) => {
    const userId = getUserId(req);

    const conversations =
      Array.from(
        conversationsStore.values()
      )
      .filter(
        item =>
          item.userId === userId
      )
      .map(
        item => ({
          id: item.id,
          title: item.title,
          messageCount:
            item.messages.length,
          createdAt:
            item.createdAt,
          updatedAt:
            item.updatedAt
        })
      )
      .sort(
        (a, b) =>
          new Date(b.updatedAt) -
          new Date(a.updatedAt)
      );

    res.json({
      success: true,
      count:
        conversations.length,
      conversations
    });
  }
);

/* =========================================================
   CONVERSA — ABRIR
========================================================= */

app.get(
  "/conversations/:id",
  (req, res) => {
    const userId = getUserId(req);

    const conversation =
      conversationsStore.get(
        req.params.id
      );

    if (
      !conversation ||
      conversation.userId !== userId
    ) {
      return res.status(404).json({
        success: false,
        error:
          "Conversa não encontrada."
      });
    }

    res.json({
      success: true,
      conversation
    });
  }
);

/* =========================================================
   CONVERSA — APAGAR
========================================================= */

app.delete(
  "/conversations/:id",
  (req, res) => {
    const userId = getUserId(req);

    const conversation =
      conversationsStore.get(
        req.params.id
      );

    if (
      !conversation ||
      conversation.userId !== userId
    ) {
      return res.status(404).json({
        success: false,
        error:
          "Conversa não encontrada."
      });
    }

    conversationsStore.delete(
      req.params.id
    );

    res.json({
      success: true,
      message:
        "Conversa apagada."
    });
  }
);

/* =========================================================
   PROJETOS — CRIAR
========================================================= */

app.post(
  "/projects",
  (req, res) => {
    const userId = getUserId(req);

    const {
      name,
      description = ""
    } = req.body;

    if (
      !name ||
      !String(name).trim()
    ) {
      return res.status(400).json({
        success: false,
        error:
          "O nome do projeto é obrigatório."
      });
    }

    const project = {
      id: createId("proj"),
      userId,
      name:
        String(name).trim(),
      description:
        String(description),
      context: "",
      createdAt: now(),
      updatedAt: now()
    };

    projectsStore.set(
      project.id,
      project
    );

    res.json({
      success: true,
      project
    });
  }
);

/* =========================================================
   PROJETOS — LISTAR
========================================================= */

app.get(
  "/projects",
  (req, res) => {
    const userId = getUserId(req);

    const projects =
      Array.from(
        projectsStore.values()
      )
      .filter(
        project =>
          project.userId === userId
      )
      .sort(
        (a, b) =>
          new Date(b.updatedAt) -
          new Date(a.updatedAt)
      );

    res.json({
      success: true,
      count:
        projects.length,
      projects
    });
  }
);

/* =========================================================
   PROJETO — ABRIR
========================================================= */

app.get(
  "/projects/:id",
  (req, res) => {
    const userId = getUserId(req);

    const project =
      projectsStore.get(
        req.params.id
      );

    if (
      !project ||
      project.userId !== userId
    ) {
      return res.status(404).json({
        success: false,
        error:
          "Projeto não encontrado."
      });
    }

    res.json({
      success: true,
      project
    });
  }
);

/* =========================================================
   PROJETO — ATUALIZAR
========================================================= */

app.patch(
  "/projects/:id",
  (req, res) => {
    const userId = getUserId(req);

    const project =
      projectsStore.get(
        req.params.id
      );

    if (
      !project ||
      project.userId !== userId
    ) {
      return res.status(404).json({
        success: false,
        error:
          "Projeto não encontrado."
      });
    }

    const {
      name,
      description,
      context
    } = req.body;

    if (
      name !== undefined
    ) {
      project.name =
        String(name).trim();
    }

    if (
      description !== undefined
    ) {
      project.description =
        String(description);
    }

    if (
      context !== undefined
    ) {
      project.context =
        String(context);
    }

    project.updatedAt =
      now();

    projectsStore.set(
      project.id,
      project
    );

    res.json({
      success: true,
      project
    });
  }
);

/* =========================================================
   PROJETO — APAGAR
========================================================= */

app.delete(
  "/projects/:id",
  (req, res) => {
    const userId = getUserId(req);

    const project =
      projectsStore.get(
        req.params.id
      );

    if (
      !project ||
      project.userId !== userId
    ) {
      return res.status(404).json({
        success: false,
        error:
          "Projeto não encontrado."
      });
    }

    projectsStore.delete(
      req.params.id
    );

    res.json({
      success: true,
      message:
        "Projeto apagado."
    });
  }
);

/* =========================================================
   404
========================================================= */

app.use(
  (req, res) => {
    res.status(404).json({
      success: false,
      error:
        "Rota não encontrada.",
      path:
        req.originalUrl
    });
  }
);

/* =========================================================
   ERRO GLOBAL
========================================================= */

app.use(
  (error, req, res, next) => {
    console.error(
      "GLOBAL ERROR:",
      error
    );

    res.status(500).json({
      success: false,
      error:
        "Erro interno do servidor."
    });
  }
);

/* =========================================================
   INICIAR SERVIDOR
========================================================= */

app.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      "=========================================="
    );

    console.log(
      "🚀 Adaptra.AI Backend"
    );

    console.log(
      "=========================================="
    );

    console.log(
      "Porta:",
      PORT
    );

    console.log(
      "Chat:",
      HF_TOKEN
        ? "✅ configurado"
        : "❌ não configurado"
    );

    console.log(
      "Cloudflare:",
      (
        CLOUDFLARE_ACCOUNT_ID &&
        CLOUDFLARE_API_TOKEN
      )
        ? "✅ configurado"
        : "❌ não configurado"
    );

    console.log(
      "Modelo de imagem:",
      CLOUDFLARE_IMAGE_MODEL
    );

    console.log(
      "=========================================="
    );
  }
);
