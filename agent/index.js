import http from 'node:http';
import { pathToFileURL } from 'node:url';

import { MissingApiKeyError, createAgentRuntime } from './core.js';

const MAX_BODY_BYTES = 64 * 1024;

class InvalidRequestError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InvalidRequestError';
  }
}

async function parseQuestion(request) {
  let raw = '';
  for await (const chunk of request) {
    raw += chunk;
    if (Buffer.byteLength(raw) > MAX_BODY_BYTES) {
      throw new InvalidRequestError('Request body is too large.');
    }
  }

  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new InvalidRequestError('Body must be valid JSON.');
  }
  if (!body || Array.isArray(body) || typeof body !== 'object') {
    throw new InvalidRequestError('Body must be a JSON object.');
  }
  if (typeof body.question !== 'string' || body.question.trim().length === 0) {
    throw new InvalidRequestError('question must be a non-empty string.');
  }
  return body.question;
}

function sendJson(response, status, payload) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

function startSse(response) {
  response.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
}

function sendSse(response, event) {
  response.write(`data: ${JSON.stringify(event)}\n\n`);
}

async function handleRun(request, response, runtime) {
  let question;
  try {
    question = await parseQuestion(request);
  } catch (error) {
    if (error instanceof InvalidRequestError) {
      sendJson(response, 400, { error: { code: 'invalid_request', message: error.message } });
      return;
    }
    throw error;
  }

  startSse(response);
  try {
    const stream = await runtime.streamQuestion(question);
    for await (const event of stream) sendSse(response, event);
    sendSse(response, { type: 'completion', ok: true, final_output: stream.finalOutput ?? null });
  } catch (error) {
    const missingKey = error instanceof MissingApiKeyError;
    sendSse(response, {
      type: 'error',
      code: missingKey ? error.code : 'agent_run_failed',
      message: missingKey ? error.message : 'Agent run failed.',
    });
    sendSse(response, { type: 'completion', ok: false });
  }
  response.end();
}

export function createServer({ runtime = createAgentRuntime() } = {}) {
  return http.createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
    try {
      if (request.method === 'GET' && url.pathname === '/api/health') {
        sendJson(response, 200, { status: 'ok' });
        return;
      }
      if (request.method === 'POST' && url.pathname === '/api/run') {
        await handleRun(request, response, runtime);
        return;
      }
      sendJson(response, 404, { error: { code: 'not_found', message: 'Not found.' } });
    } catch {
      if (!response.headersSent) {
        sendJson(response, 500, { error: { code: 'internal_error', message: 'Internal server error.' } });
      } else {
        response.end();
      }
    }
  });
}

export function startServer({ port = Number(process.env.PORT ?? 4000), runtime } = {}) {
  const server = createServer(runtime ? { runtime } : {});
  server.listen(port);
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer();
}
