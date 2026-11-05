// VOICEVOX (ローカルエンジン + Web API 分割連続再生 + キャラクター別トーン調整TTSフォールバック) & Web Speech API 音声認識マネージャー

export interface VoiceSpeedOption {
    label: string;
    value: number;
}

export const VOICE_SPEED_OPTIONS: VoiceSpeedOption[] = [
    { label: '🐢 ゆっくり', value: 0.85 },
    { label: '🚶 ふつう', value: 1.0 },
    { label: '🐇 はやめ', value: 1.2 },
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
    speedScale: number; // 0.85 | 1.0 | 1.2
}

const VOICE_STORAGE_KEY = 'hakoniwa_voice_settings_v1';

export class VoiceManager {
    private settings: VoiceSettings;
    private currentAudio: HTMLAudioElement | null = null;
    private isSpeakingState = false;
    private activeRequestId = 0;
    private onStateChange?: (speaking: boolean) => void;

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
        if (this.currentAudio) {
            this.currentAudio.playbackRate = speedScale;
        }
        this.saveSettings();
    }

    public setOnSpeakingChange(cb: (speaking: boolean) => void): void {
        this.onStateChange = cb;
    }

    private setSpeaking(val: boolean): void {
        this.isSpeakingState = val;
        this.onStateChange?.(val);
    }

    public isSpeaking(): boolean {
        return this.isSpeakingState;
    }

    public stop(): void {
        this.activeRequestId++;
        if (this.currentAudio) {
            this.currentAudio.pause();
            this.currentAudio = null;
        }
        if ('speechSynthesis' in window) {
            window.speechSynthesis.cancel();
        }
        this.setSpeaking(false);
    }

    /**
     * 読み上げ用にテキストからURLや余計な記号・絵文字を整理する（文字数制限なしで全文対応）
     */
    private cleanTextForSpeech(text: string): string {
        return text
            .replace(/https?:\/\/[^\s]+/g, '')
            .replace(/🔗\s*出典:?/g, '')
            .replace(/[★☆]{2,}/g, (m) => `星${(m.match(/★/g) || []).length}つ。`)
            .replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '')
            .trim();
    }

    /**
     * 長い文章を句点（。！？）や改行ごとに160文字前後のチャンクにまとめる（分割数を減らしてAPI制限を防ぐ）
     */
    private splitIntoChunks(cleanedText: string): string[] {
        const rawSentences = cleanedText
            .split(/(?<=[。！？!?\n])\s*/)
            .map(s => s.replace(/\s+/g, ' ').trim())
            .filter(s => s.length > 0);

        const chunks: string[] = [];
        let current = '';

        for (const sentence of rawSentences) {
            // 1文自体が170文字を超える場合は読点（、）で分割
            if (sentence.length > 170) {
                if (current) {
                    chunks.push(current);
                    current = '';
                }
                const subParts = sentence.split(/(?<=[、，,])\s*/);
                let subCurrent = '';
                for (const part of subParts) {
                    if ((subCurrent + part).length > 150 && subCurrent) {
                        chunks.push(subCurrent);
                        subCurrent = part;
                    } else {
                        subCurrent += part;
                    }
                }
                if (subCurrent) chunks.push(subCurrent);
                continue;
            }

            if ((current + sentence).length > 160 && current) {
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
     * ハコさんの返答をVOICEVOXで最後まで同じ声質で読み上げる
     * （途中でブラウザTTSに勝手に切り替わって別人になるのを防ぐため、1チャンク目でVOICEVOXが成功したら最後までVOICEVOXを維持する）
     */
    public async speak(rawText: string, force: boolean = false, overrideSpeakerId?: number): Promise<void> {
        if (!this.settings.enabled && !force) return;

        const cleaned = this.cleanTextForSpeech(rawText);
        if (!cleaned) return;

        const chunks = this.splitIntoChunks(cleaned);
        if (chunks.length === 0) return;

        this.stop();
        const reqId = this.activeRequestId;
        this.setSpeaking(true);

        const speaker = overrideSpeakerId ?? this.settings.speakerId;

        try {
            let voicevoxSucceededOnce = false;

            for (let i = 0; i < chunks.length; i++) {
                if (reqId !== this.activeRequestId) return;

                const audioInfo = await this.prepareChunkAudioUrl(chunks[i], speaker, reqId);
                if (reqId !== this.activeRequestId) return;

                if (audioInfo) {
                    voicevoxSucceededOnce = true;
                    await this.playAudioUrl(audioInfo.url, audioInfo.revoke, audioInfo.applyRate);
                } else if (!voicevoxSucceededOnce) {
                    // 最初からVOICEVOXに全く繋がらないオフライン環境等の場合のみブラウザTTSを使用
                    await this.speakWithBrowserTTSAsync(chunks[i], speaker, reqId);
                }
            }
        } finally {
            if (reqId === this.activeRequestId) {
                this.setSpeaking(false);
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
            // レート制限(retryAfter)が返ってきた場合はしっかり待機して最大5回までリトライする（途中で別人の声になるのを防ぐ）
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
                    for (let i = 0; i < 20; i++) {
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
                        await new Promise(r => setTimeout(r, 450));
                    }
                } else {
                    await new Promise(r => setTimeout(r, 1000));
                }

                return data.mp3DownloadUrl || data.mp3StreamingUrl;
            }
            return null;
        } catch {
            return null;
        }
    }

    private playAudioUrl(url: string, revokeOnEnd: boolean, applyPlaybackRate: boolean = true): Promise<void> {
        return new Promise((resolve) => {
            const audio = new Audio(url);
            if (applyPlaybackRate) {
                audio.playbackRate = this.settings.speedScale;
            }
            this.currentAudio = audio;

            const cleanup = () => {
                if (revokeOnEnd) URL.revokeObjectURL(url);
                if (this.currentAudio === audio) {
                    this.currentAudio = null;
                }
                resolve();
            };

            audio.onended = cleanup;
            audio.onerror = cleanup;
            audio.play().catch(cleanup);
        });
    }

    private speakWithBrowserTTSAsync(text: string, speakerId: number, reqId: number): Promise<void> {
        return new Promise((resolve) => {
            if (!('speechSynthesis' in window) || reqId !== this.activeRequestId) {
                resolve();
                return;
            }
            const speakerOption = VOICEVOX_SPEAKERS.find(s => s.id === speakerId) || VOICEVOX_SPEAKERS[0];
            const utter = new SpeechSynthesisUtterance(text);
            utter.lang = 'ja-JP';
            utter.pitch = speakerOption.fallbackPitch;
            utter.rate = Math.max(0.5, Math.min(2.0, speakerOption.fallbackRate * this.settings.speedScale));

            const voices = window.speechSynthesis.getVoices();
            const jaVoice = voices.find(v => v.lang.includes('ja') && (v.name.includes('Nanami') || v.name.includes('Kyoko') || v.name.includes('Google')));
            if (jaVoice) utter.voice = jaVoice;

            utter.onend = () => resolve();
            utter.onerror = () => resolve();
            window.speechSynthesis.speak(utter);
        });
    }
}

export const voiceManager = new VoiceManager();
