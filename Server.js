"use strict";

const express = require("express");
const cors = require("cors");
const { InferenceClient } = require("@huggingface/inference");

const app = express();

const PORT = Number(process.env.PORT) || 10000;

/* =========================================================
   CORS
========================================================= */

app.use(
  cors({
    origin: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
  })
);

app.use(
  express.json({
    limit: "10mb"
  })
);

/* =========================================================
   CONFIGURAÇÃO
========================================================= */

const HF_TOKEN =
  process.env.HF_TOKEN ||
  process.env.HUGGINGFACE_TOKEN ||
  process.env.HF_API_TOKEN ||
  "";

const HF_MODEL =
  process.env.HF_MODEL ||
  "Qwen/Qwen3-32B";

const CF_ACCOUNT_ID =
  process.env.CF_ACCOUNT_ID ||
  process.env.CLOUDFLARE_ACCOUNT_ID ||
  "";

const CF_API_TOKEN =
  process.env.CF_API_TOKEN ||
  process.env.CLOUDFLARE_API_TOKEN ||
  "";

const CF_IMAGE_MODEL =
  "@cf/black-forest-labs/flux-1-schnell";

/* =========================================================
   CLIENT HUGGING FACE
========================================================= */

let hf = null;

if (HF_TOKEN) {
  hf = new InferenceClient(HF_TOKEN);
  console.log("🤗 Hugging Face configurado.");
} else {
  console.warn("⚠️ HF_TOKEN não configurado.");
}

/* =========================================================
   MEMÓRIA
========================================================= */

const memoryStore = new Map();
const conversationStore = new Map();
const projectStore = new Map();

/* =========================================================
   FUNÇÕES AUXILIARES
========================================================= */

function cleanText(value, max = 12000) {
  return String(value ?? "")
    .trim()
    .slice(0, max);
}

function safeId(value, fallback = "default") {
  const id = cleanText(value, 100);
  return id || fallback;
}

function getConversationId(req) {
  return safeId(
    req.body?.conversationId ||
    req.query?.conversationId ||
    "adaptra-main"
  );
}

function getUserId(req) {
  return safeId(
    req.body?.userId ||
    req.query?.userId ||
    "default-user"
  );
}

/* =========================================================
   ROTA PRINCIPAL
========================================================= */

app.get("/", (req, res) => {
  res.json({
    success: true,
    name: "Adaptra.AI",
    version: "4.4",
    message: "Backend da Adaptra.AI está funcionando.",
    status: "online",

    provider: {
      chat: "Hugging Face",
      image: "Cloudflare Workers AI"
    },

    configured: {
      chat: Boolean(HF_TOKEN),
      image: Boolean(
        CF_ACCOUNT_ID &&
        CF_API_TOKEN
      )
    },

    routes: {
      health: "/health",
      test: "/test",
      chat: "/chat",
      generate: "/generate",
      memory: "/memory",
      conversations: "/conversations",
      projects: "/projects",
      repair: "/admin/repair"
    }
  });
});

/* =========================================================
   HEALTH
========================================================= */

