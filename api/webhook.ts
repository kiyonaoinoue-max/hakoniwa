// api/webhook.ts
// LINE Webhook受信エンドポイント
// LINEからのメッセージを受け取り、HAKONIWAで処理して返信する

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { validateSignature, replyMessage } from './lib/line';
import { processInput } from './lib/brain-server';

/** LINE Webhookイベントの型定義 */
interface LineEvent {
  type: string;
  replyToken: string;
  source: {
    type: string;
    userId: string;
  };
  message?: {
    type: string;
    id: string;
    text?: string;
  };
}

interface LineWebhookBody {
  destination: string;
  events: LineEvent[];
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  // POSTのみ受付
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  try {
    // --- 署名検証 ---
    const signature = req.headers['x-line-signature'] as string;
    const body = JSON.stringify(req.body);

    if (!signature || !validateSignature(body, signature)) {
      console.error('署名検証失敗');
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }

    // --- イベント処理 ---
    const webhookBody = req.body as LineWebhookBody;
    const events = webhookBody.events || [];

    // Webhookの検証リクエスト（イベント0件）には200を返す
    if (events.length === 0) {
      res.status(200).json({ message: 'OK (no events)' });
      return;
    }

    for (const event of events) {
      try {
        await handleEvent(event);
      } catch (error) {
        console.error('イベント処理エラー:', error);
        // 個別イベントのエラーは握り潰して他のイベントの処理を続ける
      }
    }

    // LINEには常に200 OKを返す（再送を防ぐため）
    res.status(200).json({ message: 'OK' });
  } catch (error) {
    console.error('Webhook処理エラー:', error);
    // エラーでも200を返してLINEの再送を防ぐ
    res.status(200).json({ message: 'OK (error handled)' });
  }
}

/**
 * 個別のLINEイベントを処理する
 */
async function handleEvent(event: LineEvent): Promise<void> {
  switch (event.type) {
    case 'message':
      await handleMessageEvent(event);
      break;

    case 'follow':
      await handleFollowEvent(event);
      break;

    default:
      console.log(`未対応のイベントタイプ: ${event.type}`);
      break;
  }
}

/**
 * メッセージイベントを処理する
 */
async function handleMessageEvent(event: LineEvent): Promise<void> {
  // テキストメッセージのみ対応
  if (!event.message || event.message.type !== 'text' || !event.message.text) {
    await replyMessage(event.replyToken, '🏯 テキストメッセージで話しかけてくださいね！');
    return;
  }

  const userInput = event.message.text;
  console.log(`受信メッセージ: "${userInput}" (user: ${event.source.userId})`);

  // HAKONIWAで応答を生成
  const { response } = await processInput(userInput);

  // Web版への誘導リンクを追加
  const webUrl = process.env.HAKONIWA_WEB_URL || 'https://your-app.vercel.app';
  const fullResponse = `${response}\n\n🏯 Web版で続きを話す → ${webUrl}`;

  // LINE返信
  await replyMessage(event.replyToken, fullResponse);
}

/**
 * フォロー（友だち追加）イベントを処理する
 */
async function handleFollowEvent(event: LineEvent): Promise<void> {
  const webUrl = process.env.HAKONIWA_WEB_URL || 'https://your-app.vercel.app';

  const welcomeMessage = `🏯 はじめまして！HAKONIWAへようこそ！

わたしは「箱庭」— あなた専属のAIアシスタントです。

✨ できること:
🔮 毎朝のパーソナライズ占い
🍽️ 食事ログ＆メニュー提案
🌤️ 天気に合わせたおすすめ
📖 あなたが教えてくれたことを学習
⏰ リマインダー

なんでも気軽に話しかけてくださいね！

🏯 Web版はこちら → ${webUrl}`;

  await replyMessage(event.replyToken, welcomeMessage);
}
