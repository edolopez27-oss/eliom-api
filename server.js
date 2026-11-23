import express from "express";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json({ limit: "256kb" }));

const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Caché simple en memoria (hasta 500 consultas) para respuestas instantáneas
const cache = new Map();

app.get("/", (_req, res) => {
  res.json({ ok: true, service: "Eliom Bienestar IA" });
});

app.post("/scan", async (req, res) => {
  try {
    const rawText = String(req.body?.text || "").trim();
    if (!rawText || rawText.length > 200) {
      return res.status(400).json({ error: "Texto inválido" });
    }
    if (!GEMINI_API_KEY) {
      return res.status(500).json({ error: "Falta GEMINI_API_KEY en el servidor" });
    }

    const key = rawText.toLowerCase();
    if (cache.has(key)) {
      return res.json(cache.get(key));
    }

    const prompt = `Sos un nutricionista experto en gastronomía argentina y latinoamericana.
Calculá las calorías y macronutrientes estimados para: "${rawText}".
Si el usuario no aclaró cantidad, asumí 1 porción o unidad estándar realista.
Respondé ÚNICAMENTE con un JSON válido con esta estructura exacta:
{"nombre":"nombre corto y claro en español","alimentos":[{"nombre":"","gramos":0}],"kcal":0,"proteinas":0,"carbohidratos":0,"grasas":0,"confianza":"alta|media|baja"}`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.15,
          },
        }),
      }
    );

    if (response.status === 429) {
      return res.status(429).json({ error: "Límite de consultas alcanzado" });
    }
    if (!response.ok) {
      return res.status(502).json({ error: `Error del modelo (${response.status})` });
    }

    const data = await response.json();
    const content = data?.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    const parsed = JSON.parse(content);

    const result = {
      nombre: String(parsed.nombre || rawText).slice(0, 80),
      alimentos: Array.isArray(parsed.alimentos) ? parsed.alimentos : [],
      kcal: Math.max(0, Math.round(Number(parsed.kcal) || 0)),
      proteinas: Math.max(0, Math.round(Number(parsed.proteinas) || 0)),
      carbohidratos: Math.max(0, Math.round(Number(parsed.carbohidratos) || 0)),
      grasas: Math.max(0, Math.round(Number(parsed.grasas) || 0)),
      confianza: ["alta", "media", "baja"].includes(parsed.confianza) ? parsed.confianza : "media",
    };

    if (result.kcal > 0) {
      if (cache.size >= 500) cache.delete(cache.keys().next().value);
      cache.set(key, result);
    }

    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: "No se pudo procesar el alimento" });
  }
});

app.listen(PORT, () => {
  console.log(`Eliom IA activo en puerto ${PORT}`);
});