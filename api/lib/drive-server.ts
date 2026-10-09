// Google Drive サーバーサイド ヘルパーモジュール
// Service Account 認証で Google Drive API v3 にアクセス
// jsonwebtoken ライブラリ非依存：Node.js crypto で JWT を自前生成

import crypto from 'crypto';
import type { BrainState } from './types.js';

// Google OAuth2 トークンエンドポイント
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

// Google Drive API v3 ベースURL
const DRIVE_API_BASE = 'https://www.googleapis.com/';

// アクセストークンのキャッシュ（有効期限内は再利用）
let cachedToken: { token: string; expiresAt: number } | null = null;

/**
 * 環境変数から Google Drive 設定を取得する
 */
function getConfig() {
    const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const privateKeyRaw = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
    const fileId = process.env.HAKONIWA_DRIVE_FILE_ID;

    if (!serviceAccountEmail || !privateKeyRaw || !fileId) {
        return null;
    }

    const privateKey = privateKeyRaw.replace(/\\n/g, '\n');
    return { serviceAccountEmail, privateKey, fileId };
}

/**
 * Base64URL エンコード（JWT用）
 * 標準Base64から + → -、/ → _、末尾の = を除去
 */
function base64urlEncode(data: string | Buffer): string {
    const buf = typeof data === 'string' ? Buffer.from(data, 'utf-8') : data;
    return buf.toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

/**
 * JWT（JSON Web Token）を自前生成する
 * Google OAuth2 Service Account 認証に使用
 * 
 * JWT構造: header.payload.signature
 * - header: アルゴリズム（RS256）とタイプ（JWT）
 * - payload: iss, scope, aud, iat, exp
 * - signature: header.payload を秘密鍵でRS256署名
 */
function createJWT(email: string, privateKey: string): string {
    const now = Math.floor(Date.now() / 1000);

    // JWTヘッダー
    const header = {
        alg: 'RS256',
        typ: 'JWT',
    };

    // JWTペイロード
    const payload = {
        iss: email,                                    // 発行者（サービスアカウントのメール）
        scope: 'https://www.googleapis.com/auth/drive', // Google Drive のフルアクセススコープ
        aud: TOKEN_URL,                                // 対象（トークンエンドポイント）
        iat: now,                                      // 発行時刻
        exp: now + 3600,                               // 有効期限（1時間後）
    };

    // header と payload を Base64URL エンコード
    const headerB64 = base64urlEncode(JSON.stringify(header));
    const payloadB64 = base64urlEncode(JSON.stringify(payload));

    // 署名対象文字列
    const signInput = `${headerB64}.${payloadB64}`;

    // RS256 署名（SHA-256 + RSA）
    const signer = crypto.createSign('RSA-SHA256');
    signer.update(signInput);
    const signature = signer.sign(privateKey);

    // 署名を Base64URL エンコード
    const signatureB64 = base64urlEncode(signature);

    return `${signInput}.${signatureB64}`;
}

/**
 * Google OAuth2 アクセストークンを取得する
 * キャッシュが有効な場合はキャッシュから返す
 */
async function getAccessToken(): Promise<string> {
    // キャッシュが有効期限内ならそれを使う（5分前にリフレッシュ）
    if (cachedToken && Date.now() < cachedToken.expiresAt - 5 * 60 * 1000) {
        return cachedToken.token;
    }

    const config = getConfig();
    if (!config) {
        throw new Error('Google Drive 設定がありません');
    }
    const { serviceAccountEmail, privateKey } = config;

    // JWT を生成
    const jwt = createJWT(serviceAccountEmail, privateKey);

    // トークンエンドポイントにリクエスト
    const response = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
            grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            assertion: jwt,
        }).toString(),
    });

    if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(
            `Google OAuth2 トークン取得エラー: ${response.status} - ${errorBody}`
        );
    }

    const data = await response.json() as {
        access_token: string;
        expires_in: number;
    };

    // トークンをキャッシュ
    cachedToken = {
        token: data.access_token,
        expiresAt: Date.now() + data.expires_in * 1000,
    };

    console.log('[Drive] アクセストークンを取得しました');
    return data.access_token;
}

/**
 * hakoniwa_memory.json の内容を Google Drive から読み取る
 * 
 * Google Drive API v3 の files.get を alt=media で呼び出し、
 * ファイルの内容を直接取得する
 */
export async function readMemory(): Promise<BrainState | null> {
    const config = getConfig();
    if (!config) {
        console.log('[Drive] Google Drive未設定のため、メモリ読み込みをスキップします');
        return null;
    }

    const { fileId } = config;
    const token = await getAccessToken();

    // alt=media でファイル内容を直接取得
    const url = `${DRIVE_API_BASE}drive/v3/files/${fileId}?alt=media`;

    const response = await fetch(url, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${token}`,
        },
    });

    if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(
            `Google Drive 読み取りエラー: ${response.status} - ${errorBody}`
        );
    }

    const data = await response.json() as BrainState;
    console.log(`[Drive] メモリ読み取り完了 (エピソード数: ${data.episodes?.length ?? 0})`);
    return data;
}

/**
 * hakoniwa_memory.json の内容を Google Drive に書き込む
 * 
 * Google Drive API v3 の files.update を使用。
 * メディアアップロード（uploadType=media）でファイル内容を直接更新する。
 */
export async function writeMemory(state: BrainState): Promise<void> {
    const config = getConfig();
    if (!config) {
        console.log('[Drive] Google Drive未設定のため、メモリ保存をスキップします');
        return;
    }

    const { fileId } = config;
    const token = await getAccessToken();

    // uploadType=media でファイル内容を直接更新
    const url = `${DRIVE_API_BASE}upload/drive/v3/files/${fileId}?uploadType=media`;

    const body = JSON.stringify(state, null, 2);

    const response = await fetch(url, {
        method: 'PATCH',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body,
    });

    if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(
            `Google Drive 書き込みエラー: ${response.status} - ${errorBody}`
        );
    }

    console.log(`[Drive] メモリ書き込み完了 (${body.length} bytes)`);
}
