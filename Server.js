// ============================================================
// Adaptra.AI 4.5.5
// Backend Node.js + Express
// Hugging Face + Qwen3-VL
// Cloudflare Workers AI
// Supabase Auth
// Desenvolvida por Adaptrium AI
// ============================================================

const express = require("express");
const cors = require("cors");
const multer = require("multer");
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");
const { InferenceClient } = require("@huggingface/inference");

const app = express();

// ============================================================
// CONFIGURAÇÕES
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
// CORS
// ============================================================

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) {
        return callback(null, true);
      }

      const allowed = [
        "https://jasonn-26.github.io",
        ALLOWED_ORIGIN,
        "http://localhost:3000",
        "http://localhost:5500",
        "http://127.0.0.1:5500"
      ];

      if (allowed.includes(origin)) {
        return callback(null, true);
      }

      return callback(
        new Error("Origem não autorizada pelo CORS.")
      );
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization"
    ]
  })
);

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// ============================================================
// UPLOADS
// ============================================================

const upload = multer({
  storage: multer.memoryStorage(),

  limits: {
    files: 5,
    fileSize: 8 * 1024 * 1024
  },

  fileFilter: function (req, file, callback) {
    const allowedExtensions = [
      ".txt",
      ".md",
      ".csv",
      ".json",
      ".html",
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
      ".webp"
    ];

    const name = String(file.originalname || "").toLowerCase();

    const allowed = allowedExtensions.some((extension) =>
      name.endsWith(extension)
    );

    if (!allowed) {
      return callback(
        new Error(
          "Tipo de arquivo não permitido."
        )
      );
    }

    callback(null, true);
  }
});

// ============================================================
// ARMAZENAMENTO TEMPORÁRIO
// ============================================================

const memories = new Map();
const conversations = new Map();
const projects = new Map();

// ============================================================
// UTILIDADES
// ============================================================

