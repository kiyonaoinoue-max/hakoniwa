export class DriveManager {
    private accessToken: string | null = null;
    private fileId: string | null = null;
    private readonly FILENAME = 'hakoniwa_memory.json';

    public setToken(token: string) {
        this.accessToken = token;
        // Optionally reset fileId if token changes, though typically it's the same user
    }

    public clearToken() {
        this.accessToken = null;
        this.fileId = null;
    }

    public isAuthenticated(): boolean {
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
            headers
        });

        if (!response.ok) {
            console.error('Drive API Error:', await response.text());
            throw new Error(`Drive API Error: ${response.status}`);
        }

        return response;
    }

    // Find the file by name
    public async findMemoryFile(): Promise<string | null> {
        if (!this.accessToken) return null;

        const q = encodeURIComponent(`name='${this.FILENAME}' and trashed=false`);
        const response = await this.request(`/files?q=${q}&spaces=drive&fields=files(id,name)`);
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

    // Read file contents
    public async readFileContent(): Promise<string> {
        if (!this.fileId) {
            const id = await this.findMemoryFile();
            if (!id) throw new Error('File not found to read');
        }

        const response = await this.request(`/files/${this.fileId}?alt=media`);
        return await response.text();
    }

    // Update file contents
    public async updateFileContent(content: string): Promise<void> {
        if (!this.fileId) {
            const id = await this.findMemoryFile();
            if (!id) {
                // If it doesn't exist, create it instead of updating
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
