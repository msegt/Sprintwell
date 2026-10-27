import { createHash, randomBytes } from 'node:crypto';
import { customAlphabet } from 'nanoid';

export const newId = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 16);

/** Invite codes avoid look-alike characters so they can be read aloud in class. */
export const newInviteCode = customAlphabet('23456789abcdefghjkmnpqrstuvwxyz', 10);
export const newDeviceCode = customAlphabet('23456789ABCDEFGHJKMNPQRSTUVWXYZ', 8);

export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function now(): string {
  return new Date().toISOString();
}

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    /** Optional structured detail for the client, e.g. what makes a story not ready. */
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what = 'Not found') => new HttpError(404, what);
export const forbidden = (why = 'You do not have permission to do that') => new HttpError(403, why);
export const badRequest = (why: string) => new HttpError(400, why);

export function parseJson<T>(text: string | null | undefined, fallback: T): T {
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}
