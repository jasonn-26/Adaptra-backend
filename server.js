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
    version: "3.5"
  });
});

app.post("/generate", async (req, res) => {
  try {
    const { prompt } = req.body;

    if (!prompt || !prompt.trim()) {
      return res.status(400).json({
        error: "Digite uma descrição para a imagem."
      });
    }

    const image = await hf.textToImage({
      provider: "hf-inference",
      model: "black-forest-labs/FLUX.1-schnell",
      inputs: prompt.trim()
    });

    const buffer = Buffer.from(await image.arrayBuffer());

    res.set("Content-Type", "image/png");
    res.send(buffer);

  } catch (error) {
    console.error("Erro na geração:", error);

    res.status(500).json({
      error: "Não foi possível gerar a imagem.",
      details: error.message
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Adaptra.AI funcionando na porta ${PORT}`);
});
