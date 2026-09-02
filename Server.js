// Server.js — Adaptra.AI 4.5.1
// Backend oficial do Adaptra.AI / Adaptrium AI

const express = require("express");
const cors = require("cors");
const { InferenceClient } = require("@huggingface/inference");

const app = express();

const PORT = process.env.PORT || 3000;

const HF_TOKEN =
  process.env.HF_TOKEN ||
  process.env.HUGGINGFACE_TOKEN ||
  process.env.HF_API_TOKEN;

const HF_MODEL =
  process.env.HF_MODEL ||
  "Qwen/Qwen3-32B";

const CF_ACCOUNT_ID =
  process.env.CF_ACCOUNT_ID ||
  process.env.CLOUDFLARE_ACCOUNT_ID;

const CF_API_TOKEN =
  process.env.CF_API_TOKEN ||
  process.env.CLOUDFLARE_API_TOKEN;

const CF_IMAGE_MODEL =
  process.env.CF_IMAGE_MODEL ||
  "@cf/black-forest-labs/flux-1-schnell";

const ALLOWED_ORIGIN =
  process.env.ALLOWED_ORIGIN ||
  "https://jasonn-26.github.io";


// ======================================================
// CORS
// ======================================================

const allowedOrigins = [
  ALLOWED_ORIGIN,
  "https://jasonn-26.github.io",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:5500",
  "http://127.0.0.1:5500"
];

app.use(
  cors({
    origin: function (origin, callback) {

      // Permite ferramentas como curl/Postman
      if (!origin) {
        return callback(null, true);
      }

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(
        new Error("Origem não autorizada pelo CORS.")
      );
    },
    methods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization"
    ]
  })
);

app.options("*", cors());


// ======================================================
// JSON
// ======================================================

app.use(
  express.json({
    limit: "2mb"
  })
);


// ======================================================
// CLIENTE HUGGING FACE
// ======================================================

const hf = HF_TOKEN
  ? new InferenceClient(HF_TOKEN)
  : null;


// ======================================================
// MEMÓRIA TEMPORÁRIA
// ======================================================

const memories = new Map();

const conversations = new Map();

const projects = new Map();


// ======================================================
// FUNÇÕES AUXILIARES
// ======================================================

function getUserId(req) {

  const bodyUserId =
    req.body &&
    typeof req.body.userId === "string"
      ? req.body.userId
      : null;

  const queryUserId =
    typeof req.query.userId === "string"
      ? req.query.userId
      : null;

  const headerUserId =
    typeof req.headers["x-user-id"] === "string"
      ? req.headers["x-user-id"]
      : null;

  return (
    bodyUserId ||
    queryUserId ||
    headerUserId ||
    "anonymous"
  );
}


function getStore(store, userId) {

  if (!store.has(userId)) {
    store.set(userId, []);
  }

  return store.get(userId);
}


function cleanText(value, max = 20000) {

  if (typeof value !== "string") {
    return "";
  }

  return value.trim().slice(0, max);
}


// ======================================================
// ROTA PRINCIPAL
// ======================================================

