// ============================================================
// Adaptra.AI 4.5.5
// Backend Node.js + Express
// Hugging Face + Qwen3-VL
// Cloudflare Workers AI
// Supabase Auth
// ============================================================

const express = require("express");
const cors = require("cors");
const multer = require("multer");
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");
const { InferenceClient } = require("@huggingface/inference");

const app = express();

// ============================================================
// CONFIGURAÇÃO
// ============================================================

const PORT = process.env.PORT || 3000;

const HF_TOKEN =
  process.env.HF_TOKEN ||
  process.env.HUGGINGFACE_TOKEN ||
  process.env.HF_API_TOKEN ||
  "";

const HF_CHAT_MODEL =
  process.env.HF_CHAT_MODEL ||
  process.env.HF_MODEL ||
  "Qwen/Qwen3-VL-32B-Instruct:featherless-ai";

const IMAGE_MODEL =
  process.env.IMAGE_MODEL ||
  "@cf/black-forest-labs/flux-1-schnell";

const CF_ACCOUNT_ID =
  process.env.CF_ACCOUNT_ID ||
  process.env.CLOUDFLARE_ACCOUNT_ID ||
  "";

const CF_API_TOKEN =
  process.env.CF_API_TOKEN ||
  process.env.CLOUDFLARE_API_TOKEN ||
  "";

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  "https://anxtcfatziljkdoyzuwq.supabase.co";

const SUPABASE_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  process.env.SUPABASE_KEY ||
  "";

const ALLOWED_ORIGIN =
  process.env.ALLOWED_ORIGIN ||
  "https://jasonn-26.github.io";

const hf = HF_TOKEN
  ? new InferenceClient(HF_TOKEN)
  : null;

// ============================================================
// CONFIGURAÇÃO DO EXPRESS
// ============================================================

app.disable("x-powered-by");

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) {
        return callback(null, true);
      }

      const allowedOrigins = [
        ALLOWED_ORIGIN,
        "https://jasonn-26.github.io",
        "http://localhost:3000",
        "http://localhost:5500",
        "http://127.0.0.1:5500",
      ];

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      if (
        process.env.NODE_ENV !== "production" &&
        /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
      ) {
        return callback(null, true);
      }

      return callback(
        new Error("Origem não permitida pelo backend.")
      );
    },

    credentials: true,
  })
);

app.use(
  express.json({
    limit: "12mb",
  })
);

// ============================================================
// UPLOADS
// ============================================================

const upload = multer({
  storage: multer.memoryStorage(),

  limits: {
    files: 5,
    fileSize: 8 * 1024 * 1024,
  },

  fileFilter(req, file, cb) {
    const allowed = [
      "image/png",
      "image/jpeg",
      "image/jpg",
      "image/webp",
      "text/plain",
      "text/markdown",
      "text/csv",
      "application/json",
      "text/html",
      "text/css",
      "application/javascript",
      "text/javascript",
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ];

    if (allowed.includes(file.mimetype)) {
      return cb(null, true);
    }

    // Também permite arquivos de código pelo nome/extensão.
    const name = String(file.originalname || "").toLowerCase();

    const allowedExtensions = [
      ".txt",
      ".md",
      ".csv",
      ".json",
      ".html",
      ".htm",
      ".css",
      ".js",
      ".ts",
      ".jsx",
      ".tsx",
      ".py",
      ".java",
      ".c",
      ".cpp",
      ".h",
      ".hpp",
      ".xml",
      ".yml",
      ".yaml",
      ".sql",
      ".pdf",
      ".docx",
      ".png",
      ".jpg",
      ".jpeg",
      ".webp",
    ];

    const validExtension = allowedExtensions.some((ext) =>
      name.endsWith(ext)
    );

    if (validExtension) {
      return cb(null, true);
    }

    return cb(
      new Error(
        `Tipo de arquivo não suportado: ${file.originalname}`
      )
    );
  },
});

// ============================================================
// ARMAZENAMENTO TEMPORÁRIO
// ============================================================

const memories = new Map();
const conversations = new Map();
const projects = new Map();

// ============================================================
// FUNÇÕES AUXILIARES
// ============================================================

function now() {
  return new Date().toISOString();
}

function safeText(value, max = 12000) {
  return String(value ?? "")
    .trim()
    .slice(0, max);
}

