import fs from 'node:fs';

function replaceOnce(source, before, after, label) {
  if (source.includes(after)) return source;
  if (!source.includes(before)) throw new Error(`Inbox response UX patch failed: ${label} anchor not found.`);
  return source.replace(before, after);
}

const path = 'src/LiveAppV3.tsx';
let source = fs.readFileSync(path, 'utf8');
if (source.includes('SC_INBOX_RESPONSE_UX_V1')) {
  console.log('Inbox response UX already applied.');
  process.exit(0);
}

source = replaceOnce(
  source,
  `  const [reply, setReply] = useState('');\n  const [replyBusy, setReplyBusy] = useState(false);`,
  `  const [reply, setReply] = useState('');\n  const [replyBusy, setReplyBusy] = useState(false);\n  const [aiReplyBusy, setAiReplyBusy] = useState(false);`,
  'AI reply loading state',
);

const genericBefore = `    if (!runtime.outboundReady) {\n      setToast('La lecture est active, mais l’envoi réel est encore verrouillé.');\n      return;\n    }\n    setReplyBusy(true);\n    try {\n      await apiRequest('/api/messages', {\n        method: 'POST',\n        body: JSON.stringify({\n          conversationId: selectedConversation.id,\n          message: reply.trim(),\n          idempotencyKey: crypto.randomUUID(),\n        }),\n      }, workspaceId);\n      setReply('');\n      setToast('Réponse envoyée.');\n      setRefreshIndex((value) => value + 1);\n    } catch (error) {\n      setToast(readableError(error));\n    } finally {\n      setReplyBusy(false);\n    }`;
const genericAfter = `    if (!runtime.outboundReady && selectedConversation.platform !== 'youtube') {\n      setToast('L’envoi réel n’est pas disponible pour ce compte.');\n      return;\n    }\n    const submitted = reply.trim();\n    setReplyBusy(true);\n    try {\n      const result = await apiRequest<{ status?: string; message?: ConversationMessage; id?: string }>('/api/messages', {\n        method: 'POST',\n        body: JSON.stringify({\n          conversationId: selectedConversation.id,\n          message: submitted,\n          idempotencyKey: crypto.randomUUID(),\n        }),\n      }, workspaceId);\n      if (result.status === 'sent' && result.message) {\n        setReply('');\n        setMessages((current) => current && current.conversationId === selectedConversation.id ? {\n          ...current,\n          messages: [result.message!, ...current.messages.filter((message) => message.id !== result.message!.id)],\n        } : current);\n        setInbox((current) => current ? {\n          ...current,\n          conversations: current.conversations.map((conversation) => conversation.id === selectedConversation.id ? {\n            ...conversation,\n            unread: false,\n            needsReply: false,\n            lastMessageAt: result.message!.sentAt,\n            updatedAt: result.message!.sentAt,\n            latestMessage: { body: result.message!.body, direction: 'outbound', type: result.message!.type, sentAt: result.message!.sentAt },\n          } : conversation),\n        } : current);\n        setToast('Réponse envoyée et confirmée par le réseau.');\n      } else {\n        setReply('');\n        setToast('Réponse prise en charge. Confirmation du réseau en cours.');\n        setRefreshIndex((value) => value + 1);\n      }\n    } catch (error) {\n      setToast(readableError(error));\n    } finally {\n      setReplyBusy(false);\n    }`;
source = replaceOnce(source, genericBefore, genericAfter, 'provider-confirmed generic reply flow');

