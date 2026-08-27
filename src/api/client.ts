export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

interface ApiErrorPayload {
  error?: string;
  code?: string;
}

export async function apiRequest<T>(
  path: string,
  init: RequestInit = {},
  workspaceId?: string,
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('accept', 'application/json');
  if (init.body && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  if (workspaceId) headers.set('x-workspace-id', workspaceId);

  let response: Response;
  try {
    response = await fetch(path, { ...init, headers });
  } catch {
    throw new ApiError('Le serveur Social Conversion est injoignable.', 0, 'NETWORK_ERROR');
  }

  const contentType = response.headers.get('content-type') ?? '';
  const payload = contentType.includes('application/json')
    ? await response.json().catch(() => undefined)
    : undefined;

  if (!response.ok) {
    const errorPayload = payload as ApiErrorPayload | undefined;
    throw new ApiError(
      errorPayload?.error ?? `La requête a échoué (${response.status}).`,
      response.status,
      errorPayload?.code,
    );
  }

  return payload as T;
}
