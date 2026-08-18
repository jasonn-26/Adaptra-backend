"use strict";

const express = require("express");
const cors = require("cors");
const { InferenceClient } = require("@huggingface/inference");

const app = express();

const PORT = process.env.PORT || 3000;

// ============================================================
// MIDDLEWARE
// ============================================================

app.use(cors());

app.use(
  express.json({
    limit: "10mb"
  })
);


// ============================================================
// CONFIGURAÇÃO HUGGING FACE
// ============================================================

const HF_TOKEN = process.env.HF_TOKEN;

const HF_CHAT_MODEL =
  process.env.HF_CHAT_MODEL ||
  "meta-llama/Llama-3.1-8B-Instruct";

const HF_IMAGE_MODEL =
  process.env.HF_IMAGE_MODEL ||
  "black-forest-labs/FLUX.1-schnell";


// ============================================================
// CLIENT HUGGING FACE
// ============================================================

const hf = HF_TOKEN
  ? new InferenceClient(HF_TOKEN)
  : null;


// ============================================================
// MEMÓRIA TEMPORÁRIA
// ============================================================

const memoryStore = new Map();

const conversationsStore = new Map();

const projectsStore = new Map();


// ============================================================
// UTILIDADES
// ============================================================

function now() {
  return new Date().toISOString();
}


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

    version: "3.6",

    message:
      "Backend da Adaptra.AI está funcionando.",

    provider:
      "Hugging Face Inference Providers",

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


// ============================================================
// HEALTH
// ============================================================