app.get("/health", (req, res) => {
  res.json({
    success: true,
    name: "Adaptra.AI",
    version: "4.4",

    message:
      "Backend da Adaptra.AI está funcionando.",

    status: "online",

    provider: {
      chat: "Hugging Face",
      image: "Cloudflare Workers AI"
    },

    configured: {
      chat: Boolean(HF_TOKEN),
      image: Boolean(
        CF_ACCOUNT_ID &&
        CF_API_TOKEN
      )
    },

    models: {
      chat: HF_MODEL,
      image: CF_IMAGE_MODEL
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
   TEST
========================================================= */

app.get("/test", (req, res) => {
  res.json({
    success: true,
    name: "Adaptra.AI",
    version: "4.4",
    server: "online",
    time: new Date().toISOString(),

    services: {
      huggingface: Boolean(HF_TOKEN),
      cloudflare: Boolean(
        CF_ACCOUNT_ID &&
        CF_API_TOKEN
      )
    }
  });
});

/* =========================================================
   CHAT
========================================================= */

app.post("/chat", async (req, res) => {
  try {
    const message = cleanText(
      req.body?.message,
      12000
    );

    if (!message) {
      return res.status(400).json({
        success: false,
        error: "Digite uma mensagem."
      });
    }

    if (!HF_TOKEN || !hf) {
      return res.status(503).json({
        success: false,
        error:
          "Hugging Face não está configurado.",
        hint:
          "Configure HF_TOKEN nas variáveis do Render."
      });
    }

    const conversationId =
      getConversationId(req);

    let history =
      Array.isArray(req.body?.history)
        ? req.body.history
        : [];

    history = history
      .filter(item =>
        item &&
        (
          item.role === "user" ||
          item.role === "assistant" ||
          item.role === "system"
        ) &&
        item.content
      )
      .slice(-12)
      .map(item => ({
        role: item.role,
        content: cleanText(
          item.content,
          8000
        )
      }));

    const messages = [
      {
        role: "system",
        content:
`Você é a Adaptra.AI 4.4, uma assistente de inteligência artificial que conversa em português do Brasil.

Seja útil, clara e objetiva.

Ajude com programação, desenvolvimento de jogos, projetos, ideias, estudos e tarefas gerais.

Quando o usuário pedir código, forneça código funcional.

Não diga que executou algo se não executou.

Nunca revele tokens, chaves secretas ou variáveis de ambiente.`
      },

      ...history,

      {
        role: "user",
        content: message
      }
    ];

    console.log(
      "🤖 Processando chat:",
      HF_MODEL
    );

    const result =
      await hf.chatCompletion({
        model: HF_MODEL,
        messages,

        max_tokens: 1200,
        temperature: 0.7
      });

    let reply =
      result
        ?.choices?.[0]
        ?.message
        ?.content;

    if (Array.isArray(reply)) {
      reply = reply
        .map(item =>
          typeof item === "string"
            ? item
            : item?.text || ""
        )
        .join("");
    }

    reply = cleanText(
      reply,
      20000
    );

    reply = reply
      .replace(
        /<think>[\s\S]*?<\/think>/gi,
        ""
      )
      .trim();

    if (!reply) {
      throw new Error(
        "A IA não retornou uma resposta."
      );
    }

    const previous =
      conversationStore.get(
        conversationId
      ) || [];

    previous.push(
      {
        role: "user",
        content: message,
        timestamp:
          new Date().toISOString()
      },

      {
        role: "assistant",
        content: reply,
        timestamp:
          new Date().toISOString()
      }
    );

    conversationStore.set(
      conversationId,
      previous.slice(-50)
    );

    return res.json({
      success: true,
      reply,
      response: reply,
      model: HF_MODEL
    });

  } catch (error) {
    console.error(
      "❌ CHAT ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      error:
        error?.message ||
        "Erro ao conversar com a IA."
    });
  }
});

/* =========================================================
   GERAÇÃO DE IMAGEM
========================================================= */

app.post("/generate", async (req, res) => {
  try {
    const prompt = cleanText(
      req.body?.prompt,
      2048
    );

    if (!prompt) {
      return res.status(400).json({
        success: false,
        error:
          "Digite uma descrição para gerar a imagem."
      });
    }

    if (
      !CF_ACCOUNT_ID ||
      !CF_API_TOKEN
    ) {
      return res.status(503).json({
        success: false,
        error:
          "Cloudflare Workers AI não está configurada.",

        hint:
          "Configure CF_ACCOUNT_ID e CF_API_TOKEN no Render."
      });
    }

    const url =
      "https://api.cloudflare.com/client/v4" +
      "/accounts/" +
      encodeURIComponent(
        CF_ACCOUNT_ID
      ) +
      "/ai/run/" +
      CF_IMAGE_MODEL;

    console.log(
      "🎨 Gerando imagem..."
    );

    console.log(
      "Modelo:",
      CF_IMAGE_MODEL
    );

    const response =
      await fetch(url, {
        method: "POST",

        headers: {
          "Authorization":
            `Bearer ${CF_API_TOKEN}`,

          "Content-Type":
            "application/json"
        },

        body: JSON.stringify({
          prompt,
          steps: 4
        })
      });

    const contentType =
      (
        response.headers.get(
          "content-type"
        ) || ""
      ).toLowerCase();

    const raw =
      await response.text();

    let data = null;

    try {
      data =
        raw
          ? JSON.parse(raw)
          : null;
    } catch {
      data = null;
    }

    /* -----------------------------------------------------
       ERRO HTTP
    ----------------------------------------------------- */

    if (!response.ok) {
      console.error(
        "❌ CLOUDFLARE HTTP:",
        response.status
      );

      console.error(
        raw.slice(0, 5000)
      );

      let details =
        "Erro da Cloudflare.";

      if (
        data?.errors &&
        Array.isArray(data.errors)
      ) {
        details =
          data.errors
            .map(error =>
              `${error.code || ""} ${error.message || ""}`
            )
            .join(" | ");
      }

      return res.status(502).json({
        success: false,

        error:
          "A Cloudflare recusou a geração da imagem.",

        details,

        status:
          response.status,

        model:
          CF_IMAGE_MODEL
      });
    }

    /* -----------------------------------------------------
       IMAGEM BINÁRIA
    ----------------------------------------------------- */

    if (
      contentType.includes("image/")
    ) {
      return res.status(500).json({
        success: false,
        error:
          "A Cloudflare retornou imagem binária diretamente. Este backend espera o resultado JSON do Workers AI."
      });
    }

    /* -----------------------------------------------------
       RESPOSTA JSON
    ----------------------------------------------------- */

    if (
      !data ||
      data.success === false
    ) {
      return res.status(502).json({
        success: false,

        error:
          "A Cloudflare não retornou um resultado válido.",

        details:
          data?.errors || data
      });
    }

    const image =
      data?.result?.image;

    if (!image) {
      console.error(
        "❌ Cloudflare sem result.image:",
        data
      );

      return res.status(502).json({
        success: false,

        error:
          "A Cloudflare respondeu, mas não enviou a imagem.",

        details: data
      });
    }

    return res.json({
      success: true,

      image:
        `data:image/jpeg;base64,${image}`,

      prompt,

      model:
        CF_IMAGE_MODEL
    });

  } catch (error) {
    console.error(
      "❌ IMAGE ERROR:",
      error
    );

    return res.status(500).json({
      success: false,

      error:
        error?.message ||
        "Erro interno na geração da imagem."
    });
  }
});

/* =========================================================
   MEMÓRIA
========================================================= */

app.get("/memory", (req, res) => {
  const userId =
    getUserId(req);

  res.json({
    success: true,

    memory:
      memoryStore.get(userId) || {}
  });
});

app.post("/memory", (req, res) => {
  const userId =
    getUserId(req);

  const current =
    memoryStore.get(userId) || {};

  const incoming =
    req.body?.memory;

  if (
    incoming &&
    typeof incoming === "object"
  ) {
    Object.assign(
      current,
      incoming
    );
  }

  memoryStore.set(
    userId,
    current
  );

  res.json({
    success: true,
    memory: current
  });
});

app.delete("/memory", (req, res) => {
  const userId =
    getUserId(req);

  memoryStore.delete(
    userId
  );

  res.json({
    success: true,
    message:
      "Memória apagada."
  });
});

/* =========================================================
   CONVERSA
========================================================= */

app.get(
  "/conversations",
  (req, res) => {
    const conversationId =
      safeId(
        req.query?.conversationId,
        "adaptra-main"
      );

    res.json({
      success: true,

      conversationId,

      messages:
        conversationStore.get(
          conversationId
        ) || []
    });
  }
);

app.post(
  "/conversations",
  (req, res) => {
    const conversationId =
      safeId(
        req.body?.conversationId,
        "adaptra-main"
      );

    const messages =
      Array.isArray(
        req.body?.messages
      )
        ? req.body.messages.slice(-50)
        : [];

    conversationStore.set(
      conversationId,
      messages
    );

    res.json({
      success: true,

      conversationId,

      messages
    });
  }
);

/* =========================================================
   PROJETOS
========================================================= */

app.get(
  "/projects",
  (req, res) => {
    const userId =
      getUserId(req);

    res.json({
      success: true,

      projects:
        projectStore.get(
          userId
        ) || []
    });
  }
);

app.post(
  "/projects",
  (req, res) => {
    const userId =
      getUserId(req);

    const project =
      req.body?.project;

    if (
      !project ||
      typeof project !== "object"
    ) {
      return res.status(400).json({
        success: false,
        error:
          "Projeto inválido."
      });
    }

    const projects =
      projectStore.get(
        userId
      ) || [];

    const newProject = {
      ...project,

      id:
        project.id ||
        `project-${Date.now()}`,

      createdAt:
        project.createdAt ||
        new Date().toISOString()
    };

    projects.push(
      newProject
    );

    projectStore.set(
      userId,
      projects.slice(-100)
    );

    res.json({
      success: true,
      project: newProject
    });
  }
);

/* =========================================================
   MODO DE REPARO
========================================================= */

app.get(
  "/admin/repair",
  (req, res) => {
    const checks = {
      server: true,

      huggingface:
        Boolean(HF_TOKEN),

      cloudflare:
        Boolean(
          CF_ACCOUNT_ID &&
          CF_API_TOKEN
        )
    };

    res.json({
      success: true,

      mode:
        "repair",

      version:
        "4.4",

      checks,

      configuration: {
        chatModel:
          HF_MODEL,

        imageModel:
          CF_IMAGE_MODEL
      },

      recommendations: [
        checks.huggingface
          ? "Hugging Face configurado."
          : "Configure HF_TOKEN no Render.",

        checks.cloudflare
          ? "Cloudflare configurada."
          : "Configure CF_ACCOUNT_ID e CF_API_TOKEN no Render."
      ]
    });
  }
);

/* =========================================================
   ROTA NÃO ENCONTRADA
========================================================= */

app.use(
  (req, res) => {
    res.status(404).json({
      success: false,

      error:
        "Rota não encontrada.",

      path:
        req.originalUrl,

      method:
        req.method,

      availableRoutes: [
        "/",
        "/health",
        "/test",
        "/chat",
        "/generate",
        "/memory",
        "/conversations",
        "/projects",
        "/admin/repair"
      ]
    });
  }
);

/* =========================================================
   ERRO GLOBAL
========================================================= */

app.use(
  (
    error,
    req,
    res,
    next
  ) => {
    console.error(
      "❌ GLOBAL ERROR:",
      error
    );

    if (
      res.headersSent
    ) {
      return next(error);
    }

    res.status(500).json({
      success: false,

      error:
        error?.message ||
        "Erro interno do servidor."
    });
  }
);

/* =========================================================
   INICIAR SERVIDOR
========================================================= */

app.listen(
  PORT,
  () => {
    console.log(
      "=========================================="
    );

    console.log(
      "🤖 Adaptra.AI Backend 4.4"
    );

    console.log(
      "🚀 Porta:",
      PORT
    );

    console.log(
      "=========================================="
    );

    console.log(
      "Chat:",
      HF_TOKEN
        ? "✅ configurado"
        : "❌ não configurado"
    );

    console.log(
      "Imagem:",
      CF_ACCOUNT_ID &&
      CF_API_TOKEN
        ? "✅ configurada"
        : "❌ não configurada"
    );

    console.log(
      "Modelo de imagem:",
      CF_IMAGE_MODEL
    );

    console.log(
      "=========================================="
    );
  }
);
