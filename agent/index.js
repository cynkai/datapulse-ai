import http from 'node:http';
import { pathToFileURL } from 'node:url';

import { MissingApiKeyError, createAgentRuntime } from './core.js';
import { LinerApiError } from './tools/liner_search.js';

const MAX_BODY_BYTES = 64 * 1024;
const MAX_ERROR_CHAIN_DEPTH = 8;
const MAX_STREAM_EVENT_DEPTH = 12;

class InvalidRequestError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InvalidRequestError';
  }
}

function hasLinerApiFailure(error) {
  const errorsToInspect = [error];
  const inspected = new Set();

  while (errorsToInspect.length > 0 && inspected.size < MAX_ERROR_CHAIN_DEPTH) {
    const current = errorsToInspect.pop();
    if (!(current instanceof Error) || inspected.has(current)) continue;
    inspected.add(current);
    try {
      if (current instanceof LinerApiError || current.code === 'liner_api_failed') return true;
      if (current.error instanceof Error) errorsToInspect.push(current.error);
      if (current.cause instanceof Error) errorsToInspect.push(current.cause);
    } catch {
      continue;
    }
  }

  return false;
}

function streamCallId(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return typeof value.callId === 'string' ? value.callId : typeof value.call_id === 'string' ? value.call_id : null;
}

function textEnvelope(value) {
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.type !== 'text') return null;
  return typeof value.text === 'string' ? value.text : null;
}

function isSerializedLinerApiFailure(value) {
  const text = textEnvelope(value);
  if (!text) return false;
  if (text.startsWith('An error occurred while running the tool. Please try again. Error: LinerApiError:')) return true;
  try {
    const serializedError = JSON.parse(text);
    return serializedError?.name === 'LinerApiError' && serializedError?.code === 'liner_api_failed';
  } catch {
    return false;
  }
}

function hasLinerApiFailureInStreamEvent(event, linerCallIds) {
  const valuesToInspect = [{ value: event, depth: 0 }];
  const inspected = new Set();

  while (valuesToInspect.length > 0) {
    const { value, depth } = valuesToInspect.pop();
    if (!value || typeof value !== 'object' || inspected.has(value) || depth > MAX_STREAM_EVENT_DEPTH) continue;
    inspected.add(value);
    let type;
    try {
      type = value.type;
      if (type === 'function_call' && value.name === 'liner_search') {
        const callId = streamCallId(value);
        if (callId) linerCallIds.add(callId);
      }
      if (type === 'function_call_result' || type === 'function_call_output') {
        const callId = streamCallId(value);
        const isLinerCall = value.name === 'liner_search' || (callId !== null && linerCallIds.has(callId));
        if (isLinerCall && isSerializedLinerApiFailure(value.output)) return true;
      }
      if (depth < MAX_STREAM_EVENT_DEPTH) {
        for (const child of Object.values(value)) valuesToInspect.push({ value: child, depth: depth + 1 });
      }
    } catch {
      continue;
    }
  }

  return false;
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
  response.write(': connected\n\n');
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
    const linerCallIds = new Set();
    for await (const event of stream) {
      if (hasLinerApiFailureInStreamEvent(event, linerCallIds)) {
        throw new LinerApiError('Liner tool output reported a failure.');
      }
      sendSse(response, event);
    }
    sendSse(response, { type: 'completion', ok: true, final_output: stream.finalOutput ?? null });
  } catch (error) {
    const missingKey = error instanceof MissingApiKeyError;
    const linerFailure = hasLinerApiFailure(error);
    sendSse(response, {
      type: 'error',
      code: missingKey ? error.code : linerFailure ? 'liner_api_failed' : 'agent_run_failed',
      message: missingKey ? error.message : linerFailure ? 'Liner search failed.' : 'Agent run failed.',
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
  // Read agent/.env when it exists; real environment variables still win.
  try {
    process.loadEnvFile(new URL('.env', import.meta.url));
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const port = Number(process.env.PORT ?? 4000);
  startServer({ port }).on('listening', () => {
    console.log(`[agent] listening on http://localhost:${port}`);
    for (const name of ['OPENAI_API_KEY', 'LINER_API_KEY']) {
      if (!process.env[name]?.trim()) console.warn(`[agent] ${name} is not set`);
    }
  });
}
