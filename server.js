import express from "express";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json({ limit: "256kb" }));

const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = (process.env.GEMINI_API_KEY || "").trim();

const cache = new Map();

app.get("/", (_req, res) => {
  res.json({
    ok: true,
    service: "Eliom Bienestar IA",
    hasKey: Boolean(GEMINI_API_KEY),
  });
});

async function callGemini(prompt) {
  const isAuthKey = GEMINI_API_KEY.startsWith("AQ.");
  const url = isAuthKey
    ? "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"
    : `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

  const headers = {
    "Content-Type": "application/json",
  };
  if (isAuthKey) {
    headers["Authorization"] = `Bearer ${GEMINI_API_KEY}`;
  }

  return fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.15,
      },
    }),
  });
}

app.post("/scan", async (req, res) => {
  try {
    const rawText = String(req.body?.text || "").trim();
    if (!rawText || rawText.length > 200) {
      return res.status(400).json({ error: "Texto inválido" });
    }
    if (!GEMINI_API_KEY) {
      return res.status(500).json({ error: "Falta GEMINI_API_KEY en Render" });
    }

    const cacheKey = rawText.toLowerCase();
    if (cache.has(cacheKey)) {
      return res.json(cache.get(cacheKey));
    }

    const prompt = `Sos un nutricionista experto en gastronomía argentina y latinoamericana.
Calculá las calorías y macronutrientes estimados para: "${rawText}".
Si el usuario no aclaró cantidad, asumí 1 porción o unidad estándar realista.
Respondé ÚNICAMENTE con un JSON válido con esta estructura exacta:
{"nombre":"nombre corto y claro en español","alimentos":[{"nombre":"","gramos":0}],"kcal":0,"proteinas":0,"carbohidratos":0,"grasas":0,"confianza":"alta|media|baja"}`;

    const response = await callGemini(prompt);

    if (response.status === 429) {
      return res.status(429).json({ error: "Límite de consultas alcanzado" });
    }

    if (!response.ok) {
      const detail = await response.text();
      console.error("Error de Gemini:", response.status, detail);
      return res.status(502).json({
        error: `Error Gemini (${response.status}): ${detail.slice(0, 180)}`,
      });
    }

    const data = await response.json();
    const content = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const parsed = JSON.parse(content);

    const result = {
      nombre: String(parsed.nombre || rawText).slice(0, 80),
      alimentos: Array.isArray(parsed.alimentos) ? parsed.alimentos : [],
      kcal: Math.max(0, Math.round(Number(parsed.kcal) || 0)),
      proteinas: Math.max(0, Math.round(Number(parsed.proteinas) || 0)),
      carbohidratos: Math.max(0, Math.round(Number(parsed.carbohidratos) || 0)),
      grasas: Math.max(0, Math.round(Number(parsed.grasas) || 0)),
      confianza: ["alta", "media", "baja"].includes(parsed.confianza)
        ? parsed.confianza
        : "media",
    };

    if (result.kcal > 0) {
      if (cache.size >= 500) {
        const firstKey = cache.keys().next().value;
        cache.delete(firstKey);
      }
      cache.set(cacheKey, result);
    }

    return res.json(result);
  } catch (err) {
    console.error("Error interno en /scan:", err);
    return res.status(500).json({ error: err?.message || "Error interno del servidor" });
  }
});

app.listen(PORT, () => {
  console.log(`Eliom IA escuchando en puerto ${PORT}`);
});
