"use strict";

const express = require("express");
const cors = require("cors");

const app = express();

const PORT = process.env.PORT || 3000;

/* =========================================================
   CONFIGURAÇÃO
========================================================= */

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
  "@cf/black-forest-labs/FLUX-1-schnell";

const SUPABASE_URL =
  process.env.SUPABASE_URL;

const SUPABASE_SECRET_KEY =
  process.env.SUPABASE_SECRET_KEY;

const FRONTEND_URL =
  process.env.FRONTEND_URL || "*";


/* =========================================================
   MIDDLEWARE
========================================================= */

app.use(
  cors({
    origin: FRONTEND_URL === "*"
      ? true
      : FRONTEND_URL,
    credentials: true
  })
);

app.use(
  express.json({
    limit: "10mb"
  })
);

app.disable("x-powered-by");


/* =========================================================
   BANCO TEMPORÁRIO
========================================================= */

const memoryStore =
  new Map();

const conversationsStore =
  new Map();

const projectsStore =
  new Map();


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
    Math.random()
      .toString(36)
      .slice(2, 9)
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


/* =========================================================
   AUTENTICAÇÃO SUPABASE
========================================================= */

async function authenticate(req, res, next) {

  try {

    /*
      Permite que o frontend envie:

      Authorization: Bearer TOKEN
    */

    const authorization =
      req.headers.authorization || "";

    if (
      !authorization.startsWith("Bearer ")
    ) {

      return res.status(401).json({

        success: false,

        error:
          "Login necessário."

      });

    }


    if (
      !SUPABASE_URL ||
      !SUPABASE_SECRET_KEY
    ) {

      return res.status(500).json({

        success: false,

        error:
          "Supabase não está configurado no servidor."

      });

    }


    const token =
      authorization
        .slice(7)
        .trim();


    if (!token) {

      return res.status(401).json({

        success: false,

        error:
          "Token de autenticação ausente."

      });

    }


    /*
      Verificação através do endpoint
      oficial de autenticação do Supabase.
    */

    const response =
      await fetch(
        SUPABASE_URL +
        "/auth/v1/user",
        {

          method: "GET",

          headers: {

            "Authorization":
              `Bearer ${token}`,

            "apikey":
              SUPABASE_SECRET_KEY

          }

        }
      );


    if (!response.ok) {

      return res.status(401).json({

        success: false,

        error:
          "Sessão inválida ou expirada."

      });

    }


    const user =
      await response.json();


    if (
      !user ||
      !user.id
    ) {

      return res.status(401).json({

        success: false,

        error:
          "Usuário inválido."

      });

    }


    req.user = user;

    req.userId = user.id;

    next();

  } catch (error) {

    console.error(
      "AUTH ERROR:",
      error
    );

    return res.status(401).json({

      success: false,

      error:
        "Não foi possível validar sua sessão."

    });

  }

}


/* =========================================================
   HOME
========================================================= */

