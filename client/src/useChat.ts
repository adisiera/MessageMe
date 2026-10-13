import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import type {
  ApiError, ClientEvent, ConnectionStatus, Conversation, Message, ServerEvent, User,
} from './types';

interface PendingMessage {
  resolve: (message: Message) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  conversationId: string;
}

interface ChatSocket extends WebSocket {
  changedConversations?: Set<string>;
}

function mergeMessages(previous: Message[], incoming: Message[]) {
  return [...new Map([...previous, ...incoming].map((message) => [message.id, message])).values()]
    .sort((a, b) => a.id - b.id);
}

export function useChat(
  user: User,
  onError: (message: string) => void,
  onUnauthorized: () => void,
) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, Message[]>>({});
  const [hasMore, setHasMore] = useState<Record<string, boolean>>({});
  const [online, setOnline] = useState<string[]>([]);
  const [typing, setTyping] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [loading, setLoading] = useState(false);
  const [loadingChats, setLoadingChats] = useState(true);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [pendingChats, setPendingChats] = useState<string[]>([]);
  const attemptsRef = useRef(new Map<string, { text: string; clientId: string }>());
  const socketRef = useRef<ChatSocket | null>(null);
  const pendingRef = useRef(new Map<string, PendingMessage>());

  const reportError = useCallback((error: ApiError) => {
    if (error.status === 401) onUnauthorized();
    else onError(error.message || 'Unable to reach the server.');
  }, [onError, onUnauthorized]);

  const upsertConversation = useCallback((conversation: Conversation) => {
    setConversations((previous) => [
      ...previous.filter((item) => item.id !== conversation.id), conversation,
    ].sort((a, b) => (b.lastMessage?.id || 0) - (a.lastMessage?.id || 0)));
  }, []);

  useEffect(() => {
    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let generation = 0;
    const typingTimers = new Map<string, ReturnType<typeof setTimeout>>();

    function failPending() {
      for (const { reject, timer } of pendingRef.current.values()) {
        clearTimeout(timer);
        reject(new Error('Connection interrupted. Your draft is saved; reconnect and retry.'));
      }
      pendingRef.current.clear();
    }

    function connect() {
      if (cancelled) return;
      setStatus('connecting');
      const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`) as ChatSocket;
      socketRef.current = ws;
      ws.onmessage = async ({ data }) => {
        const event = JSON.parse(String(data)) as ServerEvent;
        if (event.type === 'ready') {
          attempt = 0;
          setStatus('connected');
          setOnline(event.onlineUserIds);
          // A snapshot is refreshed on every reconnect; events received during it win.
          const snapshotGeneration = ++generation;
          const updatedDuringSnapshot = new Set<string>();
          ws.changedConversations = updatedDuringSnapshot;
          try {
            const snapshot = await api<{ conversations: Conversation[]; onlineUserIds: string[] }>('/conversations');
            if (!cancelled && ws === socketRef.current && snapshotGeneration === generation) {
              setConversations((previous) => {
                const byId = new Map(snapshot.conversations.map((item) => [item.id, item]));
                for (const item of previous) if (updatedDuringSnapshot.has(item.id)) byId.set(item.id, item);
                return [...byId.values()].sort((a, b) => (b.lastMessage?.id || 0) - (a.lastMessage?.id || 0));
              });
              setLoadingChats(false);
            }
          } catch (error) { if (!cancelled) { setLoadingChats(false); reportError(error as ApiError); } }
        } else if (event.type === 'conversation') {
          ws.changedConversations?.add(event.conversation.id);
          upsertConversation(event.conversation);
          setOnline(event.onlineUserIds);
        } else if (event.type === 'message') {
          const message = event.message;
          ws.changedConversations?.add(message.conversationId);
          setMessages((previous) => ({
            ...previous,
            [message.conversationId]: mergeMessages(previous[message.conversationId] || [], [message]),
          }));
          setConversations((previous) => previous.map((item) => {
            if (item.id !== message.conversationId || (item.lastMessage?.id ?? 0) >= message.id) return item;
            return {
              ...item, lastMessage: message,
              unreadCount: item.unreadCount + (message.senderId !== user.id ? 1 : 0),
            };
          }).sort((a, b) => (b.lastMessage?.id || 0) - (a.lastMessage?.id || 0)));
          const pending = pendingRef.current.get(message.clientId);
          if (pending && message.senderId === user.id) {
            clearTimeout(pending.timer);
            pending.resolve(message);
            pendingRef.current.delete(message.clientId);
          }
          const key = `${message.conversationId}:${message.senderId}`;
          clearTimeout(typingTimers.get(key));
          setTyping((previous) => { const next = { ...previous }; delete next[key]; return next; });
        } else if (event.type === 'read') {
          ws.changedConversations?.add(event.conversationId);
          setConversations((previous) => previous.map((item) => item.id !== event.conversationId ? item : ({
            ...item,
            unreadCount: event.userId === user.id ? 0 : item.unreadCount,
            members: item.members.map((member) => member.id !== event.userId ? member : ({
              ...member, lastReadId: Math.max(member.lastReadId, event.messageId),
            })),
          })));
        } else if (event.type === 'presence') {
          setOnline((previous) => event.online
            ? [...new Set([...previous, event.userId])] : previous.filter((id) => id !== event.userId));
        } else if (event.type === 'typing') {
          const key = `${event.conversationId}:${event.userId}`;
          clearTimeout(typingTimers.get(key));
          setTyping((previous) => {
            const next = { ...previous };
            if (event.typing) next[key] = event.userId;
            else delete next[key];
            return next;
          });
          if (event.typing) typingTimers.set(key, setTimeout(() => {
            setTyping((previous) => { const next = { ...previous }; delete next[key]; return next; });
          }, 4000));
        } else if (event.type === 'error') {
          const pending = event.clientId ? pendingRef.current.get(event.clientId) : undefined;
          if (pending) {
            clearTimeout(pending.timer);
            pending.reject(new Error(event.error));
            pendingRef.current.delete(event.clientId!);
          } else onError(event.error);
        }
      };
      ws.onclose = ({ code }) => {
        if (cancelled) return;
        failPending();
        setStatus('disconnected');
        setOnline([]);
        setTyping({});
        if (code === 4001) { onUnauthorized(); return; }
        reconnectTimer = setTimeout(connect, Math.min(1000 * 2 ** attempt++, 10_000));
      };
      // Browsers supply no useful error details; close drives visible reconnect state.
      ws.onerror = () => ws.close();
    }
    connect();
    return () => {
      cancelled = true;
      clearTimeout(reconnectTimer);
      for (const timer of typingTimers.values()) clearTimeout(timer);
      failPending();
      socketRef.current?.close();
    };
  }, [user.id, onError, onUnauthorized, reportError, upsertConversation]);

  useEffect(() => {
    if (!selectedId || status !== 'connected') return;
    let cancelled = false;
    setLoading(true);
    api<{ messages: Message[]; hasMore: boolean }>(`/conversations/${selectedId}/messages`).then((data) => {
      if (cancelled) return;
      setMessages((previous) => ({
        ...previous, [selectedId]: mergeMessages(previous[selectedId] || [], data.messages),
      }));
      setHasMore((previous) => ({ ...previous, [selectedId]: data.hasMore }));
    }).catch((error: ApiError) => { if (!cancelled) reportError(error); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [selectedId, status, reportError]);

  const sendEvent = useCallback((event: ClientEvent) => {
    if (socketRef.current?.readyState !== WebSocket.OPEN) return false;
    socketRef.current.send(JSON.stringify(event));
    return true;
  }, []);

  const selected = conversations.find((item) => item.id === selectedId);
  const selectedMessages = selectedId ? messages[selectedId] || [] : [];
  const lastId = selectedMessages.at(-1)?.id;
  const lastReadId = selected?.members.find((member) => member.id === user.id)?.lastReadId || 0;
  useEffect(() => {
    const markRead = () => {
      if (document.visibilityState === 'visible' && selectedId && lastId !== undefined &&
          lastId > lastReadId && status === 'connected') {
        sendEvent({ type: 'read', conversationId: selectedId, messageId: lastId });
      }
    };
    markRead();
    document.addEventListener('visibilitychange', markRead);
    return () => document.removeEventListener('visibilitychange', markRead);
  }, [selectedId, lastId, lastReadId, status, sendEvent]);

  const sendMessage = useCallback((conversationId: string, text: string, clientId: string): Promise<Message> => {
    if ([...pendingRef.current.values()].some((item) => item.conversationId === conversationId)) {
      return Promise.reject(new Error('A message is already awaiting confirmation in this chat.'));
    }
    setPendingChats((previous) => [...previous, conversationId]);
    return new Promise<Message>((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingRef.current.delete(clientId);
        reject(new Error('Delivery was not confirmed. Your draft is saved; retry to check delivery.'));
      }, 10_000);
      pendingRef.current.set(clientId, { resolve, reject, timer, conversationId });
      if (!sendEvent({ type: 'message', conversationId, text, clientId })) {
        clearTimeout(timer);
        pendingRef.current.delete(clientId);
        reject(new Error('You are offline. Wait for the connection to return.'));
      }
    }).finally(() => {
      setPendingChats((previous) => previous.filter((id) => id !== conversationId));
    });
  }, [sendEvent]);

  const setDraft = (id: string, value: string) => setDrafts((previous) => ({ ...previous, [id]: value }));

  const loadOlder = async () => {
    if (!selectedId || loading || !hasMore[selectedId]) return;
    const id = selectedId;
    setLoading(true);
    try {
      const data = await api<{ messages: Message[]; hasMore: boolean }>(
        `/conversations/${id}/messages?before=${messages[id][0].id}`,
      );
      setMessages((previous) => ({ ...previous, [id]: mergeMessages(previous[id], data.messages) }));
      setHasMore((previous) => ({ ...previous, [id]: data.hasMore }));
    } catch (error) { reportError(error as ApiError); }
    finally { setLoading(false); }
  };

  return {
    conversations, selected, selectedId, setSelectedId, messages: selectedMessages,
    online, typing, status, loading, loadingChats, hasMore: selectedId ? hasMore[selectedId] : false,
    sendEvent, sendMessage, loadOlder, upsertConversation, reportError,
    drafts, setDraft, pendingChats, attempts: attemptsRef.current,
  };
}