function getOrCreate(map, key, factory) {
  if (!map.has(key)) {
    map.set(key, factory());
  }

  return map.get(key);
}

function getBearerToken(req) {
  const header = req.headers.authorization || "";

  if (!header.startsWith("Bearer ")) {
    return "";
  }

  return header.slice(7).trim();
}

// ============================================================
// AUTENTICAÇÃO SUPABASE
// ============================================================

async function authenticateSupabase(req) {
  const token = getBearerToken(req);

  if (!token) {
    return null;
  }

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error(
      "SUPABASE_URL ou SUPABASE_PUBLISHABLE_KEY não configurado."
    );

    return null;
  }

  try {
    const response = await fetch(
      `${SUPABASE_URL}/auth/v1/user`,
      {
        method: "GET",

        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${token}`,
        },
      }
    );

    if (!response.ok) {
      return null;
    }

    const user = await response.json();

    if (!user || !user.id) {
      return null;
    }

    return user;
  } catch (error) {
    console.error(
      "SUPABASE AUTH ERROR:",
      error?.message || error
    );

    return null;
  }
}

async function requireAuth(req, res, next) {
  const user = await authenticateSupabase(req);

  if (!user) {
    return res.status(401).json({
      success: false,
      error: "Usuário não autenticado.",
    });
  }

  req.user = user;
  req.userId = String(user.id);

  next();
}

// ============================================================
// HISTÓRICO
// ============================================================

function normalizeHistory(history) {
  if (!Array.isArray(history)) {
    return [];
  }

  return history
    .filter(
      (item) =>
        item &&
        typeof item === "object"
    )
    .map((item) => {
      const role =
        item.role === "assistant"
          ? "assistant"
          : item.role === "system"
          ? "system"
          : "user";

      return {
        role,
        content: safeText(
          item.content,
          12000
        ),
      };
    })
    .filter((item) => item.content)
    .slice(-20);
}

// ============================================================
// EXTRAÇÃO DE ARQUIVOS
// ============================================================

async function extractFileText(file) {
  if (!file) {
    return "";
  }

  const name = String(
    file.originalname || ""
  ).toLowerCase();

  // ----------------------------------------------------------
  // PDF
  // ----------------------------------------------------------

  if (
    file.mimetype === "application/pdf" ||
    name.endsWith(".pdf")
  ) {
    try {
      const parsed = await pdfParse(
        file.buffer
      );

      return safeText(
        parsed.text,
        30000
      );
    } catch (error) {
      return `[Não foi possível extrair o texto do PDF ${file.originalname}.]`;
    }
  }

  // ----------------------------------------------------------
  // DOCX
  // ----------------------------------------------------------

  if (
    file.mimetype ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    name.endsWith(".docx")
  ) {
    try {
      const result =
        await mammoth.extractRawText({
          buffer: file.buffer,
        });

      return safeText(
        result.value,
        30000
      );
    } catch (error) {
      return `[Não foi possível extrair o texto do DOCX ${file.originalname}.]`;
    }
  }

  // ----------------------------------------------------------
  // IMAGEM
  // ----------------------------------------------------------

  if (
    file.mimetype.startsWith("image/")
  ) {
    return "";
  }

  // ----------------------------------------------------------
  // TEXTO / CÓDIGO
  // ----------------------------------------------------------

  try {
    return safeText(
      file.buffer.toString("utf8"),
      30000
    );
  } catch (error) {
    return "";
  }
}

// ============================================================
// CONVERTER IMAGEM PARA DATA URL
// ============================================================

function imageToDataUrl(file) {
  if (!file) {
    return null;
  }

  if (
    !file.mimetype ||
    !file.mimetype.startsWith("image/")
  ) {
    return null;
  }

  const base64 =
    file.buffer.toString("base64");

  return `data:${file.mimetype};base64,${base64}`;
}

// ============================================================
// CONTEXTO DOS ARQUIVOS
// ============================================================

async function buildAttachmentContext(files) {
  if (!Array.isArray(files)) {
    return {
      textContext: "",
      images: [],
      metadata: [],
    };
  }

  const textParts = [];
  const images = [];
  const metadata = [];

  for (const file of files) {
    const isImage =
      file.mimetype &&
      file.mimetype.startsWith("image/");

    metadata.push({
      name: file.originalname,
      type: file.mimetype,
      size: file.size,
    });

    if (isImage) {
      const dataUrl =
        imageToDataUrl(file);

      if (dataUrl) {
        images.push({
          name: file.originalname,
          dataUrl,
        });
      }

      continue;
    }

    const extracted =
      await extractFileText(file);

    if (extracted) {
      textParts.push(
        `--- ARQUIVO: ${file.originalname} ---\n${extracted}`
      );
    }
  }

  return {
    textContext: textParts.join("\n\n"),
    images,
    metadata,
  };
}

// ============================================================
// PROMPT DO SISTEMA
// ============================================================

const SYSTEM_PROMPT = `
Você é a Adaptra.AI, uma assistente de inteligência artificial
desenvolvida pela Adaptrium AI.

Você deve:

- Responder no idioma do usuário.
- Quando o usuário escrever em português, responder em português do Brasil.
- Ser clara, útil, natural e precisa.
- Não inventar informações.
- Admitir quando não souber algo.
- Ajudar com programação, matemática, estudos, criatividade,
  análise de documentos e imagens.
- Quando receber uma imagem, analisar visualmente a imagem
  antes de responder.
- Descrever somente aquilo que realmente puder observar.
- Se houver texto em uma imagem, tentar ler e explicar.
- Se o usuário perguntar sobre elementos visuais, responder
  com base na imagem recebida.
- Para programação, fornecer código funcional.
- Não revelar tokens, senhas, chaves, variáveis secretas,
  informações internas ou credenciais.
- Nunca revelar o ID interno do usuário.
- Nunca fingir que viu uma imagem se nenhuma imagem foi enviada.
`.trim();

// ============================================================
// HEALTH
// ============================================================

app.get("/", (req, res) => {
  res.json({
    success: true,

    name: "Adaptra.AI",

    company: "Adaptrium AI",

    version: "4.5.5",

    status: "online",

    provider: {
      chat: "Hugging Face Inference Providers",
      vision: "Qwen3-VL",
      image: "Cloudflare Workers AI",
      auth: "Supabase Auth + Google OAuth",
    },

    configured: {
      chat: Boolean(HF_TOKEN),
      image: Boolean(
        CF_ACCOUNT_ID &&
        CF_API_TOKEN
      ),
      auth: Boolean(
        SUPABASE_URL &&
        SUPABASE_KEY
      ),
    },

    models: {
      chat: HF_CHAT_MODEL,
      image: IMAGE_MODEL,
    },

    routes: {
      health: "/health",
      test: "/test",

      chat: "/chat",
      generate: "/generate",

      memory: "/memory",
      conversations: "/conversations",
      projects: "/projects",

      api: "/api/v1",
      apiChat: "/api/v1/chat",
      apiImages: "/api/v1/images",
      apiMemory: "/api/v1/memory",
      apiConversations:
        "/api/v1/conversations",
      apiProjects: "/api/v1/projects",
    },
  });
});

// ============================================================
// HEALTH DETALHADO
// ============================================================

app.get("/health", (req, res) => {
  res.json({
    success: true,

    status: "online",

    name: "Adaptra.AI",

    company: "Adaptrium AI",

    version: "4.5.5",

    configured: {
      chat: Boolean(HF_TOKEN),
      image: Boolean(
        CF_ACCOUNT_ID &&
        CF_API_TOKEN
      ),
      auth: Boolean(
        SUPABASE_URL &&
        SUPABASE_KEY
      ),
    },

    models: {
      chat: HF_CHAT_MODEL,
      image: IMAGE_MODEL,
    },

    vision: {
      enabled: true,
      model: HF_CHAT_MODEL,
      provider: "featherless-ai",
    },

    timestamp: now(),
  });
});

// ============================================================
// TEST
// ============================================================

app.get("/test", (req, res) => {
  res.json({
    success: true,

    message:
      "API Adaptra.AI funcionando.",

    timestamp: now(),
  });
});

// ============================================================
// API V1
// ============================================================

app.get("/api/v1", (req, res) => {
  res.json({
    success: true,

    name: "Adaptra.AI API",

    version: "1.0",

    company: "Adaptrium AI",

    endpoints: {
      chat: "POST /api/v1/chat",
      images: "POST /api/v1/images",

      memory: {
        get: "GET /api/v1/memory",
        create:
          "POST /api/v1/memory",
        delete:
          "DELETE /api/v1/memory",
      },

      conversations: {
        get:
          "GET /api/v1/conversations",
        create:
          "POST /api/v1/conversations",
        delete:
          "DELETE /api/v1/conversations/:id",
      },

      projects: {
        get:
          "GET /api/v1/projects",
        create:
          "POST /api/v1/projects",
        delete:
          "DELETE /api/v1/projects/:id",
      },
    },
  });
});

// ============================================================
// CHAT PRINCIPAL
// ============================================================

async function handleChat(req, res) {
  try {
    // --------------------------------------------------------
    // Verificar Hugging Face
    // --------------------------------------------------------

    if (!HF_TOKEN || !hf) {
      return res.status(503).json({
        success: false,

        error:
          "Hugging Face não está configurado no servidor.",
      });
    }

    // --------------------------------------------------------
    // Usuário
    // --------------------------------------------------------

    const userId =
      req.userId ||
      "anonymous";

    // --------------------------------------------------------
    // Mensagem
    // --------------------------------------------------------

    const message =
      safeText(
        req.body?.message,
        12000
      );

    if (!message) {
      return res.status(400).json({
        success: false,

        error:
          "A mensagem não pode estar vazia.",
      });
    }

    // --------------------------------------------------------
    // Histórico
    // --------------------------------------------------------

    let history =
      req.body?.history;

    if (typeof history === "string") {
      try {
        history = JSON.parse(history);
      } catch {
        history = [];
      }
    }

    history =
      normalizeHistory(history);

    // --------------------------------------------------------
    // Arquivos
    // --------------------------------------------------------

    const files =
      Array.isArray(req.files)
        ? req.files
        : [];

    const attachments =
      await buildAttachmentContext(
        files
      );

    // --------------------------------------------------------
    // Montar conteúdo do usuário
    // --------------------------------------------------------

    let userText = message;

    if (attachments.textContext) {
      userText += `

Contexto dos arquivos enviados:

${attachments.textContext}
`;
    }

    if (attachments.metadata.length) {
      userText += `

Arquivos enviados:
${attachments.metadata
  .map(
    (item) =>
      `- ${item.name} (${item.type}, ${item.size} bytes)`
  )
  .join("\n")}
`;
    }

    // --------------------------------------------------------
    // Conteúdo multimodal
    // --------------------------------------------------------

    let currentUserContent;

    if (attachments.images.length) {
      currentUserContent = [
        {
          type: "text",
          text: userText,
        },
      ];

      for (const image of attachments.images) {
        currentUserContent.push({
          type: "image_url",

          image_url: {
            url: image.dataUrl,
          },
        });
      }
    } else {
      currentUserContent = userText;
    }

    // --------------------------------------------------------
    // Mensagens para o modelo
    // --------------------------------------------------------

    const messages = [
      {
        role: "system",

        content: SYSTEM_PROMPT,
      },

      ...history,

      {
        role: "user",

        content:
          currentUserContent,
      },
    ];

    // --------------------------------------------------------
    // Modelo
    // --------------------------------------------------------

    const result =
      await hf.chatCompletion({
        model: HF_CHAT_MODEL,

        messages,

        max_tokens: 2200,

        temperature: 0.7,
      });

    // --------------------------------------------------------
    // Resposta
    // --------------------------------------------------------

    let reply =
      result?.choices?.[0]?.message
        ?.content || "";

    if (Array.isArray(reply)) {
      reply = reply
        .map((part) => {
          if (
            typeof part === "string"
          ) {
            return part;
          }

          return (
            part?.text ||
            ""
          );
        })
        .join("");
    }

    reply = safeText(
      reply,
      30000
    );

    if (!reply) {
      return res.status(502).json({
        success: false,

        error:
          "A IA não retornou uma resposta.",
      });
    }

    // --------------------------------------------------------
    // Salvar conversa
    // --------------------------------------------------------

    const userConversations =
      getOrCreate(
        conversations,
        userId,
        () => []
      );

    const conversationId =
      String(
        req.body?.conversationId ||
          "adaptra-main"
      );

    let conversation =
      userConversations.find(
        (item) =>
          item.id ===
          conversationId
      );

    if (!conversation) {
      conversation = {
        id: conversationId,

        title:
          message.slice(0, 70),

        messages: [],

        createdAt: now(),
      };

      userConversations.push(
        conversation
      );
    }

    conversation.messages.push(
      {
        role: "user",
        content: message,
        attachments:
          attachments.metadata,
        createdAt: now(),
      },

      {
        role: "assistant",
        content: reply,
        createdAt: now(),
      }
    );

    conversation.messages =
      conversation.messages.slice(
        -60
      );

    // --------------------------------------------------------
    // Resposta
    // --------------------------------------------------------

    return res.json({
      success: true,

      reply,

      userId,

      model: HF_CHAT_MODEL,

      vision:
        attachments.images.length > 0,

      attachments:
        attachments.metadata,
    });
  } catch (error) {
    console.error(
      "CHAT ERROR:",
      error
    );

    const details =
      String(
        error?.message ||
          error
      ).slice(0, 2000);

    return res.status(500).json({
      success: false,

      error:
        "Erro ao conversar com a IA.",

      details:
        process.env.NODE_ENV ===
        "production"
          ? undefined
          : details,
    });
  }
}

// ============================================================
// CHAT — API V1
// ============================================================

app.post(
  "/api/v1/chat",
  requireAuth,
  upload.array("files", 5),
  handleChat
);

// ============================================================
// CHAT — ROTA ANTIGA
// ============================================================

app.post(
  "/chat",
  requireAuth,
  upload.array("files", 5),
  handleChat
);

// ============================================================
// GERAÇÃO DE IMAGEM
// ============================================================

async function handleGenerate(
  req,
  res
) {
  try {
    if (
      !CF_ACCOUNT_ID ||
      !CF_API_TOKEN
    ) {
      return res.status(503).json({
        success: false,

        error:
          "Cloudflare Workers AI não está configurado.",
      });
    }

    const prompt =
      safeText(
        req.body?.prompt,
        4000
      );

    if (!prompt) {
      return res.status(400).json({
        success: false,

        error:
          "O prompt da imagem não pode estar vazio.",
      });
    }

    const url =
      `https://api.cloudflare.com/client/v4/accounts/` +
      `${encodeURIComponent(
        CF_ACCOUNT_ID
      )}/ai/run/` +
      `${IMAGE_MODEL}`;

    const response =
      await fetch(url, {
        method: "POST",

        headers: {
          Authorization:
            `Bearer ${CF_API_TOKEN}`,

          "Content-Type":
            "application/json",
        },

        body: JSON.stringify({
          prompt,

          steps: 4,
        }),
      });

    const raw =
      await response.text();

    let data = null;

    try {
      data = raw
        ? JSON.parse(raw)
        : null;
    } catch {
      data = null;
    }

    if (!response.ok) {
      console.error(
        "CLOUDFLARE ERROR:",
        response.status,
        raw
      );

      return res
        .status(response.status)
        .json({
          success: false,

          error:
            "A geração de imagem falhou no Cloudflare.",

          details:
            data?.errors ||
            raw.slice(0, 1000),
        });
    }

    const image =
      data?.result?.image ||
      data?.result?.images?.[0] ||
      data?.image ||
      null;

    if (!image) {
      return res.status(502).json({
        success: false,

        error:
          "O Cloudflare não retornou uma imagem.",
      });
    }

    const imageString =
      String(image);

    return res.json({
      success: true,

      image:
        imageString.startsWith(
          "data:image/"
        )
          ? imageString
          : `data:image/jpeg;base64,${imageString}`,

      model: IMAGE_MODEL,
    });
  } catch (error) {
    console.error(
      "GENERATE ERROR:",
      error
    );

    return res.status(500).json({
      success: false,

      error:
        "Erro interno ao gerar a imagem.",

      details:
        process.env.NODE_ENV ===
        "production"
          ? undefined
          : String(
              error?.message ||
                error
            ).slice(0, 1000),
    });
  }
}

// ============================================================
// IMAGENS — API V1
// ============================================================

app.post(
  "/api/v1/images",
  requireAuth,
  handleGenerate
);

// ============================================================
// IMAGENS — ROTA ANTIGA
// ============================================================

app.post(
  "/generate",
  requireAuth,
  handleGenerate
);

// ============================================================
// MEMÓRIA
// ============================================================

app.get(
  "/api/v1/memory",
  requireAuth,
  (req, res) => {
    const userId =
      req.userId;

    const memory =
      memories.get(userId) ||
      [];

    res.json({
      success: true,

      userId,

      memory,
    });
  }
);

app.get(
  "/memory",
  requireAuth,
  (req, res) => {
    const userId =
      req.userId;

    res.json({
      success: true,

      userId,

      memory:
        memories.get(userId) ||
        [],
    });
  }
);

// ------------------------------------------------------------
// CRIAR MEMÓRIA
// ------------------------------------------------------------

async function createMemory(
  req,
  res
) {
  const userId =
    req.userId;

  const text =
    safeText(
      req.body?.text ||
        req.body?.memory,
      2000
    );

  if (!text) {
    return res.status(400).json({
      success: false,

      error:
        "A memória não pode estar vazia.",
    });
  }

  const memory =
    getOrCreate(
      memories,
      userId,
      () => []
    );

  memory.push({
    id:
      `${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`,

    text,

    createdAt: now(),
  });

  while (memory.length > 100) {
    memory.shift();
  }

  res.json({
    success: true,

    userId,

    memory,
  });
}

app.post(
  "/api/v1/memory",
  requireAuth,
  createMemory
);

app.post(
  "/memory",
  requireAuth,
  createMemory
);

// ------------------------------------------------------------
// APAGAR MEMÓRIA
// ------------------------------------------------------------

async function deleteMemory(
  req,
  res
) {
  const userId =
    req.userId;

  memories.delete(userId);

  res.json({
    success: true,

    message:
      "Memória apagada.",
  });
}

app.delete(
  "/api/v1/memory",
  requireAuth,
  deleteMemory
);

app.delete(
  "/memory",
  requireAuth,
  deleteMemory
);

// ============================================================
// CONVERSAS
// ============================================================

async function listConversations(
  req,
  res
) {
  const userId =
    req.userId;

  res.json({
    success: true,

    userId,

    conversations:
      conversations.get(
        userId
      ) || [],
  });
}

app.get(
  "/api/v1/conversations",
  requireAuth,
  listConversations
);

app.get(
  "/conversations",
  requireAuth,
  listConversations
);

// ------------------------------------------------------------
// CRIAR CONVERSA
// ------------------------------------------------------------

async function createConversation(
  req,
  res
) {
  const userId =
    req.userId;

  const title =
    safeText(
      req.body?.title,
      100
    ) ||
    "Nova conversa";

  const list =
    getOrCreate(
      conversations,
      userId,
      () => []
    );

  const conversation = {
    id:
      `${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`,

    title,

    messages: [],

    createdAt: now(),
  };

  list.unshift(
    conversation
  );

  res.json({
    success: true,

    userId,

    conversation,
  });
}

app.post(
  "/api/v1/conversations",
  requireAuth,
  createConversation
);

app.post(
  "/conversations",
  requireAuth,
  createConversation
);

// ------------------------------------------------------------
// APAGAR CONVERSA
// ------------------------------------------------------------

async function deleteConversation(
  req,
  res
) {
  const userId =
    req.userId;

  const list =
    conversations.get(
      userId
    ) || [];

  const before =
    list.length;

  const filtered =
    list.filter(
      (item) =>
        item.id !==
        req.params.id
    );

  conversations.set(
    userId,
    filtered
  );

  res.json({
    success: true,

    deleted:
      before !==
      filtered.length,
  });
}

app.delete(
  "/api/v1/conversations/:id",
  requireAuth,
  deleteConversation
);

app.delete(
  "/conversations/:id",
  requireAuth,
  deleteConversation
);

// ============================================================
// PROJETOS
// ============================================================

async function listProjects(
  req,
  res
) {
  const userId =
    req.userId;

  res.json({
    success: true,

    userId,

    projects:
      projects.get(
        userId
      ) || [],
  });
}

app.get(
  "/api/v1/projects",
  requireAuth,
  listProjects
);

app.get(
  "/projects",
  requireAuth,
  listProjects
);

// ------------------------------------------------------------
// CRIAR PROJETO
// ------------------------------------------------------------

async function createProject(
  req,
  res
) {
  const userId =
    req.userId;

  const name =
    safeText(
      req.body?.name,
      120
    );

  const description =
    safeText(
      req.body?.description,
      2000
    );

  if (!name) {
    return res.status(400).json({
      success: false,

      error:
        "O projeto precisa de um nome.",
    });
  }

  const list =
    getOrCreate(
      projects,
      userId,
      () => []
    );

  const project = {
    id:
      `${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`,

    name,

    description,

    createdAt: now(),
  };

  list.unshift(project);

  res.json({
    success: true,

    userId,

    project,
  });
}

app.post(
  "/api/v1/projects",
  requireAuth,
  createProject
);

app.post(
  "/projects",
  requireAuth,
  createProject
);

// ------------------------------------------------------------
// APAGAR PROJETO
// ------------------------------------------------------------

async function deleteProject(
  req,
  res
) {
  const userId =
    req.userId;

  const list =
    projects.get(
      userId
    ) || [];

  const filtered =
    list.filter(
      (item) =>
        item.id !==
        req.params.id
    );

  projects.set(
    userId,
    filtered
  );

  res.json({
    success: true,

    deleted:
      list.length !==
      filtered.length,
  });
}

app.delete(
  "/api/v1/projects/:id",
  requireAuth,
  deleteProject
);

app.delete(
  "/projects/:id",
  requireAuth,
  deleteProject
);

// ============================================================
// DIAGNÓSTICO
// ============================================================

app.get(
  "/admin/repair",
  requireAuth,
  (req, res) => {
    res.json({
      success: true,

      mode: "diagnostic",

      checks: {
        chatConfigured:
          Boolean(HF_TOKEN),

        imageConfigured:
          Boolean(
            CF_ACCOUNT_ID &&
            CF_API_TOKEN
          ),

        authConfigured:
          Boolean(
            SUPABASE_URL &&
            SUPABASE_KEY
          ),

        visionEnabled:
          true,
      },

      models: {
        chat:
          HF_CHAT_MODEL,

        image:
          IMAGE_MODEL,
      },

      timestamp: now(),
    });
  }
);

// ============================================================
// MULTER / UPLOAD ERROR
// ============================================================

app.use(
  (
    error,
    req,
    res,
    next
  ) => {
    if (
      error &&
      error.code ===
        "LIMIT_FILE_SIZE"
    ) {
      return res.status(413).json({
        success: false,

        error:
          "Arquivo muito grande. O limite é 8 MB por arquivo.",
      });
    }

    if (
      error &&
      error.code ===
        "LIMIT_FILE_COUNT"
    ) {
      return res.status(400).json({
        success: false,

        error:
          "O limite é de 5 arquivos por mensagem.",
      });
    }

    if (error) {
      console.error(
        "UPLOAD ERROR:",
        error
      );

      return res.status(400).json({
        success: false,

        error:
          error.message ||
          "Erro no upload.",
      });
    }

    next();
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
        req.originalUrl,
    });
  }
);

