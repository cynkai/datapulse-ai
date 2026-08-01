import http from 'node:http';

const PORT = Number(process.env.PORT || 5001);

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'OPTIONS' && url.pathname.startsWith('/api/v1/')) {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  if (req.method === 'GET' && url.pathname === '/health') {
    writeJson(res, 200, { status: 'ok', mode: 'offline-emergency' });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/v1/agents/search') {
    handleJsonRequest(req, res, handleSearch);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/v1/tools/visualization') {
    handleJsonRequest(req, res, handleVisualization);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/v1/agents/visual-answer') {
    handleVisualAnswer(req, res);
    return;
  }

  writeJson(res, 404, { error: { code: 'NOT_FOUND', message: 'Not found' } });
});

server.listen(PORT, () => {
  console.log(`[mock] offline/emergency Liner mock listening on http://localhost:${PORT}`);
});

// ---------------------------------------------------------------------------
// request handling
// ---------------------------------------------------------------------------

function handleVisualAnswer(req, res) {
  collectBody(req)
    .then((raw) => {
      const query = extractQuery(raw);
      console.log(
        `[mock] ${new Date().toISOString()} POST /api/v1/agents/visual-answer query="${query.slice(0, 80)}"`,
      );

      const scenario = pickScenario(query);
      streamEvents(res, scenario);
    })
    .catch((err) => {
      console.error(`[mock] failed to read request body: ${err.message}`);
      res.writeHead(500, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(JSON.stringify({ error: 'Failed to read request body' }));
    });
}

function handleJsonRequest(req, res, handler) {
  if (!req.headers['content-type']?.toLowerCase().includes('application/json')) {
    writeJson(res, 415, {
      error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Content-Type must be application/json' },
    });
    return;
  }

  collectBody(req)
    .then((raw) => {
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        writeJson(res, 400, { error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON' } });
        return;
      }

      if (!isPlainObject(body)) {
        writeJson(res, 400, { error: { code: 'INVALID_REQUEST', message: 'Request body must be a JSON object' } });
        return;
      }

      try {
        writeJson(res, 200, handler(body));
      } catch (error) {
        writeJson(res, 400, { error: { code: 'INVALID_REQUEST', message: error.message } });
      }
    })
    .catch((error) => {
      console.error(`[mock] failed to read JSON request body: ${error.message}`);
      writeJson(res, 500, { error: { code: 'REQUEST_READ_FAILED', message: 'Failed to read request body' } });
    });
}

function handleSearch(body) {
  assertExactKeys(body, ['sq_id', 'query', 'mode']);
  assertNonEmptyString(body.sq_id, 'sq_id');
  assertNonEmptyString(body.query, 'query');
  if (!['scholar', 'general'].includes(body.mode)) {
    throw new Error('mode must be "scholar" or "general"');
  }

  const fixture = SEARCH_FIXTURES[body.mode];
  return { sq_id: body.sq_id.trim(), references: fixture.references, chunks: fixture.chunks };
}

function handleVisualization(body) {
  assertExactKeys(body, ['question', 'chart_spec_input', 'verdicts']);
  assertNonEmptyString(body.question, 'question');
  assertChartSpec(body.chart_spec_input);

  if (body.verdicts === undefined) return blockedVisualization('insufficient');
  if (!Array.isArray(body.verdicts) || body.verdicts.length === 0) {
    throw new Error('verdicts must be a non-empty array when provided');
  }

  body.verdicts.forEach(assertVerdict);
  const verdict = body.verdicts.find((item) => item.verdict !== 'supported');
  return verdict ? blockedVisualization(verdict.verdict) : body.chart_spec_input;
}

function blockedVisualization(reason) {
  return {
    blocked: true,
    reason,
    message: `Visualization is blocked because verdicts are ${reason}; every verdict must be supported.`,
  };
}

function assertChartSpec(chartSpec) {
  assertExactKeys(chartSpec, ['type', 'title', 'x_axis', 'y_axis', 'series']);
  if (!['bar', 'line', 'scatter'].includes(chartSpec.type)) {
    throw new Error('chart_spec_input.type must be "bar", "line", or "scatter"');
  }
  ['title', 'x_axis', 'y_axis'].forEach((field) => assertNonEmptyString(chartSpec[field], `chart_spec_input.${field}`));
  if (!Array.isArray(chartSpec.series) || chartSpec.series.length === 0) {
    throw new Error('chart_spec_input.series must be a non-empty array');
  }
  chartSpec.series.forEach((series, seriesIndex) => {
    assertExactKeys(series, ['name', 'data']);
    assertNonEmptyString(series.name, `chart_spec_input.series[${seriesIndex}].name`);
    if (!Array.isArray(series.data) || series.data.length === 0) {
      throw new Error(`chart_spec_input.series[${seriesIndex}].data must be a non-empty array`);
    }
    series.data.forEach((point, pointIndex) => {
      assertExactKeys(point, ['x', 'y']);
      if (!(typeof point.x === 'string' || typeof point.x === 'number')) {
        throw new Error(`chart_spec_input.series[${seriesIndex}].data[${pointIndex}].x must be a string or number`);
      }
      if (typeof point.y !== 'number' || !Number.isFinite(point.y)) {
        throw new Error(`chart_spec_input.series[${seriesIndex}].data[${pointIndex}].y must be a finite number`);
      }
    });
  });
}

function assertVerdict(verdict) {
  assertExactKeys(verdict, ['claim', 'verdict', 'reason', 'supporting_sources', 'conflicting_sources']);
  assertNonEmptyString(verdict.claim, 'verdict.claim');
  assertNonEmptyString(verdict.reason, 'verdict.reason');
  if (!['supported', 'conflicting', 'insufficient', 'unsupported', 'not_atomic'].includes(verdict.verdict)) {
    throw new Error('verdict.verdict is not supported');
  }
  ['supporting_sources', 'conflicting_sources'].forEach((field) => {
    if (!Array.isArray(verdict[field]) || !verdict[field].every((id) => typeof id === 'string')) {
      throw new Error(`verdict.${field} must be an array of strings`);
    }
  });
}

function assertExactKeys(value, keys) {
  if (!isPlainObject(value)) throw new Error('Expected an object');
  const unknown = Object.keys(value).filter((key) => !keys.includes(key));
  const missing = keys.filter((key) => !(key in value) && !(key === 'verdicts' && value.verdicts === undefined));
  if (unknown.length > 0) throw new Error(`Unexpected field: ${unknown.join(', ')}`);
  if (missing.length > 0) throw new Error(`Missing required field: ${missing.join(', ')}`);
}

function assertNonEmptyString(value, field) {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${field} must be a non-empty string`);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function writeJson(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'X-Mock-Mode': 'offline-emergency',
  });
  res.end(JSON.stringify(body));
}

function collectBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => resolve(raw));
    req.on('error', reject);
  });
}

function extractQuery(raw) {
  try {
    const body = JSON.parse(raw || '{}');
    const messages = Array.isArray(body?.messages) ? body.messages : [];
    const last = messages[messages.length - 1];
    return typeof last?.content === 'string' ? last.content : '';
  } catch {
    return '';
  }
}

function pickScenario(query) {
  if (/(애플|마이크로소프트|실적)/.test(query)) return SCENARIOS.appleVsMicrosoft;
  if (/(semiconductor|gpu|점유율)/i.test(query)) return SCENARIOS.aiSemiconductor;
  return SCENARIOS.appleVsMicrosoft; // Korean default
}

// ---------------------------------------------------------------------------
// SSE streaming
// ---------------------------------------------------------------------------

function streamEvents(res, scenario) {
  const events = buildEvents(scenario);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'X-Mock-Mode': 'offline-emergency',
  });

  let index = 0;

  const next = () => {
    if (res.destroyed) return;

    if (index < events.length) {
      const event = events[index++];
      res.write(`event: data\ndata: ${JSON.stringify(event)}\n\n`);
      setTimeout(next, 150 + Math.floor(Math.random() * 150)); // visible streaming
      return;
    }

    res.write('data: [DONE]\n\n');
    res.end();
    console.log(`[mock] stream complete (${events.length} events)`);
  };

  next();
}

function buildEvents(scenario) {
  const events = [
    {
      type: 'start',
      message_id: scenario.messageId,
      message_metadata: {
        request_id: scenario.requestId,
        trace_id: `api_visual_answer_${scenario.requestId}`,
      },
    },
    { type: 'start-step' },
    { type: 'data-search-vertical', data: { verticalSearchDomain: 'atlas' } },
    {
      type: 'data-search-references',
      id: `data-search-references-${rand8()}`,
      data: { references: scenario.references },
    },
    {
      type: 'data-search-chunks',
      id: `data-search-chunks-${rand8()}`,
      data: { referenceChunks: scenario.chunks },
    },
    ...scenario.deltas.map((delta) => ({ type: 'text-delta', id: 'text-1', delta })),
    {
      type: 'data-update',
      data: {
        atlasArtifact: {
          html: buildChartHtml(scenario.chart),
          theme: scenario.theme,
          description: scenario.description,
          resourceId: scenario.resourceId,
        },
      },
    },
    { type: 'data-update', data: { atlasInsertionPosition: scenario.insertionPosition } },
    { type: 'finish-step' },
    { type: 'finish', message_id: scenario.messageId, text: scenario.fullText },
  ];
  return events;
}

function rand8() {
  return Math.random().toString(16).slice(2, 10);
}

// ---------------------------------------------------------------------------
// canned demo scenarios
// ---------------------------------------------------------------------------

const SCENARIOS = {
  appleVsMicrosoft: {
    messageId: 'msg_apple_msft_2025',
    requestId: 'req_apple_msft_2025',
    theme: 'comparison',
    resourceId: 'viz_apple_msft_2025',
    description:
      '연도별 Apple과 Microsoft 매출을 비교한 막대 차트입니다. Apple이 규모에서 앞서지만 Microsoft가 더 빠른 성장률을 보여줍니다.',
    deltas: [
      '애플과 마이크로소프트의 2025 회계연도 매출을 비교해 보면, 애플이 약 4,160억 달러로 여전히 1위를 유지하고 있습니다. ',
      '다만 마이크로소프트가 2,810억 달러로 가장 빠른 성장률(약 15%)을 기록하며 격차를 좁혀가고 있습니다. ',
      '특히 클라우드(Azure)와 AI 관련 매출이 마이크로소프트 성장의 핵심 동력입니다.',
    ],
    fullText:
      '애플과 마이크로소프트의 2025 회계연도 매출을 비교해 보면, 애플이 약 4,160억 달러로 여전히 1위를 유지하고 있습니다. 다만 마이크로소프트가 2,810억 달러로 가장 빠른 성장률(약 15%)을 기록하며 격차를 좁혀가고 있습니다. 특히 클라우드(Azure)와 AI 관련 매출이 마이크로소프트 성장의 핵심 동력입니다.',
    references: [
      {
        title: 'Apple Q4 2025 Results - Record Revenue',
        url: 'https://www.apple.com/newsroom/2025/10/apple-reports-fourth-quarter-results/',
        hostname: 'apple.com',
        faviconUrl: 'https://www.google.com/s2/favicons?domain=apple.com&sz=32',
        description:
          'Apple reported all-time high revenue of $416.3 billion for fiscal 2025.',
        date: '2025-10-31',
      },
      {
        title: 'Microsoft FY2025 Q4 Earnings Release',
        url: 'https://www.microsoft.com/en-us/investor/earnings/FY-2025-Q4/press-release-webcast',
        hostname: 'microsoft.com',
        faviconUrl: 'https://www.google.com/s2/favicons?domain=microsoft.com&sz=32',
        description:
          'Microsoft revenue grew 15% to $281 billion in fiscal 2025, led by Azure and AI services.',
        date: '2025-07-30',
      },
    ],
    chunks: [
      {
        num: 1,
        content:
          'Apple today announced fiscal 2025 fourth quarter results with quarterly revenue of $104.9 billion, bringing full-year revenue to a record $416.3 billion.',
        sourceTitle: 'Apple Q4 2025 Results',
        sourceUrl: 'https://www.apple.com/newsroom/2025/10/apple-reports-fourth-quarter-results/',
      },
      {
        num: 2,
        content:
          "Microsoft's fiscal 2025 revenue totaled $281.0 billion, up 15% year over year, driven by Microsoft Cloud revenue growth to $168 billion.",
        sourceTitle: 'Microsoft FY2025 Q4 Earnings Release',
        sourceUrl:
          'https://www.microsoft.com/en-us/investor/earnings/FY-2025-Q4/press-release-webcast',
      },
    ],
    insertionPosition: 71, // after the first sentence
    chart: {
      title: 'Apple vs Microsoft - 2025 Revenue Comparison',
      subtitle: 'Annual revenue by fiscal year (USD billion)',
      unit: 'B',
      labels: ['2021', '2022', '2023', '2024', '2025'],
      series: [
        { name: 'Apple', color: '#5b8cff', values: [365, 394, 383, 391, 416] },
        { name: 'Microsoft', color: '#7ad0a0', values: [168, 198, 212, 245, 281] },
      ],
    },
  },

  aiSemiconductor: {
    messageId: 'msg_ai_semi_2026',
    requestId: 'req_ai_semi_2026',
    theme: 'distribution',
    resourceId: 'viz_ai_semi_2026',
    description:
      '2026년 AI 가속기 매출 기준 점유율 분포입니다. NVIDIA가 약 74%로 압도적인 1위를 유지합니다.',
    deltas: [
      'In 2026, NVIDIA is projected to command roughly 74% of AI accelerator revenue, keeping its dominant position in the AI semiconductor market. ',
      'AMD follows with about 9%, while Intel, Cerebras, and custom accelerators such as Google TPU split the remainder. ',
      'Overall demand remains strong, driven by continued buildout of large-scale training clusters and enterprise AI inference.',
    ],
    fullText:
      'In 2026, NVIDIA is projected to command roughly 74% of AI accelerator revenue, keeping its dominant position in the AI semiconductor market. AMD follows with about 9%, while Intel, Cerebras, and custom accelerators such as Google TPU split the remainder. Overall demand remains strong, driven by continued buildout of large-scale training clusters and enterprise AI inference.',
    references: [
      {
        title: 'AI Semiconductor Market Share Report 2026',
        url: 'https://www.techinsights.com/ai-semiconductor-market-share-2026',
        hostname: 'techinsights.com',
        faviconUrl: 'https://www.google.com/s2/favicons?domain=techinsights.com&sz=32',
        description:
          'NVIDIA holds ~74% of AI accelerator revenue; AMD, Intel, and custom ASICs follow.',
        date: '2026-03-12',
      },
      {
        title: 'Global AI GPU Shipments Outlook',
        url: 'https://www.counterpointresearch.com/insights/ai-gpu-shipments-2026',
        hostname: 'counterpointresearch.com',
        faviconUrl: 'https://www.google.com/s2/favicons?domain=counterpointresearch.com&sz=32',
        description:
          'AI GPU shipments expected to grow 22% in 2026 as hyperscalers expand training clusters.',
        date: '2026-04-05',
      },
    ],
    chunks: [
      {
        num: 1,
        content:
          'NVIDIA is projected to capture approximately 74% of AI accelerator revenue in 2026, extending its leadership in the data-center GPU segment.',
        sourceTitle: 'AI Semiconductor Market Share Report 2026',
        sourceUrl: 'https://www.techinsights.com/ai-semiconductor-market-share-2026',
      },
      {
        num: 2,
        content:
          'AMD trails at 9%, with Intel, Cerebras, and Google TPU combined accounting for the remaining 17% of the market.',
        sourceTitle: 'Global AI GPU Shipments Outlook',
        sourceUrl: 'https://www.counterpointresearch.com/insights/ai-gpu-shipments-2026',
      },
    ],
    insertionPosition: 108, // after the first sentence
    chart: {
      title: 'AI Semiconductor Market Share - 2026',
      subtitle: 'Estimated share of AI accelerator revenue',
      unit: '%',
      labels: ['NVIDIA', 'AMD', 'Intel', 'Cerebras', 'Google TPU', 'Others'],
      series: [{ name: 'Market share', color: '#c792ea', values: [74, 9, 6, 3, 4, 4] }],
    },
  },
};

const SEARCH_FIXTURES = {
  scholar: {
    references: [
      {
        id: 'scholar-falco-paper',
        title: 'Falco: Cloud Native Runtime Security',
        url: 'https://www.falco.org/docs/',
        source_group: 'falco-project',
      },
      {
        id: 'scholar-nist-container',
        title: 'NIST SP 800-190: Application Container Security Guide',
        url: 'https://csrc.nist.gov/pubs/sp/800/190/final',
        source_group: 'nist',
      },
    ],
    chunks: [
      {
        id: 'scholar-falco-syscalls',
        reference_id: 'scholar-falco-paper',
        content: 'Falco uses kernel system-call events to detect unexpected behavior in cloud-native workloads.',
        claim: 'Falco observes runtime system-call events.',
        stance: 'supports',
      },
      {
        id: 'scholar-nist-runtime',
        reference_id: 'scholar-nist-container',
        content: 'Container runtime security monitoring detects behavioral deviations after deployment.',
        claim: 'Runtime monitoring detects behavioral deviations.',
        stance: 'supports',
      },
    ],
  },
  general: {
    references: [
      {
        id: 'general-apple-results',
        title: 'Apple Reports Fourth Quarter Results',
        url: 'https://www.apple.com/newsroom/2025/10/apple-reports-fourth-quarter-results/',
        source_group: 'apple',
      },
      {
        id: 'general-microsoft-results',
        title: 'Microsoft FY2025 Q4 Earnings Release',
        url: 'https://www.microsoft.com/en-us/investor/earnings/FY-2025-Q4/press-release-webcast',
        source_group: 'microsoft',
      },
    ],
    chunks: [
      {
        id: 'general-apple-revenue',
        reference_id: 'general-apple-results',
        content: 'Apple reported fiscal 2025 annual revenue of $416.3 billion.',
        claim: 'Apple fiscal 2025 revenue was $416.3 billion.',
        stance: 'supports',
      },
      {
        id: 'general-microsoft-revenue',
        reference_id: 'general-microsoft-results',
        content: 'Microsoft reported fiscal 2025 annual revenue of $281.0 billion.',
        claim: 'Microsoft fiscal 2025 revenue was $281.0 billion.',
        stance: 'supports',
      },
    ],
  },
};

// ---------------------------------------------------------------------------
// standalone chart HTML (renders inside an iframe)
// ---------------------------------------------------------------------------

function buildChartHtml(cfg) {
  const legend = cfg.series
    .map(
      (s) =>
        `<span><i class="dot" style="background:${s.color}"></i>${escapeHtml(s.name)}</span>`,
    )
    .join('');
  const cfgJson = JSON.stringify(cfg).replace(/</g, '\\u003c');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(cfg.title)}</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; padding: 20px; background: #0e1320; color: #e8ecf4; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  h1 { font-size: 15px; margin: 0 0 4px; }
  .sub { font-size: 12px; color: #8b93a7; margin: 0 0 16px; }
  .legend { display: flex; gap: 16px; font-size: 12px; margin-bottom: 12px; }
  .dot { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 6px; }
  .chart { display: flex; align-items: flex-end; gap: 10px; height: 210px; }
  .group { flex: 1; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; gap: 4px; }
  .val { font-size: 11px; color: #aab2c5; opacity: 0; transition: opacity .3s .6s; }
  .bar { width: 70%; max-width: 46px; border-radius: 6px 6px 0 0; transform: scaleY(0); transform-origin: bottom; transition: transform .7s cubic-bezier(.2,.8,.2,1); }
  .labels { display: flex; margin-top: 10px; }
  .labels span { flex: 1; text-align: center; font-size: 11px; color: #8b93a7; }
</style>
</head>
<body>
  <h1>${escapeHtml(cfg.title)}</h1>
  <p class="sub">${escapeHtml(cfg.subtitle)}</p>
  <div class="legend">${legend}</div>
  <div class="chart" id="chart"></div>
  <div class="labels">${cfg.labels.map((l) => `<span>${escapeHtml(l)}</span>`).join('')}</div>
<script>
  const CFG = ${cfgJson};
  const chart = document.getElementById('chart');
  const max = Math.max(...CFG.series.flatMap((s) => s.values));
  for (let i = 0; i < CFG.labels.length; i++) {
    const group = document.createElement('div');
    group.className = 'group';
    for (const s of CFG.series) {
      const v = s.values[i];
      const val = document.createElement('div');
      val.className = 'val';
      val.textContent = v + CFG.unit;
      const bar = document.createElement('div');
      bar.className = 'bar';
      bar.style.background = s.color;
      bar.style.height = (v / max * 100) + '%';
      group.append(val, bar);
    }
    chart.appendChild(group);
  }
  requestAnimationFrame(() => { document.querySelectorAll('.bar').forEach((b) => b.style.transform = 'scaleY(1)'); });
  setTimeout(() => { document.querySelectorAll('.val').forEach((v) => v.style.opacity = 1); }, 700);
</script>
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
