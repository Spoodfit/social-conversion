import fs from 'node:fs';

function replaceRequired(source, before, after, label) {
  if (source.includes(after)) return source;
  if (!source.includes(before)) throw new Error(`Social copy Workers AI v2 failed: ${label} anchor not found.`);
  return source.replace(before, after);
}

const copyPath = 'src/worker/social-copy-writer.ts';
let copy = fs.readFileSync(copyPath, 'utf8');
if (!copy.includes('SC_SOCIAL_COPY_WORKERS_AI_V2')) {
  copy = copy.replace('const EDITORIAL_KEYS: Record<PlanningPlatform, Set<string>> = {', 'const EDITORIAL_KEYS: Partial<Record<PlanningPlatform, Set<string>>> = {');
  copy = replaceRequired(
    copy,
    '  const editorialKeys = EDITORIAL_KEYS[platform];\n  const writable = definition.fields',
    [
      '  const editorialKeys = EDITORIAL_KEYS[platform] ?? new Set(',
      '    definition.fields',
      "      .filter((field) => field.kind === 'text' || field.kind === 'textarea' || field.kind === 'tags')",
      '      .map((field) => field.key)',
      "      .filter((key) => !['altText', 'note', 'location'].includes(key)),",
      '  );',
      '  const writable = definition.fields',
    ].join('\n'),
    'generic editorial fields',
  );

  const modelAnchor = [
    'function modelName(env: Env): string {',
    "  const copyModel = Reflect.get(env, 'OPENAI_COPY_MODEL');",
    "  if (typeof copyModel === 'string' && copyModel.trim()) return copyModel.trim();",
    "  const configured = Reflect.get(env, 'OPENAI_MODEL');",
    "  return typeof configured === 'string' && configured.trim() ? configured.trim() : 'gpt-5.6';",
    '}',
  ].join('\n');
  const helpers = [
    modelAnchor,
    '',
    'type WorkersAiBinding = { run: (model: string, input: Record<string, unknown>) => Promise<unknown> };',
    '',
    'function workersAiBinding(env: Env): WorkersAiBinding | undefined {',
    "  const binding = Reflect.get(env, 'AI');",
    "  if (!binding || typeof binding !== 'object' || typeof Reflect.get(binding, 'run') !== 'function') return undefined;",
    '  return binding as WorkersAiBinding;',
    '}',
    '',
    'function workersAiModelName(env: Env): string {',
    "  const configured = Reflect.get(env, 'WORKERS_AI_MODEL');",
    "  return typeof configured === 'string' && configured.trim() ? configured.trim() : '@cf/meta/llama-3.1-8b-instruct-fast';",
    '}',
    '',
    'function workersAiOutputText(payload: unknown): string {',
    "  if (typeof payload === 'string') return payload.trim();",
    "  if (!payload || typeof payload !== 'object') return '';",
    '  const candidate = payload as { response?: unknown; text?: unknown; result?: unknown };',
    "  if (typeof candidate.response === 'string') return candidate.response.trim();",
    "  if (typeof candidate.text === 'string') return candidate.text.trim();",
    "  if (candidate.result && typeof candidate.result === 'object') {",
    '    const nested = candidate.result as { response?: unknown; text?: unknown };',
    "    if (typeof nested.response === 'string') return nested.response.trim();",
    "    if (typeof nested.text === 'string') return nested.text.trim();",
    '  }',
    "  return '';",
    '}',
    '',
    'function extractJsonObject(value: string): string {',
    '  const cleaned = value.trim();',
    "  const start = cleaned.indexOf('{');",
    "  const end = cleaned.lastIndexOf('}');",
    '  return start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned;',
    '}',
  ].join('\n');
  copy = replaceRequired(copy, modelAnchor, helpers, 'Workers AI helpers');

  copy = replaceRequired(
    copy,
    "  const apiKey = optionalSecret(env, 'OPENAI_API_KEY');\n  if (!apiKey) throw new SocialCopyError('AI_NOT_READY', 'OpenAI API key is not configured.');\n  const request = normalizeRequest(input);",
    "  const workersAi = workersAiBinding(env);\n  const apiKey = optionalSecret(env, 'OPENAI_API_KEY');\n  if (!workersAi && !apiKey) throw new SocialCopyError('AI_NOT_READY', 'Aucun moteur IA n’est disponible.');\n  const request = normalizeRequest(input);",
    'AI readiness',
  );

  const providerStart = copy.indexOf('  const controller = new AbortController();');
  const providerEnd = copy.indexOf('\n\n  let parsed: { fields?: Record<string, unknown> };', providerStart);
  if (providerStart < 0 || providerEnd < 0) throw new Error('Social copy Workers AI v2 failed: provider block not found.');

  const replacement = [
    '  let model: string;',
    '  let text: string;',
    '  if (workersAi) {',
    '    model = workersAiModelName(env);',
    "    const contract = request.writable.map((field) => field.kind === 'tags' ? `\"${field.key}\": [\"mot-clé\"]` : `\"${field.key}\": \"texte\"`).join(', ');",
    '    const prompt = [',
    "      'Tu es un rédacteur social media senior. Tu prépares uniquement un brouillon modifiable.',",
    "      'Respecte le ton natif de la plateforme et les contraintes indiquées.',",
    "      'Ne crée jamais de faits, chiffres, prix, preuves, promotions ou promesses absents du contexte.',",
    '      context,',
    "      `Réponds uniquement en JSON valide, sans markdown, sous la forme {\"fields\": {${contract}}}.`,",
    "    ].join('\\n');",
    '    try {',
    "      const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('workers_ai_timeout')), 18_000));",
    '      const payload = await Promise.race([',
    "        workersAi.run(model, { messages: [{ role: 'user', content: prompt }], max_tokens: 900, temperature: 0.45 }),",
    '        timeout,',
    '      ]);',
    '      text = workersAiOutputText(payload);',
    '    } catch (error) {',
    "      console.warn(JSON.stringify({ event: 'social_copy_workers_ai_failed', reason: error instanceof Error ? error.message.slice(0, 120) : 'unknown', platform: request.platform, format: request.format }));",
    "      throw new SocialCopyError('AI_PROVIDER_FAILED', 'L’assistant de rédaction est temporairement indisponible.');",
    '    }',
    '  } else {',
    '    model = modelName(env);',
    '    const controller = new AbortController();',
    '    const timeout = setTimeout(() => controller.abort(), 18_000);',
    '    let response: Response;',
    '    try {',
    "      response = await fetchImpl('https://api.openai.com/v1/responses', {",
    "        method: 'POST',",
    "        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },",
    '        body: JSON.stringify({',
    '          model,',
    "          reasoning: { effort: 'low' },",
    "          instructions: 'Tu es un rédacteur social media senior. Tu aides à préparer un brouillon modifiable, jamais à publier automatiquement. Retourne uniquement la structure demandée.',",
    '          input: context,',
    "          text: { format: { type: 'json_schema', name: 'social_copy_fields', strict: true, schema } },",
    '        }),',
    '        signal: controller.signal,',
    '      });',
    '    } catch (error) {',
    "      const reason = error instanceof DOMException && error.name === 'AbortError' ? 'timeout' : 'network';",
    "      console.warn(JSON.stringify({ event: 'social_copy_provider_failed', reason, platform: request.platform, format: request.format }));",
    "      throw new SocialCopyError('AI_PROVIDER_FAILED', 'L’assistant de rédaction est temporairement indisponible.');",
    '    } finally {',
    '      clearTimeout(timeout);',
    '    }',
    '    if (!response.ok) {',
    "      console.warn(JSON.stringify({ event: 'social_copy_provider_failed', status: response.status, platform: request.platform, format: request.format }));",
    "      throw new SocialCopyError('AI_PROVIDER_FAILED', 'Le moteur IA a refusé la requête.');",
    '    }',
    '    let payload: unknown;',
    "    try { payload = await response.json(); } catch { throw new SocialCopyError('AI_PROVIDER_FAILED', 'Le moteur IA a retourné une réponse invalide.'); }",
    '    text = outputText(payload);',
    '  }',
    "  if (!text) throw new SocialCopyError('AI_EMPTY_RESPONSE', 'L’assistant de rédaction n’a pas retourné de texte exploitable.');",
  ].join('\n');
  copy = copy.slice(0, providerStart) + replacement + copy.slice(providerEnd);
  copy = copy.replace('    parsed = JSON.parse(text) as { fields?: Record<string, unknown> };', '    parsed = JSON.parse(extractJsonObject(text)) as { fields?: Record<string, unknown> };');
  copy = copy.replace('    model: modelName(env),', '    model,');
  copy += '\n// SC_SOCIAL_COPY_WORKERS_AI_V2\n';
  fs.writeFileSync(copyPath, copy);
}

// Make loading unmissable in create/edit publication UX.
const composerPath = 'src/NativePlatformComposer.tsx';
let composer = fs.readFileSync(composerPath, 'utf8');
if (!composer.includes('SC_COMPOSER_AI_LOADING_V2')) {
  composer = replaceRequired(composer, '  Link2,\n  MapPin,', '  Link2,\n  LoaderCircle,\n  MapPin,', 'LoaderCircle import');
  composer = replaceRequired(
    composer,
    '<button type="button" className="generate" disabled={!ready || busy} onClick={onGenerate}><Sparkles size={13} /> {busy ? \'Rédaction…\' : \'Générer\'}</button>',
    '<button type="button" className={`generate${busy ? \' busy\' : \'\'}`} disabled={!ready || busy} onClick={onGenerate}>{busy ? <><LoaderCircle className="sc3-spin" size={13} /> Rédaction en cours…</> : <><Sparkles size={13} /> Générer</>}</button>',
    'composer loading button',
  );
  composer += '\n// SC_COMPOSER_AI_LOADING_V2\n';
  fs.writeFileSync(composerPath, composer);
}

console.log('Publication assistant now uses Workers AI first and shows explicit writing progress.');
