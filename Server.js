"use strict";

/*
===========================================================
 ADAPTRA.AI BACKEND 4.4
===========================================================

Rotas:

GET  /health
GET  /test
POST /chat
POST /generate
GET  /memory
POST /memory
DELETE /memory
GET  /conversations
POST /conversations
GET  /projects
POST /projects
GET  /admin/repair

IMPORTANTE:
- Não coloque tokens neste arquivo.
- Configure as variáveis no Render.
===========================================================
*/

const express = require("express");
const cors = require("cors");

const {
  InferenceClient
} = require("@huggingface/inference");


/* =========================================================
   APP
========================================================= */

const app = express();

const PORT =
  Number(process.env.PORT) || 10000;


/* =========================================================
   CORS
========================================================= */

app.use(
  cors({
    origin: true,
    methods: [
      "GET",
      "POST",
      "PUT",
      "DELETE",
      "OPTIONS"
    ],
    allowedHeaders: [
      "Content-Type",
      "Authorization"
    ]
  })
);


/* =========================================================
   BODY
========================================================= */

app.use(
  express.json({
    limit: "10mb"
  })
);


/* =========================================================
   LOG
========================================================= */

app.use(
  (req, res, next) => {

    const started =
      Date.now();

    res.on(
      "finish",
      () => {

        console.log(
          `${req.method} ${req.originalUrl} ` +
          `${res.statusCode} ` +
          `${Date.now() - started}ms`
        );

      }
    );

    next();

  }
);


/* =========================================================
   CONFIGURAÇÃO
========================================================= */

/*
   Hugging Face
*/

const HF_TOKEN =
  process.env.HF_TOKEN ||
  process.env.HUGGINGFACE_TOKEN ||
  process.env.HF_API_TOKEN ||
  "";

const HF_MODEL =
  process.env.HF_MODEL ||
  "Qwen/Qwen3-32B";


/*
   Cloudflare
*/

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


/*
   Memória simples do backend.
   Futuramente podemos migrar para banco.
*/

const memoryStore =
  new Map();


const conversationStore =
  new Map();


const projectStore =
  new Map();


/* =========================================================
   HUGGING FACE CLIENT
========================================================= */

let hf = null;

if (HF_TOKEN) {

  hf =
    new InferenceClient(
      HF_TOKEN
    );

  console.log(
    "🤗 Hugging Face configurado."
  );

} else {

  console.warn(
    "⚠️ HF_TOKEN não configurado."
  );

}


/* =========================================================
   FUNÇÕES AUXILIARES
========================================================= */

function cleanText(
  value,
  max = 12000
){

  return String(
    value ?? ""
  )
    .trim()
    .slice(0, max);

}


function safeId(
  value,
  fallback = "default"
){

  const id =
    cleanText(
      value,
      100
    );

  return id || fallback;

}


function getConversationId(
  req
){

  return safeId(
    req.body?.conversationId ||
    req.query?.conversationId ||
    "adaptra-main"
  );

}


function getUserId(
  req
){

  return safeId(
    req.body?.userId ||
    req.query?.userId ||
    "default-user"
  );

}


/* =========================================================
   HEALTH
========================================================= */

