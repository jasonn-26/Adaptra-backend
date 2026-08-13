const express = require("express");
const cors = require("cors");
const { InferenceClient } = require("@huggingface/inference");

const app = express();

app.use(cors());
app.use(express.json({ limit: "2mb" }));

const hf = new InferenceClient(process.env.HF_TOKEN);

app.get("/", (req, res) => {
  res.json({
    status: "online",
    app: "Adaptra.AI",
    version: "3.5",
    imageGeneration: true
  });
});

app.post("/generate", async (req, res) => {
  try {
    const { prompt } = req.body;

    if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
      return res.status(400).json({
        success: false,
        error: "Digite uma descrição para a imagem."
      });
    }

    console.log("Gerando imagem:", prompt);

    const image = await hf.textToImage({
      provider: "auto",
      model: "black-forest-labs/FLUX.1-schnell",
      inputs: prompt.trim()
    });

    const buffer = Buffer.from(await image.arrayBuffer());

    res.status(200);
    res.set("Content-Type", "image/png");
    res.set("Cache-Control", "no-store");
    res.send(buffer);

  } catch (error) {
    console.error("ERRO NA GERAÇÃO:", error);

    res.status(500).json({
      success: false,
      error: "Não foi possível gerar a imagem.",
      details: error.message || "Erro desconhecido"
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Adaptra.AI 3.5 online na porta ${PORT}`);
});
