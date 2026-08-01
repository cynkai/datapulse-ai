const RELAY_ERROR = "에이전트 연결에 실패했습니다.";

function agentRunUrl(): string {
  return new URL("/api/run", process.env.AGENT_API_BASE ?? "http://localhost:4000").toString();
}

function relayError(): Response {
  return Response.json({ error: RELAY_ERROR }, { status: 502 });
}

export async function POST(request: Request): Promise<Response> {
  let upstream: Response;
  try {
    upstream = await fetch(agentRunUrl(), {
      method: "POST",
      headers: {
        Accept: "text/event-stream",
        "Content-Type": request.headers.get("content-type") ?? "application/json",
      },
      body: await request.text(),
      cache: "no-store",
      signal: request.signal,
    });
  } catch (cause) {
    if (request.signal.aborted) throw cause;
    return relayError();
  }
  if (!upstream.ok || upstream.body === null) return relayError();

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "Cache-Control": upstream.headers.get("cache-control") ?? "no-store",
      "Content-Type": upstream.headers.get("content-type") ?? "application/json; charset=utf-8",
    },
  });
}
