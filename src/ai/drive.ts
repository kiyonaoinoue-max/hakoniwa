const DRIVE_CONNECTED_KEY = 'hakoniwa_drive_connected_v1';
const OAUTH_TOKEN_KEY = 'hakoniwa_drive_oauth_token_v1';

export class DriveManager {
    private accessToken: string | null = null;
    private fileId: string | null = null;
    private readonly FILENAME = 'hakoniwa_memory.json';

    constructor() {
        try {
            this.accessToken = sessionStorage.getItem(OAUTH_TOKEN_KEY);
        } catch { /* ignore */ }
    }

    public setToken(token: string) {
        this.accessToken = token;
        try {
            sessionStorage.setItem(OAUTH_TOKEN_KEY, token);
            localStorage.setItem(DRIVE_CONNECTED_KEY, 'true');
        } catch { /* ignore */ }
    }

    public clearToken() {
        this.accessToken = null;
        this.fileId = null;
        try {
            sessionStorage.removeItem(OAUTH_TOKEN_KEY);
            localStorage.removeItem(DRIVE_CONNECTED_KEY);
        } catch { /* ignore */ }
    }

    public isAuthenticated(): boolean {
        try {
            if (localStorage.getItem(DRIVE_CONNECTED_KEY) === 'true') {
                return true;
            }
        } catch { /* ignore */ }
        return this.accessToken !== null;
    }

    private async request(path: string, options: RequestInit = {}) {
        if (!this.accessToken) {
            throw new Error('No access token available for Drive API');
        }

        const headers = new Headers(options.headers || {});
        headers.set('Authorization', `Bearer ${this.accessToken}`);

        const response = await fetch(`https://www.googleapis.com/drive/v3${path}`, {
            ...options,
            headers,
            cache: 'no-store',
        });

        if (!response.ok) {
            console.error('Drive API Error:', await response.text());
            throw new Error(`Drive API Error: ${response.status}`);
        }

        return response;
    }

    // Find the most recently modified memory file by name
    public async findMemoryFile(): Promise<string | null> {
        if (!this.accessToken) return null;

        const q = encodeURIComponent(`name='${this.FILENAME}' and trashed=false`);
        const response = await this.request(
            `/files?q=${q}&spaces=drive&orderBy=modifiedTime%20desc&fields=files(id,name,modifiedTime)`
        );
        const data = await response.json();

        if (data.files && data.files.length > 0) {
            this.fileId = data.files[0].id;
            return this.fileId;
        }

        return null;
    }

    // Create a new empty memory file
    public async createMemoryFile(initialContent: string): Promise<string> {
        if (!this.accessToken) throw new Error('Not authenticated');

        const metadata = {
            name: this.FILENAME,
            mimeType: 'application/json'
        };

        const form = new FormData();
        form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
        form.append('file', new Blob([initialContent], { type: 'application/json' }));

        const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.accessToken}`
            },
            body: form
        });

        if (!response.ok) {
            throw new Error(`Failed to create file: ${response.status}`);
        }

        const data = await response.json();
        this.fileId = data.id;
        return data.id;
    }

    /**
     * Google Driveから記憶JSONを読み取る
     * 1. まずサーバーサイド (/api/memory) 経由で唯一の固定ファイル (HAKONIWA_DRIVE_FILE_ID) を期限切れなしで取得
     * 2. ローカル開発時等で /api/memory が使えない場合はブラウザのOAuthトークンで直接取得
     */
    public async readFileContent(): Promise<string> {
        // 1. サーバーサイドの固定Driveファイル (Edge / Chrome / LINE 完全共通) から取得を試みる
        try {
            const serverRes = await fetch(`/api/memory?t=${Date.now()}`, {
                method: 'GET',
                cache: 'no-store',
                headers: { 'Cache-Control': 'no-cache' },
            });
            if (serverRes.ok) {
                const text = await serverRes.text();
                if (text && text.trim().startsWith('{')) {
                    return text;
                }
            }
        } catch (err) {
            console.warn('Server /api/memory read fallback to direct OAuth:', err);
        }

        // 2. フォールバック: クライアントOAuthで直接取得
        if (!this.fileId) {
            const id = await this.findMemoryFile();
            if (!id) throw new Error('File not found to read');
        }

        const response = await this.request(`/files/${this.fileId}?alt=media&t=${Date.now()}`);
        return await response.text();
    }

    /**
     * Google Driveの記憶JSONを更新する
     * 1. まずサーバーサイド (/api/memory) 経由で唯一の固定ファイル (HAKONIWA_DRIVE_FILE_ID) を更新（60分トークン切れなし！）
     * 2. フォールバックとしてクライアントOAuthで直接更新
     */
    public async updateFileContent(content: string): Promise<void> {
        let serverSaved = false;
        try {
            const serverRes = await fetch('/api/memory', {
                method: 'POST',
                cache: 'no-store',
                headers: { 'Content-Type': 'application/json' },
                body: content,
            });
            if (serverRes.ok) {
                serverSaved = true;
            }
        } catch (err) {
            console.warn('Server /api/memory write fallback to direct OAuth:', err);
        }

        // OAuthトークンも有効なら念のためクライアント側ファイルも同期、またはサーバー保存成功なら完了
        if (serverSaved) {
            return;
        }

        if (!this.accessToken) {
            throw new Error('Drive write failed: neither server /api/memory nor active OAuth token available');
        }

        if (!this.fileId) {
            const id = await this.findMemoryFile();
            if (!id) {
                await this.createMemoryFile(content);
                return;
            }
        }

        const response = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${this.fileId}?uploadType=media`, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${this.accessToken}`,
                'Content-Type': 'application/json'
            },
            body: content
        });

        if (!response.ok) {
            console.error('Failed to update file:', await response.text());
            throw new Error(`Failed to update file: ${response.status}`);
        }
    }
}

export const driveManager = new DriveManager();