const suggestStart = source.indexOf('  async function suggestReply() {');
const openCreateStart = source.indexOf('  function openCreate(', suggestStart);
if (suggestStart < 0 || openCreateStart < 0) throw new Error('Inbox response UX patch failed: suggestReply section not found.');
const suggestReplacement = `  async function suggestReply() {\n    if (!workspaceId || !selectedConversation || aiReplyBusy) return;\n    if (!runtime.aiReady) {\n      setToast('Le copilote IA n’est pas encore configuré.');\n      return;\n    }\n    setAiReplyBusy(true);\n    try {\n      const result = await apiRequest<AiDraftPayload>('/api/ai/suggest', {\n        method: 'POST',\n        body: JSON.stringify({ conversationId: selectedConversation.id }),\n      }, workspaceId);\n      setReply(result.draft.body);\n    } catch (error) {\n      setToast(readableError(error));\n    } finally {\n      setAiReplyBusy(false);\n    }\n  }\n\n`;
source = source.slice(0, suggestStart) + suggestReplacement + source.slice(openCreateStart);

source = replaceOnce(
  source,
  `  useEffect(() => {\n    // In "Non lus", never open an item automatically: opening is an explicit read action.\n    if (inboxStatusFilter === 'unread') return;\n    if (!visibleConversations.length) {\n      setSelectedConversationId(undefined);\n      return;\n    }\n    if (!visibleConversations.some((conversation) => conversation.id === selectedConversationId)) {\n      setSelectedConversationId(visibleConversations[0]?.id);\n    }\n  }, [visibleConversations, selectedConversationId, inboxStatusFilter]);`,
  `  useEffect(() => {\n    // In "Non lus", opening stays an explicit read action. In every other queue, keep\n    // the current thread visible after answering even if it leaves the filtered list.\n    if (inboxStatusFilter === 'unread') return;\n    if (!selectedConversationId) {\n      if (visibleConversations.length) setSelectedConversationId(visibleConversations[0]?.id);\n      return;\n    }\n    const stillExists = inbox?.conversations.some((conversation) => conversation.id === selectedConversationId);\n    if (!stillExists) setSelectedConversationId(visibleConversations[0]?.id);\n  }, [visibleConversations, selectedConversationId, inboxStatusFilter, inbox]);`,
  'stable selected conversation after answer',
);

source = replaceOnce(
  source,
  `              reply={reply}\n              replyTargetMessageId={replyTargetMessageId}`,
  `              reply={reply}\n              replyBusy={replyBusy}\n              replyTargetMessageId={replyTargetMessageId}`,
  'pass reply busy state',
);
source = replaceOnce(
  source,
  `              onSuggest={() => void suggestReply()}`,
  `              suggestBusy={aiReplyBusy}\n              onSuggest={() => void suggestReply()}`,
  'pass AI busy state to Inbox',
);
source = replaceOnce(
  source,
  `function InboxPage({ conversations, selected, messages, loading, query, filter, statusFilter, refreshBusy, sync, reply, replyTargetMessageId, outboundReady, aiReady, accountLabel, onQuery, onFilter, onStatusFilter, onRefresh, onSelect, onReply, onReplyTarget, onSend, onSuggest, onOpenPublication }: {`,
  `function InboxPage({ conversations, selected, messages, loading, query, filter, statusFilter, refreshBusy, sync, reply, replyBusy, replyTargetMessageId, outboundReady, aiReady, suggestBusy, accountLabel, onQuery, onFilter, onStatusFilter, onRefresh, onSelect, onReply, onReplyTarget, onSend, onSuggest, onOpenPublication }: {`,
  'InboxPage busy prop signature',
);
source = replaceOnce(
  source,
  `  reply: string;\n  replyTargetMessageId?: string;`,
  `  reply: string;\n  replyBusy: boolean;\n  replyTargetMessageId?: string;`,
  'InboxPage reply busy prop type',
);
source = replaceOnce(
  source,
  `  aiReady: boolean;\n  accountLabel: string;`,
  `  aiReady: boolean;\n  suggestBusy: boolean;\n  accountLabel: string;`,
  'InboxPage AI busy prop type',
);
source = replaceOnce(
  source,
  `  const canSendReply = selected?.platform === 'threads' ? threadsReplyReady : outboundReady;`,
  `  const youtubeCommentReplyReady = selected?.platform === 'youtube' && selected.latestMessage?.type === 'comment';\n  const canSendReply = selected?.platform === 'threads' ? threadsReplyReady : youtubeCommentReplyReady || outboundReady;`,
  'YouTube reply readiness',
);
source = replaceOnce(
  source,
  `{aiReady && <button onClick={onSuggest}><Sparkles size={15} /> Proposer une réponse</button>}`,
  `{aiReady && <div className="sc27-ai-reply-wrap"><button type="button" onClick={onSuggest} disabled={suggestBusy} className={suggestBusy ? 'busy' : ''}>{suggestBusy ? <LoaderCircle className="sc3-spin" size={15} /> : <Sparkles size={15} />} {suggestBusy ? 'Rédaction en cours…' : 'Proposer une réponse'}</button>{suggestBusy && <small>L’IA analyse le profil, le message et son contexte…</small>}</div>}`,
  'AI loading button',
);
source = replaceOnce(
  source,
  `<header><div><ContactAvatar name={selected.contactName} url={selected.avatarUrl} /><span><strong>{selected.contactName}</strong><small>{selected.handle || selected.accountName}</small></span></div>`,
  `<header><div><ContactAvatar name={selected.contactName} url={selected.avatarUrl} /><span className="sc27-contact-identity"><strong>{selected.contactName}</strong><small>{selected.handle || platformLabel(selected.platform)} · {platformLabel(selected.platform)} · via {selected.accountName || 'Compte connecté'} · {selected.latestMessage?.type === 'comment' ? 'Commentaire public' : 'Message privé'}</small></span></div>`,
  'richer thread identity',
);
source = replaceOnce(
  source,
  `<button type="submit" disabled={!canSendReply || !reply.trim()}><Send size={17} /></button>`,
  `<button type="submit" disabled={!canSendReply || !reply.trim() || replyBusy} aria-label={replyBusy ? 'Envoi en cours' : 'Envoyer'}>{replyBusy ? <LoaderCircle className="sc3-spin" size={17} /> : <Send size={17} />}</button>`,
  'send button loading state',
);

