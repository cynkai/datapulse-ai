import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import { streamVisualAnswer } from './liner.js';

function createResponseStub() {
  const response = new EventEmitter();
  response.destroyed = false;
  response.writableEnded = false;
  return response;
}

test('does not return the upstream response body for non-success responses', async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('private upstream detail', { status: 429 });
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const result = await streamVisualAnswer({
    messages: [{ role: 'user', content: 'question' }],
    apiKey: 'test-key',
    baseUrl: 'https://liner.example.test',
    res: createResponseStub(),
  });

  assert.deepEqual(result, { upstreamError: true, status: 429 });
});
