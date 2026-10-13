import type { ApiError } from './types';

type ApiOptions = Omit<RequestInit, 'body'> & { body?: unknown };

export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    credentials: 'same-origin',
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  if (response.status === 204) return null as T;
  const data = await response.json() as T & { error?: string };
  if (!response.ok) {
    const error: ApiError = new Error(data.error || 'The request failed.');
    error.status = response.status;
    throw error;
  }
  return data;
}