if (!source.includes('replyBusy={replyBusy}')) throw new Error('Inbox response UX patch failed: replyBusy not wired.');
if (!source.includes('suggestBusy={aiReplyBusy}')) throw new Error('Inbox response UX patch failed: suggestBusy not wired.');
if (!source.includes('Rédaction en cours…')) throw new Error('Inbox response UX patch failed: AI loading text missing.');
if (!source.includes('youtubeCommentReplyReady')) throw new Error('Inbox response UX patch failed: YouTube reply readiness missing.');

source += '\n/* SC_INBOX_RESPONSE_UX_V1 */\n';
fs.writeFileSync(path, source);

const cssPath = 'src/inbox-reply-ai-ux.css';
if (!fs.existsSync(cssPath)) {
  fs.writeFileSync(cssPath, `.sc27-ai-reply-wrap{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.sc27-ai-reply-wrap>button{display:inline-flex;align-items:center;gap:6px}.sc27-ai-reply-wrap>button.busy{cursor:wait;opacity:.75}.sc27-ai-reply-wrap>small{font-size:10px;color:#777d94}.sc27-contact-identity{display:grid;gap:2px;min-width:0}.sc27-contact-identity>small{white-space:normal;line-height:1.35}.sc3-message.outbound{margin-left:auto;background:#f0ebff;border-color:#d7c7ff}.sc3-message.outbound small{color:#6750a4}.sc3-reply button:disabled{cursor:not-allowed;opacity:.62}\n`);
}
const mainPath = 'src/main.tsx';
let main = fs.readFileSync(mainPath, 'utf8');
if (!main.includes("./inbox-reply-ai-ux.css")) {
  main += `\nimport './inbox-reply-ai-ux.css';\n`;
  fs.writeFileSync(mainPath, main);
}
console.log('Inbox reply loading, stable selection, profile identity and provider-confirmed send UX applied.');
