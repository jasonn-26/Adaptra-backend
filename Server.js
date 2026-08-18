"use strict";

const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");

const app = express();

const PORT = process.env.PORT || 3000;

// ============================================================
// CONFIGURAÇÃO
// ============================================================

const HF_TOKEN = process.env.HF_TOKEN;

const HF_CHAT_MODEL =
  process.env.HF_CHAT_MODEL ||
  "meta-llama/Llama-3.1-8B-Instruct";

const SUPABASE_URL =
  process.env.SUPABASE_URL;

const SUPABASE_SECRET_KEY =
  process.env.SUPABASE_SECRET_KEY;

const CF_ACCOUNT_ID =
  process.env.CF_ACCOUNT_ID;

const CF_API_TOKEN =
  process.env.CF_API_TOKEN;

const CF_IMAGE_MODEL =
  process.env.CF_IMAGE_MODEL ||
  "@cf/black-forest-labs/flux-1-schnell";


// ============================================================
// SUPABASE
// ============================================================

let supabaseAdmin = null;

if (
  SUPABASE_URL &&
  SUPABASE_SECRET_KEY
) {
  supabaseAdmin = createClient(
    SUPABASE_URL,
    SUPABASE_SECRET_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    }
  );
}


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
// MEMÓRIA TEMPORÁRIA
// ============================================================

const memoryStore =
  new Map();

const conversationsStore =
  new Map();

const projectsStore =
  new Map();


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


// ============================================================
// AUTENTICAÇÃO SUPABASE
// ============================================================
//
// O frontend envia:
//
// Authorization: Bearer JWT
//
// O backend valida esse JWT usando o Supabase.
// ============================================================

async function authenticate(req, res, next) {

  try {

    if (!supabaseAdmin) {

      return res.status(500).json({
        success: false,
        error:
          "Supabase não está configurado no Render."
      });

    }

    const auth =
      req.headers.authorization || "";

    if (!auth.startsWith("Bearer ")) {

      return res.status(401).json({
        success: false,
        error:
          "Autenticação necessária."
      });

    }

    const token =
      auth.substring(7).trim();

    if (!token) {

      return res.status(401).json({
        success: false,
        error:
          "Token de autenticação ausente."
      });

    }

    const {
      data,
      error
    } =
      await supabaseAdmin.auth.getUser(
        token
      );

    if (
      error ||
      !data ||
      !data.user
    ) {

      return res.status(401).json({
        success: false,
        error:
          "Sessão inválida ou expirada."
      });

    }

    req.user =
      data.user;

    req.userId =
      data.user.id;

    next();

  } catch (error) {

    console.error(
      "AUTH ERROR:",
      error
    );

    return res.status(401).json({
      success: false,
      error:
        "Não foi possível validar a sessão."
    });

  }
}


// ============================================================
// HOME
// ============================================================

