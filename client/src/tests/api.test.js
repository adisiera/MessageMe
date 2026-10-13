import { api } from '../api';

afterEach(() => { delete global.fetch; });

test('uses same-origin credentials and JSON for writes', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ user: { id: '1' } }) });
  expect(await api('/auth/login', { method: 'POST', body: { email: 'a@example.test' } }))
    .toEqual({ user: { id: '1' } });
  expect(fetch).toHaveBeenCalledWith('/api/auth/login', expect.objectContaining({
    credentials: 'same-origin', body: '{"email":"a@example.test"}',
  }));
});

test('propagates server error details and handles empty responses', async () => {
  global.fetch = jest.fn()
    .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({ error: 'Please sign in.' }) })
    .mockResolvedValueOnce({ ok: true, status: 204 });
  await expect(api('/auth/me')).rejects.toMatchObject({ message: 'Please sign in.', status: 401 });
  expect(await api('/auth/logout', { method: 'POST' })).toBeNull();
});
