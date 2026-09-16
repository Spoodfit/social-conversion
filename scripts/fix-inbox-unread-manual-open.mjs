import fs from 'node:fs';

const appPath = 'src/LiveAppV3.tsx';
let app = fs.readFileSync(appPath, 'utf8');

if (!app.includes('SC_INBOX_UNREAD_MANUAL_SELECTION_V1')) {
  const autoSelectBefore = `  useEffect(() => {\n    if (!visibleConversations.length) {\n      setSelectedConversationId(undefined);\n      return;\n    }\n    if (!visibleConversations.some((conversation) => conversation.id === selectedConversationId)) {\n      setSelectedConversationId(visibleConversations[0]?.id);\n    }\n  }, [visibleConversations, selectedConversationId]);`;
  const autoSelectAfter = `  useEffect(() => {\n    // In \"Non lus\", never open an item automatically: opening is an explicit read action.\n    if (inboxStatusFilter === 'unread') return;\n    if (!visibleConversations.length) {\n      setSelectedConversationId(undefined);\n      return;\n    }\n    if (!visibleConversations.some((conversation) => conversation.id === selectedConversationId)) {\n      setSelectedConversationId(visibleConversations[0]?.id);\n    }\n  }, [visibleConversations, selectedConversationId, inboxStatusFilter]);\n\n  useEffect(() => {\n    // Entering the unread queue starts with no conversation selected.\n    // Once the user clicks one, keep its detail open even after it leaves the unread list.\n    if (inboxStatusFilter !== 'unread') return;\n    setSelectedConversationId(undefined);\n    setMessages(undefined);\n  }, [inboxStatusFilter]);`;
  if (!app.includes(autoSelectBefore)) {
    throw new Error('Inbox unread manual selection patch failed: auto-select effect anchor not found.');
  }
  app = app.replace(autoSelectBefore, autoSelectAfter);

  const autoReadBefore = `  useEffect(() => {\n    if (!workspaceId || page !== 'inbox' || !selectedConversationId) return;\n    const conversation = inbox?.conversations.find((candidate) => candidate.id === selectedConversationId);\n    if (!conversation?.unread) return;\n    void apiRequest(\`/api/inbox/conversations/\${encodeURIComponent(selectedConversationId)}/read\`, { method: 'POST' }, workspaceId)\n      .then(() => setInbox((current) => current ? {\n        ...current,\n        conversations: current.conversations.map((candidate) => candidate.id === selectedConversationId ? { ...candidate, unread: false } : candidate),\n      } : current))\n      .catch((error) => setToast(readableError(error)));\n  }, [workspaceId, page, selectedConversationId, inbox]);`;
  const explicitReadAfter = `  async function selectInboxConversation(conversationId: string) {\n    setSelectedConversationId(conversationId);\n    const conversation = inbox?.conversations.find((candidate) => candidate.id === conversationId);\n    if (!workspaceId || !conversation?.unread) return;\n    try {\n      await apiRequest(\`/api/inbox/conversations/\${encodeURIComponent(conversationId)}/read\`, { method: 'POST' }, workspaceId);\n      setInbox((current) => current ? {\n        ...current,\n        conversations: current.conversations.map((candidate) => candidate.id === conversationId ? { ...candidate, unread: false } : candidate),\n      } : current);\n    } catch (error) {\n      setToast(readableError(error));\n    }\n  }`;
  if (!app.includes(autoReadBefore)) {
    throw new Error('Inbox unread manual selection patch failed: automatic read effect anchor not found.');
  }
  app = app.replace(autoReadBefore, explicitReadAfter);

  const selectProp = '              onSelect={setSelectedConversationId}';
  const explicitSelectProp = '              onSelect={(conversationId) => void selectInboxConversation(conversationId)}';
  if (!app.includes(selectProp)) {
    throw new Error('Inbox unread manual selection patch failed: Inbox onSelect anchor not found.');
  }
  app = app.replace(selectProp, explicitSelectProp);

  app += '\n/* SC_INBOX_UNREAD_MANUAL_SELECTION_V1 */\n';
  fs.writeFileSync(appPath, app);
}

console.log('Unread Inbox now requires an explicit click before marking a conversation as read.');
