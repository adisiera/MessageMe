import { useEffect, useLayoutEffect, useRef } from 'react';
import {
  Avatar, Box, Button, CircularProgress, IconButton, Stack, TextField, Tooltip, Typography,
} from '@mui/material';
import ArrowBackRounded from '@mui/icons-material/ArrowBackRounded';
import DoneAllRounded from '@mui/icons-material/DoneAllRounded';
import DoneRounded from '@mui/icons-material/DoneRounded';
import GroupRounded from '@mui/icons-material/GroupRounded';
import SendRounded from '@mui/icons-material/SendRounded';
import type { FormEvent } from 'react';
import type { useChat } from '../useChat';
import type { ApiError, Conversation, User } from '../types';

export const conversationTitle = (conversation: Conversation, userId: string) => conversation.name ||
  conversation.members.find((member) => member.id !== userId)?.name || 'Conversation';

const time = (timestamp: string) => new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const date = (timestamp: string) => new Date(timestamp).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });

interface ChatViewProps {
  chat: ReturnType<typeof useChat>;
  user: User;
  onError: (message: string) => void;
}

export function ChatView({ chat, user, onError }: ChatViewProps) {
  const { messages, status, online, typing, sendEvent, sendMessage } = chat;
  const selected = chat.selected!;
  const draft = chat.drafts[selected.id] || '';
  const setDraft = (value: string) => chat.setDraft(selected.id, value);
  const sending = chat.pendingChats.includes(selected.id);
  const endRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollSnapshot = useRef<{ height: number; top: number } | null>(null);
  const lastTyping = useRef(0);
  const previousLastId = useRef<number | undefined>(undefined);
  const title = conversationTitle(selected, user.id);
  const peers = selected.members.filter((member) => member.id !== user.id);
  const typers = peers.filter((member) => typing[`${selected.id}:${member.id}`]).map((member) => member.name);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    const lastId = messages.at(-1)?.id;
    if (scrollSnapshot.current && element) {
      element.scrollTop = element.scrollHeight - scrollSnapshot.current.height + scrollSnapshot.current.top;
      scrollSnapshot.current = null;
    } else if (lastId !== previousLastId.current) {
      endRef.current?.scrollIntoView({ behavior: previousLastId.current ? 'smooth' : 'instant' });
    }
    previousLastId.current = lastId;
  }, [messages]);

  useEffect(() => () => {
    sendEvent({ type: 'typing', conversationId: selected.id, typing: false });
  }, [selected.id, sendEvent]);

  function changeDraft(value: string) {
    setDraft(value);
    if (Date.now() - lastTyping.current > 1500 || !value) {
      sendEvent({ type: 'typing', conversationId: selected.id, typing: !!value.trim() });
      lastTyping.current = Date.now();
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft.trim() || sending || status !== 'connected') return;
    const text = draft.trim();
    const lastAttempt = chat.attempts.get(selected.id);
    const clientId = lastAttempt?.text === text ? lastAttempt.clientId : crypto.randomUUID();
    chat.attempts.set(selected.id, { text, clientId });
    try {
      await sendMessage(selected.id, text, clientId);
      setDraft('');
      chat.attempts.delete(selected.id);
      sendEvent({ type: 'typing', conversationId: selected.id, typing: false });
    } catch (error) { onError((error as ApiError).message); }
  }

  async function older() {
    const element = scrollRef.current;
    if (!element) return;
    scrollSnapshot.current = { height: element.scrollHeight, top: element.scrollTop };
    await chat.loadOlder();
  }

  return (
    <Stack sx={{ height: '100%', minWidth: 0 }}>
      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ px: { xs: 1, md: 3 }, py: 1.5, bgcolor: 'action.hover', borderBottom: 1, borderColor: 'divider' }}>
        <IconButton aria-label="Back to chats" sx={{ display: { md: 'none' } }} onClick={() => chat.setSelectedId(null)}><ArrowBackRounded /></IconButton>
        <Avatar sx={{ bgcolor: selected.name ? 'info.main' : 'primary.main' }}>{selected.name ? <GroupRounded /> : title[0].toUpperCase()}</Avatar>
        <Box sx={{ minWidth: 0 }}>
          <Typography fontWeight={650} noWrap>{title}</Typography>
          <Typography variant="caption" color={typers.length ? 'primary' : 'text.secondary'} aria-live="polite">
            {typers.length ? `${typers.join(', ')} ${typers.length === 1 ? 'is' : 'are'} typing...`
              : selected.name ? `${selected.members.length} members`
                : online.includes(peers[0]?.id) ? 'Online' : 'Offline'}
          </Typography>
        </Box>
      </Stack>
      <Box ref={scrollRef} className="chat-wallpaper" sx={{ flex: 1, minHeight: 0, overflowY: 'auto', p: { xs: 2, md: 4 } }}>
        <Stack spacing={1} sx={{ maxWidth: 900, mx: 'auto' }} role="log" aria-label="Chat messages" aria-live="polite">
          {chat.hasMore && <Button onClick={older} disabled={chat.loading} size="small" sx={{ alignSelf: 'center', bgcolor: 'background.paper' }}>Load older messages</Button>}
          {chat.loading && <CircularProgress size={24} sx={{ alignSelf: 'center' }} aria-label="Loading messages" />}
          {!chat.loading && !messages.length && <Typography align="center" variant="body2" color="text.secondary" sx={{ py: 6 }}>Say hello to start the conversation.</Typography>}
          {messages.map((message: import('../types').Message, index: number) => {
            const own = message.senderId === user.id;
            const read = peers.every((member) => member.lastReadId >= message.id);
            const sender = selected.members.find((member) => member.id === message.senderId);
            const showDate = !index || date(messages[index - 1].createdAt) !== date(message.createdAt);
            return (
              <Box key={message.id}>
                {showDate && <Typography align="center" variant="caption" component="div" sx={{ my: 2 }}>
                  <Box component="span" sx={{ bgcolor: 'background.paper', px: 2, py: 0.75, borderRadius: 2 }}>{date(message.createdAt)}</Box>
                </Typography>}
                <Box sx={{
                  bgcolor: own ? 'primary.light' : 'background.paper', ml: own ? 'auto' : 0, mr: own ? 0 : 'auto',
                  width: 'fit-content', maxWidth: { xs: '88%', md: '72%' }, px: 1.5, pt: 1, pb: 0.5,
                  borderRadius: 2, borderTopRightRadius: own ? 0 : 8, borderTopLeftRadius: own ? 8 : 0,
                  boxShadow: 1,
                }}>
                  {selected.name && !own && <Typography variant="caption" fontWeight={700} color="primary">{sender?.name}</Typography>}
                  <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', lineHeight: 1.6 }}>{message.text}</Typography>
                  <Stack direction="row" spacing={0.5} justifyContent="flex-end" alignItems="center">
                    <Typography variant="caption" color="text.secondary">{time(message.createdAt)}</Typography>
                    {own && <Tooltip title={read ? 'Read by everyone' : 'Saved on server'}>{read
                      ? <DoneAllRounded aria-label="Read by everyone" fontSize="small" color="info" />
                      : <DoneRounded aria-label="Saved on server" sx={{ fontSize: 16, color: 'text.secondary' }} />}</Tooltip>}
                  </Stack>
                </Box>
              </Box>
            );
          })}
          <div ref={endRef} />
        </Stack>
      </Box>
      <Stack component="form" onSubmit={submit} direction="row" alignItems="center" spacing={1.5} sx={{ p: 2, bgcolor: 'action.hover' }}>
        <TextField fullWidth multiline maxRows={4} label="Message" placeholder="Type a message"
          value={draft} disabled={sending} onChange={(event) => changeDraft(event.target.value)}
          slotProps={{ htmlInput: { maxLength: 4000 } }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              submit(event);
            }
          }}
          sx={{ '& .MuiOutlinedInput-root': { bgcolor: 'background.paper' } }} />
        <Tooltip title={status !== 'connected' ? 'Waiting for connection' : 'Send message'}>
          <span><IconButton aria-label="Send message" type="submit" color="primary"
            disabled={!draft.trim() || sending || status !== 'connected'}
            sx={{ bgcolor: 'primary.main', color: 'primary.contrastText', '&:hover': { bgcolor: 'primary.dark' } }}>
            {sending ? <CircularProgress size={22} color="inherit" /> : <SendRounded />}
          </IconButton></span>
        </Tooltip>
      </Stack>
    </Stack>
  );
}
