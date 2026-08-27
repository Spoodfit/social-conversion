const encoder = new TextEncoder();
type CloudflareSubtleCrypto = SubtleCrypto & {
  timingSafeEqual(left: ArrayBuffer | ArrayBufferView, right: ArrayBuffer | ArrayBufferView): boolean;
};

function timingSafeEqual(left: ArrayBuffer | ArrayBufferView, right: ArrayBuffer | ArrayBufferView): boolean {
  return (crypto.subtle as CloudflareSubtleCrypto).timingSafeEqual(left, right);
}

export type BoundedTextResult =
  | { ok: true; text: string }
  | { ok: false; reason: 'too_large' | 'invalid_utf8' };

export async function readTextWithinLimit(request: Request, maxBytes: number): Promise<BoundedTextResult> {
  const contentLengthValue = request.headers.get('content-length');
  if (contentLengthValue) {
    const contentLength = Number(contentLengthValue);
    if (!Number.isFinite(contentLength) || contentLength < 0 || contentLength > maxBytes) {
      return { ok: false, reason: 'too_large' };
    }
  }

  if (!request.body) return { ok: true, text: '' };

  const reader = request.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytesRead = 0;
  let text = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      if (bytesRead > maxBytes) {
        try {
          await reader.cancel('payload too large');
        } catch {
          // The size decision is already final even if the producer cannot be cancelled.
        }
        return { ok: false, reason: 'too_large' };
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return { ok: true, text };
  } catch {
    try {
      await reader.cancel('invalid utf-8');
    } catch {
      // Nothing else is safe to read from this stream.
    }
    return { ok: false, reason: 'invalid_utf8' };
  } finally {
    reader.releaseLock();
  }
}

function hexToBytes(value: string): Uint8Array | undefined {
  if (!/^[a-f0-9]+$/i.test(value) || value.length % 2 !== 0) return undefined;
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < value.length; index += 2) {
    bytes[index / 2] = Number.parseInt(value.slice(index, index + 2), 16);
  }
  return bytes;
}

export async function verifySecret(provided: string | undefined, expected: string): Promise<boolean> {
  if (!provided) return false;
  const [providedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(provided)),
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
  ]);
  return timingSafeEqual(providedHash, expectedHash);
}

export async function verifyMetaSignature(body: string, signature: string | undefined, secret: string): Promise<boolean> {
  if (!signature?.startsWith('sha256=')) return false;
  const providedDigest = hexToBytes(signature.slice(7));
  if (!providedDigest || providedDigest.byteLength !== 32) return false;
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
  return timingSafeEqual(digest, providedDigest);
}

export function optionalSecret(env: Env, key: string): string | undefined {
  const value = Reflect.get(env, key);
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
