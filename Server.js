"use strict";

const express = require("express");
const cors = require("cors");

const app = express();

const PORT = process.env.PORT || 3000;

// ============================================================
// MIDDLEWARE
// ============================================================

app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-User-Id"]
  })
);

app.use(
  express.json({
    limit: "10mb"
  })
);

// ============================================================
// CONFIGURAÇÃO
// ============================================================

const HF_TOKEN = process.env.HF_TOKEN;

const HF_CHAT_MODEL =
  process.env.HF_CHAT_MODEL ||
  "meta-llama/Llama-3.1-8B-Instruct";

const CF_ACCOUNT_ID =
  process.env.CF_ACCOUNT_ID;

const CF_API_TOKEN =
  process.env.CF_API_TOKEN;

const CF_IMAGE_MODEL =
  process.env.CF_IMAGE_MODEL ||
  "@cf/black-forest-labs/FLUX.1-schnell";

// ============================================================
// BANCO TEMPORÁRIO EM MEMÓRIA
// ============================================================

const memoryStore = new Map();
const conversationsStore = new Map();
const projectsStore = new Map();

// ============================================================
// UTILIDADES
// ============================================================

function createId(prefix) {
  return (
    prefix +
    "_" +
    Date.now().toString(36) +
    "_" +
    Math.random()
      .toString(36)
      .slice(2, 8)
  );
}

function now() {
  return new Date().toISOString();
}

function cleanText(text) {
  return String(text || "")
    .replace(
      /<think>[\s\S]*?<\/think>/gi,
      ""
    )
    .replace(
      /<\|im_end\|>/g,
      ""
    )
    .replace(
      /<\|endoftext\|>/g,
      ""
    )
    .trim();
}

/*
  SEM LOGIN

  O frontend pode enviar x-user-id ou userId.
  Se não enviar nada, usamos "default-user".

  Isso NÃO é autenticação.
*/
function getUserId(req) {
  return (
    req.body?.userId ||
    req.query?.userId ||
    req.headers["x-user-id"] ||
    "default-user"
  );
}

// ============================================================
// HOME
// ============================================================

app.get("/", (req, res) => {
  res.json({
    success: true,

    name: "Adaptra.AI",

    version: "4.3",

    message:
      "Backend da Adaptra.AI está funcionando.",

    authentication:
      false,

    provider: {
      chat:
        "Hugging Face",

      image:
        "Cloudflare Workers AI"
    },

    routes: {
      health:
        "/health",

      chat:
        "/chat",

      generate:
        "/generate",

      memory:
        "/memory",

      conversations:
        "/conversations",

      projects:
        "/projects"
    }
  });
});

// ============================================================
// HEALTH
// ============================================================

app.get("/health", (req, res) => {
  res.json({
    success: true,

    status:
      "online",

    service:
      "Adaptra.AI Backend",

    version:
      "4.3",

    authentication:
      false,

    provider: {
      chat:
        "Hugging Face",

      image:
        "Cloudflare Workers AI"
    },

    chatModel:
      HF_CHAT_MODEL,

    imageModel:
      CF_IMAGE_MODEL,

    apiConfigured: {
      huggingFace:
        !!HF_TOKEN,

      cloudflare:
        !!CF_ACCOUNT_ID &&
        !!CF_API_TOKEN
    },

    features: {
      chat:
        true,

      imageGeneration:
        true,

      memory:
        true,

      conversations:
        true,

      projects:
        true,

      login:
        false
    },

    timestamp:
      now()
  });
});

// ============================================================
// CHAT
// ============================================================

