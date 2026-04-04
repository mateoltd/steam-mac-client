import { app } from 'electron';
import { randomBytes, createCipheriv, createDecipheriv, createHash } from 'node:crypto';
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import path from 'node:path';

const ALGORITHM = 'aes-256-gcm';
const CREDENTIALS_FILE = () => path.join(app.getPath('userData'), 'credentials.enc');

function deriveKey(): Buffer {
  const material = `steam-mac-client:${app.getPath('userData')}`;
  return createHash('sha256').update(material).digest();
}

export function saveCredentials(username: string, password: string): void {
  const key = deriveKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const payload = JSON.stringify({ username, password });
  const encrypted = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Format: iv (12) + tag (16) + ciphertext
  const blob = Buffer.concat([iv, tag, encrypted]);
  writeFileSync(CREDENTIALS_FILE(), blob);
}

export function loadCredentials(): { username: string; password: string } | null {
  const file = CREDENTIALS_FILE();
  if (!existsSync(file)) return null;
  try {
    const blob = readFileSync(file);
    if (blob.length < 29) return null; // 12 + 16 + at least 1
    const iv = blob.subarray(0, 12);
    const tag = blob.subarray(12, 28);
    const encrypted = blob.subarray(28);
    const key = deriveKey();
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return JSON.parse(decrypted.toString('utf8'));
  } catch {
    return null;
  }
}

export function clearCredentials(): void {
  const file = CREDENTIALS_FILE();
  if (existsSync(file)) unlinkSync(file);
}
