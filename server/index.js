import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import { fileURLToPath } from 'node:url';

import { getLinerConfig, streamVisualAnswer } from './lib/liner.js';

export function createApp(config = getLinerConfig(process.env)) {
  const app = express();

  // --- middleware -----------------------------------------------------------

  app.use(cors()); // open CORS for the hackathon demo
  app.use(express.json({ limit: '1mb' }));

  // request log: method / path / status
  app.use((req, res, next) => {
    res.on('finish', () => {
      console.log(
        `[server] ${new Date().toISOString()} ${req.method} ${req.originalUrl} ${res.statusCode}`,
      );
    });
    next();
  });

  // --- routes ---------------------------------------------------------------

  app.get('/api/health', (req, res) => {
    res.json({ ok: true });
  });

  app.post('/api/chat', async (req, res) => {
    const parsed = parseChatRequest(req.body);
    if (parsed.error) {
      res.status(400).json({ error: parsed.error });
      return;
    }

    if (!config.apiKey) {
      res.status(500).json({ error: 'Service unavailable' });
      return;
    }

    try {
      const result = await streamVisualAnswer({
        messages: parsed.messages,
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        res,
      });

      if (result.streamed || result.aborted) return;

      console.error(`[server] upstream request failed with status ${result.status}`);
      res.status(502).json({ error: 'Upstream request failed' });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[server] upstream error: ${message}`);
      if (res.headersSent || res.destroyed) {
        res.end();
        return;
      }
      res.status(502).json({ error: 'Upstream request failed' });
    }
  });

  // --- error handling -------------------------------------------------------

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') {
      res.status(400).json({ error: 'Invalid JSON body' });
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[server] unhandled error: ${message}`);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

export function startServer(config = getLinerConfig(process.env)) {
  const app = createApp(config);
  return app.listen(config.port, () => {
    console.log(`[server] listening on http://localhost:${config.port}`);
    if (!config.apiKey) {
      console.warn('[server] LINER_API_KEY is not set - /api/chat will return 500');
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startServer();
}

/**
 * Validate a /api/chat request body.
 * Returns { messages } on success or { error } describing the problem.
 */
export function parseChatRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Request body must be a JSON object' };
  }

  const { messages } = body;
  if (!Array.isArray(messages) || messages.length === 0) {
    return { error: 'messages must be a non-empty array' };
  }

  for (const message of messages) {
    if (
      !message ||
      typeof message !== 'object' ||
      typeof message.role !== 'string' ||
      typeof message.content !== 'string'
    ) {
      return { error: 'each message must have a string role and a string content' };
    }
  }

  const last = messages[messages.length - 1];
  if (last.role !== 'user') {
    return { error: 'the final message must have role "user"' };
  }

  return { messages };
}
