import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert, Avatar, Badge, Box, Button, Chip, CircularProgress, IconButton, InputAdornment,
  List, ListItemAvatar, ListItemButton, ListItemText, Snackbar, Stack, TextField, Tooltip, Typography,
} from '@mui/material';
import AddCommentRounded from '@mui/icons-material/AddCommentRounded';
import ChatRounded from '@mui/icons-material/ChatRounded';
import ForumRounded from '@mui/icons-material/ForumRounded';
import GroupRounded from '@mui/icons-material/GroupRounded';
import LogoutRounded from '@mui/icons-material/LogoutRounded';
import SearchRounded from '@mui/icons-material/SearchRounded';
import { api } from './api';
import { AuthScreen } from './Components/AuthScreen';
import { ChatView, conversationTitle } from './Components/ChatView';
import { NewChatDialog } from './Components/NewChatDialog';
import { useChat } from './useChat';
import type { ApiError, User } from './types';

interface ChatWorkspaceProps {
  user: User;
  onLogout: () => void;
  onError: (message: string) => void;
  onUnauthorized: () => void;
}

function ChatWorkspace({ user, onLogout, onError, onUnauthorized }: ChatWorkspaceProps) {
  const logoutRef = useRef(false);
  const onSessionEnded = useCallback(() => {
    if (!logoutRef.current) onUnauthorized();
  }, [onUnauthorized]);
  const chat = useChat(user, onError, onSessionEnded);
  const [newChat, setNewChat] = useState(false);
  const [query, setQuery] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const filtered = chat.conversations.filter((item) =>
    conversationTitle(item, user.id).toLowerCase().includes(query.toLowerCase()) && (!unreadOnly || item.unreadCount > 0));

  async function logout() {
    logoutRef.current = true;
    setSigningOut(true);
    try { await api('/auth/logout', { method: 'POST' }); onLogout(); }
    catch (error) { logoutRef.current = false; chat.reportError(error as ApiError); }
    finally { setSigningOut(false); }
  }

  return (
    <Box sx={{ height: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ px: { xs: 2, md: 4 }, py: 1.5, bgcolor: 'primary.dark', color: 'primary.contrastText' }}>
        <Stack direction="row" spacing={1} alignItems="center"><ChatRounded /><Typography fontWeight={700}>MessageMe</Typography></Stack>
        <Stack direction="row" spacing={1} alignItems="center">
          <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: chat.status === 'connected' ? 'success.light' : 'warning.main' }} />
          <Typography variant="caption" role="status">{chat.status === 'connected' ? 'Connected' : chat.status === 'connecting' ? 'Connecting...' : 'Reconnecting...'}</Typography>
        </Stack>
      </Stack>
      <Box sx={{
        flex: 1, minHeight: 0, display: 'flex', width: '100%', maxWidth: 1440, mx: 'auto',
        my: { xs: 0, lg: 3 }, boxShadow: { lg: 8 }, borderRadius: { lg: 2 }, overflow: 'hidden',
      }}>
        <Stack sx={{
          bgcolor: 'background.paper', width: { xs: '100%', md: 360 }, flexShrink: 0,
          borderRight: 1, borderColor: 'divider', display: { xs: chat.selected ? 'none' : 'flex', md: 'flex' },
        }}>
          <Stack direction="row" alignItems="center" spacing={1.5} sx={{ p: 2, bgcolor: 'action.hover' }}>
            <Avatar sx={{ bgcolor: 'primary.main' }}>{user.name[0].toUpperCase()}</Avatar>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography fontWeight={650} noWrap>{user.name}</Typography><Typography variant="caption" color="text.secondary">Your conversations</Typography>
            </Box>
            <Tooltip title="New chat"><IconButton aria-label="New chat" onClick={() => setNewChat(true)}><AddCommentRounded /></IconButton></Tooltip>
            <Tooltip title="Sign out"><IconButton aria-label="Sign out" onClick={logout} disabled={signingOut}><LogoutRounded fontSize="small" /></IconButton></Tooltip>
          </Stack>
          <Box sx={{ p: 2, pb: 1 }}>
            <Typography variant="h5" sx={{ mb: 2 }}>Chats</Typography>
            <TextField fullWidth label="Search chats" value={query} onChange={(event) => setQuery(event.target.value)}
              slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchRounded fontSize="small" /></InputAdornment> } }} />
            <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
              <Chip label="All" size="small" color={!unreadOnly ? 'primary' : 'default'} onClick={() => setUnreadOnly(false)} />
              <Chip label="Unread" size="small" color={unreadOnly ? 'primary' : 'default'} onClick={() => setUnreadOnly(true)} />
            </Stack>
          </Box>
          <List sx={{ flex: 1, minHeight: 0, overflowY: 'auto', p: 0 }} aria-label="Conversations">
            {chat.loadingChats && <Box sx={{ p: 4, textAlign: 'center' }}><CircularProgress size={26} aria-label="Loading conversations" /></Box>}
            {filtered.map((conversation) => {
              const title = conversationTitle(conversation, user.id);
              const other = conversation.members.find((member) => member.id !== user.id);
              const isOnline = !conversation.name && !!other && chat.online.includes(other.id);
              return (
                <ListItemButton key={conversation.id} selected={chat.selectedId === conversation.id}
                  onClick={() => chat.setSelectedId(conversation.id)} aria-label={`Open chat with ${title}`}
                  sx={{ py: 1.7, '&.Mui-selected': { bgcolor: 'action.selected' } }}>
                  <ListItemAvatar>
                    <Badge variant="dot" color="success" invisible={!isOnline} overlap="circular" anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}>
                      <Avatar sx={{ bgcolor: conversation.name ? 'info.main' : 'primary.main' }}>{conversation.name ? <GroupRounded /> : title[0].toUpperCase()}</Avatar>
                    </Badge>
                  </ListItemAvatar>
                  <ListItemText primary={<Typography fontWeight={conversation.unreadCount ? 700 : 600} noWrap>{title}</Typography>}
                    secondary={<Typography variant="body2" color="text.secondary" noWrap>
                      {conversation.lastMessage ? `${conversation.lastMessage.senderId === user.id ? 'You: ' : ''}${conversation.lastMessage.text}` : 'Start the conversation'}
                    </Typography>} sx={{ minWidth: 0 }} />
                  <Stack alignItems="flex-end" spacing={1} sx={{ ml: 1 }}>
                    <Typography variant="caption" color="text.secondary">
                      {conversation.lastMessage && new Date(conversation.lastMessage.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </Typography>
                    {!!conversation.unreadCount && <Chip size="small" label={conversation.unreadCount} color="success" />}
                  </Stack>
                </ListItemButton>
              );
            })}
            {!chat.loadingChats && !filtered.length && <Stack alignItems="center" spacing={1.5} sx={{ p: 4, textAlign: 'center' }}>
              <ForumRounded fontSize="large" sx={{ color: 'action.disabled' }} />
              <Typography color="text.secondary">{chat.conversations.length ? 'No matching chats.' : 'Your next conversation starts here.'}</Typography>
              {!chat.conversations.length && <Button onClick={() => setNewChat(true)}>Start a new chat</Button>}
            </Stack>}
          </List>
          <Typography variant="caption" color="text.secondary" sx={{ p: 2, borderTop: 1, borderColor: 'divider' }}>Locally hosted. Made for staying close.</Typography>
        </Stack>
        <Box sx={{ flex: 1, minWidth: 0, display: { xs: chat.selected ? 'block' : 'none', md: 'block' }, bgcolor: 'background.default' }}>
          {chat.selected ? <ChatView key={chat.selected.id} chat={chat} user={user} onError={onError} /> : (
            <Stack alignItems="center" justifyContent="center" spacing={2} sx={{ height: '100%', p: 4, textAlign: 'center', borderBottom: 5, borderColor: 'secondary.main' }}>
              <Box sx={{ p: 4, bgcolor: 'primary.light', borderRadius: '50%', mb: 1 }}><ForumRounded sx={{ fontSize: 80, color: 'primary.main' }} /></Box>
              <Typography variant="h4">A little closer, wherever you are.</Typography>
              <Typography color="text.secondary" sx={{ maxWidth: 400 }}>Choose a conversation or start a new one. Messages and chat history stay on your server.</Typography>
              <Button variant="contained" startIcon={<AddCommentRounded />} onClick={() => setNewChat(true)}>New conversation</Button>
              <Typography variant="caption" color="text.secondary" sx={{ pt: 4 }}>Messages are not end-to-end encrypted.</Typography>
            </Stack>
          )}
        </Box>
      </Box>
      <NewChatDialog open={newChat} onClose={() => setNewChat(false)} onError={chat.reportError}
        onCreated={(conversation) => { chat.upsertConversation(conversation); chat.setSelectedId(conversation.id); }} />
    </Box>
  );
}

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [startupError, setStartupError] = useState('');
  const [notification, setNotification] = useState('');
  const [retry, setRetry] = useState(0);
  const onError = useCallback((message: string) => setNotification(message), []);
  const onUnauthorized = useCallback(() => {
    setUser(null);
    setNotification('Your session ended. Please sign in again.');
  }, []);

  useEffect(() => {
    let cancelled = false;
    setInitializing(true);
    setStartupError('');
    api<{ user: User }>('/auth/me').then((data) => { if (!cancelled) setUser(data.user); })
      .catch((failure: ApiError) => { if (!cancelled && failure.status !== 401) setStartupError(failure.message); })
      .finally(() => { if (!cancelled) setInitializing(false); });
    return () => { cancelled = true; };
  }, [retry]);

  if (initializing) return <Stack alignItems="center" justifyContent="center" sx={{ height: '100%' }}><CircularProgress aria-label="Loading MessageMe" /></Stack>;
  if (startupError) return <Stack alignItems="center" justifyContent="center" spacing={2} sx={{ height: '100%', p: 3 }}>
    <Alert severity="error">{startupError}</Alert><Button onClick={() => setRetry((value) => value + 1)}>Retry connection</Button>
  </Stack>;

  return (
    <>
      {user ? <ChatWorkspace user={user} onLogout={() => setUser(null)} onError={onError} onUnauthorized={onUnauthorized} />
        : <AuthScreen onAuthenticated={setUser} />}
      <Snackbar open={!!notification} autoHideDuration={6000} onClose={() => setNotification('')}>
        <Alert severity="error" variant="filled" onClose={() => setNotification('')}>{notification}</Alert>
      </Snackbar>
    </>
  );
}