app.post("/chat", async (req, res) => {
  try {
    const {
      message,
      history = [],
      conversationId,
      userId
    } = req.body;

    const resolvedUserId =
      userId ||
      getUserId(req);

    if (
      !message ||
      !String(message).trim()
    ) {
      return res.status(400).json({
        success: false,
        error:
          "Mensagem vazia."
      });
    }

    if (!HF_TOKEN) {
      return res.status(500).json({
        success: false,
        error:
          "HF_TOKEN não está configurado no Render."
      });
    }

    // --------------------------------------------------------
    // HISTÓRICO
    // --------------------------------------------------------

    let safeHistory =
      Array.isArray(history)
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

    // --------------------------------------------------------
    // CONVERSA
    // --------------------------------------------------------

    if (conversationId) {
      const conversation =
        conversationsStore.get(
          conversationId
        );

      if (
        conversation &&
        conversation.userId ===
          resolvedUserId
      ) {
        safeHistory =
          conversation.messages
            .filter(
              item =>
                item.role === "user" ||
                item.role === "assistant"
            )
            .slice(-10);
      }
    }

    // --------------------------------------------------------
    // MEMÓRIAS
    // --------------------------------------------------------

    const userMemories =
      memoryStore.get(
        resolvedUserId
      ) || [];

    const memoryContext =
      userMemories
        .slice(-20)
        .map(item => {
          return (
            "- " +
            item.key +
            ": " +
            item.value
          );
        })
        .join("\n");

    // --------------------------------------------------------
    // PROMPT
    // --------------------------------------------------------

    const systemPrompt = `
Você é a Adaptra.AI, uma inteligência artificial brasileira.

Responda sempre em português do Brasil.

Seja amigável, inteligente, clara e objetiva.

Ajude o usuário com:
- programação
- desenvolvimento de jogos
- HTML
- CSS
- JavaScript
- projetos
- ideias
- criação de conteúdo
- assuntos gerais

Não invente informações quando não tiver certeza.

Quando o usuário pedir código, entregue código funcional e explique
de forma clara quando necessário.

MEMÓRIAS DISPONÍVEIS DO USUÁRIO:

${
  memoryContext ||
  "Nenhuma memória disponível."
}
`;

    const messages = [
      {
        role:
          "system",

        content:
          systemPrompt
      },

      ...safeHistory,

      {
        role:
          "user",

        content:
          String(message)
      }
    ];

    // --------------------------------------------------------
    // HUGGING FACE
    // --------------------------------------------------------

    const response =
      await fetch(
        "https://router.huggingface.co/v1/chat/completions",
        {
          method:
            "POST",

          headers: {
            "Content-Type":
              "application/json",

            "Authorization":
              `Bearer ${HF_TOKEN}`
          },

          body:
            JSON.stringify({
              model:
                HF_CHAT_MODEL,

              messages,

              temperature:
                0.7,

              max_tokens:
                1500
            })
        }
      );

    let data;

    try {
      data =
        await response.json();
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

      return res.status(
        response.status
      ).json({
        success: false,
        error:
          data?.error?.message ||
          data?.error ||
          "Erro na API da Hugging Face."
      });
    }

    const reply =
      cleanText(
        data?.choices?.[0]?.message?.content
      );

    if (!reply) {
      return res.status(500).json({
        success: false,
        error:
          "A IA não retornou uma resposta."
      });
    }

    // --------------------------------------------------------
    // SALVAR CONVERSA
    // --------------------------------------------------------

    if (conversationId) {
      let conversation =
        conversationsStore.get(
          conversationId
        );

      if (!conversation) {
        conversation = {
          id:
            conversationId,

          userId:
            resolvedUserId,

          title:
            String(message)
              .slice(0, 60),

          messages: [],

          createdAt:
            now(),

          updatedAt:
            now()
        };
      }

      if (
        conversation.userId ===
        resolvedUserId
      ) {
        conversation.messages.push(
          {
            role:
              "user",

            content:
              String(message),

            createdAt:
              now()
          },

          {
            role:
              "assistant",

            content:
              reply,

            createdAt:
              now()
          }
        );

        conversation.messages =
          conversation.messages.slice(-40);

        conversation.updatedAt =
          now();

        conversationsStore.set(
          conversationId,
          conversation
        );
      }
    }

    return res.json({
      success:
        true,

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

// ============================================================
// GERAÇÃO DE IMAGEM
// CLOUDFLARE WORKERS AI
// ============================================================

app.post("/generate", async (req, res) => {
  try {
    const {
      prompt
    } = req.body;

    if (
      !prompt ||
      !String(prompt).trim()
    ) {
      return res.status(400).json({
        success: false,
        error:
          "Descreva a imagem que deseja criar."
      });
    }

    if (
      !CF_ACCOUNT_ID ||
      !CF_API_TOKEN
    ) {
      return res.status(500).json({
        success: false,
        error:
          "CF_ACCOUNT_ID ou CF_API_TOKEN não está configurado no Render."
      });
    }

    const url =
      `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/run/${CF_IMAGE_MODEL}`;

    console.log(
      "🎨 Gerando imagem com Cloudflare:",
      CF_IMAGE_MODEL
    );

    const response =
      await fetch(
        url,
        {
          method:
            "POST",

          headers: {
            "Authorization":
              `Bearer ${CF_API_TOKEN}`,

            "Content-Type":
              "application/json"
          },

          body:
            JSON.stringify({
              prompt:
                String(prompt)
            })
        }
      );

    if (!response.ok) {
      const errorText =
        await response.text();

      console.error(
        "CLOUDFLARE IMAGE ERROR:",
        errorText
      );

      return res.status(
        response.status
      ).json({
        success: false,
        error:
          errorText ||
          "Erro na geração da imagem."
      });
    }

    const contentType =
      response.headers.get(
        "content-type"
      ) ||
      "";

    /*
      Workers AI normalmente retorna
      a imagem diretamente.
    */

    if (
      contentType.includes(
        "image/"
      )
    ) {
      const arrayBuffer =
        await response.arrayBuffer();

      const buffer =
        Buffer.from(arrayBuffer);

      if (!buffer.length) {
        return res.status(500).json({
          success: false,
          error:
            "A imagem retornada está vazia."
        });
      }

      res.setHeader(
        "Content-Type",
        contentType
      );

      res.setHeader(
        "Cache-Control",
        "no-store"
      );

      return res.send(
        buffer
      );
    }

    /*
      Algumas respostas podem vir
      como JSON.
    */

    const data =
      await response.json();

    if (
      data?.success === false
    ) {
      return res.status(500).json({
        success: false,
        error:
          data?.errors ||
          data?.messages ||
          "Erro da Cloudflare Workers AI."
      });
    }

    /*
      Caso a Cloudflare retorne
      base64.
    */

    if (
      data?.result?.image
    ) {
      const buffer =
        Buffer.from(
          data.result.image,
          "base64"
        );

      res.setHeader(
        "Content-Type",
        "image/png"
      );

      return res.send(
        buffer
      );
    }

    return res.status(500).json({
      success: false,
      error:
        "A Cloudflare não retornou uma imagem reconhecida."
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
        "Erro interno na geração."
    });
  }
});

// ============================================================
// MEMÓRIA — LISTAR
// ============================================================

app.get("/memory", (req, res) => {
  const userId =
    getUserId(req);

  const memories =
    memoryStore.get(
      userId
    ) || [];

  res.json({
    success:
      true,

    userId,

    count:
      memories.length,

    memories
  });
});

// ============================================================
// MEMÓRIA — SALVAR
// ============================================================

app.post("/memory", (req, res) => {
  const userId =
    getUserId(req);

  const {
    key,
    value
  } = req.body;

  if (
    !key ||
    value === undefined ||
    value === null
  ) {
    return res.status(400).json({
      success: false,
      error:
        "key e value são obrigatórios."
    });
  }

  let memories =
    memoryStore.get(
      userId
    ) || [];

  const existing =
    memories.find(
      item =>
        item.key.toLowerCase() ===
        String(key).toLowerCase()
    );

  if (existing) {
    existing.value =
      String(value);

    existing.updatedAt =
      now();
  } else {
    memories.push({
      id:
        createId("mem"),

      key:
        String(key),

      value:
        String(value),

      createdAt:
        now(),

      updatedAt:
        now()
    });
  }

  if (
    memories.length > 100
  ) {
    memories =
      memories.slice(-100);
  }

  memoryStore.set(
    userId,
    memories
  );

  res.json({
    success:
      true,

    message:
      "Memória salva.",

    memory:
      memories[
        memories.length - 1
      ]
  });
});

// ============================================================
// MEMÓRIA — APAGAR UMA
// ============================================================

app.delete(
  "/memory/:id",
  (req, res) => {
    const userId =
      getUserId(req);

    const memories =
      memoryStore.get(
        userId
      ) || [];

    const index =
      memories.findIndex(
        item =>
          item.id ===
          req.params.id
      );

    if (index === -1) {
      return res.status(404).json({
        success: false,
        error:
          "Memória não encontrada."
      });
    }

    const removed =
      memories.splice(
        index,
        1
      )[0];

    memoryStore.set(
      userId,
      memories
    );

    res.json({
      success:
        true,

      message:
        "Memória apagada.",

      memory:
        removed
    });
  }
);

// ============================================================
// MEMÓRIA — APAGAR TODAS
// ============================================================

app.delete(
  "/memory",
  (req, res) => {
    const userId =
      getUserId(req);

    memoryStore.delete(
      userId
    );

    res.json({
      success:
        true,

      message:
        "Todas as memórias foram apagadas."
    });
  }
);

// ============================================================
// CONVERSAS — CRIAR
// ============================================================

app.post(
  "/conversations",
  (req, res) => {
    const userId =
      getUserId(req);

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

      createdAt:
        now(),

      updatedAt:
        now()
    };

    conversationsStore.set(
      id,
      conversation
    );

    res.json({
      success:
        true,

      conversation
    });
  }
);

// ============================================================
// CONVERSAS — LISTAR
// ============================================================

app.get(
  "/conversations",
  (req, res) => {
    const userId =
      getUserId(req);

    const conversations =
      Array.from(
        conversationsStore.values()
      )
        .filter(
          item =>
            item.userId ===
            userId
        )
        .map(
          item => ({
            id:
              item.id,

            title:
              item.title,

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
            new Date(
              b.updatedAt
            ) -
            new Date(
              a.updatedAt
            )
        );

    res.json({
      success:
        true,

      count:
        conversations.length,

      conversations
    });
  }
);

// ============================================================
// CONVERSA — ABRIR
// ============================================================

app.get(
  "/conversations/:id",
  (req, res) => {
    const userId =
      getUserId(req);

    const conversation =
      conversationsStore.get(
        req.params.id
      );

    if (
      !conversation ||
      conversation.userId !==
        userId
    ) {
      return res.status(404).json({
        success: false,
        error:
          "Conversa não encontrada."
      });
    }

    res.json({
      success:
        true,

      conversation
    });
  }
);

// ============================================================
// CONVERSA — APAGAR
// ============================================================

app.delete(
  "/conversations/:id",
  (req, res) => {
    const userId =
      getUserId(req);

    const conversation =
      conversationsStore.get(
        req.params.id
      );

    if (
      !conversation ||
      conversation.userId !==
        userId
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
      success:
        true,

      message:
        "Conversa apagada."
    });
  }
);

// ============================================================
// PROJETOS — CRIAR
// ============================================================

app.post(
  "/projects",
  (req, res) => {
    const userId =
      getUserId(req);

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
      id:
        createId("proj"),

      userId,

      name:
        String(name).trim(),

      description:
        String(description),

      context:
        "",

      createdAt:
        now(),

      updatedAt:
        now()
    };

    projectsStore.set(
      project.id,
      project
    );

    res.json({
      success:
        true,

      project
    });
  }
);

// ============================================================
// PROJETOS — LISTAR
// ============================================================

app.get(
  "/projects",
  (req, res) => {
    const userId =
      getUserId(req);

    const projects =
      Array.from(
        projectsStore.values()
      )
        .filter(
          project =>
            project.userId ===
            userId
        )
        .sort(
          (a, b) =>
            new Date(
              b.updatedAt
            ) -
            new Date(
              a.updatedAt
            )
        );

    res.json({
      success:
        true,

      count:
        projects.length,

      projects
    });
  }
);

// ============================================================
// PROJETO — ABRIR
// ============================================================

app.get(
  "/projects/:id",
  (req, res) => {
    const userId =
      getUserId(req);

    const project =
      projectsStore.get(
        req.params.id
      );

    if (
      !project ||
      project.userId !==
        userId
    ) {
      return res.status(404).json({
        success: false,
        error:
          "Projeto não encontrado."
      });
    }

    res.json({
      success:
        true,

      project
    });
  }
);

// ============================================================
// PROJETO — ATUALIZAR
// ============================================================

app.patch(
  "/projects/:id",
  (req, res) => {
    const userId =
      getUserId(req);

    const project =
      projectsStore.get(
        req.params.id
      );

    if (
      !project ||
      project.userId !==
        userId
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
      success:
        true,

      project
    });
  }
);

// ============================================================
// PROJETO — APAGAR
// ============================================================

app.delete(
  "/projects/:id",
  (req, res) => {
    const userId =
      getUserId(req);

    const project =
      projectsStore.get(
        req.params.id
      );

    if (
      !project ||
      project.userId !==
        userId
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
      success:
        true,

      message:
        "Projeto apagado."
    });
  }
);

// ============================================================
// 404
// ============================================================

app.use(
  (req, res) => {
    res.status(404).json({
      success: false,
      error:
        "Rota não encontrada.",
      path:
        req.path
    });
  }
);

// ============================================================
// ERRO GLOBAL
// ============================================================

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

// ============================================================
// START
// ============================================================

app.listen(
  PORT,
  () => {
    console.log(
      "========================================"
    );

    console.log(
      "🤖 Adaptra.AI Backend"
    );

    console.log(
      "========================================"
    );

    console.log(
      "Porta:",
      PORT
    );

    console.log(
      "Login:",
      "DESATIVADO"
    );

    console.log(
      "Chat:",
      HF_TOKEN
        ? "CONFIGURADO"
        : "SEM HF_TOKEN"
    );

    console.log(
      "Imagem:",
      CF_ACCOUNT_ID &&
      CF_API_TOKEN
        ? "CLOUDFLARE CONFIGURADA"
        : "SEM CLOUDFLARE"
    );

    console.log(
      "========================================"
    );
  }
);
