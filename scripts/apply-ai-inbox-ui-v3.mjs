import fs from 'node:fs';

function replaceRequired(source, before, after, label) {
  if (source.includes(after)) return source;
  if (!source.includes(before)) throw new Error(`Inbox AI UI v3 failed: ${label} anchor not found.`);
  return source.replace(before, after);
}

const appPath = 'src/LiveAppV3.tsx';
let app = fs.readFileSync(appPath, 'utf8');
if (!app.includes('SC_INBOX_AI_UI_V3')) {
  app = replaceRequired(
    app,
    '  avatarUrl?: string;\n  handle?: string;',
    '  avatarUrl?: string;\n  profileUrl?: string;\n  handle?: string;',
    'profileUrl conversation type',
  );
  app = replaceRequired(
    app,
    "  const [reply, setReply] = useState('');\n  const [replyBusy, setReplyBusy] = useState(false);",
    "  const [reply, setReply] = useState('');\n  const [replyBusy, setReplyBusy] = useState(false);\n  const [aiReplyBusy, setAiReplyBusy] = useState(false);",
    'AI reply busy state',
  );

  const suggestStart = app.indexOf('  async function suggestReply() {');
  const suggestEnd = app.indexOf('\n\n  function openCreate(', suggestStart);
  if (suggestStart < 0 || suggestEnd < 0) throw new Error('Inbox AI UI v3 failed: suggestReply function not found.');
  const suggest = [
    '  async function suggestReply() {',
    '    if (!workspaceId || !selectedConversation || aiReplyBusy) return;',
    '    if (!runtime.aiReady) {',
    "      setToast('Le copilote IA n’est pas encore configuré.');",
    '      return;',
    '    }',
    '    setAiReplyBusy(true);',
    '    try {',
    "      const result = await apiRequest<AiDraftPayload>('/api/ai/suggest', {",
    "        method: 'POST',",
    '        body: JSON.stringify({ conversationId: selectedConversation.id }),',
    '      }, workspaceId);',
    '      setReply(result.draft.body);',
    '    } catch (error) {',
    '      setToast(readableError(error));',
    '    } finally {',
    '      setAiReplyBusy(false);',
    '    }',
    '  }',
  ].join('\n');
  app = app.slice(0, suggestStart) + suggest + app.slice(suggestEnd);

  app = replaceRequired(
    app,
    '              aiReady={runtime.aiReady}\n              accountLabel=',
    '              aiReady={runtime.aiReady}\n              aiBusy={aiReplyBusy}\n              accountLabel=',
    'aiBusy prop',
  );

  const signature = 'function InboxPage({ conversations, selected, messages, loading, query, filter, statusFilter, refreshBusy, sync, reply, replyTargetMessageId, outboundReady, aiReady, accountLabel, onQuery, onFilter, onStatusFilter, onRefresh, onSelect, onReply, onReplyTarget, onSend, onSuggest, onOpenPublication }: {';
  const nextSignature = signature.replace('aiReady, accountLabel', 'aiReady, aiBusy, accountLabel');
  app = replaceRequired(app, signature, nextSignature, 'current Inbox signature');
  app = replaceRequired(
    app,
    '  aiReady: boolean;\n  accountLabel: string;',
    '  aiReady: boolean;\n  aiBusy: boolean;\n  accountLabel: string;',
    'aiBusy type',
  );

  app = replaceRequired(
    app,
    '{aiReady && <button onClick={onSuggest}><Sparkles size={15} /> Proposer une réponse</button>}',
    "{aiReady && <button type=\"button\" className={`sc26-ai-suggest${aiBusy ? ' busy' : ''}`} onClick={onSuggest} disabled={aiBusy}>{aiBusy ? <><LoaderCircle className=\"sc3-spin\" size={15} /> Rédaction en cours…</> : <><Sparkles size={15} /> Proposer une réponse</>}</button>}",
    'AI suggestion button',
  );

  const header = '<header><div><ContactAvatar name={selected.contactName} url={selected.avatarUrl} /><span><strong>{selected.contactName}</strong><small>{selected.handle || selected.accountName}</small></span></div><div className="sc22-inbox-head-actions"><span className={`sc22-thread-state ${selected.unread ? \'unread\' : selected.needsReply ? \'todo\' : \'answered\'}`}>{selected.unread ? \'Non lu\' : selected.needsReply ? \'À répondre\' : \'Répondu\'}</span><b>{selected.leadStage}</b></div></header>';
  const nextHeader = '<header className="sc26-contact-header"><div className="sc26-contact-identity"><ContactAvatar name={selected.contactName} url={selected.avatarUrl} /><span><strong>{selected.contactName}</strong><small>{selected.handle || \'Profil social\'}</small><em><PlatformMark platform={selected.platform} size={11} /> {platformLabel(selected.platform)} · via {selected.accountName || accountLabel}</em></span></div><div className="sc26-contact-actions">{selected.profileUrl && <a className="sc26-profile-link" href={selected.profileUrl} target="_blank" rel="noreferrer"><Eye size={13} /> Voir le profil</a>}<span className={`sc22-thread-state ${selected.unread ? \'unread\' : selected.needsReply ? \'todo\' : \'answered\'}`}>{selected.unread ? \'Non lu\' : selected.needsReply ? \'À répondre\' : \'Répondu\'}</span><b>{selected.leadStage}</b></div></header>';
  app = replaceRequired(app, header, nextHeader, 'rich selected-contact header');

  app += '\n/* SC_INBOX_AI_UI_V3 */\n';
  fs.writeFileSync(appPath, app);
}

const mainPath = 'src/main.tsx';
let main = fs.readFileSync(mainPath, 'utf8');
if (!main.includes("./ai-ux-unification.css")) {
  main += "\nimport './ai-ux-unification.css';\n";
  fs.writeFileSync(mainPath, main);
}

console.log('Current Inbox AI loading and profile UI v3 applied.');
