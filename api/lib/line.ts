// LINE Messaging API ヘルパーモジュール
// @line/bot-sdk に依存しない、fetch APIベースの軽量実装

import crypto from 'crypto';

// LINE Messaging API のベースURL
const LINE_API_BASE = 'https://api.line.me/v2/bot';

// LINEテキストメッセージの文字数上限
const LINE_TEXT_LIMIT = 5000;

// 1回のリクエストで送信できるメッセージ数の上限
const LINE_MESSAGE_LIMIT = 5;

/**
 * 環境変数からLINE設定を取得する
 * 毎回process.envから読むことで、ホットリロード時にも最新値を使用
 */
function getConfig() {
    const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
    const channelSecret = process.env.LINE_CHANNEL_SECRET;
    const userId = process.env.LINE_USER_ID;

    if (!channelAccessToken) {
        throw new Error('LINE_CHANNEL_ACCESS_TOKEN が設定されていません');
    }
    if (!channelSecret) {
        throw new Error('LINE_CHANNEL_SECRET が設定されていません');
    }
    if (!userId) {
        throw new Error('LINE_USER_ID が設定されていません');
    }

    return { channelAccessToken, channelSecret, userId };
}

/**
 * テキストを LINE の文字数制限（5000文字）に合わせて分割する
 * 可能な限り改行位置で分割し、それができない場合は強制的に切る
 */
function splitText(text: string): string[] {
    if (text.length <= LINE_TEXT_LIMIT) {
        return [text];
    }

    const chunks: string[] = [];
    let remaining = text;

    while (remaining.length > 0) {
        if (remaining.length <= LINE_TEXT_LIMIT) {
            chunks.push(remaining);
            break;
        }

        // 制限文字数内で最後の改行位置を探す
        let splitIndex = remaining.lastIndexOf('\n', LINE_TEXT_LIMIT);

        // 改行が見つからない、または先頭すぎる場合は強制的に切る
        if (splitIndex <= 0 || splitIndex < LINE_TEXT_LIMIT * 0.3) {
            splitIndex = LINE_TEXT_LIMIT;
        }

        chunks.push(remaining.substring(0, splitIndex));
        remaining = remaining.substring(splitIndex).replace(/^\n/, ''); // 先頭の改行を除去
    }

    return chunks;
}

/**
 * LINE API にリクエストを送信する共通関数
 */
async function lineApiRequest(endpoint: string, body: object): Promise<void> {
    const { channelAccessToken } = getConfig();

    const response = await fetch(`${LINE_API_BASE}${endpoint}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${channelAccessToken}`,
        },
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(
            `LINE API エラー: ${response.status} ${response.statusText} - ${errorBody}`
        );
    }
}

/**
 * Push Message 送信（Bot→ユーザーへの能動的な通知）
 * 長いテキストは自動的に5000文字ごとに分割して送信する
 * 
 * 注意: Push Messageは月間通数にカウントされる
 */
export async function pushMessage(text: string): Promise<void> {
    const { userId } = getConfig();
    const chunks = splitText(text);

    // LINE APIは1回のリクエストで最大5メッセージまで送れる
    // 5メッセージを超える場合は複数リクエストに分割
    for (let i = 0; i < chunks.length; i += LINE_MESSAGE_LIMIT) {
        const batch = chunks.slice(i, i + LINE_MESSAGE_LIMIT);
        const messages = batch.map(chunk => ({
            type: 'text' as const,
            text: chunk,
        }));

        await lineApiRequest('/message/push', {
            to: userId,
            messages,
        });
    }

    console.log(`[LINE] Push message 送信完了 (${chunks.length} メッセージ)`);
}

/**
 * Reply Message 送信（ユーザーメッセージへの返信）
 * replyTokenを使うため、通数カウントに含まれない
 * 
 * 注意: replyTokenは受信後30秒以内に使用する必要がある
 * 注意: 同じreplyTokenは1回しか使えない
 */
export async function replyMessage(replyToken: string, text: string): Promise<void> {
    const chunks = splitText(text);

    // Reply APIも最大5メッセージまで
    // replyTokenは1回しか使えないので、最初の5チャンクだけreplyで送る
    const replyChunks = chunks.slice(0, LINE_MESSAGE_LIMIT);
    const remainingChunks = chunks.slice(LINE_MESSAGE_LIMIT);

    const messages = replyChunks.map(chunk => ({
        type: 'text' as const,
        text: chunk,
    }));

    await lineApiRequest('/message/reply', {
        replyToken,
        messages,
    });

    // 5メッセージを超えた分はPush Messageで送信
    if (remainingChunks.length > 0) {
        const { userId } = getConfig();
        for (let i = 0; i < remainingChunks.length; i += LINE_MESSAGE_LIMIT) {
            const batch = remainingChunks.slice(i, i + LINE_MESSAGE_LIMIT);
            const pushMessages = batch.map(chunk => ({
                type: 'text' as const,
                text: chunk,
            }));

            await lineApiRequest('/message/push', {
                to: userId,
                messages: pushMessages,
            });
        }
    }

    console.log(`[LINE] Reply message 送信完了 (${chunks.length} メッセージ)`);
}

/**
 * Webhook 署名検証
 * LINE Platform からのリクエストが正当なものか検証する
 * 
 * @param body - リクエストボディの生文字列
 * @param signature - X-Line-Signature ヘッダーの値
 * @returns 署名が有効ならtrue
 */
export function validateSignature(body: string, signature: string): boolean {
    const { channelSecret } = getConfig();

    const hmac = crypto.createHmac('SHA256', channelSecret);
    hmac.update(body);
    const digest = hmac.digest('base64');

    // タイミング攻撃を防ぐため、timingSafeEqual を使用
    try {
        const sigBuffer = Buffer.from(signature, 'base64');
        const digestBuffer = Buffer.from(digest, 'base64');

        if (sigBuffer.length !== digestBuffer.length) {
            return false;
        }

        return crypto.timingSafeEqual(sigBuffer, digestBuffer);
    } catch {
        return false;
    }
}