app.get("/", (req, res) => {

  res.json({
    success: true,
    name: "Adaptra.AI",
    company: "Adaptrium AI",
    version: "4.5.1",
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


// ======================================================
// HEALTH
// ======================================================

app.get("/health", (req, res) => {

  res.json({
    success: true,
    status: "online",
    name: "Adaptra.AI",
    version: "4.5.1",

    configured: {
      chat: Boolean(HF_TOKEN),
      image: Boolean(
        CF_ACCOUNT_ID &&
        CF_API_TOKEN
      )
    },

    timestamp: new Date().toISOString()
  });

});


// ======================================================
// TEST
// ======================================================

app.get("/test", (req, res) => {

  res.json({
    success: true,
    message: "Servidor funcionando corretamente.",
    name: "Adaptra.AI",
    version: "4.5.1"
  });

});


// ======================================================
// CHAT
// ======================================================

app.post("/chat", async (req, res) => {

  try {

    if (!hf) {

      return res.status(500).json({
        success: false,
        error:
          "Hugging Face não configurado no servidor. Verifique HF_TOKEN no Render."
      });

    }

    const userId = getUserId(req);

    const message =
      cleanText(
        req.body?.message ||
        req.body?.prompt
      );

    if (!message) {

      return res.status(400).json({
        success: false,
        error: "Mensagem vazia."
      });

    }


    const history =
      Array.isArray(req.body?.messages)
        ? req.body.messages
            .filter(
              item =>
                item &&
                typeof item.role === "string" &&
                typeof item.content === "string"
            )
            .slice(-20)
        : [];


    const userMemories =
      getStore(memories, userId);


    const memoryText =
      userMemories.length > 0
        ? userMemories
            .slice(-20)
            .map(item => `- ${item.text}`)
            .join("\n")
        : "Nenhuma memória salva.";


    const systemPrompt = `
Você é a Adaptra.AI, uma assistente de inteligência artificial criada pela Adaptrium AI.

Responda principalmente em português do Brasil, a menos que o usuário peça outro idioma.

Seja útil, clara, educada e objetiva.

Você pode ajudar com:
- programação;
- estudos;
- matemática;
- tecnologia;
- criação de ideias;
- escrita;
- projetos;
- explicações;
- resolução de problemas.

Não revele tokens, chaves API, segredos, variáveis de ambiente ou informações internas do servidor.

Memórias disponíveis do usuário:

${memoryText}
`.trim();


    const messages = [
      {
        role: "system",
        content: systemPrompt
      }
    ];


    for (const item of history) {

      if (
        item.role === "user" ||
        item.role === "assistant"
      ) {

        messages.push({
          role: item.role,
          content: cleanText(
            item.content,
            12000
          )
        });

      }

    }


    messages.push({
      role: "user",
      content: message
    });


    const result =
      await hf.chatCompletion({

        model: HF_MODEL,

        messages,

        max_tokens: 2048,

        temperature: 0.7

      });


    const answer =
      result?.choices?.[0]?.message?.content ||
      "Não consegui gerar uma resposta.";


    return res.json({

      success: true,

      answer,

      message: answer,

      userId

    });

  } catch (error) {

    console.error(
      "Erro no /chat:",
      error
    );

    return res.status(500).json({

      success: false,

      error:
        error?.message ||
        "Erro interno ao processar o chat."

    });

  }

});


// ======================================================
// GERAR IMAGEM
// ======================================================

app.post("/generate", async (req, res) => {

  try {

    if (
      !CF_ACCOUNT_ID ||
      !CF_API_TOKEN
    ) {

      return res.status(500).json({

        success: false,

        error:
          "Cloudflare Workers AI não configurado. Verifique CF_ACCOUNT_ID e CF_API_TOKEN no Render."

      });

    }


    const userId = getUserId(req);

    const prompt =
      cleanText(
        req.body?.prompt
      );


    if (!prompt) {

      return res.status(400).json({

        success: false,

        error: "Prompt vazio."

      });

    }


    const url =
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(
        CF_ACCOUNT_ID
      )}/ai/run/${CF_IMAGE_MODEL}`;


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
      response.headers.get(
        "content-type"
      ) || "";


    if (!response.ok) {

      const raw =
        await response.text();

      console.error(
        "Erro Cloudflare:",
        response.status,
        raw
      );

      let details = raw;

      try {

        const parsed =
          JSON.parse(raw);

        details =
          parsed?.errors?.[0]?.message ||
          parsed?.error ||
          raw;

      } catch (_) {}

      return res.status(
        response.status
      ).json({

        success: false,

        error:
          `Erro Cloudflare (${response.status}): ${details}`

      });

    }


    let imageBase64 = null;


    if (
      contentType.includes(
        "application/json"
      )
    ) {

      const data =
        await response.json();


      imageBase64 =
        data?.result?.image ||
        data?.image ||
        null;

    } else {

      const buffer =
        Buffer.from(
          await response.arrayBuffer()
        );

      imageBase64 =
        buffer.toString(
          "base64"
        );

    }


    if (!imageBase64) {

      return res.status(500).json({

        success: false,

        error:
          "A Cloudflare não retornou a imagem."

      });

    }


    let image;


    if (
      imageBase64.startsWith(
        "data:image/"
      )
    ) {

      image = imageBase64;

    } else {

      image =
        `data:image/jpeg;base64,${imageBase64}`;

    }


    return res.json({

      success: true,

      image,

      userId

    });

  } catch (error) {

    console.error(
      "Erro no /generate:",
      error
    );

    return res.status(500).json({

      success: false,

      error:
        error?.message ||
        "Erro interno ao gerar imagem."

    });

  }

});


// ======================================================
// MEMÓRIA — GET
// ======================================================

app.get("/memory", (req, res) => {

  const userId =
    getUserId(req);

  const data =
    getStore(
      memories,
      userId
    );

  res.json({

    success: true,

    memories: data

  });

});


// ======================================================
// MEMÓRIA — POST
// ======================================================

app.post("/memory", (req, res) => {

  const userId =
    getUserId(req);

  const text =
    cleanText(
      req.body?.text ||
      req.body?.memory
    );


  if (!text) {

    return res.status(400).json({

      success: false,

      error:
        "Memória vazia."

    });

  }


  const data =
    getStore(
      memories,
      userId
    );


  const item = {

    id:
      Date.now().toString(),

    text,

    createdAt:
      new Date().toISOString()

  };


  data.push(item);


  // Evita crescimento infinito
  if (data.length > 100) {
    data.splice(
      0,
      data.length - 100
    );
  }


  res.json({

    success: true,

    memory: item,

    memories: data

  });

});


// ======================================================
// MEMÓRIA — DELETE
// ======================================================

app.delete("/memory", (req, res) => {

  const userId =
    getUserId(req);

  const data =
    getStore(
      memories,
      userId
    );


  const id =
    req.body?.id ||
    req.query?.id;


  if (!id) {

    data.length = 0;

  } else {

    const index =
      data.findIndex(
        item =>
          item.id === id
      );

    if (index !== -1) {
      data.splice(index, 1);
    }

  }


  res.json({

    success: true,

    memories: data

  });

});


// ======================================================
// CONVERSAS — GET
// ======================================================

app.get("/conversations", (req, res) => {

  const userId =
    getUserId(req);

  const data =
    getStore(
      conversations,
      userId
    );


  res.json({

    success: true,

    conversations: data

  });

});


// ======================================================
// CONVERSAS — POST
// ======================================================

app.post("/conversations", (req, res) => {

  const userId =
    getUserId(req);

  const title =
    cleanText(
      req.body?.title ||
      "Nova conversa",
      200
    );


  const messages =
    Array.isArray(
      req.body?.messages
    )
      ? req.body.messages
      : [];


  const data =
    getStore(
      conversations,
      userId
    );


  const conversation = {

    id:
      Date.now().toString(),

    title,

    messages,

    createdAt:
      new Date().toISOString(),

    updatedAt:
      new Date().toISOString()

  };


  data.push(
    conversation
  );


  res.json({

    success: true,

    conversation

  });

});


// ======================================================
// CONVERSAS — DELETE
// ======================================================

app.delete(
  "/conversations",
  (req, res) => {

    const userId =
      getUserId(req);

    const data =
      getStore(
        conversations,
        userId
      );


    const id =
      req.body?.id ||
      req.query?.id;


    if (!id) {

      data.length = 0;

    } else {

      const index =
        data.findIndex(
          item =>
            item.id === id
        );

      if (index !== -1) {
        data.splice(
          index,
          1
        );
      }

    }


    res.json({

      success: true,

      conversations: data

    });

  }
);


// ======================================================
// PROJETOS — GET
// ======================================================

app.get("/projects", (req, res) => {

  const userId =
    getUserId(req);

  const data =
    getStore(
      projects,
      userId
    );


  res.json({

    success: true,

    projects: data

  });

});


// ======================================================
// PROJETOS — POST
// ======================================================

app.post("/projects", (req, res) => {

  const userId =
    getUserId(req);

  const name =
    cleanText(
      req.body?.name ||
      "Novo projeto",
      200
    );


  const description =
    cleanText(
      req.body?.description ||
      "",
      2000
    );


  const data =
    getStore(
      projects,
      userId
    );


  const project = {

    id:
      Date.now().toString(),

    name,

    description,

    createdAt:
      new Date().toISOString(),

    updatedAt:
      new Date().toISOString()

  };


  data.push(project);


  res.json({

    success: true,

    project

  });

});


// ======================================================
// PROJETOS — DELETE
// ======================================================

app.delete("/projects", (req, res) => {

  const userId =
    getUserId(req);

  const data =
    getStore(
      projects,
      userId
    );


  const id =
    req.body?.id ||
    req.query?.id;


  if (!id) {

    data.length = 0;

  } else {

    const index =
      data.findIndex(
        item =>
          item.id === id
      );

    if (index !== -1) {

      data.splice(
        index,
        1
      );

    }

  }


  res.json({

    success: true,

    projects: data

  });

});


// ======================================================
// REPAIR / DIAGNÓSTICO
// ======================================================

app.get(
  "/admin/repair",
  (req, res) => {

    res.json({

      success: true,

      diagnostic: {

        server: "online",

        version: "4.5.1",

        node:
          process.version,

        chatConfigured:
          Boolean(HF_TOKEN),

        imageConfigured:
          Boolean(
            CF_ACCOUNT_ID &&
            CF_API_TOKEN
          ),

        model:
          HF_MODEL,

        imageModel:
          CF_IMAGE_MODEL

      },

      note:
        "Esta rota é apenas diagnóstica. Não é uma rota administrativa protegida."

    });

  }
);


// ======================================================
// 404
// ======================================================

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


// ======================================================
// ERRO GLOBAL
// ======================================================

app.use(
  (error, req, res, next) => {

    console.error(
      "Erro global:",
      error
    );


    if (
      error?.message?.includes(
        "CORS"
      )
    ) {

      return res.status(403).json({

        success: false,

        error:
          error.message

      });

    }


    res.status(500).json({

      success: false,

      error:
        error?.message ||
        "Erro interno do servidor."

    });

  }
);


// ======================================================
// INICIAR SERVIDOR
// ======================================================

app.listen(
  PORT,
  () => {

    console.log(
      "========================================"
    );

    console.log(
      "Adaptra.AI Backend"
    );

    console.log(
      "Version: 4.5.1"
    );

    console.log(
      `Porta: ${PORT}`
    );

    console.log(
      `Chat configurado: ${Boolean(HF_TOKEN)}`
    );

    console.log(
      `Imagem configurada: ${Boolean(
        CF_ACCOUNT_ID &&
        CF_API_TOKEN
      )}`
    );

    console.log(
      `Modelo: ${HF_MODEL}`
    );

    console.log(
      `Imagem: ${CF_IMAGE_MODEL}`
    );

    console.log(
      "========================================"
    );

  }
);
