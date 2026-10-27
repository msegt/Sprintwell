import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Encrypts small secrets (OAuth tokens) at rest with AES-256-GCM. The key is
 * derived from the SPRINTWELL_SECRET setting; changing that setting makes
 * stored tokens unreadable, so people simply have to connect GitLab again.
 */
export class SecretBox {
  private readonly key: Buffer;

  constructor(secret: string) {
    if (secret.length < 16) throw new Error('SPRINTWELL_SECRET must be at least 16 characters long.');
    this.key = createHash('sha256').update(`sprintwell:tokens:${secret}`).digest();
  }

  seal(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return `v1.${Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url')}`;
  }

  /** Returns null if the value cannot be decrypted (e.g. the secret changed). */
  open(sealed: string): string | null {
    try {
      if (!sealed.startsWith('v1.')) return null;
      const raw = Buffer.from(sealed.slice(3), 'base64url');
      const decipher = createDecipheriv('aes-256-gcm', this.key, raw.subarray(0, 12));
      decipher.setAuthTag(raw.subarray(12, 28));
      return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
    } catch {
      return null;
    }
  }
}

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}
