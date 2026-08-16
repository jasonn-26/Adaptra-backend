const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json({ limit: "10mb" }));

const PORT = process.env.PORT || 3000;

// =====================================================
// CONFIGURAÇÃO HUGGING FACE
// =====================================================

const HF_TOKEN = process.env.HF_TOKEN;

// Modelo de CHAT
const HF_CHAT_MODEL =
  process.env.HF_CHAT_MODEL ||
  "meta-llama/Llama-3.1-8B-Instruct";

// Modelo de IMAGEM
const HF_IMAGE_MODEL =
  process.env.HF_IMAGE_MODEL ||
  "black-forest-labs/FLUX.1-dev";

// =====================================================
// FUNÇÕES
// =====================================================

function cleanText(text) {
  return String(text || "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<\|im_end\|>/g, "")
    .replace(/<\|endoftext\|>/g, "")
    .trim();
}


// =====================================================
// HOME
// =====================================================

app.get("/", (req, res) => {

  res.json({
    success: true,
    name: "Adaptra.AI",
    version: "3.6",
    message: "Backend da Adaptra.AI está funcionando.",
    routes: {
      health: "/health",
      chat: "/chat",
      generate: "/generate"
    }
  });

});


// =====================================================
// HEALTH
// =====================================================

app.get("/health", (req, res) => {

  res.json({
    success: true,
    status: "online",

    service: "Adaptra.AI Backend",

    version: "3.6",

    provider: "Hugging Face",

    chatModel: HF_CHAT_MODEL,

    imageModel: HF_IMAGE_MODEL,

    apiConfigured: !!HF_TOKEN,

    timestamp: new Date().toISOString()
  });

});


// =====================================================
// CHAT — HUGGING FACE
// =====================================================

app.post("/chat", async (req, res) => {

  try {

    const {
      message,
      history = []
    } = req.body;


    // ---------------------------------------------
    // VALIDAÇÃO
    // ---------------------------------------------

    if (
      !message ||
      !String(message).trim()
    ) {

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


    // ---------------------------------------------
    // HISTÓRICO
    // ---------------------------------------------

    const safeHistory =
      Array.isArray(history)
        ? history
            .filter(item =>
              item &&
              (
                item.role === "user" ||
                item.role === "assistant"
              ) &&
              typeof item.content === "string"
            )
            .slice(-10)
        : [];


    const messages = [

      {
        role: "system",
        content:
          "Você é a Adaptra.AI, uma inteligência artificial brasileira. Responda em português do Brasil. Seja amigável, inteligente, clara e objetiva. Ajude o usuário com programação, projetos, jogos, ideias e assuntos gerais."
      },

      ...safeHistory,

      {
        role: "user",
        content: String(message)
      }

    ];


    // ---------------------------------------------
    // REQUEST HUGGING FACE
    // ---------------------------------------------

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

          body: JSON.stringify({

            model: HF_CHAT_MODEL,

            messages: messages,

            temperature: 0.7,

            max_tokens: 1000

          })

        }
      );


    // ---------------------------------------------
    // RESPOSTA
    // ---------------------------------------------

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
        "Hugging Face Chat:",
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
          "A Hugging Face não retornou uma resposta."

      });

    }


    return res.json({

      success: true,

      reply

    });

  } catch (error) {

    console.error(
      "Erro /chat:",
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


// =====================================================
// GERAÇÃO DE IMAGEM — HUGGING FACE
// =====================================================

app.post("/generate", async (req, res) => {

  try {

    const {
      prompt
    } = req.body;


    // ---------------------------------------------
    // VALIDAÇÃO
    // ---------------------------------------------

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


    if (!HF_TOKEN) {

      return res.status(500).json({

        success: false,

        error:
          "HF_TOKEN não está configurado no Render."

      });

    }


    console.log(
      "🎨 Gerando imagem com:",
      HF_IMAGE_MODEL
    );


    // ---------------------------------------------
    // REQUEST PARA HUGGING FACE
    // ---------------------------------------------

    const response =
      await fetch(

        `https://router.huggingface.co/hf-inference/models/${encodeURIComponent(HF_IMAGE_MODEL)}`,

        {

          method: "POST",

          headers: {

            "Authorization":
              `Bearer ${HF_TOKEN}`,

            "Content-Type":
              "application/json",

            "Accept":
              "image/png"

          },

          body: JSON.stringify({

            inputs:
              String(prompt)

          })

        }

      );


    // ---------------------------------------------
    // ERRO
    // ---------------------------------------------

    if (!response.ok) {

      let errorText = "";

      try {

        errorText =
          await response.text();

      } catch {}

      console.error(
        "Hugging Face Image:",
        errorText
      );

      return res.status(
        response.status
      ).json({

        success: false,

        error:
          errorText ||
          "Erro ao gerar imagem na Hugging Face."

      });

    }


    // ---------------------------------------------
    // PEGAR IMAGEM
    // ---------------------------------------------

    const contentType =
      response.headers.get(
        "content-type"
      ) || "image/png";


    const arrayBuffer =
      await response.arrayBuffer();


    const buffer =
      Buffer.from(arrayBuffer);


    if (!buffer.length) {

      return res.status(500).json({

        success: false,

        error:
          "A Hugging Face retornou uma imagem vazia."

      });

    }


    // ---------------------------------------------
    // ENVIAR IMAGEM PARA O FRONTEND
    // ---------------------------------------------

    res.setHeader(
      "Content-Type",
      contentType
    );

    res.setHeader(
      "Cache-Control",
      "no-store"
    );

    return res.send(buffer);

  } catch (error) {

    console.error(
      "Erro /generate:",
      error
    );

    return res.status(500).json({

      success: false,

      error:
        error.message ||
        "Erro interno na geração de imagem."

    });

  }

});


// =====================================================
// ROTA NÃO ENCONTRADA
// =====================================================

app.use((req, res) => {

  res.status(404).json({

    success: false,

    error:
      "Rota não encontrada."

  });

});


// =====================================================
// SERVIDOR
// =====================================================

app.listen(
  PORT,
  () => {

    console.log(
      "================================"
    );

    console.log(
      "🤖 Adaptra.AI 3.6"
    );

    console.log(
      "================================"
    );

    console.log(
      "Porta:",
      PORT
    );

    console.log(
      "Provider: Hugging Face"
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
      "Token:",
      HF_TOKEN
        ? "CONFIGURADO"
        : "NÃO CONFIGURADO"
    );

    console.log(
      "================================"
    );

  }
);
