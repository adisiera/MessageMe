import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatView } from '../ChatView';
import { NewChatDialog } from '../NewChatDialog';
import { api } from '../api';

jest.mock('../api', () => ({ api: jest.fn() }));

function makeChat(overrides = {}) {
  return {
    selected: { id: 'c1', name: null, members: [
      { id: 'alice', name: 'Alice', lastReadId: 1 }, { id: 'bob', name: 'Bob', lastReadId: 1 },
    ] },
    messages: [{ id: 1, senderId: 'alice', text: 'Hello Bob', createdAt: '2026-01-01T10:00:00Z' }],
    status: 'connected', online: ['bob'], typing: {}, loading: false,
    sendEvent: jest.fn(), sendMessage: jest.fn().mockResolvedValue({ id: 2 }),
    setSelectedId: jest.fn(), loadOlder: jest.fn(),
    drafts: {}, pendingChats: [], attempts: new Map(),
    ...overrides,
  };
}

function StatefulChatView({ chat, onError = jest.fn() }) {
  const [drafts, setDrafts] = useState({});
  return <ChatView chat={{
    ...chat, drafts,
    setDraft: (id, value) => setDrafts((previous) => ({ ...previous, [id]: value })),
  }} user={{ id: 'alice' }} onError={onError} />;
}

test('renders history and read receipts and sends a message on Enter', async () => {
  const user = userEvent.setup();
  const chat = makeChat();
  render(<StatefulChatView chat={chat} />);
  expect(screen.getByText('Hello Bob')).toBeInTheDocument();
  expect(screen.getByLabelText('Read by everyone')).toBeInTheDocument();
  await user.type(screen.getByLabelText('Message'), 'Hi again{Enter}');
  await waitFor(() => expect(chat.sendMessage).toHaveBeenCalledWith('c1', 'Hi again', expect.any(String)));
  await waitFor(() => expect(screen.getByLabelText('Message')).toHaveValue(''));
});

test('keeps the draft and reuses the message ID when an unconfirmed delivery is retried', async () => {
  const user = userEvent.setup();
  const chat = makeChat({ sendMessage: jest.fn()
    .mockRejectedValueOnce(new Error('Delivery was not confirmed'))
    .mockResolvedValueOnce({ id: 2 }) });
  const onError = jest.fn();
  render(<StatefulChatView chat={chat} onError={onError} />);
  await user.type(screen.getByLabelText('Message'), 'Retriable message');
  await user.click(screen.getByRole('button', { name: 'Send message' }));
  await waitFor(() => expect(onError).toHaveBeenCalledWith('Delivery was not confirmed'));
  expect(screen.getByLabelText('Message')).toHaveValue('Retriable message');
  await user.click(screen.getByRole('button', { name: 'Send message' }));
  expect(chat.sendMessage.mock.calls[0][2]).toBe(chat.sendMessage.mock.calls[1][2]);
});

test('disables sending while offline and shows typing status', async () => {
  render(<ChatView chat={makeChat({ status: 'disconnected', typing: { 'c1:bob': 'bob' } })}
    user={{ id: 'alice' }} onError={jest.fn()} />);
  expect(screen.getByText('Bob is typing...')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
});

test('creates a named group with selected contacts', async () => {
  const user = userEvent.setup();
  api.mockImplementation((path) => path.startsWith('/users')
    ? Promise.resolve({ users: [{ id: 'bob', name: 'Bob' }, { id: 'carol', name: 'Carol' }] })
    : Promise.resolve({ conversation: { id: 'group' } }));
  const onCreated = jest.fn();
  render(<NewChatDialog open onClose={jest.fn()} onCreated={onCreated} onError={jest.fn()} />);
  await user.click(await screen.findByRole('button', { name: 'Select Bob' }));
  await user.click(screen.getByRole('button', { name: 'Select Carol' }));
  await user.type(screen.getByLabelText('Group name'), 'Weekend crew');
  await user.click(screen.getByRole('button', { name: 'Start chat' }));
  await waitFor(() => expect(onCreated).toHaveBeenCalledWith({ id: 'group' }));
  expect(api).toHaveBeenCalledWith('/conversations', {
    method: 'POST', body: { memberIds: ['bob', 'carol'], name: 'Weekend crew' },
  });
});
