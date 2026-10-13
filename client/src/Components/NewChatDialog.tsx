import { useEffect, useState } from 'react';
import {
  Alert, Avatar, Box, Button, Checkbox, CircularProgress, Dialog, DialogActions,
  DialogContent, DialogTitle, List, ListItemButton, ListItemText, Stack, TextField, Typography,
} from '@mui/material';
import { api } from '../api';
import type { ApiError, Conversation, User } from '../types';

interface NewChatDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: (conversation: Conversation) => void;
  onError: (error: ApiError) => void;
}

export function NewChatDialog({ open, onClose, onCreated, onError }: NewChatDialogProps) {
  const [users, setUsers] = useState<Pick<User, 'id' | 'name'>[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setSelected([]);
    setName('');
    setQuery('');
    setError('');
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const data = await api<{ users: Pick<User, 'id' | 'name'>[] }>(`/users?q=${encodeURIComponent(query)}`);
        if (!cancelled) { setUsers(data.users); setError(''); }
      } catch (failure) {
        const error = failure as ApiError;
        if (!cancelled) { setError(error.message); if (error.status === 401) onError(error); }
      } finally { if (!cancelled) setLoading(false); }
    }, 200);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [open, query, onError]);

  async function create() {
    setBusy(true);
    setError('');
    try {
      const data = await api<{ conversation: Conversation }>('/conversations', { method: 'POST', body: { memberIds: selected, name } });
      onCreated(data.conversation);
      onClose();
    } catch (failure) {
      const error = failure as ApiError;
      setError(error.message);
      if (error.status === 401) onError(error);
    }
    finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="xs">
      <DialogTitle>Start a conversation</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Select one person for a direct chat, or several for a group.
        </Typography>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <TextField fullWidth label="Find people" value={query} onChange={(event) => setQuery(event.target.value)} />
        <Box sx={{ minHeight: 160, maxHeight: 280, overflowY: 'auto', my: 1 }}>
          {loading ? <Stack alignItems="center" sx={{ p: 4 }}><CircularProgress size={28} /></Stack> : (
            <List>
              {users.map((user) => (
                <ListItemButton key={user.id} disabled={busy || (!selected.includes(user.id) && selected.length >= 49)}
                  onClick={() => setSelected((previous) => previous.includes(user.id)
                    ? previous.filter((id) => id !== user.id) : [...previous, user.id])}
                  aria-label={`Select ${user.name}`} selected={selected.includes(user.id)}>
                  <Avatar sx={{ mr: 2, bgcolor: 'primary.main' }}>{user.name[0].toUpperCase()}</Avatar>
                  <ListItemText primary={user.name} />
                  <Checkbox checked={selected.includes(user.id)} tabIndex={-1} disableRipple
                    slotProps={{ input: { 'aria-label': user.name } }} />
                </ListItemButton>
              ))}
              {!users.length && <Typography color="text.secondary" sx={{ p: 2 }}>
                No people found. Invite a friend to create an account on this server.
              </Typography>}
            </List>
          )}
        </Box>
        <Typography variant="caption" color="text.secondary">{selected.length} selected</Typography>
        {selected.length > 1 && <TextField label="Group name" fullWidth value={name} sx={{ mt: 2 }}
          onChange={(event) => setName(event.target.value)} slotProps={{ htmlInput: { maxLength: 60 } }} />}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 3 }}>
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="contained" onClick={create} disabled={busy || !selected.length || (selected.length > 1 && !name.trim())}>
          {busy ? 'Creating...' : 'Start chat'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
