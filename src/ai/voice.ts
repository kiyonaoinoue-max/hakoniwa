// VOICEVOX (ローカルエンジン + Web API 分割連続再生 + スマホブラウザ自動再生ロック解除対応) & Web Speech API 音声認識マネージャー

export type VoicePlaybackPhase = 'idle' | 'loading' | 'playing';

export interface VoiceStatusSnapshot {
    phase: VoicePlaybackPhase;
    activeId: string | null;
}

export interface VoiceSpeedOption {
    label: string;
    value: number;
}

export const VOICE_SPEED_OPTIONS: VoiceSpeedOption[] = [
    { label: '🐢 ゆっくり', value: 0.90 },
    { label: '🚶 ふつう', value: 1.0 },
    { label: '🐇 はやめ', value: 1.12 },
];

export interface VoiceSpeakerOption {
    id: number;
    name: string;
    description: string;
    fallbackPitch: number;
    fallbackRate: number;
}

export const VOICEVOX_SPEAKERS: VoiceSpeakerOption[] = [
    { id: 47, name: 'ナースロボ＿タイプＴ (ノーマル)', description: '落ち着いて控えめ・優しいAIボイス（ハコさん推奨！）', fallbackPitch: 1.05, fallbackRate: 0.95 },
    { id: 48, name: 'ナースロボ＿タイプＴ (楽々)', description: '少し明るく親しみやすいAIボイス', fallbackPitch: 1.18, fallbackRate: 1.02 },
    { id: 14, name: '冥鳴ひまり (ノーマル)', description: '柔らかくて上品・聞き心地の良い声', fallbackPitch: 0.92, fallbackRate: 0.98 },
    { id: 61, name: '中国うさぎ (ノーマル)', description: 'おっとり控えめで可愛らしい声', fallbackPitch: 1.25, fallbackRate: 0.88 },
    { id: 2,  name: '四国めたん (ノーマル)', description: 'ハキハキして清楚な声', fallbackPitch: 1.15, fallbackRate: 1.08 },
    { id: 10, name: '雨晴はう (ノーマル)', description: '素直で優しい声', fallbackPitch: 1.32, fallbackRate: 1.0 },
    { id: 8,  name: '春日部つむぎ (ノーマル)', description: '元気でフレンドリーな声', fallbackPitch: 1.28, fallbackRate: 1.12 },
    { id: 3,  name: 'ずんだもん (ノーマル)', description: 'マスコットらしい可愛い声', fallbackPitch: 1.45, fallbackRate: 1.10 },
];

interface VoiceSettings {
    enabled: boolean;
    speakerId: number;
    speedScale: number;
}

const VOICE_STORAGE_KEY = 'hakoniwa_voice_settings_v1';

// スマホブラウザ(iOS Safari / Android Chrome)でタップ直後にAudio再生権限をアンロックするための極小無音WAV
const SILENT_WAV_DATA_URI =
    'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';

export class VoiceManager {
    private settings: VoiceSettings;
    private sharedAudio: HTMLAudioElement | null = null;
    private phase: VoicePlaybackPhase = 'idle';
    private activeId: string | null = null;
    private activeRequestId = 0;
    private onStateChange?: (speaking: boolean) => void;
    private onStatusChange?: (status: VoiceStatusSnapshot) => void;

    constructor() {
        this.settings = this.loadSettings();
    }

    private loadSettings(): VoiceSettings {
        try {
            const raw = localStorage.getItem(VOICE_STORAGE_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                return {
                    enabled: Boolean(parsed.enabled),
                    speakerId: typeof parsed.speakerId === 'number' ? parsed.speakerId : 47,
                    speedScale: typeof parsed.speedScale === 'number' ? parsed.speedScale : 1.0,
                };
            }
        } catch { /* ignore */ }
        return {
            enabled: false,
            speakerId: 47, // ナースロボ＿タイプＴ
            speedScale: 1.0,
        };
    }

    private saveSettings(): void {
        localStorage.setItem(VOICE_STORAGE_KEY, JSON.stringify(this.settings));
    }

    public getSettings(): VoiceSettings {
        return { ...this.settings };
    }

    public setEnabled(enabled: boolean): void {
        this.settings.enabled = enabled;
        if (!enabled) {
            this.stop();
        }
        this.saveSettings();
    }

    public setSpeakerId(speakerId: number): void {
        this.settings.speakerId = speakerId;
        this.saveSettings();
    }

    public setSpeedScale(speedScale: number): void {
        this.settings.speedScale = speedScale;
        if (this.sharedAudio && this.phase === 'playing') {
            this.sharedAudio.playbackRate = speedScale;
        }
        this.saveSettings();
    }

    public setOnSpeakingChange(cb: (speaking: boolean) => void): void {
        this.onStateChange = cb;
    }

    public setOnStatusChange(cb: (status: VoiceStatusSnapshot) => void): void {
        this.onStatusChange = cb;
    }

    public getStatus(): VoiceStatusSnapshot {
        return { phase: this.phase, activeId: this.activeId };
    }