app.get("/", (req, res) => {

  res.json({

    success: true,

    name:
      "Adaptra.AI",

    version:
      "4.0",

    message:
      "Backend da Adaptra.AI está funcionando.",

    provider: {

      chat:
        "Hugging Face",

      image:
        "Cloudflare Workers AI",

      auth:
        "Supabase"

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


/* =========================================================
   HEALTH
========================================================= */

app.get("/health", (req, res) => {

  res.json({

    success: true,

    status:
      "online",

    service:
      "Adaptra.AI Backend",

    version:
      "4.0",

    provider: {

      chat:
        "Hugging Face",

      image:
        "Cloudflare Workers AI",

      auth:
        "Supabase"

    },

    models: {

      chat:
        HF_CHAT_MODEL,

      image:
        CF_IMAGE_MODEL

    },

    configured: {

      huggingFace:
        !!HF_TOKEN,

      cloudflare:
        !!CF_ACCOUNT_ID &&
        !!CF_API_TOKEN,

      supabase:
        !!SUPABASE_URL &&
        !!SUPABASE_SECRET_KEY

    },

    features: {

      login:
        true,

      chat:
        true,

      imageGeneration:
        true,

      memory:
        true,

      conversations:
        true,

      projects:
        true

    },

    timestamp:
      now()

  });

});


/* =========================================================
   USUÁRIO ATUAL
========================================================= */

app.get(
  "/me",
  authenticate,
  (req, res) => {

    res.json({

      success:
        true,

      user: {

        id:
          req.user.id,

        email:
          req.user.email || null,

        createdAt:
          req.user.created_at || null

      }

    });

  }
);


/* =========================================================
   CHAT
========================================================= */

app.post(
  "/chat",
  authenticate,
  async (req, res) => {

    try {

      const {
        message,
        history = [],
        conversationId
      } = req.body;


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


      const userId =
        req.userId;


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


      /*
        Se existir conversa, usamos o histórico
        salvo no backend.
      */

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
              .slice(-10);

        }

      }


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


      const systemPrompt = `
Você é a Adaptra.AI, uma inteligência artificial brasileira.

Responda em português do Brasil.

Seja amigável, inteligente, clara e objetiva.

Ajude o usuário com programação,
desenvolvimento de jogos,
projetos,
ideias,
tecnologia,
criação de conteúdo
e assuntos gerais.

Não invente informações quando não tiver certeza.

MEMÓRIAS DO USUÁRIO:

${memoryContext || "Nenhuma memória disponível."}
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


      const raw =
        await response.text();


      let data = {};

      try {

        data =
          raw
            ? JSON.parse(raw)
            : {};

      } catch {

        console.error(
          "HF RESPONSE:",
          raw
        );

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


      /*
        Salvar conversa.
      */

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
            conversation.messages
              .slice(-40);


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

  }
);


/* =========================================================
   GERAÇÃO DE IMAGEM — CLOUDFLARE
========================================================= */

app.post(
  "/generate",
  authenticate,
  async (req, res) => {

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
            "Cloudflare Workers AI não está configurado."

        });

      }


      console.log(
        "🎨 Gerando imagem:",
        CF_IMAGE_MODEL
      );


      const url =
        `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/run/${CF_IMAGE_MODEL}`;


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
                "application/json",

              "Accept":
                "image/png"

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
        "image/png";


      const arrayBuffer =
        await response.arrayBuffer();


      const buffer =
        Buffer.from(
          arrayBuffer
        );


      if (!buffer.length) {

        return res.status(500).json({

          success: false,

          error:
            "A Cloudflare não retornou uma imagem."

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

  }
);


/* =========================================================
   MEMÓRIA — LISTAR
========================================================= */

app.get(
  "/memory",
  authenticate,
  (req, res) => {

    const userId =
      req.userId;

    const memories =
      memoryStore.get(userId) || [];


    res.json({

      success:
        true,

      count:
        memories.length,

      memories

    });

  }
);


/* =========================================================
   MEMÓRIA — SALVAR
========================================================= */

app.post(
  "/memory",
  authenticate,
  (req, res) => {

    const userId =
      req.userId;

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

      success:
        true,

      message:
        "Memória salva.",

      memories

    });

  }
);


/* =========================================================
   MEMÓRIA — APAGAR
========================================================= */

app.delete(
  "/memory/:id",
  authenticate,
  (req, res) => {

    const userId =
      req.userId;

    const memories =
      memoryStore.get(userId) || [];


    const index =
      memories.findIndex(
        item =>
          item.id === req.params.id
      );


    if (
      index === -1
    ) {

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

      memory:
        removed

    });

  }
);


/* =========================================================
   MEMÓRIA — APAGAR TODAS
========================================================= */

app.delete(
  "/memory",
  authenticate,
  (req, res) => {

    memoryStore.delete(
      req.userId
    );


    res.json({

      success:
        true,

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
  authenticate,
  (req, res) => {

    const title =
      String(
        req.body?.title ||
        "Nova conversa"
      )
      .slice(0, 100);


    const conversation = {

      id:
        createId("conv"),

      userId:
        req.userId,

      title,

      messages: [],

      createdAt:
        now(),

      updatedAt:
        now()

    };


    conversationsStore.set(
      conversation.id,
      conversation
    );


    res.json({

      success:
        true,

      conversation

    });

  }
);


/* =========================================================
   CONVERSAS — LISTAR
========================================================= */

app.get(
  "/conversations",
  authenticate,
  (req, res) => {

    const conversations =
      Array.from(
        conversationsStore.values()
      )
      .filter(
        item =>
          item.userId === req.userId
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

      success:
        true,

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
  authenticate,
  (req, res) => {

    const conversation =
      conversationsStore.get(
        req.params.id
      );


    if (
      !conversation ||
      conversation.userId !== req.userId
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


/* =========================================================
   CONVERSA — APAGAR
========================================================= */

app.delete(
  "/conversations/:id",
  authenticate,
  (req, res) => {

    const conversation =
      conversationsStore.get(
        req.params.id
      );


    if (
      !conversation ||
      conversation.userId !== req.userId
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


/* =========================================================
   PROJETOS — CRIAR
========================================================= */

app.post(
  "/projects",
  authenticate,
  (req, res) => {

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

      userId:
        req.userId,

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


/* =========================================================
   PROJETOS — LISTAR
========================================================= */

app.get(
  "/projects",
  authenticate,
  (req, res) => {

    const projects =
      Array.from(
        projectsStore.values()
      )
      .filter(
        project =>
          project.userId === req.userId
      )
      .sort(
        (a, b) =>
          new Date(b.updatedAt) -
          new Date(a.updatedAt)
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


/* =========================================================
   PROJETO — ABRIR
========================================================= */

app.get(
  "/projects/:id",
  authenticate,
  (req, res) => {

    const project =
      projectsStore.get(
        req.params.id
      );


    if (
      !project ||
      project.userId !== req.userId
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


/* =========================================================
   PROJETO — ATUALIZAR
========================================================= */

app.patch(
  "/projects/:id",
  authenticate,
  (req, res) => {

    const project =
      projectsStore.get(
        req.params.id
      );


    if (
      !project ||
      project.userId !== req.userId
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
          .trim()
          .slice(0, 150);

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


/* =========================================================
   PROJETO — APAGAR
========================================================= */

app.delete(
  "/projects/:id",
  authenticate,
  (req, res) => {

    const project =
      projectsStore.get(
        req.params.id
      );


    if (
      !project ||
      project.userId !== req.userId
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


/* =========================================================
   ERRO 404
========================================================= */

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
   START
========================================================= */

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
      "📡 Porta:",
      PORT
    );

    console.log(
      "🤖 Chat:",
      HF_CHAT_MODEL
    );

    console.log(
      "🎨 Imagem:",
      CF_IMAGE_MODEL
    );

    console.log(
      "🔐 Supabase:",
      SUPABASE_URL
        ? "CONFIGURADO"
        : "NÃO CONFIGURADO"
    );

    console.log(
      "========================================"
    );

  }
);