app.get(
  "/health",
  (req, res) => {

    const cloudflareReady =
      Boolean(
        CF_ACCOUNT_ID &&
        CF_API_TOKEN
      );

    const huggingFaceReady =
      Boolean(
        HF_TOKEN
      );

    res.json({

      success: true,

      name:
        "Adaptra.AI",

      version:
        "4.4",

      message:
        "Backend da Adaptra.AI está funcionando.",

      provider: {

        chat:
          "Hugging Face",

        image:
          "Cloudflare Workers AI"

      },

      configured: {

        chat:
          huggingFaceReady,

        image:
          cloudflareReady

      },

      models: {

        chat:
          HF_MODEL,

        image:
          CF_IMAGE_MODEL

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

  }
);


/* =========================================================
   TEST
========================================================= */

app.get(
  "/test",
  (req, res) => {

    res.json({

      success: true,

      name:
        "Adaptra.AI",

      version:
        "4.4",

      server:
        "online",

      time:
        new Date().toISOString(),

      cloudflare:
        Boolean(
          CF_ACCOUNT_ID &&
          CF_API_TOKEN
        ),

      huggingface:
        Boolean(
          HF_TOKEN
        )

    });

  }
);


/* =========================================================
   CHAT
========================================================= */

app.post(
  "/chat",
  async (req, res) => {

    try {

      const message =
        cleanText(
          req.body?.message,
          12000
        );

      if (!message) {

        return res.status(400).json({

          success:
            false,

          error:
            "Digite uma mensagem."

        });

      }


      if (!HF_TOKEN || !hf) {

        return res.status(503).json({

          success:
            false,

          error:
            "Hugging Face não está configurado no backend.",

          hint:
            "Configure HF_TOKEN nas Environment Variables do Render."

        });

      }


      const conversationId =
        getConversationId(
          req
        );


      let history =
        Array.isArray(
          req.body?.history
        )
          ? req.body.history
          : [];


      /*
        Limita o histórico para evitar
        requisições gigantes.
      */

      history =
        history
          .filter(
            item =>
              item &&
              (
                item.role === "user" ||
                item.role === "assistant" ||
                item.role === "system"
              ) &&
              item.content
          )
          .slice(-12)
          .map(
            item => ({

              role:
                item.role,

              content:
                cleanText(
                  item.content,
                  8000
                )

            })
          );


      const messages = [

        {
          role:
            "system",

          content:
`Você é a Adaptra.AI 4.4, uma assistente de inteligência artificial criada para conversar em português do Brasil.

Seja útil, clara e objetiva.

Ajude com programação, desenvolvimento de jogos, projetos, ideias, estudos e tarefas gerais.

Quando o usuário pedir código, forneça código funcional e explique as partes importantes.

Não invente que executou algo quando não executou.

Não revele tokens, chaves secretas ou variáveis de ambiente.`

        },

        ...history,

        {

          role:
            "user",

          content:
            message

        }

      ];


      console.log(
        "🤖 Chat:",
        HF_MODEL
      );


      const result =
        await hf.chatCompletion({

          model:
            HF_MODEL,

          messages,

          max_tokens:
            1200,

          temperature:
            0.7

        });


      let reply =
        result
          ?.choices?.[0]
          ?.message
          ?.content;


      /*
        Alguns modelos podem devolver
        conteúdo em formatos diferentes.
      */

      if (
        Array.isArray(
          reply
        )
      ){

        reply =
          reply
            .map(
              item =>
                typeof item === "string"
                  ? item
                  : item?.text || ""
            )
            .join("");

      }


      reply =
        cleanText(
          reply,
          20000
        );


      /*
        Remove blocos <think>
        caso o modelo envie raciocínio
        nesse formato.
      */

      reply =
        reply
          .replace(
            /<think>[\s\S]*?<\/think>/gi,
            ""
          )
          .trim();


      if (!reply) {

        throw new Error(
          "A Hugging Face não retornou uma resposta."
        );

      }


      /*
        Salva conversa no backend.
      */

      const previous =
        conversationStore.get(
          conversationId
        ) || [];


      previous.push(

        {
          role:
            "user",

          content:
            message,

          timestamp:
            new Date().toISOString()

        },

        {
          role:
            "assistant",

          content:
            reply,

          timestamp:
            new Date().toISOString()

        }

      );


      conversationStore.set(
        conversationId,
        previous.slice(-50)
      );


      return res.json({

        success:
          true,

        reply,

        response:
          reply,

        model:
          HF_MODEL

      });


    } catch (error) {

      console.error(
        "❌ CHAT ERROR:",
        error
      );


      return res.status(500).json({

        success:
          false,

        error:
          error?.message ||
          "Erro ao conversar com a Hugging Face."

      });

    }

  }
);


/* =========================================================
   GERAÇÃO DE IMAGEM
========================================================= */

app.post(
  "/generate",
  async (req, res) => {

    try {

      const prompt =
        cleanText(
          req.body?.prompt,
          2048
        );


      if (!prompt) {

        return res.status(400).json({

          success:
            false,

          error:
            "Digite uma descrição para a imagem."

        });

      }


      if (
        !CF_ACCOUNT_ID ||
        !CF_API_TOKEN
      ) {

        return res.status(503).json({

          success:
            false,

          error:
            "Cloudflare Workers AI não está configurada.",

          hint:
            "Configure CF_ACCOUNT_ID e CF_API_TOKEN no Render."

        });

      }


      /*
        Endpoint oficial do Workers AI.

        NÃO coloque /v1 aqui.

        O formato correto é:

        /accounts/{ACCOUNT_ID}/ai/run/{MODEL}
      */

      const url =
        "https://api.cloudflare.com/client/v4" +
        "/accounts/" +
        encodeURIComponent(
          CF_ACCOUNT_ID
        ) +
        "/ai/run/" +
        CF_IMAGE_MODEL;


      console.log(
        "🎨 Cloudflare image request"
      );

      console.log(
        "Model:",
        CF_IMAGE_MODEL
      );


      const cloudflareResponse =
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

                prompt,

                steps:
                  4,

                seed:
                  Math.floor(
                    Math.random() *
                    2147483647
                  )

              })

          }
        );


      const contentType =
        (
          cloudflareResponse
            .headers
            .get(
              "content-type"
            ) || ""
        ).toLowerCase();


      /*
        Lê o retorno uma única vez.
      */

      const raw =
        await cloudflareResponse.text();


      let data =
        null;


      try {

        data =
          raw
            ? JSON.parse(
                raw
              )
            : null;

      } catch {

        data =
          null;

      }


      /*
        Cloudflare HTTP error.
      */

      if (
        !cloudflareResponse.ok
      ) {

        console.error(
          "❌ CLOUDFLARE HTTP:",
          cloudflareResponse.status
        );

        console.error(
          "Cloudflare response:",
          raw.slice(
            0,
            5000
          )
        );


        let details =
          "Erro desconhecido da Cloudflare.";


        if (
          data?.errors &&
          Array.isArray(
            data.errors
          )
        ){

          details =
            data.errors
              .map(
                error =>
                  `${error.code || ""} ${error.message || ""}`
              )
              .join(
                " | "
              );

        }


        if (
          cloudflareResponse.status === 404
        ){

          return res.status(502).json({

            success:
              false,

            error:
              "A Cloudflare retornou 404 para o endpoint de IA.",

            details,

            model:
              CF_IMAGE_MODEL,

            hint:
              "Verifique CF_ACCOUNT_ID, CF_API_TOKEN e se o token possui Workers AI - Read e Workers AI - Edit."

          });

        }


        if (
          cloudflareResponse.status === 401 ||
          cloudflareResponse.status === 403
        ){

          return res.status(502).json({

            success:
              false,

            error:
              "A Cloudflare recusou o token.",

            details,

            hint:
              "Verifique o API Token e as permissões do Workers AI."

          });

        }


        return res.status(502).json({

          success:
            false,

          error:
            "Erro retornado pela Cloudflare.",

          details,

          status:
            cloudflareResponse.status

        });

      }


      /*
        Caso raro:
        Cloudflare devolveu uma imagem diretamente.
      */

      if (
        contentType.includes(
          "image/"
        )
      ){

        const buffer =
          Buffer.from(
            raw,
            "binary"
          );


        return res.json({

          success:
            true,

          image:
            `data:${contentType};base64,${buffer.toString("base64")}`,

          prompt,

          model:
            CF_IMAGE_MODEL

        });

      }


      /*
        Resultado normal do Workers AI:
        {
          result: {
            image: "BASE64..."
          },
          success: true
        }
      */

      if (
        !data ||
        data.success === false
      ){

        const details =
          data?.errors
            ?.map(
              e =>
                `${e.code || ""} ${e.message || ""}`
            )
            .join(
              " | "
            ) ||
          "A Cloudflare não retornou um resultado válido.";


        return res.status(502).json({

          success:
            false,

          error:
            "A Cloudflare não conseguiu gerar a imagem.",

          details

        });

      }


      const image =
        data?.result?.image;


      if (!image) {

        console.error(
          "❌ Resultado Cloudflare sem result.image:",
          data
        );


        return res.status(502).json({

          success:
            false,

          error:
            "A Cloudflare respondeu, mas não enviou a imagem.",

          details:
            data

        });

      }


      /*
        Entrega diretamente como
        Data URI para o HTML.
      */

      return res.json({

        success:
          true,

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

        success:
          false,

        error:
          error?.message ||
          "Erro interno na geração da imagem."

      });

    }

  }
);


