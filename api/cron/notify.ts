// api/cron/notify.ts
// 定時通知エンドポイント
// GitHub Actionsから呼ばれ、各種メッセージをLINEにプッシュ通知する

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { pushMessage } from '../lib/line';
import {
  generateMorningMessage,
  generateMealMessage,
  generateEveningMessage,
  checkReminders,
} from '../lib/brain-server';

/** 通知タイプ */
type NotifyType = 'morning' | 'meal' | 'evening' | 'reminder';

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  // --- 認証チェック ---
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error('CRON_SECRET が設定されていません');
    res.status(500).json({ error: 'Server configuration error' });
    return;
  }

  // Authorizationヘッダーまたはクエリパラメータからシークレットを取得
  const authHeader = req.headers.authorization;
  const querySecret = req.query.secret as string | undefined;
  const providedSecret = authHeader?.replace('Bearer ', '') || querySecret;

  if (providedSecret !== cronSecret) {
    console.error('認証失敗: 無効なCRON_SECRET');
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  // --- typeパラメータで分岐 ---
  const type = (req.query.type as NotifyType) || (req.body?.type as NotifyType);

  if (!type) {
    res.status(400).json({ error: 'type parameter is required (morning | meal | evening | reminder)' });
    return;
  }

  // Web版URLを取得
  const webUrl = process.env.HAKONIWA_WEB_URL || 'https://your-app.vercel.app';
  const webFooter = `\n\n🏯 Web版で続きを話す → ${webUrl}`;

  try {
    switch (type) {
      case 'morning': {
        // --- 朝の挨拶 + 占い ---
        console.log('🌅 朝の通知を生成中...');
        const message = await generateMorningMessage();

        if (message) {
          await pushMessage(`${message}${webFooter}`);
          console.log('✅ 朝の通知を送信しました');
          res.status(200).json({ success: true, type, message: 'Morning message sent' });
        } else {
          console.log('ℹ️ 朝の通知: 生成条件を満たさず');
          res.status(200).json({ success: true, type, message: 'No morning message needed' });
        }
        break;
      }

      case 'meal': {
        // --- 食事トリガー ---
        console.log('🍽️ 食事通知を生成中...');
        const message = await generateMealMessage();

        if (message) {
          await pushMessage(`${message}${webFooter}`);
          console.log('✅ 食事通知を送信しました');
          res.status(200).json({ success: true, type, message: 'Meal message sent' });
        } else {
          console.log('ℹ️ 食事通知: 生成条件を満たさず');
          res.status(200).json({ success: true, type, message: 'No meal message needed' });
        }
        break;
      }

      case 'evening': {
        // --- 夕方のおすすめ ---
        console.log('🎯 夕方のおすすめ通知を生成中...');
        const message = await generateEveningMessage();

        if (message) {
          await pushMessage(`${message}${webFooter}`);
          console.log('✅ 夕方のおすすめ通知を送信しました');
          res.status(200).json({ success: true, type, message: 'Evening message sent' });
        } else {
          console.log('ℹ️ 夕方のおすすめ通知: 生成条件を満たさず');
          res.status(200).json({ success: true, type, message: 'No evening message needed' });
        }
        break;
      }

      case 'reminder': {
        // --- リマインダーチェック ---
        console.log('⏰ リマインダーチェック中...');
        const messages = await checkReminders();

        if (messages.length > 0) {
          const combined = messages.join('\n');
          await pushMessage(`${combined}${webFooter}`);
          console.log(`✅ リマインダー ${messages.length}件を送信しました`);
          res.status(200).json({
            success: true,
            type,
            message: `${messages.length} reminder(s) sent`,
            count: messages.length,
          });
        } else {
          console.log('ℹ️ 期限切れのリマインダーなし');
          res.status(200).json({ success: true, type, message: 'No due reminders' });
        }
        break;
      }

      default:
        res.status(400).json({
          error: `Invalid type: ${type}`,
          validTypes: ['morning', 'meal', 'evening', 'reminder'],
        });
        break;
    }
  } catch (error) {
    console.error(`通知処理エラー (type=${type}):`, error);
    const errMsg = error instanceof Error ? error.message : String(error);
    res.status(500).json({
      error: 'Notification failed',
      type,
      detail: errMsg,
    });
  }
}
