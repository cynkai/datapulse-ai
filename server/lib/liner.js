import { Readable } from 'node:stream';

const UPSTREAM_TIMEOUT_MS = 60_000;

/**
 * Read server configuration from the environment.
 */
export function getLinerConfig(env = process.env) {
  return {
    apiKey: env.LINER_API_KEY || '',
    baseUrl: (env.LINER_BASE_URL || 'https://platform.liner.com').replace(/\/+$/, ''),
    port: Number(env.PORT || 4000),
  };
}

/**
 * Build the Liner Visual Answer endpoint URL for a base URL.
 */
export function upstreamUrl(baseUrl) {
  return `${baseUrl}/api/v1/agents/visual-answer`;
}

/**
 * Call the Liner Visual Answer API and stream the SSE response to `res`.
 *
 * Resolves with:
 *   { streamed: true }            - upstream 2xx streamed to the client
 *   { aborted: true }             - client disconnected, nothing to do
 *   { upstreamError: true, status } - upstream returned a non-2xx status
 *
 * Throws on network/abort errors before the response starts streaming.
 */
export async function streamVisualAnswer({ messages, apiKey, baseUrl, res }) {
  const controller = new AbortController();

  const timer = setTimeout(() => {
    controller.abort();
  }, UPSTREAM_TIMEOUT_MS);

  const onClientClose = () => controller.abort();
  res.on('close', onClientClose);

  try {
    const upstream = await fetch(upstreamUrl(baseUrl), {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({ messages }),
      signal: controller.signal,
    });

    if (!upstream.ok || !upstream.body) {
      const diagnostic = await upstream.text();
      console.error(`[server] upstream response status=${upstream.status}: ${diagnostic}`);
      return { upstreamError: true, status: upstream.status };
    }

    res.status(upstream.status);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    await pipeUpstream(upstream.body, res);
    res.end();
    return { streamed: true };
  } catch (err) {
    if (res.destroyed || res.writableEnded) {
      return { aborted: true }; // client went away - nothing more to send
    }
    throw err;
  } finally {
    clearTimeout(timer);
    res.removeListener('close', onClientClose);
  }
}

/**
 * Forward a web ReadableStream to an HTTP response with backpressure.
 */
function pipeUpstream(body, res) {
  return new Promise((resolve, reject) => {
    const readable = Readable.fromWeb(body);

    readable.on('error', reject);
    readable.on('end', () => {
      res.end();
      resolve();
    });

    res.on('close', () => {
      readable.destroy();
      resolve();
    });

    readable.pipe(res);
  });
}
