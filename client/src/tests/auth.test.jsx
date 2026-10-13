import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthScreen } from '../AuthScreen';
import { api } from '../api';
import { App } from '../App';

jest.mock('../api', () => ({ api: jest.fn() }));

test('submits registration with the correct payload', async () => {
  const user = userEvent.setup();
  const onAuthenticated = jest.fn();
  api.mockResolvedValue({ user: { id: '1', name: 'Alice' } });
  render(<AuthScreen onAuthenticated={onAuthenticated} />);
  await user.click(screen.getByRole('button', { name: 'New here? Create an account' }));
  await user.type(screen.getByLabelText(/Display name/), 'Alice');
  await user.type(screen.getByLabelText(/Email address/), 'alice@example.test');
  await user.type(screen.getByLabelText(/Password/), 'my-long-password');
  await user.click(screen.getByRole('button', { name: 'Create account' }));
  await waitFor(() => expect(onAuthenticated).toHaveBeenCalledWith({ id: '1', name: 'Alice' }));
  expect(api).toHaveBeenCalledWith('/auth/register', {
    method: 'POST', body: { name: 'Alice', email: 'alice@example.test', password: 'my-long-password' },
  });
});

test('shows failed sign-in errors without navigating', async () => {
  const user = userEvent.setup();
  api.mockRejectedValue(new Error('Email or password is incorrect.'));
  render(<AuthScreen onAuthenticated={jest.fn()} />);
  await user.type(screen.getByLabelText(/Email address/), 'alice@example.test');
  await user.type(screen.getByLabelText(/Password/), 'my-long-password');
  await user.click(screen.getByRole('button', { name: 'Sign in', exact: true }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Email or password is incorrect.');
});

test('distinguishes a server outage from an unauthenticated session and offers retry', async () => {
  const user = userEvent.setup();
  api.mockRejectedValueOnce(new Error('Server unavailable'))
    .mockRejectedValueOnce(Object.assign(new Error('Sign in'), { status: 401 }));
  render(<App />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Server unavailable');
  await user.click(screen.getByRole('button', { name: 'Retry connection' }));
  expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
});