/* =========================================================
   MEMÓRIA
========================================================= */

app.get(
  "/memory",
  (req, res) => {

    const userId =
      getUserId(
        req
      );

    res.json({

      success:
        true,

      memory:
        memoryStore.get(
          userId
        ) || {}

    });

  }
);


app.post(
  "/memory",
  (req, res) => {

    const userId =
      getUserId(
        req
      );


    const current =
      memoryStore.get(
        userId
      ) || {};


    const incoming =
      req.body?.memory;


    if (
      incoming &&
      typeof incoming === "object"
    ){

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

      success:
        true,

      memory:
        current

    });

  }
);


app.delete(
  "/memory",
  (req, res) => {

    const userId =
      getUserId(
        req
      );


    memoryStore.delete(
      userId
    );


    res.json({

      success:
        true,

      message:
        "Memória apagada."

    });

  }
);


/* =========================================================
   CONVERSAS
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

      success:
        true,

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

      success:
        true,

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
      getUserId(
        req
      );


    res.json({

      success:
        true,

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
      getUserId(
        req
      );


    const project =
      req.body?.project;


    if (
      !project ||
      typeof project !== "object"
    ){

      return res.status(400).json({

        success:
          false,

        error:
          "Projeto inválido."

      });

    }


    const projects =
      projectStore.get(
        userId
      ) || [];


    projects.push({

      ...project,

      id:
        project.id ||
        `project-${Date.now()}`,

      createdAt:
        project.createdAt ||
        new Date().toISOString()

    });


    projectStore.set(
      userId,
      projects.slice(-100)
    );


    res.json({

      success:
        true,

      project:
        projects[
          projects.length - 1
        ]

    });

  }
);


/* =========================================================
   REPAIR MODE
========================================================= */

