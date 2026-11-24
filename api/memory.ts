// api/memory.ts
// Web版（Edge / Chrome / スマホブラウザ）とLINE版で完全に同じGoogle Driveファイル(HAKONIWA_DRIVE_FILE_ID)を
// 60分のOAuthトークン期限切れなしで読み書きするためのサーバーサイド同期エンドポイント

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { readMemory, writeMemory } from './lib/drive-server.js';
import type { BrainState } from './lib/types.js';

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  // キャッシュを完全に無効化し、EdgeとChromeで常に最新の記憶を取得できるようにする
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  try {
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