app.get("/", (req, res) => {

  res.json({

    success: true,

    name:
      "Adaptra.AI",

    version:
      "3.6",

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

      authRegister:
        "/auth/register",

      authLogin:
        "/auth/login",

      authMe:
        "/auth/me",

      authLogout:
        "/auth/logout",

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

    success:
      true,

    status:
      "online",

    service:
      "Adaptra.AI Backend",

    version:
      "3.6",

    provider: {

      chat:
        "Hugging Face",

      image:
        "Cloudflare Workers AI",

      auth:
        "Supabase"

    },

    chatModel:
      HF_CHAT_MODEL,

    imageModel:
      CF_IMAGE_MODEL,

    apiConfigured: {

      huggingFace:
        !!HF_TOKEN,

      cloudflare:
        !!(
          CF_ACCOUNT_ID &&
          CF_API_TOKEN
        ),

      supabase:
        !!(
          SUPABASE_URL &&
          SUPABASE_SECRET_KEY
        )

    },

    features: {

      chat:
        true,

      imageGeneration:
        true,

      authentication:
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


// ============================================================
// AUTH — REGISTRAR
// ============================================================
//
// O frontend pode usar diretamente o Supabase Auth.
// Esta rota também permite cadastro pelo backend.
// ============================================================

app.post(
  "/auth/register",
  async (req, res) => {

    try {

      if (!supabaseAdmin) {

        return res.status(500).json({
          success: false,
          error:
            "Supabase não está configurado."
        });

      }

      const {
        email,
        password
      } = req.body;

      if (
        !email ||
        !password
      ) {

        return res.status(400).json({
          success: false,
          error:
            "E-mail e senha são obrigatórios."
        });

      }

      if (
        String(password).length < 6
      ) {

        return res.status(400).json({
          success: false,
          error:
            "A senha deve ter pelo menos 6 caracteres."
        });

      }

      const {
        data,
        error
      } =
        await supabaseAdmin.auth.admin.createUser({
          email:
            String(email)
              .trim()
              .toLowerCase(),

          password:
            String(password),

          email_confirm:
            true
        });

      if (error) {

        return res.status(400).json({
          success: false,
          error:
            error.message
        });

      }

      return res.status(201).json({

        success:
          true,

        message:
          "Conta criada com sucesso.",

        user: {

          id:
            data.user.id,

          email:
            data.user.email

        }

      });

    } catch (error) {

      console.error(
        "REGISTER ERROR:",
        error
      );

      return res.status(500).json({

        success:
          false,

        error:
          error.message ||
          "Erro ao criar conta."

      });

    }

  }
);


// ============================================================
// AUTH — LOGIN
// ============================================================
//
// Recomendado: o frontend faz login diretamente pelo Supabase.
// Esta rota existe para facilitar futuras integrações.
// ============================================================

app.post(
  "/auth/login",
  async (req, res) => {

    try {

      if (!supabaseAdmin) {

        return res.status(500).json({
          success: false,
          error:
            "Supabase não está configurado."
        });

      }

      const {
        email,
        password
      } = req.body;

      if (
        !email ||
        !password
      ) {

        return res.status(400).json({
          success: false,
          error:
            "E-mail e senha são obrigatórios."
        });

      }

      /*
       * Para login de usuário,
       * o ideal é usar o cliente público
       * do Supabase no frontend.
       *
       * Não usamos a Secret Key para entregar
       * sessão diretamente pelo backend.
       */

      return res.status(400).json({

        success:
          false,

        error:
          "Faça o login pelo Supabase Auth no frontend."

      });

    } catch (error) {

      console.error(
        "LOGIN ERROR:",
        error
      );

      return res.status(500).json({

        success:
          false,

        error:
          "Erro no login."

      });

    }

  }
);


// ============================================================
// AUTH — USUÁRIO ATUAL
// ============================================================

app.get(
  "/auth/me",
  authenticate,
  (req, res) => {

    res.json({

      success:
        true,

      user: {

        id:
          req.user.id,

        email:
          req.user.email,

        createdAt:
          req.user.created_at,

        lastSignIn:
          req.user.last_sign_in_at

      }

    });

  }
);


// ============================================================
// AUTH — LOGOUT
// ============================================================

app.post(
  "/auth/logout",
  authenticate,
  async (req, res) => {

    /*
     * A sessão fica armazenada no frontend pelo Supabase.
     * O logout efetivo da sessão deve ser feito com:
     *
     * supabase.auth.signOut()
     *
     * Aqui apenas confirmamos que o usuário está autenticado.
     */

    res.json({

      success:
        true,

      message:
        "Sessão pronta para encerramento."

    });

  }
);


// ============================================================
// CHAT
// ============================================================

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

      const userId =
        req.userId;

      if (
        !message ||
        !String(message).trim()
      ) {

        return res.status(400).json({

          success:
            false,

          error:
            "Mensagem vazia."

        });

      }

      if (!HF_TOKEN) {

        return res.status(500).json({

          success:
            false,

          error:
            "HF_TOKEN não está configurado no Render."

        });

      }


      // ------------------------------------------------------
      // HISTÓRICO
      // ------------------------------------------------------

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


      // ------------------------------------------------------
      // CONVERSA SALVA
      // ------------------------------------------------------

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


      // ------------------------------------------------------
      // MEMÓRIAS
      // ------------------------------------------------------

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


      const systemPrompt = `Você é a Adaptra.AI, uma inteligência artificial brasileira.

Responda em português do Brasil.

Seja amigável, inteligente, clara e objetiva.

Ajude o usuário com programação, projetos, jogos, ideias e assuntos gerais.

Não invente informações quando não tiver certeza.

MEMÓRIAS DISPONÍVEIS:
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


      // ------------------------------------------------------
      // HUGGING FACE
      // ------------------------------------------------------

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
                  1200

              })

          }
        );


      let data;

      try {

        data =
          await response.json();

      } catch {

        return res.status(500).json({

          success:
            false,

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

          success:
            false,

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

          success:
            false,

          error:
            "A IA não retornou uma resposta."

        });

      }


      // ------------------------------------------------------
      // SALVAR CONVERSA
      // ------------------------------------------------------

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

        userId,

        memoriesUsed:
          userMemories.length

      });

    } catch (error) {

      console.error(
        "CHAT ERROR:",
        error
      );

      return res.status(500).json({

        success:
          false,

        error:
          error.message ||
          "Erro interno no chat."

      });

    }

  }
);


// ============================================================
// GERAÇÃO DE IMAGEM — CLOUDFLARE WORKERS AI
// ============================================================

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

          success:
            false,

          error:
            "Descreva a imagem que deseja criar."

        });

      }


      if (
        !CF_ACCOUNT_ID ||
        !CF_API_TOKEN
      ) {

        return res.status(500).json({

          success:
            false,

          error:
            "Cloudflare Workers AI não está configurado no Render."

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
                "application/json"

            },

            body:
              JSON.stringify({

                prompt:
                  String(prompt)

              })

          }
        );


      const contentType =
        response.headers.get(
          "content-type"
        ) || "";


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

          success:
            false,

          error:
            errorText ||
            "Erro na geração da imagem."

        });

      }


      // ------------------------------------------------------
      // CLOUDFLARE NORMALMENTE RETORNA IMAGEM BINÁRIA
      // ------------------------------------------------------

      if (
        contentType.includes(
          "image/"
        )
      ) {

        const arrayBuffer =
          await response.arrayBuffer();

        const buffer =
          Buffer.from(
            arrayBuffer
          );


        if (!buffer.length) {

          return res.status(500).json({

            success:
              false,

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


      // ------------------------------------------------------
      // CASO CLOUDFLARE RETORNE JSON
      // ------------------------------------------------------

      const data =
        await response.json();


      if (
        data?.success === false
      ) {

        return res.status(500).json({

          success:
            false,

          error:
            data?.errors?.[0]?.message ||
            "Cloudflare não conseguiu gerar a imagem."

        });

      }


      // Algumas respostas podem vir em formato
      // JSON/base64.

      const result =
        data?.result;


      if (
        result &&
        typeof result === "object"
      ) {

        if (
          result.image
        ) {

          return res.json({

            success:
              true,

            image:
              result.image

          });

        }

        if (
          result.b64_json
        ) {

          return res.json({

            success:
              true,

            b64_json:
              result.b64_json

          });

        }

      }


      return res.status(500).json({

        success:
          false,

        error:
          "A Cloudflare respondeu, mas não retornou uma imagem reconhecível."

      });

    } catch (error) {

      console.error(
        "IMAGE ERROR:",
        error
      );

      return res.status(500).json({

        success:
          false,

        error:
          error.message ||
          "Erro interno na geração da imagem."

      });

    }

  }
);


// ============================================================
// MEMÓRIA — LISTAR
// ============================================================

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

      userId,

      count:
        memories.length,

      memories

    });

  }
);


// ============================================================
// MEMÓRIA — SALVAR
// ============================================================

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

        success:
          false,

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

      memory:
        memories[memories.length - 1]

    });

  }
);


// ============================================================
// MEMÓRIA — APAGAR
// ============================================================

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

        success:
          false,

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


// ============================================================
// CONVERSAS — CRIAR
// ============================================================

app.post(
  "/conversations",
  authenticate,
  (req, res) => {

    const userId =
      req.userId;

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
  authenticate,
  (req, res) => {

    const userId =
      req.userId;


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

        success:
          false,

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

        success:
          false,

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
  authenticate,
  (req, res) => {

    const userId =
      req.userId;

    const {
      name,
      description = ""
    } = req.body;


    if (
      !name ||
      !String(name).trim()
    ) {

      return res.status(400).json({

        success:
          false,

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
  authenticate,
  (req, res) => {

    const userId =
      req.userId;


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

        success:
          false,

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

        success:
          false,

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

        success:
          false,

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

      success:
        false,

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

      success:
        false,

      error:
        error.message ||
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
      `🚀 Porta: ${PORT}`
    );

    console.log(
      `🧠 Chat: ${HF_CHAT_MODEL}`
    );

    console.log(
      `🎨 Imagem: ${CF_IMAGE_MODEL}`
    );

    console.log(
      `🔐 Supabase: ${
        supabaseAdmin
          ? "CONFIGURADO"
          : "NÃO CONFIGURADO"
      }`
    );

    console.log(
      "========================================"
    );

  }
);
