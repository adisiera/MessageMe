import { useState } from 'react';
import {
  Alert, Box, Button, CircularProgress, Paper, Stack, TextField, Typography,
} from '@mui/material';
import ChatRounded from '@mui/icons-material/ChatRounded';
import ForumRounded from '@mui/icons-material/ForumRounded';
import LockOutlined from '@mui/icons-material/LockOutlined';
import BoltRounded from '@mui/icons-material/BoltRounded';
import { api } from '../api';
import type { ApiError, User } from '../types';

interface AuthScreenProps {
  onAuthenticated: (user: User) => void;
}

export function AuthScreen({ onAuthenticated }: AuthScreenProps) {
  const [register, setRegister] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError('');
    setBusy(true);
    try {
      const { user } = await api<{ user: User }>(`/auth/${register ? 'register' : 'login'}`, {
        method: 'POST',
        body: { name: form.get('name'), email: form.get('email'), password: form.get('password') },
      });
      onAuthenticated(user);
    } catch (failure) { setError((failure as ApiError).message); }
    finally { setBusy(false); }
  }

  return (
    <Box sx={{
      minHeight: '100%', display: 'grid', placeItems: 'center', p: { xs: 2, md: 5 },
      background: (theme) => `linear-gradient(135deg, ${theme.palette.primary.dark} 0%, ${theme.palette.primary.main} 45%, ${theme.palette.background.default} 45%)`,
    }}>
      <Paper elevation={8} sx={{
        width: '100%', maxWidth: 960, overflow: 'hidden', display: 'grid',
        gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, borderRadius: 5,
      }}>
        <Stack spacing={4} sx={{ p: { xs: 4, md: 6 }, bgcolor: 'action.hover', justifyContent: 'center' }}>
          <Stack direction="row" spacing={1.5} alignItems="center">
            <ChatRounded sx={{ fontSize: 38, color: 'primary.main' }} />
            <Typography variant="h5">MessageMe</Typography>
          </Stack>
          <Box>
            <Typography variant="h4" sx={{ mb: 2 }}>Good conversations.<br />Closer connections.</Typography>
            <Typography color="text.secondary">Your people, one message away. A familiar space for everyday catch-ups and group conversations.</Typography>
          </Box>
          <Stack spacing={2}>
            {([
              [ForumRounded, 'Direct chats & groups'],
              [BoltRounded, 'Messages delivered in real time'],
              [LockOutlined, 'Your own locally hosted server'],
            ] as const).map(([Icon, text]) => (
              <Stack key={text} direction="row" spacing={1.5} alignItems="center">
                <Icon color="primary" fontSize="small" /><Typography variant="body2">{text}</Typography>
              </Stack>
            ))}
          </Stack>
          <Typography variant="caption" color="text.secondary">An independent chat app. Not affiliated with WhatsApp.</Typography>
        </Stack>
        <Stack component="form" onSubmit={submit} spacing={2.5} sx={{ p: { xs: 4, md: 6 }, justifyContent: 'center' }}>
          <Box>
            <Typography variant="h5">{register ? 'Create your account' : 'Welcome back'}</Typography>
            <Typography color="text.secondary" sx={{ mt: 1 }}>
              {register ? 'Start a conversation that matters.' : 'Sign in to pick up where you left off.'}
            </Typography>
          </Box>
          {error && <Alert severity="error">{error}</Alert>}
          {register && <TextField required name="name" label="Display name" autoComplete="nickname" slotProps={{ htmlInput: { maxLength: 50 } }} />}
          <TextField required name="email" label="Email address" type="email" autoComplete="email" slotProps={{ htmlInput: { maxLength: 254 } }} />
          <TextField required name="password" label="Password" type="password"
            autoComplete={register ? 'new-password' : 'current-password'}
            helperText={register ? 'Use 12-128 characters.' : undefined}
            slotProps={{ htmlInput: { minLength: 12, maxLength: 128 } }} />
          <Button type="submit" variant="contained" size="large" disabled={busy}>
            {busy ? <CircularProgress size={24} color="inherit" /> : register ? 'Create account' : 'Sign in'}
          </Button>
          <Button disabled={busy} onClick={() => { setRegister(!register); setError(''); }}>
            {register ? 'Already have an account? Sign in' : 'New here? Create an account'}
          </Button>
        </Stack>
      </Paper>
    </Box>
  );
}