function safeJsonParse(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function cleanText(text) {
  return String(text || "")
    .replace(/\u0000/g, "")
    .trim();
}

function limitText(text, max = 20000) {
  const value = String(text || "");

  if (value.length <= max) {
    return value;
  }

  return value.slice(0, max) + "\n...[conteúdo cortado]";
}

function normalizeHistory(history) {
  if (!Array.isArray(history)) {
    return [];
  }

  return history
    .filter((item) => {
      return (
        item &&
        typeof item === "object" &&
        typeof item.role === "string"
      );
    })
    .slice(-30)
    .map((item) => ({
      role:
        item.role === "assistant"
          ? "assistant"
          : "user",

      content:
        typeof item.content === "string"
          ? item.content
          : ""
    }));
}

// ============================================================
// SUPABASE AUTH
// ============================================================

async function authenticateUser(req, res, next) {
  try {
    const authorization =
      req.headers.authorization || "";

    if (!authorization.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        error: "Token de autenticação ausente."
      });
    }

    const accessToken =
      authorization.slice("Bearer ".length).trim();

    if (!accessToken) {
      return res.status(401).json({
        success: false,
        error: "Token inválido."
      });
    }

    if (!SUPABASE_KEY) {
      return res.status(500).json({
        success: false,
        error:
          "SUPABASE_PUBLISHABLE_KEY não configurada no backend."
      });
    }

    const response = await fetch(
      `${SUPABASE_URL}/auth/v1/user`,
      {
        method: "GET",

        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${accessToken}`
        }
      }
    );

    if (!response.ok) {
      return res.status(401).json({
        success: false,
        error: "Sessão do usuário inválida ou expirada."
      });
    }

    const data = await response.json();

    if (!data || !data.id) {
      return res.status(401).json({
        success: false,
        error: "Usuário não encontrado."
      });
    }

    req.user = data;
    req.userId = String(data.id);

    next();
  } catch (error) {
    console.error(
      "Erro de autenticação:",
      error
    );

    return res.status(401).json({
      success: false,
      error: "Falha ao validar autenticação."
    });
  }
}

// ============================================================
// EXTRAÇÃO DE ARQUIVOS
// ============================================================

async function extractAttachment(file) {
  if (!file || !file.buffer) {
    return null;
  }

  const filename =
    file.originalname || "arquivo";

  const mimetype =
    file.mimetype || "application/octet-stream";

  const lower =
    filename.toLowerCase();

  try {
    // --------------------------------------------------------
    // IMAGENS
    // --------------------------------------------------------

    if (mimetype.startsWith("image/")) {
      return {
        type: "image",
        filename,
        mimetype,
        size: file.size,

        dataUrl:
          `data:${mimetype};base64,` +
          file.buffer.toString("base64")
      };
    }

    // --------------------------------------------------------
    // PDF
    // --------------------------------------------------------

    if (lower.endsWith(".pdf")) {
      const parsed =
        await pdfParse(file.buffer);

      return {
        type: "text",
        filename,
        mimetype,
        size: file.size,
        content: limitText(
          parsed.text || "",
          30000
        )
      };
    }

    // --------------------------------------------------------
    // DOCX
    // --------------------------------------------------------

    if (lower.endsWith(".docx")) {
      const result =
        await mammoth.extractRawText({
          buffer: file.buffer
        });

      return {
        type: "text",
        filename,
        mimetype,
        size: file.size,
        content: limitText(
          result.value || "",
          30000
        )
      };
    }

    // --------------------------------------------------------
    // ARQUIVOS DE TEXTO / CÓDIGO
    // --------------------------------------------------------

    return {
      type: "text",
      filename,
      mimetype,
      size: file.size,

      content: limitText(
        file.buffer.toString("utf8"),
        30000
      )
    };
  } catch (error) {
    console.error(
      `Erro processando ${filename}:`,
      error
    );

    return {
      type: "text",
      filename,
      mimetype,
      size: file.size,
      content:
        "[Não foi possível extrair o conteúdo deste arquivo.]"
    };
  }
}

// ============================================================
// CONVERSÃO DO HISTÓRICO PARA O MODELO
// ============================================================

function normalizeMessageContent(content) {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content;
  }

  return "";
}

function buildHistoryMessages(history) {
  return normalizeHistory(history).map((item) => ({
    role: item.role,
    content: normalizeMessageContent(
      item.content
    )
  }));
}

// ============================================================
// MEMÓRIA DO USUÁRIO
// ============================================================

function getUserMemory(userId) {
  if (!memories.has(userId)) {
    memories.set(userId, []);
  }

  return memories.get(userId);
}

function saveMemory(userId, memory) {
  const current =
    getUserMemory(userId);

  current.push({
    id:
      Date.now().toString() +
      Math.random()
        .toString(36)
        .slice(2),

    text: cleanText(memory),

    createdAt:
      new Date().toISOString()
  });

  // Mantém somente as últimas 100
  if (current.length > 100) {
    current.splice(
      0,
      current.length - 100
    );
  }

  memories.set(userId, current);

  return current;
}

// ============================================================
// CONTEXTO DE MEMÓRIA
// ============================================================

function buildMemoryContext(userId) {
  const memory =
    getUserMemory(userId);

  if (!memory.length) {
    return "";
  }

  const selected =
    memory.slice(-20);

  return selected
    .map(
      (item) =>
        `- ${item.text}`
    )
    .join("\n");
}

// ============================================================
// CONTEXTO DOS ANEXOS
// ============================================================

function buildAttachmentContext(attachments) {
  const textFiles =
    attachments.filter(
      (item) => item.type === "text"
    );

  if (!textFiles.length) {
    return "";
  }

  return textFiles
    .map((file) => {
      return (
        `\n\n--- ARQUIVO: ${file.filename} ---\n` +
        file.content
      );
    })
    .join("\n");
}

// ============================================================
// MENSAGEM DO SISTEMA
// ============================================================

function buildSystemPrompt(userId) {
  const memory =
    buildMemoryContext(userId);

  return `
Você é a Adaptra.AI, uma inteligência artificial
desenvolvida pela Adaptrium AI.

Você deve responder em português brasileiro
quando o usuário falar português, mas pode
responder em outros idiomas quando solicitado.

Seja útil, clara, natural e precisa.

Você pode analisar texto, código, documentos
e imagens quando esses conteúdos forem enviados.

Quando uma imagem for enviada, analise somente
o que realmente pode ser observado nela.
Não invente detalhes.

Quando não souber alguma informação, diga que
não tem certeza em vez de inventar.

Você pode ajudar com:
- programação
- jogos
- criação de conteúdo
- estudos
- matemática
- escrita
- ideias
- análise de imagens
- documentos
- projetos
- planejamento

Memórias relevantes do usuário:
${memory || "Nenhuma memória registrada."}
`.trim();
}

// ============================================================
// CONSTRUÇÃO MULTIMODAL
// ============================================================

function buildUserContent(
  userText,
  attachments
) {
  const content = [];

  content.push({
    type: "text",
    text:
      userText ||
      "Analise os arquivos enviados."
  });

  for (const attachment of attachments) {
    if (
      attachment.type === "image" &&
      attachment.dataUrl
    ) {
      content.push({
        type: "image_url",

        image_url: {
          url: attachment.dataUrl
        }
      });
    }
  }

  const attachmentContext =
    buildAttachmentContext(
      attachments
    );

  if (attachmentContext) {
    content.push({
      type: "text",
      text:
        "\nConteúdo extraído dos arquivos:" +
        attachmentContext
    });
  }

  return content;
}

// ============================================================
// CHAT PRINCIPAL
// ============================================================

async function handleChat(
  req,
  res,
  uploadedFiles = []
) {
  try {
    if (!hf) {
      return res.status(500).json({
        success: false,
        error:
          "HF_TOKEN não configurado no backend."
      });
    }

    let userText =
      cleanText(
        req.body?.message ||
        req.body?.prompt ||
        ""
      );

    let history =
      req.body?.history || [];

    if (typeof history === "string") {
      history =
        safeJsonParse(history, []);
    }

    history =
      normalizeHistory(history);

    const extracted = [];

    for (const file of uploadedFiles) {
      const result =
        await extractAttachment(file);

      if (result) {
        extracted.push(result);
      }
    }

    const hasImages =
      extracted.some(
        (item) =>
          item.type === "image"
      );

    const systemPrompt =
      buildSystemPrompt(
        req.userId
      );

    const messages = [];

    messages.push({
      role: "system",
      content: systemPrompt
    });

    for (const message of history.slice(-20)) {
      messages.push({
        role: message.role,
        content: message.content
      });
    }

    const currentContent =
      buildUserContent(
        userText,
        extracted
      );

    messages.push({
      role: "user",
      content: currentContent
    });

    console.log(
      "Chat:",
      req.userId,
      "modelo:",
      HF_CHAT_MODEL,
      "imagens:",
      hasImages,
      "arquivos:",
      extracted.length
    );

    const completion =
      await hf.chatCompletion({
        model: HF_CHAT_MODEL,

        messages,

        max_tokens: 2200,

        temperature: 0.7
      });

    const reply =
      completion?.choices?.[0]?.message?.content ||
      "Não consegui gerar uma resposta.";

    // --------------------------------------------------------
    // SALVA CONVERSA EM MEMÓRIA DO SERVIDOR
    // --------------------------------------------------------

    if (!conversations.has(req.userId)) {
      conversations.set(
        req.userId,
        []
      );
    }

    const userConversation =
      conversations.get(req.userId);

    userConversation.push({
      role: "user",
      content: userText,
      attachments:
        extracted.map((item) => ({
          filename: item.filename,
          type: item.type,
          mimetype: item.mimetype,
          size: item.size
        })),
      createdAt:
        new Date().toISOString()
    });

    userConversation.push({
      role: "assistant",
      content: reply,
      createdAt:
        new Date().toISOString()
    });

    if (userConversation.length > 200) {
      userConversation.splice(
        0,
        userConversation.length - 200
      );
    }

    return res.json({
      success: true,

      reply,

      model: HF_CHAT_MODEL,

      vision: hasImages,

      attachments:
        extracted.map((item) => ({
          filename: item.filename,
          type: item.type,
          mimetype: item.mimetype,
          size: item.size
        })),

      createdAt:
        new Date().toISOString()
    });
  } catch (error) {
    console.error(
      "Erro no chat:",
      error
    );

    return res.status(500).json({
      success: false,

      error:
        error?.message ||
        "Erro interno no chat."
    });
  }
}

// ============================================================
// HEALTH
// ============================================================

app.get("/health", (req, res) => {
  res.json({
    success: true,

    name: "Adaptra.AI",

    version: "4.5.5",

    company: "Adaptrium AI",

    status: "online",

    provider: {
      chat: "Hugging Face",
      image: "Cloudflare Workers AI",
      auth: "Supabase"
    },

    models: {
      chat: HF_CHAT_MODEL,
      image: IMAGE_MODEL
    },

    configured: {
      chat: Boolean(HF_TOKEN),
      image:
        Boolean(
          CF_ACCOUNT_ID &&
          CF_API_TOKEN
        ),
      auth:
        Boolean(
          SUPABASE_URL &&
          SUPABASE_KEY
        )
    },

    vision: true,

    routes: {
      health: "/health",
      test: "/test",
      api: "/api/v1",
      chat: "/api/v1/chat",
      images: "/api/v1/images",
      memory: "/api/v1/memory",
      conversations:
        "/api/v1/conversations",
      projects:
        "/api/v1/projects",
      repair: "/admin/repair"
    },

    timestamp:
      new Date().toISOString()
  });
});

// ============================================================
// TEST
// ============================================================

app.get("/test", (req, res) => {
  res.json({
    success: true,

    message:
      "Backend da Adaptra.AI está funcionando.",

    version: "4.5.5",

    company: "Adaptrium AI",

    model: HF_CHAT_MODEL,

    vision: true
  });
});

// ============================================================
// API INFO
// ============================================================

app.get("/api/v1", (req, res) => {
  res.json({
    success: true,

    name: "Adaptrium AI API",

    product: "Adaptra.AI",

    version: "4.5.5",

    endpoints: {
      chat: "POST /api/v1/chat",
      images: "POST /api/v1/images",
      memory: "GET/POST/DELETE /api/v1/memory",
      conversations:
        "GET /api/v1/conversations",
      projects:
        "GET/POST/DELETE /api/v1/projects"
    }
  });
});

// ============================================================
// CHAT API
// ============================================================

app.post(
  "/api/v1/chat",
  authenticateUser,
  upload.array("files", 5),
  async (req, res) => {
    await handleChat(
      req,
      res,
      req.files || []
    );
  }
);

// ============================================================
// CHAT LEGADO
// ============================================================

app.post(
  "/chat",
  authenticateUser,
  upload.array("files", 5),
  async (req, res) => {
    await handleChat(
      req,
      res,
      req.files || []
    );
  }
);

// ============================================================
// GERADOR DE IMAGENS
// ============================================================

async function generateImage(prompt) {
  if (
    !CF_ACCOUNT_ID ||
    !CF_API_TOKEN
  ) {
    throw new Error(
      "Cloudflare não configurado."
    );
  }

  if (!prompt) {
    throw new Error(
      "Prompt da imagem não informado."
    );
  }

  const url =
    `https://api.cloudflare.com/client/v4/accounts/` +
    `${CF_ACCOUNT_ID}/ai/run/` +
    `${IMAGE_MODEL}`;

  const response =
    await fetch(url, {
      method: "POST",

      headers: {
        Authorization:
          `Bearer ${CF_API_TOKEN}`,

        "Content-Type":
          "application/json"
      },

      body: JSON.stringify({
        prompt: cleanText(prompt),
        steps: 4
      })
    });

  if (!response.ok) {
    const errorText =
      await response.text();

    throw new Error(
      `Cloudflare retornou ${response.status}: ${errorText}`
    );
  }

  const contentType =
    response.headers.get(
      "content-type"
    ) || "";

  if (
    contentType.includes("image/")
  ) {
    const buffer =
      Buffer.from(
        await response.arrayBuffer()
      );

    return {
      type: "image",
      mimeType: contentType,
      base64:
        buffer.toString("base64")
    };
  }

  const data =
    await response.json();

  return {
    type: "json",
    data
  };
}

// ============================================================
// IMAGENS API
// ============================================================

app.post(
  "/api/v1/images",
  authenticateUser,
  async (req, res) => {
    try {
      const prompt =
        cleanText(
          req.body?.prompt
        );

      if (!prompt) {
        return res.status(400).json({
          success: false,
          error:
            "Informe um prompt para gerar a imagem."
        });
      }

      const result =
        await generateImage(
          prompt
        );

      if (
        result.type === "image"
      ) {
        return res.json({
          success: true,

          model: IMAGE_MODEL,

          image:
            `data:${result.mimeType};base64,` +
            result.base64
        });
      }

      return res.json({
        success: true,

        model: IMAGE_MODEL,

        result: result.data
      });
    } catch (error) {
      console.error(
        "Erro gerando imagem:",
        error
      );

      return res.status(500).json({
        success: false,

        error:
          error?.message ||
          "Erro ao gerar imagem."
      });
    }
  }
);

// ============================================================
// ROTA LEGADA DE IMAGEM
// ============================================================

app.post(
  "/generate",
  authenticateUser,
  async (req, res) => {
    try {
      const prompt =
        cleanText(
          req.body?.prompt
        );

      if (!prompt) {
        return res.status(400).json({
          success: false,
          error:
            "Prompt não informado."
        });
      }

      const result =
        await generateImage(
          prompt
        );

      if (
        result.type === "image"
      ) {
        return res.json({
          success: true,

          image:
            `data:${result.mimeType};base64,` +
            result.base64
        });
      }

      return res.json({
        success: true,
        result: result.data
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error:
          error?.message ||
          "Erro ao gerar imagem."
      });
    }
  }
);

// ============================================================
// MEMÓRIA
// ============================================================

app.get(
  "/api/v1/memory",
  authenticateUser,
  (req, res) => {
    res.json({
      success: true,

      memory:
        getUserMemory(
          req.userId
        )
    });
  }
);

app.post(
  "/api/v1/memory",
  authenticateUser,
  (req, res) => {
    const text =
      cleanText(
        req.body?.text
      );

    if (!text) {
      return res.status(400).json({
        success: false,
        error:
          "Texto da memória não informado."
      });
    }

    const memory =
      saveMemory(
        req.userId,
        text
      );

    res.json({
      success: true,
      memory
    });
  }
);

app.delete(
  "/api/v1/memory",
  authenticateUser,
  (req, res) => {
    memories.set(
      req.userId,
      []
    );

    res.json({
      success: true,

      memory: []
    });
  }
);

// ============================================================
// MEMÓRIA LEGADA
// ============================================================

app.get(
  "/memory",
  authenticateUser,
  (req, res) => {
    res.json({
      success: true,

      memory:
        getUserMemory(
          req.userId
        )
    });
  }
);

app.post(
  "/memory",
  authenticateUser,
  (req, res) => {
    const text =
      cleanText(
        req.body?.text
      );

    if (!text) {
      return res.status(400).json({
        success: false,
        error:
          "Texto não informado."
      });
    }

    res.json({
      success: true,

      memory:
        saveMemory(
          req.userId,
          text
        )
    });
  }
);

// ============================================================
// CONVERSAS
// ============================================================

app.get(
  "/api/v1/conversations",
  authenticateUser,
  (req, res) => {
    res.json({
      success: true,

      conversations:
        conversations.get(
          req.userId
        ) || []
    });
  }
);

app.delete(
  "/api/v1/conversations",
  authenticateUser,
  (req, res) => {
    conversations.set(
      req.userId,
      []
    );

    res.json({
      success: true,

      conversations: []
    });
  }
);

// ============================================================
// CONVERSAS LEGADAS
// ============================================================

app.get(
  "/conversations",
  authenticateUser,
  (req, res) => {
    res.json({
      success: true,

      conversations:
        conversations.get(
          req.userId
        ) || []
    });
  }
);

// ============================================================
// PROJETOS
// ============================================================

function getUserProjects(userId) {
  if (!projects.has(userId)) {
    projects.set(
      userId,
      []
    );
  }

  return projects.get(userId);
}

app.get(
  "/api/v1/projects",
  authenticateUser,
  (req, res) => {
    res.json({
      success: true,

      projects:
        getUserProjects(
          req.userId
        )
    });
  }
);

app.post(
  "/api/v1/projects",
  authenticateUser,
  (req, res) => {
    const name =
      cleanText(
        req.body?.name
      );

    const description =
      cleanText(
        req.body?.description
      );

    if (!name) {
      return res.status(400).json({
        success: false,
        error:
          "Nome do projeto não informado."
      });
    }

    const userProjects =
      getUserProjects(
        req.userId
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

    userProjects.push(
      project
    );

    res.json({
      success: true,

      project
    });
  }
);

app.delete(
  "/api/v1/projects/:id",
  authenticateUser,
  (req, res) => {
    const userProjects =
      getUserProjects(
        req.userId
      );

    const index =
      userProjects.findIndex(
        (project) =>
          project.id ===
          String(req.params.id)
      );

    if (index === -1) {
      return res.status(404).json({
        success: false,
        error:
          "Projeto não encontrado."
      });
    }

    userProjects.splice(
      index,
      1
    );

    res.json({
      success: true
    });
  }
);

// ============================================================
// PROJETOS LEGADOS
// ============================================================

app.get(
  "/projects",
  authenticateUser,
  (req, res) => {
    res.json({
      success: true,

      projects:
        getUserProjects(
          req.userId
        )
    });
  }
);

app.post(
  "/projects",
  authenticateUser,
  (req, res) => {
    const name =
      cleanText(
        req.body?.name
      );

    if (!name) {
      return res.status(400).json({
        success: false,
        error:
          "Nome do projeto não informado."
      });
    }

    const project = {
      id:
        Date.now().toString(),

      name,

      description:
        cleanText(
          req.body?.description
        ),

      createdAt:
        new Date().toISOString()
    };

    getUserProjects(
      req.userId
    ).push(project);

    res.json({
      success: true,
      project
    });
  }
);

// ============================================================
// ADMIN / DIAGNÓSTICO
// ============================================================

app.get(
  "/admin/repair",
  (req, res) => {
    res.json({
      success: true,

      message:
        "Endpoint de diagnóstico da Adaptra.AI.",

      version: "4.5.5",

      checks: {
        huggingface:
          Boolean(HF_TOKEN),

        visionModel:
          HF_CHAT_MODEL.includes(
            "Qwen3-VL"
          ),

        cloudflare:
          Boolean(
            CF_ACCOUNT_ID &&
            CF_API_TOKEN
          ),

        supabase:
          Boolean(
            SUPABASE_URL &&
            SUPABASE_KEY
          )
      }
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

      path: req.originalUrl
    });
  }
);

// ============================================================
// TRATAMENTO DE ERROS
// ============================================================

app.use(
  (error, req, res, next) => {
    console.error(
      "Erro geral:",
      error
    );

    if (
      error.code ===
      "LIMIT_FILE_SIZE"
    ) {
      return res.status(413).json({
        success: false,

        error:
          "Arquivo muito grande. Limite de 8 MB por arquivo."
      });
    }

    if (
      error.code ===
      "LIMIT_FILE_COUNT"
    ) {
      return res.status(400).json({
        success: false,

        error:
          "Limite de 5 arquivos por envio."
      });
    }

    return res.status(500).json({
      success: false,

      error:
        error?.message ||
        "Erro interno do servidor."
    });
  }
);

// ============================================================
// INICIALIZAÇÃO
// ============================================================

app.listen(
  PORT,
  () => {
    console.log(
      "=================================================="
    );

    console.log(
      "Adaptra.AI Backend 4.5.5"
    );

    console.log(
      "Empresa: Adaptrium AI"
    );

    console.log(
      `Porta: ${PORT}`
    );

    console.log(
      `Modelo chat: ${HF_CHAT_MODEL}`
    );

    console.log(
      `Modelo imagem: ${IMAGE_MODEL}`
    );

    console.log(
      `Vision: ATIVADO`
    );

    console.log(
      `Hugging Face: ${
        HF_TOKEN
          ? "CONFIGURADO"
          : "NÃO CONFIGURADO"
      }`
    );

    console.log(
      `Cloudflare: ${
        CF_ACCOUNT_ID &&
        CF_API_TOKEN
          ? "CONFIGURADO"
          : "NÃO CONFIGURADO"
      }`
    );

    console.log(
      `Supabase: ${
        SUPABASE_KEY
          ? "CONFIGURADO"
          : "NÃO CONFIGURADO"
      }`
    );

    console.log(
      "=================================================="
    );
  }
);
