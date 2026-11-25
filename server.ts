import express from 'express';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_GEMINI_MODEL = 'gemini-4-hydrogen';

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));

  app.get('/api/ai/status', (_req, res) => {
    res.json({
      configured: Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim()),
      model: DEFAULT_GEMINI_MODEL,
    });
  });

  app.post('/api/ai', async (req, res) => {
    try {
      const { prompt, systemInstruction } = req.body || {};
      const apiKey = process.env.GEMINI_API_KEY?.trim();
      if (!apiKey) {
        return res.status(503).json({
          code: 'API_KEY_MISSING',
          error:
            'Cloud AI is not configured yet. Set GEMINI_API_KEY in Settings > Secrets, or switch AI Engine Mode to Local Ollama or Offline Extractive.',
        });
      }

      if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
        return res.status(400).json({ error: 'Prompt text is required.' });
      }

      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });

      const response = await ai.models.generateContent({
        model: DEFAULT_GEMINI_MODEL,
        contents: prompt,
        config: systemInstruction
          ? { systemInstruction: String(systemInstruction) }
          : undefined,
      });

      res.json({ text: response.text || '', model: DEFAULT_GEMINI_MODEL });
    } catch (err: any) {
      const status = Number(err?.status || err?.code) || 500;
      const msg = err?.message || 'Cloud AI generation failed.';
      if (status === 403 || status === 400 || msg.includes('API_KEY_INVALID')) {
        return res.status(status === 403 ? 403 : 400).json({
          error: `Gemini API key rejected (${msg}). Please verify GEMINI_API_KEY in Settings > Secrets.`,
        });
      }
      if (status === 429 || msg.includes('RESOURCE_EXHAUSTED')) {
        return res.status(429).json({
          error: 'Gemini API quota exceeded. Check your billing/quota in Settings > Secrets or retry shortly.',
        });
      }
      res.status(500).json({ error: msg });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`pdf tools server listening on http://localhost:${PORT}`);
  });
}

startServer();
