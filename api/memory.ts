// api/memory.ts
// マスター本人がGoogleログインしたブラウザ(Edge / Chrome)とLINE版だけで
// 同じGoogle Driveファイル(HAKONIWA_DRIVE_FILE_ID)を安全に共有・統合するエンドポイント
// （他のユーザー＝ブラウザ保存モードの人は認証トークンを持たないためアクセス不可）

import crypto from 'crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { readMemory, writeMemory } from './lib/drive-server.js';
import type { BrainState } from './lib/types.js';

function getSigningSecret(): string {
  return (
    process.env.CRON_SECRET ||
    process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY ||
    process.env.GEMINI_API_KEY ||
    'hakoniwa_master_secret_fallback'
  );
}

/** マスター用の永続セッショントークン（HMAC署名付き・30日有効）を発行 */
function createMasterSessionToken(sub: string): string {
  const payload = JSON.stringify({
    sub,
    exp: Date.now() + 30 * 24 * 60 * 60 * 1000,
  });
  const payloadB64 = Buffer.from(payload, 'utf-8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', getSigningSecret())
    .update(payloadB64)
    .digest('base64url');
  return `${payloadB64}.${sig}`;
}

/** マスター用セッショントークンを検証 */
function verifyMasterSessionToken(token: string): boolean {
  try {
    const [payloadB64, sig] = token.split('.');
    if (!payloadB64 || !sig) return false;
    const expectedSig = crypto
      .createHmac('sha256', getSigningSecret())
      .update(payloadB64)
      .digest('base64url');
    if (sig !== expectedSig) return false;
    const parsed = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf-8'));
    return typeof parsed.exp === 'number' && parsed.exp > Date.now();
  } catch {
    return false;
  }
}

/** Google OAuth access_token を Google 公式 tokeninfo で検証 */
async function verifyGoogleOAuthToken(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(accessToken)}`
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { sub?: string; expires_in?: string };
    return data.sub || 'google_verified_user';
  } catch {
    return null;
  }
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  try {
    // --- 本人認証チェック（他のユーザー・ブラウザ保存モードからのアクセスを完全遮断） ---
    const masterSession = req.headers['x-hakoniwa-session'] as string | undefined;
    const authHeader = req.headers.authorization;
    const oauthToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

    let isAuthorized = false;
    let newSessionToken: string | null = null;

    if (masterSession && verifyMasterSessionToken(masterSession)) {
      isAuthorized = true;
    } else if (oauthToken) {
      const sub = await verifyGoogleOAuthToken(oauthToken);
      if (sub) {
        isAuthorized = true;
        newSessionToken = createMasterSessionToken(sub);
      }
    }

    if (!isAuthorized) {
      res.status(401).json({ error: 'Unauthorized: Google Drive login required' });
      return;
    }

    if (newSessionToken) {
      res.setHeader('x-hakoniwa-session', newSessionToken);
    }

    if (req.method === 'GET') {
      const memory = await readMemory();
      if (!memory) {
        res.status(404).json({ error: 'Memory not found or Drive not configured' });
        return;
      }
      res.status(200).json(memory);
      return;
    }

    if (req.method === 'POST' || req.method === 'PUT') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      if (!body || typeof body !== 'object' || !Array.isArray(body.episodes)) {
        res.status(400).json({ error: 'Invalid BrainState payload' });
        return;
      }
      await writeMemory(body as BrainState);
      res.status(200).json({ success: true, episodeCount: body.episodes.length });
      return;
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (error: unknown) {
    console.error('[API /api/memory] Error:', error);
    const msg = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: 'Drive sync failed', detail: msg });
  }
}
