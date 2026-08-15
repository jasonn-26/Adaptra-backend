import express from "express";
import cors from "cors";
import { InferenceClient } from "@huggingface/inference";

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

const PORT = process.env.PORT || 3000;
const HF_TOKEN = process.env.HF_TOKEN;
const hf = HF_TOKEN ? new InferenceClient(HF_TOKEN) : null;

const CHAT_MODELS = [
  process.env.HF_CHAT_MODEL || "Qwen/Qwen3-32B",
  "openai/gpt-oss-120b"
];

const IMAGE_MODELS = [
  process.env.HF_IMAGE_MODEL || "black-forest-labs/FLUX.1-schnell",
  "black-forest-labs/FLUX.1-dev"
];

const SYSTEM_PROMPT = `Você é a Adaptra.AI, uma assistente brasileira criada por Jheymison.
Seja amigável, natural, inteligente e objetiva.
Entenda o contexto das mensagens anteriores e não repita perguntas já respondidas.
Se houver contexto suficiente, responda diretamente em vez de pedir mais explicações.
Faça perguntas apenas quando realmente faltar uma informação importante.
Perguntas simples devem receber respostas curtas; pedidos de detalhes podem receber respostas completas.
Nunca invente fatos. Se não souber, diga que não sabe.
Responda em português do Brasil, salvo pedido contrário.
Se perguntarem quem é seu criador, responda exatamente: "Meu criador é Jheymison."
Use o histórico da conversa enviado pelo aplicativo.`;

function cleanText(v) {
  return String(v ?? "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<\|im_end\|>/g, "")
    .replace(/<\|endoftext\|>/g, "")
    .trim();
}

function msgError(e) {
  return e?.message || e?.response?.statusText || "Erro desconhecido.";
}

function timeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} demorou demais para responder.`)), ms)
    )
  ]);
}

function normalizeMessages(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter(x => x && typeof x.content === "string")
    .slice(-12)
    .map(x => ({
      role: ["user", "assistant"].includes(x.role) ? x.role : "user",
      content: x.content.slice(0, 12000)
    }));
}

async function chat(prompt, history) {
  if (!hf) throw new Error("HF_TOKEN não está configurado no Render.");

  let lastError;
  for (const model of [...new Set(CHAT_MODELS)]) {
    try {
      const r = await timeout(
        hf.chatCompletion({
          provider: "auto",
          model,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            ...history,
            { role: "user", content: prompt }
          ],
          max_tokens: 500,
          temperature: 0.65,
          top_p: 0.9
        }),
        90000,
        "A resposta"
      );

      const text = cleanText(r?.choices?.[0]?.message?.content);
      if (text) return { text, model };
      lastError = new Error(`O modelo ${model} não retornou texto.`);
    } catch (e) {
      console.error(`Falha no chat (${model}):`, msgError(e));
      lastError = e;
    }
  }
  throw lastError || new Error("Nenhum modelo de conversa respondeu.");
}

async function generateImage(prompt) {
  if (!hf) throw new Error("HF_TOKEN não está configurado no Render.");

  let lastError;
  for (const model of [...new Set(IMAGE_MODELS)]) {
    try {
      const image = await timeout(
        hf.textToImage({
          provider: "auto",
          model,
          inputs: prompt
        }),
        150000,
        "A geração da imagem"
      );

      if (!image || typeof image.arrayBuffer !== "function") {
        throw new Error(`O modelo ${model} não retornou uma imagem válida.`);
      }

      const buffer = Buffer.from(await image.arrayBuffer());
      if (!buffer.length) throw new Error("A imagem retornada está vazia.");

      return { buffer, model };
    } catch (e) {
      console.error(`Falha na imagem (${model}):`, msgError(e));
      lastError = e;
    }
  }
  throw lastError || new Error("Nenhum modelo de imagem respondeu.");
}

app.get("/", (req, res) => {
  res.json({
    status: "online",
    app: "Adaptra.AI",
    version: "3.5",
    creator: "Jheymison",
    chat: true,
    imageGeneration: true
  });
});

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    configured: Boolean(HF_TOKEN),
    chat: Boolean(hf),
    imageGeneration: Boolean(hf),
    version: "3.5"
  });
});

app.post("/chat", async (req, res) => {
  try {
    const message = typeof req.body?.message === "string"
      ? req.body.message.trim()
      : "";

    if (!message) {
      return res.status(400).json({
        success: false,
        error: "Envie uma mensagem em 'message'."
      });
    }

    if (message.length > 12000) {
      return res.status(413).json({
        success: false,
        error: "A mensagem é muito grande."
      });
    }

    const history = normalizeMessages(req.body?.messages);
    const result = await chat(message, history);

    res.json({
      success: true,
      reply: result.text,
      model: result.model
    });
  } catch (e) {
    console.error("ERRO NO CHAT:", e);
    res.status(502).json({
      success: false,
      error: "A Adaptra não conseguiu gerar uma resposta agora.",
      details: msgError(e)
    });
  }
});

app.post("/generate", async (req, res) => {
  try {
    const prompt = typeof req.body?.prompt === "string"
      ? req.body.prompt.trim()
      : "";

    if (!prompt) {
      return res.status(400).json({
        success: false,
        error: "Envie uma descrição em 'prompt'."
      });
    }

    if (prompt.length > 4000) {
      return res.status(413).json({
        success: false,
        error: "A descrição da imagem é muito grande."
      });
    }

    console.log("Gerando imagem:", prompt);
    const result = await generateImage(prompt);

    res.status(200);
    res.set("Content-Type", "image/png");
    res.set("Cache-Control", "no-store");
    res.set("X-Adaptra-Model", result.model);
    res.send(result.buffer);
  } catch (e) {
    console.error("ERRO NA GERAÇÃO DE IMAGEM:", e);
    res.status(502).json({
      success: false,
      error: "Não foi possível gerar a imagem agora.",
      details: msgError(e)
    });
  }
});

app.use((req, res) => {
  res.status(404).json({ success: false, error: "Rota não encontrada." });
});

app.listen(PORT, () => {
  console.log(`Adaptra.AI 3.5 online na porta ${PORT}`);
  console.log(`HF_TOKEN configurado: ${Boolean(HF_TOKEN)}`);
});
