# DataPulse AI

Autonomous Visual Research & Analytics Copilot — AGENT:24 Hackathon (Liner API Track).

Ask a research question. Watch the agent plan, stream a source-grounded answer, cite its references, and render an interactive chart — all from Liner's Visual Answer API.

## Structure

- `server/` — Express SSE proxy to Liner (`POST /api/chat` → `platform.liner.com/api/v1/agents/visual-answer`)
- `mock/` — Local mock Liner server (offline QA + demo fallback)
- `web/` — Next.js (App Router) + Tailwind frontend

## Run

```bash
# 0. Setup (root)
npm install

# 1. Backend (terminal 1) — needs your Liner API key
cd server && cp .env.example .env   # paste LINER_API_KEY
npm run dev                          # http://localhost:4000

# 2. Frontend (terminal 2)
cd web && npm run dev                # http://localhost:3000

# 3. Optional: mock Liner (terminal 3) — for offline demo / no key yet
node mock/index.js                   # http://localhost:5001
# then run backend with: LINER_BASE_URL=http://localhost:5001
```

## Live demo

Type a query like "애플 vs 마이크로소프트 2025 실적 비교" or "AI 반도체 시장 점유율 2026" — or click a demo chip.