    private updateStatus(phase: VoicePlaybackPhase, activeId: string | null): void {
        this.phase = phase;
        this.activeId = phase === 'idle' ? null : activeId;
        const isBusy = phase === 'loading' || phase === 'playing';
        this.onStateChange?.(isBusy);
        this.onStatusChange?.({ phase: this.phase, activeId: this.activeId });
    }

    public isSpeaking(): boolean {
        return this.phase !== 'idle';
    }

    /**
     * スマホブラウザ向けに、ユーザータップの同期コンテキスト内で単一のHTMLAudioElementを初期化＆無音アンロックする
     */
    private ensureUnlockedAudio(): HTMLAudioElement {
        if (!this.sharedAudio) {
            this.sharedAudio = new Audio();
            this.sharedAudio.preload = 'auto';
        }
        try {
            this.sharedAudio.src = SILENT_WAV_DATA_URI;
            const p = this.sharedAudio.play();
            if (p && typeof p.catch === 'function') {
                p.catch(() => { /* ignore initial unlock error */ });
            }
        } catch { /* ignore */ }
        return this.sharedAudio;
    }

    public stop(): void {
        this.activeRequestId++;
        if (this.sharedAudio) {
            try {
                this.sharedAudio.onended = null;
                this.sharedAudio.onerror = null;
                this.sharedAudio.pause();
            } catch { /* ignore */ }
        }
        if ('speechSynthesis' in window) {
            window.speechSynthesis.cancel();
        }
        this.updateStatus('idle', null);
    }

