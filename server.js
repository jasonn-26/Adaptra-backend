const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

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

    if (!prompt) {
      return res.status(400).json({
        error: "Digite uma descrição para a imagem."
      });
    }

    res.json({
      success: true,
      message: "Pedido recebido pela Adaptra.AI!",
      prompt: prompt
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Erro interno do servidor."
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Adaptra.AI backend funcionando na porta ${PORT}`);
});