// ============================================================
// ERRO GLOBAL
// ============================================================

app.use(
  (
    error,
    req,
    res,
    next
  ) => {
    console.error(
      "GLOBAL ERROR:",
      error
    );

    res.status(500).json({
      success: false,

      error:
        "Erro interno do servidor.",
    });
  }
);

// ============================================================
// INICIAR SERVIDOR
// ============================================================

app.listen(
  PORT,
  () => {
    console.log(
      "======================================"
    );

    console.log(
      " Adaptra.AI Backend 4.5.5"
    );

    console.log(
      " Empresa: Adaptrium AI"
    );

    console.log(
      " Porta:",
      PORT
    );

    console.log(
      " Chat:",
      HF_TOKEN
        ? "CONFIGURADO"
        : "NÃO CONFIGURADO"
    );

    console.log(
      " Modelo chat:",
      HF_CHAT_MODEL
    );

    console.log(
      " Vision:",
      "ATIVADO"
    );

    console.log(
      " Imagem:",
      CF_ACCOUNT_ID &&
        CF_API_TOKEN
        ? "CONFIGURADO"
        : "NÃO CONFIGURADO"
    );

    console.log(
      " Modelo imagem:",
      IMAGE_MODEL
    );

    console.log(
      " Supabase:",
      SUPABASE_KEY
        ? "CONFIGURADO"
        : "NÃO CONFIGURADO"
    );

    console.log(
      "======================================"
    );
  }
);
