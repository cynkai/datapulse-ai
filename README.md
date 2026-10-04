# DataPulse AI

> A research agent that judges its evidence before it concludes: plan → search → judge each claim → answer → chart only when every claim is supported.

🇰🇷 [한국어 README](README.ko.md)

## About this repository

DataPulse AI was built for the AGENT:24 hackathon (Liner API track) in August 2026. The version submitted there is kept as the git tag
[`hackathon-submission`](../../tree/hackathon-submission). Later commits only clean up and fix what was left unfinished;
see [Changes since the hackathon](#changes-since-the-hackathon).

It is kept as a record of the project. Searching needs a [Liner](https://getliner.com) platform API key, so most people will only be able to run the offline demo.

## Quick start: offline demo (no keys)

Requires Node.js 22 or later.

```bash
git clone https://github.com/cynkai/datapulse-ai.git
cd datapulse-ai
npm install
npm run dev:mock   # terminal 1: local mock of the Liner API, http://localhost:5001
npm run dev:web    # terminal 2: web UI, http://localhost:3000
```

Open http://localhost:3000, switch the toggle in the top right to **오프라인** (offline), and click a demo question.
Offline mode replays canned answers from `mock/` straight to the browser. The numbers in it are sample data, not research results,
and the agent below is not involved.

![Offline demo](docs/images/offline-demo.png)

## Live mode (OpenAI + Liner keys)

```bash
cp agent/.env.example agent/.env   # set OPENAI_API_KEY and LINER_API_KEY
npm run dev:agent  # terminal 1: agent backend, http://localhost:4000
npm run dev:web    # terminal 2: web UI, http://localhost:3000
```

Leave the toggle on **실시간** (live). The web app relays the question to the agent through `/api/agent-run`.

| Variable (`agent/.env`) | Default | Meaning |
|---|---|---|
| `OPENAI_API_KEY` | (required) | Runs the agent and the evidence judge |
| `LINER_API_KEY` | (required) | Liner search API |
| `OPENAI_MODEL` | `gpt-5.4-mini` | Judge model (`OPENAI_JUDGE_MODEL` overrides it for the judge only) |
| `LINER_BASE_URL` | `https://platform.liner.com` | Liner API base URL |
| `ALLOW_MOCK_FALLBACK` | (off) | `true` = use the local mock when a live Liner call fails; results are labelled `mock` |
| `PORT` | `4000` | Agent port (the web app reads `AGENT_API_BASE`, default `http://localhost:4000`) |

### What a live run looks like

Checked on 2026-10-04 with the demo question "애플 vs 마이크로소프트 2025 실적 비교" (gpt-5.4-mini judge, about 35–60 s per run).
Three runs after the fixes below gave three different outcomes; in each, a chart appeared only when every claim was `supported`:

| Run | Verdicts | Result |
|---|---|---|
| 1 | both revenue claims `supported` | answer with Apple $416.2B vs Microsoft $281.7B (FY2025) and a bar chart |
| 2 | one claim `conflicting` | answer flagged as not fully verified, no chart |
| 3 | claims `insufficient` (the planner phrased them vaguely) | no comparison, no chart |

![Live run that stopped at insufficient evidence](docs/images/live-insufficient.png)

The agent is only as steady as the model planning and judging it; expect the same question to land differently between runs.

> **Run it locally.** The agent has no authentication or rate limit. Deployed publicly with your keys, anyone could spend them.

## How it works

The agent (OpenAI Agents SDK, `agent/`) follows a fixed order and has one tool per step:

1. **Plan** (`plan_research`): split the question into sub-questions (the prompt asks for at most two) and list the claims that would answer it.
   Each claim must be a single checkable fact; summaries, classifications and trends are rejected.
2. **Gather** (`liner_search`): search Liner for each sub-question, in `scholar` or `general` mode.
3. **Judge** (`judge_evidence`): pick the most relevant chunks per claim and ask a model whether each chunk supports or conflicts with it.
   Every claim gets one verdict: `supported`, `conflicting`, `insufficient`, `unsupported` or `not_atomic`.
4. **Conclude:** answer from the verdicts and evidence only, saying plainly when something could not be decided.
5. **Visualize** (`render_visualization`): draw a chart only when every required claim is `supported`.

Search results are treated as untrusted data, not instructions. Every piece of evidence carries its provenance (`live` or `mock`),
and the UI shows which one the answer used.

## Project structure

```
agent/   research agent backend (plain Node HTTP + SSE, OpenAI Agents SDK)
web/     Next.js UI; /api/agent-run relays to the agent
mock/    local mock of the Liner API for the offline demo and tests
```

## Development

```bash
npm test        # agent and web unit tests (no keys or network needed)
npm run lint
npm run build   # production build of the web app
```

## Changes since the hackathon

- Removed `server/`, an earlier Liner proxy the UI no longer used, and the create-next-app README.
- One `npm install` at the root now installs everything (npm workspaces); the agent reads `agent/.env`.
- README rewritten to match the code.
- Fixed the 13 tests that failed at submission. Six only needed the test parser to skip the SSE comment the agent sends first;
  the web ones exposed two real bugs: a run that ended with `ok: true` erased a pending Liner provenance error, so an answer whose search
  result was missing or unknown still finished as if it were live; and closing the browser did not stop the agent run.
- Added GitHub Actions CI and the MIT license.
- Live runs failed on two bugs found while verifying with real keys: the web parsers took the Agents SDK's repeated reports of one tool call
  for a reused call ID, so every real run showed "Liner 연결 실패" and no sources; and the planner wrote long keyword lists as search queries,
  for which Liner returns references but no text, so every claim came out `insufficient`. Sources from all searches are now listed, not just the last.
- Removed two unpinned debugging scripts that the dev server loaded from unpkg.

## License

[MIT](LICENSE)