app.get(
  "/admin/repair",
  async (req, res) => {

    const result = {

      server:
        true,

      huggingface:
        false,

      cloudflare:
        false

    };


    /*
      Teste simples da configuração
      do Hugging Face.
    */

    result.huggingface =
      Boolean(
        HF_TOKEN &&
        hf
      );


    /*
      Teste simples da configuração
      Cloudflare.

      Não gera imagem aqui para
      não gastar créditos.
    */

    result.cloudflare =
      Boolean(
        CF_ACCOUNT_ID &&
        CF_API_TOKEN
      );


    res.json({

      success:
        true,

      mode:
        "repair",

      version:
        "4.4",

      checks:
        result,

      recommendations: [

        !result.huggingface
          ? "Configure HF_TOKEN."
          : "Hugging Face configurado.",

        !result.cloudflare
          ? "Configure CF_ACCOUNT_ID e CF_API_TOKEN."
          : "Cloudflare configurada."

      ]

    });

  }
);


/* =========================================================
   404
========================================================= */

app.use(
  (req, res) => {

    res.status(404).json({

      success:
        false,

      error:
        "Rota não encontrada.",

      path:
        req.originalUrl,

      method:
        req.method

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
    ){

      return next(
        error
      );

    }


    res.status(500).json({

      success:
        false,

      error:
        error?.message ||
        "Erro interno do servidor."

    });

  }
);


/* =========================================================
   START
========================================================= */

app.listen(
  PORT,
  () => {

    console.log(
      "=========================================="
    );

    console.log(
      "🤖 Adaptra.AI Backend"
    );

    console.log(
      "📦 Version: 4.4"
    );

    console.log(
      "🚀 Port:",
      PORT
    );

    console.log(
      "=========================================="
    );

    console.log(
      "Chat:",
      HF_TOKEN
        ? "✅ configurado"
        : "❌ sem HF_TOKEN"
    );

    console.log(
      "Image:",
      CF_ACCOUNT_ID &&
      CF_API_TOKEN
        ? "✅ configurado"
        : "❌ sem Cloudflare"
    );

    console.log(
      "Image model:",
      CF_IMAGE_MODEL
    );

    console.log(
      "=========================================="
    );

  }
);
