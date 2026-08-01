import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import test from 'node:test';

import { createApp } from './index.js';

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return address.port;
}

test('returns a generic error instead of an upstream response body', async (t) => {
  const upstream = http.createServer((_req, res) => {
    res.writeHead(429, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'private upstream detail' }));
  });
  const upstreamPort = await listen(upstream);
  const appServer = createApp({
    apiKey: 'test-key',
    baseUrl: `http://127.0.0.1:${upstreamPort}`,
  }).listen(0, '127.0.0.1');
  await once(appServer, 'listening');
  const address = appServer.address();
  assert.ok(address && typeof address === 'object');
  t.after(() => {
    upstream.close();
    appServer.close();
  });

  const response = await fetch(`http://127.0.0.1:${address.port}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'question' }] }),
  });
  const body = await response.text();

  assert.equal(response.status, 502);
  assert.deepEqual(JSON.parse(body), { error: 'Upstream request failed' });
  assert.equal(body.includes('private upstream detail'), false);
});

test('returns a generic error instead of a raw upstream exception message', async (t) => {
  const unavailable = http.createServer();
  const unavailablePort = await listen(unavailable);
  await new Promise((resolve, reject) => unavailable.close((error) => (error ? reject(error) : resolve())));
  const appServer = createApp({
    apiKey: 'test-key',
    baseUrl: `http://127.0.0.1:${unavailablePort}`,
  }).listen(0, '127.0.0.1');
  await once(appServer, 'listening');
  const address = appServer.address();
  assert.ok(address && typeof address === 'object');
  t.after(() => appServer.close());

  const response = await fetch(`http://127.0.0.1:${address.port}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'question' }] }),
  });
  const body = await response.text();

  assert.equal(response.status, 502);
  assert.deepEqual(JSON.parse(body), { error: 'Upstream request failed' });
  assert.equal(body.includes('ECONNREFUSED'), false);
});