    /**
     * 読み上げ用にテキストからURLや余計な記号・絵文字を整理し、
     * VOICEVOXが苦手とするローマ字・英単語（Hakoniwa, Nao等）を自然なカタカナ読みに変換する
     */
    private cleanTextForSpeech(text: string): string {
        return text
            .replace(/https?:\/\/[^\s]+/g, '')
            .replace(/🔗\s*出典:?/g, '')
            // VOICEVOXのイントネーション崩壊を防ぐため頻出英単語をカタカナ化
            .replace(/Hakoniwa/gi, 'ハコニワ')
            .replace(/Nao/gi, 'ナオ')
            .replace(/AI/g, 'エーアイ')
            .replace(/API/gi, 'エーピーアイ')
            .replace(/Web/gi, 'ウェブ')
            .replace(/Wikipedia/gi, 'ウィキペディア')
            .replace(/VOICEVOX/gi, 'ボイスボックス')
            .replace(/Google/gi, 'グーグル')
            .replace(/「|」|『|』/g, '、') // カギカッコでイントネーションが跳ねるのを防ぐ
            .replace(/[★☆]{2,}/g, (m) => `星${(m.match(/★/g) || []).length}つ。`)
            .replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '')
            .trim();
    }

    /**
     * なるべく分割せずに1回のVOICEVOXリクエストで合成できるよう、280文字までは1チャンクにまとめる
     * （分割するとWeb APIの連続リクエスト制限に引っかかりやすいため）
     */
    private splitIntoChunks(cleanedText: string): string[] {
        if (cleanedText.length <= 280) {
            return [cleanedText];
        }

        const rawSentences = cleanedText
            .split(/(?<=[。！？!?\n])\s*/)
            .map(s => s.replace(/\s+/g, ' ').trim())
            .filter(s => s.length > 0);

        const chunks: string[] = [];
        let current = '';

        for (const sentence of rawSentences) {
            if ((current + sentence).length > 260 && current) {
                chunks.push(current);
                current = sentence;
            } else {
                current += (current ? ' ' : '') + sentence;
            }
        }
        if (current) {
            chunks.push(current);
        }
        return chunks;
    }

    /**
     * 特定のメッセージボタンが押されたときに再生/停止をトグルする
     */
    public async toggleSpeakMessage(messageId: string, rawText: string): Promise<void> {
        if (this.activeId === messageId && this.phase !== 'idle') {
            this.stop();
            return;
        }
        await this.speak(rawText, true, undefined, messageId);
    }

    /**
     * ハコさんの返答をVOICEVOXで最後まで同じ声質で読み上げる
     */
    public async speak(
        rawText: string,
        force: boolean = false,
        overrideSpeakerId?: number,
        messageId: string | null = null
    ): Promise<void> {
        if (!this.settings.enabled && !force) return;

        const cleaned = this.cleanTextForSpeech(rawText);
        if (!cleaned) return;

        const chunks = this.splitIntoChunks(cleaned);
        if (chunks.length === 0) return;

        this.stop();
        const reqId = this.activeRequestId;
        const targetId = messageId ?? '__system__';

        // タップ直後の同期処理内でスマホ用Audioアンロック＆「準備中(loading)」状態へ即座に遷移！
        this.ensureUnlockedAudio();
        this.updateStatus('loading', targetId);

        const speaker = overrideSpeakerId ?? this.settings.speakerId;

        try {
            for (let i = 0; i < chunks.length; i++) {
                if (reqId !== this.activeRequestId) return;

                // 2チャンク目以降はWeb APIのクールダウンのため少し待ってからリクエストする
                if (i > 0) {
                    this.updateStatus('loading', targetId);
                    await new Promise(r => setTimeout(r, 1200));
                }
                if (reqId !== this.activeRequestId) return;

                const audioInfo = await this.prepareChunkAudioUrl(chunks[i], speaker, reqId);
                if (reqId !== this.activeRequestId) return;

                if (audioInfo) {
                    this.updateStatus('playing', targetId);
                    await this.playAudioUrl(audioInfo.url, audioInfo.revoke, audioInfo.applyRate, reqId);
                }
            }
        } finally {
            if (reqId === this.activeRequestId) {
                this.updateStatus('idle', null);
            }
        }
    }

    /**
     * 1チャンク分の音声URLを ローカルVOICEVOX → Web VOICEVOX の順で取得する
     */
    private async prepareChunkAudioUrl(
        chunkText: string,
        speaker: number,
        reqId: number
    ): Promise<{ url: string; revoke: boolean; applyRate: boolean } | null> {
        // 1. ローカルVOICEVOX
        const localUrl = await this.fetchLocalVoicevoxUrl(chunkText, speaker, reqId);
        if (localUrl) {
            return { url: localUrl, revoke: true, applyRate: false };
        }
        if (reqId !== this.activeRequestId) return null;

        // 2. Web版 VOICEVOX (tts.quest)
        const webUrl = await this.fetchWebVoicevoxUrl(chunkText, speaker, reqId);
        if (webUrl) {
            return { url: webUrl, revoke: false, applyRate: true };
        }
        return null;
    }

    private async fetchLocalVoicevoxUrl(text: string, speaker: number, reqId: number): Promise<string | null> {
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 700);

            const queryRes = await fetch(
                `http://127.0.0.1:50021/audio_query?text=${encodeURIComponent(text)}&speaker=${speaker}`,
                { method: 'POST', signal: controller.signal }
            );
            clearTimeout(timeout);
            if (!queryRes.ok || reqId !== this.activeRequestId) return null;

            const queryJson = await queryRes.json();
            queryJson.speedScale = this.settings.speedScale;

            const synthRes = await fetch(
                `http://127.0.0.1:50021/synthesis?speaker=${speaker}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(queryJson)
                }
            );
            if (!synthRes.ok || reqId !== this.activeRequestId) return null;

            const blob = await synthRes.blob();
            return URL.createObjectURL(blob);
        } catch {
            return null;
        }
    }

    private async fetchWebVoicevoxUrl(text: string, speaker: number, reqId: number): Promise<string | null> {
        try {
            // レート制限(retryAfter)が返ってきた場合はしっかり待機して最大5回までリトライする
            for (let attempt = 0; attempt < 5; attempt++) {
                if (reqId !== this.activeRequestId) return null;
                const res = await fetch(
                    `https://api.tts.quest/v3/voicevox/synthesis?text=${encodeURIComponent(text)}&speaker=${speaker}`
                );
                if (!res.ok) {
                    await new Promise(r => setTimeout(r, 1500));
                    continue;
                }
                const data = await res.json();

                if (data?.retryAfter && typeof data.retryAfter === 'number') {
                    const waitMs = Math.min(8000, (data.retryAfter + 1) * 1000);
                    await new Promise(r => setTimeout(r, waitMs));
                    continue;
                }

                if (!data || !data.mp3StreamingUrl) {
                    await new Promise(r => setTimeout(r, 1500));
                    continue;
                }

                if (data.audioStatusUrl) {
                    for (let i = 0; i < 25; i++) {
                        if (reqId !== this.activeRequestId) return null;
                        try {
                            const statusRes = await fetch(data.audioStatusUrl);
                            if (statusRes.ok) {
                                const statusData = await statusRes.json();
                                if (statusData.isAudioReady) {
                                    break;
                                }
                                if (statusData.isAudioError) {
                                    return null;
                                }
                            }
                        } catch { /* ignore */ }
                        await new Promise(r => setTimeout(r, 500));
                    }
                } else {
                    await new Promise(r => setTimeout(r, 1500));
                }

                // 完成済みの mp3DownloadUrl を優先する
                return data.mp3DownloadUrl || data.mp3StreamingUrl;
            }
            return null;
        } catch {
            return null;
        }
    }

    private playAudioUrl(
        url: string,
        revokeOnEnd: boolean,
        applyPlaybackRate: boolean = true,
        reqId: number
    ): Promise<void> {
        return new Promise((resolve) => {
            if (reqId !== this.activeRequestId) {
                if (revokeOnEnd) URL.revokeObjectURL(url);
                resolve();
                return;
            }

            const audio = this.sharedAudio || new Audio();
            this.sharedAudio = audio;

            const cleanup = () => {
                audio.onended = null;
                audio.onerror = null;
                if (revokeOnEnd) URL.revokeObjectURL(url);
                resolve();
            };

            audio.onended = cleanup;
            audio.onerror = cleanup;
            audio.src = url;
            audio.preservesPitch = true;
            audio.playbackRate = applyPlaybackRate ? this.settings.speedScale : 1.0;

            const playPromise = audio.play();
            if (playPromise && typeof playPromise.catch === 'function') {
                playPromise.catch(cleanup);
            }
        });
    }
}

export const voiceManager = new VoiceManager();
