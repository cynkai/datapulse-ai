# DataPulse AI

> 결론을 내리기 전에 근거부터 판정하는 리서치 에이전트. 계획 → 검색 → 명제별 판정 → 답변 → 모든 명제가 뒷받침될 때만 차트.

🇺🇸 [English README](README.md)

## 이 레포에 대해

2026년 8월 AGENT:24 해커톤(Liner API 트랙) 제출작입니다. 제출 당시 버전은 git 태그 [`hackathon-submission`](../../tree/hackathon-submission)으로 남겨 두었습니다.
이후 커밋은 마무리하지 못한 부분을 정리하고 고친 것뿐입니다([해커톤 이후 변경 사항](#해커톤-이후-변경-사항) 참고).

프로젝트 기록으로 남겨 둔 레포입니다. 검색에는 [Liner](https://getliner.com) 플랫폼 API 키가 필요해서, 대부분은 오프라인 데모만 실행할 수 있습니다.

## 빠른 시작: 오프라인 데모 (키 없음)

Node.js 22 이상이 필요합니다.

```bash
git clone https://github.com/cynkai/datapulse-ai.git
cd datapulse-ai
npm install
npm run dev:mock   # 터미널 1: Liner API 로컬 mock, http://localhost:5001
npm run dev:web    # 터미널 2: 웹 UI, http://localhost:3000
```

http://localhost:3000 을 열고 오른쪽 위 토글을 **오프라인**으로 바꾼 뒤 데모 질문을 누릅니다.
오프라인 모드는 `mock/`에 준비된 답변을 브라우저로 바로 재생합니다. 안의 수치는 예시 데이터이지 리서치 결과가 아니며,
아래 에이전트는 관여하지 않습니다.

## 실시간 모드 (OpenAI + Liner 키)

```bash
cp agent/.env.example agent/.env   # OPENAI_API_KEY와 LINER_API_KEY 입력
npm run dev:agent  # 터미널 1: 에이전트 백엔드, http://localhost:4000
npm run dev:web    # 터미널 2: 웹 UI, http://localhost:3000
```

토글은 **실시간**에 둡니다. 웹 앱이 `/api/agent-run`을 통해 질문을 에이전트로 전달합니다.

| 변수 (`agent/.env`) | 기본값 | 의미 |
|---|---|---|
| `OPENAI_API_KEY` | (필수) | 에이전트와 근거 판정에 사용 |
| `LINER_API_KEY` | (필수) | Liner 검색 API |
| `OPENAI_MODEL` | `gpt-5.4-mini` | 판정 모델 (`OPENAI_JUDGE_MODEL`이 있으면 판정에만 그 값을 사용) |
| `LINER_BASE_URL` | `https://platform.liner.com` | Liner API 주소 |
| `ALLOW_MOCK_FALLBACK` | (꺼짐) | `true`면 Liner 호출이 실패할 때 로컬 mock을 사용하고, 결과에 `mock`으로 표시 |
| `PORT` | `4000` | 에이전트 포트 (웹 앱은 `AGENT_API_BASE`를 읽고, 기본값은 `http://localhost:4000`) |

> **로컬에서 실행하세요.** 에이전트에는 인증도, 호출 제한도 없습니다. 키를 넣은 채 공개 배포하면 누구나 그 키를 쓸 수 있습니다.

## 동작 방식

에이전트(`agent/`, OpenAI Agents SDK)는 정해진 순서를 따르고, 단계마다 도구가 하나씩 있습니다.

1. **계획** (`plan_research`): 질문을 하위 질문으로 나누고(프롬프트상 최대 2개), 답이 되는 명제를 나열합니다.
   명제는 하나의 검증 가능한 사실이어야 하며, 요약·분류·추세는 거부합니다.
2. **수집** (`liner_search`): 하위 질문마다 Liner를 `scholar` 또는 `general` 모드로 검색합니다.
3. **판정** (`judge_evidence`): 명제마다 관련도가 높은 문단을 골라, 각 문단이 명제를 뒷받침하는지 반박하는지 모델에게 묻습니다.
   명제마다 `supported`, `conflicting`, `insufficient`, `unsupported`, `not_atomic` 중 하나의 판정이 붙습니다.
4. **결론:** 판정과 근거만으로 답하고, 판단할 수 없는 부분은 그렇다고 밝힙니다.
5. **시각화** (`render_visualization`): 필요한 명제가 모두 `supported`일 때만 차트를 그립니다.

검색 결과는 지시가 아니라 신뢰할 수 없는 데이터로 다룹니다. 모든 근거에 출처 종류(`live` 또는 `mock`)가 붙고,
화면에 답변이 어느 쪽을 썼는지 표시됩니다.

## 프로젝트 구조

```
agent/   리서치 에이전트 백엔드 (Node HTTP + SSE, OpenAI Agents SDK)
web/     Next.js UI. /api/agent-run이 에이전트로 전달
mock/    오프라인 데모와 테스트용 Liner API 로컬 mock
```

## 개발

```bash
npm test        # 에이전트·웹 단위 테스트 (키나 네트워크 필요 없음)
npm run lint
npm run build   # 웹 앱 프로덕션 빌드
```

## 해커톤 이후 변경 사항

- UI가 더 이상 쓰지 않던 초기 Liner 프록시 `server/`와 create-next-app 기본 README를 지웠습니다.
- 루트에서 `npm install` 한 번으로 전부 설치됩니다(npm workspaces). 에이전트가 `agent/.env`를 읽습니다.
- README를 코드에 맞게 다시 썼습니다.
- 제출 당시 실패하던 테스트 13개를 고쳤습니다. 6개는 에이전트가 처음 보내는 SSE 주석을 테스트 파서가 건너뛰기만 하면 됐고,
  웹 쪽은 실제 버그 두 개를 드러냈습니다. 실행이 `ok: true`로 끝나면 대기 중이던 Liner 출처 오류가 지워져서, 검색 결과가 없거나
  출처를 알 수 없는 답변도 실시간 결과처럼 끝났습니다. 또 브라우저를 닫아도 에이전트 실행이 멈추지 않았습니다.
- GitHub Actions CI와 MIT 라이선스를 추가했습니다.

## 라이선스

[MIT](LICENSE)