app.get("/health", (req, res) => {

  res.json({

    success: true,

    status: "online",

    service:
      "Adaptra.AI Backend",

    version: "3.6",

    provider:
      "Hugging Face",

    chatModel:
      HF_CHAT_MODEL,

    imageModel:
      HF_IMAGE_MODEL,

    imageProvider:
      "auto",

    apiConfigured:
      !!HF_TOKEN,

    features: {

      chat: true,

      imageGeneration: true,

      memory: true,

      conversations: true,

      projects: true

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
      conversationId
    } = req.body;

    const userId =
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


    if (!HF_TOKEN || !hf) {

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
    // HISTÓRICO DA CONVERSA
    // --------------------------------------------------------

    if (conversationId) {

      const conversation =
        conversationsStore.get(
          conversationId
        );

      if (
        conversation &&
        conversation.userId === userId
      ) {

        safeHistory =
          conversation.messages
            .filter(item =>
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
      memoryStore.get(userId) || [];


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
    // SYSTEM PROMPT
    // --------------------------------------------------------

    const systemPrompt = `Você é a Adaptra.AI, uma inteligência artificial brasileira.

Responda sempre em português do Brasil.

Seja amigável, inteligente, clara e objetiva.

Ajude o usuário com programação, desenvolvimento de jogos, projetos, ideias e assuntos gerais.

Quando não souber algo, deixe isso claro.

Não invente informações.

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


    // --------------------------------------------------------
    // HUGGING FACE CHAT
    // --------------------------------------------------------

    const response =
      await fetch(
        "https://router.huggingface.co/v1/chat/completions",
        {

          method: "POST",

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
                1200

            })

        }
      );


    const raw =
      await response.text();


    let data;

    try {

      data =
        raw
          ? JSON.parse(raw)
          : {};

    } catch {

      console.error(
        "HF CHAT RAW:",
        raw
      );

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

          userId,

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
        conversation.userId === userId
      ) {

        conversation.messages.push(

          {
            role: "user",

            content:
              String(message),

            createdAt:
              now()

          },

          {
            role: "assistant",

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


// ============================================================
// GERAÇÃO DE IMAGEM
// ============================================================
//
// IMPORTANTE:
// Agora NÃO usamos:
// /hf-inference/models/
//
// Usamos o sistema atual de
// Hugging Face Inference Providers.
//
// Provider = auto
//
// Isso permite que o Hugging Face escolha
// um provedor compatível com o modelo.
//

app.post("/generate", async (req, res) => {

  try {

    const {
      prompt,
      negativePrompt,
      width,
      height,
      seed
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


    if (!HF_TOKEN || !hf) {

      return res.status(500).json({

        success: false,

        error:
          "HF_TOKEN não está configurado no Render."

      });

    }


    console.log(
      "🎨 Gerando imagem..."
    );

    console.log(
      "Modelo:",
      HF_IMAGE_MODEL
    );

    console.log(
      "Provider:",
      "auto"
    );


    // --------------------------------------------------------
    // GERAÇÃO
    // --------------------------------------------------------

    const image =
      await hf.textToImage({

        provider:
          "auto",

        model:
          HF_IMAGE_MODEL,

        inputs:
          String(prompt),

        parameters: {

          ...(negativePrompt
            ? {
                negative_prompt:
                  String(negativePrompt)
              }
            : {}),

          ...(Number.isInteger(width)
            ? {
                width
              }
            : {}),

          ...(Number.isInteger(height)
            ? {
                height
              }
            : {}),

          ...(Number.isInteger(seed)
            ? {
                seed
              }
            : {})

        }

      });


    // --------------------------------------------------------
    // CONVERTER IMAGEM PARA BUFFER
    // --------------------------------------------------------

    if (!image) {

      throw new Error(
        "O Hugging Face não retornou uma imagem."
      );

    }


    let buffer;


    // Blob / Response compatível

    if (
      typeof image.arrayBuffer ===
      "function"
    ) {

      const arrayBuffer =
        await image.arrayBuffer();

      buffer =
        Buffer.from(
          arrayBuffer
        );

    }

    // Buffer

    else if (
      Buffer.isBuffer(image)
    ) {

      buffer =
        image;

    }

    // Uint8Array

    else if (
      image instanceof Uint8Array
    ) {

      buffer =
        Buffer.from(image);

    }

    else {

      throw new Error(
        "Formato de imagem retornado pelo provedor não reconhecido."
      );

    }


    if (
      !buffer ||
      !buffer.length
    ) {

      throw new Error(
        "A imagem retornada está vazia."
      );

    }


    console.log(
      "✅ Imagem gerada:",
      buffer.length,
      "bytes"
    );


    // --------------------------------------------------------
    // RETORNAR IMAGEM
    // --------------------------------------------------------

    res.setHeader(
      "Content-Type",
      "image/png"
    );

    res.setHeader(
      "Cache-Control",
      "no-store"
    );

    res.setHeader(
      "Content-Length",
      buffer.length
    );


    return res.send(
      buffer
    );


  } catch (error) {

    console.error(
      "❌ IMAGE ERROR:"
    );

    console.error(
      error
    );


    return res.status(500).json({

      success: false,

      error:
        error.message ||
        "Erro na geração da imagem.",

      model:
        HF_IMAGE_MODEL,

      provider:
        "auto"

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
    memoryStore.get(userId) || [];


  res.json({

    success: true,

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
    !value
  ) {

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

    success: true,

    message:
      "Memória salva.",

    memory:
      memories[memories.length - 1]

  });

});


// ============================================================
// MEMÓRIA — APAGAR
// ============================================================

app.delete(
  "/memory/:id",
  (req, res) => {

    const userId =
      getUserId(req);

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
      memories.splice(
        index,
        1
      )[0];


    memoryStore.set(
      userId,
      memories
    );


    res.json({

      success: true,

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

      success: true,

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

      success: true,

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
          item.userId === userId
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

      context: "",

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

      success: true,

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
        String(name)
          .trim();

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
  "0.0.0.0",
  () => {

    console.log(
      "========================================"
    );

    console.log(
      "🚀 Adaptra.AI Backend"
    );

    console.log(
      "========================================"
    );

    console.log(
      "Porta:",
      PORT
    );

    console.log(
      "Chat:",
      HF_CHAT_MODEL
    );

    console.log(
      "Imagem:",
      HF_IMAGE_MODEL
    );

    console.log(
      "Image Provider: auto"
    );

    console.log(
      "HF Token:",
      HF_TOKEN
        ? "CONFIGURADO"
        : "NÃO CONFIGURADO"
    );

    console.log(
      "========================================"
    );

  }
);
