import { act, renderHook, waitFor } from '@testing-library/react';
import { useChat } from '../useChat';
import { api } from '../api';

jest.mock('../api', () => ({ api: jest.fn() }));

const conversation = {
  id: 'c1', name: null, unreadCount: 0, lastMessage: null,
  members: [{ id: 'alice', name: 'Alice', lastReadId: 0 }, { id: 'bob', name: 'Bob', lastReadId: 0 }],
};

class MockSocket {
  static OPEN = 1;
  static instances = [];
  constructor() {
    this.readyState = 1;
    this.send = jest.fn();
    MockSocket.instances.push(this);
  }
  close(code = 1000) { this.readyState = 3; this.onclose?.({ code }); }
  emit(event) { return this.onmessage({ data: JSON.stringify(event) }); }
}

const originalSocket = global.WebSocket;
beforeEach(() => {
  global.WebSocket = MockSocket;
  MockSocket.instances = [];
  api.mockImplementation((path) => path === '/conversations'
    ? Promise.resolve({ conversations: [conversation], onlineUserIds: ['alice'] })
    : Promise.resolve({ messages: [], hasMore: false }));
});
afterEach(() => { global.WebSocket = originalSocket; jest.useRealTimers(); });

async function initialize() {
  const onError = jest.fn();
  const onUnauthorized = jest.fn();
  const hook = renderHook(() => useChat({ id: 'alice' }, onError, onUnauthorized));
  const socket = MockSocket.instances[0];
  await act(async () => { await socket.emit({ type: 'ready', onlineUserIds: ['alice'] }); });
  return { ...hook, socket, onError, onUnauthorized };
}

test('deduplicates message echoes, resolves delivery and tracks read receipts', async () => {
  const { result, socket } = await initialize();
  act(() => { result.current.setSelectedId('c1'); });
  await waitFor(() => expect(result.current.loading).toBe(false));
  let delivery;
  act(() => { delivery = result.current.sendMessage('c1', 'Hello', 'm1'); });
  const message = { id: 1, conversationId: 'c1', senderId: 'alice', clientId: 'm1', text: 'Hello' };
  await act(async () => {
    await socket.emit({ type: 'message', message });
    await socket.emit({ type: 'message', message });
    await delivery;
  });
  expect(result.current.messages).toHaveLength(1);
  expect(result.current.pendingChats).toEqual([]);
  expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: 'read', conversationId: 'c1', messageId: 1 }));
  await act(async () => { await socket.emit({ type: 'read', conversationId: 'c1', userId: 'bob', messageId: 1 }); });
  expect(result.current.selected.members.find((member) => member.id === 'bob').lastReadId).toBe(1);
});

test('retains per-conversation drafts and reports failed acknowledgments explicitly', async () => {
  const { result, socket } = await initialize();
  act(() => { result.current.setDraft('c1', 'Draft that survives navigation'); });
  let delivery;
  act(() => {
    delivery = result.current.sendMessage('c1', 'Test', 'm2');
  });
  const failure = expect(delivery).rejects.toThrow('Message too long.');
  await act(async () => {
    await socket.emit({ type: 'error', clientId: 'm2', error: 'Message too long.' });
    await failure;
  });
  expect(result.current.drafts.c1).toBe('Draft that survives navigation');
  expect(result.current.pendingChats).toEqual([]);
});

test('reconnects and refreshes history, but stops on an expired session', async () => {
  const { result, socket, onUnauthorized } = await initialize();
  act(() => { result.current.setSelectedId('c1'); });
  await waitFor(() => expect(result.current.loading).toBe(false));
  jest.useFakeTimers();
  act(() => { socket.close(1006); });
  expect(result.current.status).toBe('disconnected');
  act(() => { jest.advanceTimersByTime(1000); });
  const replacement = MockSocket.instances[1];
  await act(async () => { await replacement.emit({ type: 'ready', onlineUserIds: ['bob'] }); });
  expect(result.current.status).toBe('connected');
  expect(api.mock.calls.filter(([path]) => path === '/conversations/c1/messages')).toHaveLength(2);
  act(() => { replacement.close(4001); });
  expect(onUnauthorized).toHaveBeenCalledTimes(1);
  act(() => { jest.advanceTimersByTime(20_000); });
  expect(MockSocket.instances).toHaveLength(2);
});
