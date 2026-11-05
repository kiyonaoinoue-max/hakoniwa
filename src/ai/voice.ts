// VOICEVOX (ローカルエンジン + Web API + キャラクター別トーン調整TTSフォールバック) & Web Speech API 音声認識マネージャー

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
    speedScale: number; // 0.8 ~ 1.3 (デフォルト 1.0)
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
     * 読み上げ用にテキストからURLや余計な記号・絵文字を整理する
     */
    private cleanTextForSpeech(text: string): string {
        return text
            .replace(/https?:\/\/[^\s]+/g, '')
            .replace(/🔗\s*出典:?/g, '')
            .replace(/[★☆]{2,}/g, (m) => `星${(m.match(/★/g) || []).length}つ。`)
            .replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 220); // Web合成のレスポンスを速くするため最大220文字に制限
    }

    /**
     * ハコさんの返答をVOICEVOXで読み上げる
     * overrideSpeakerId が指定されていれば確実にその声IDで合成する
     */
    public async speak(rawText: string, force: boolean = false, overrideSpeakerId?: number): Promise<void> {
        if (!this.settings.enabled && !force) return;

        const text = this.cleanTextForSpeech(rawText);
        if (!text) return;

        this.stop();
        const reqId = this.activeRequestId;
        this.setSpeaking(true);

        const speaker = overrideSpeakerId ?? this.settings.speakerId;

        // 1. まずローカルPCの VOICEVOX エンジン (http://127.0.0.1:50021) を試行
        const playedLocal = await this.tryLocalVoicevox(text, speaker, reqId);
        if (playedLocal || reqId !== this.activeRequestId) return;

        // 2. 次に Web版 VOICEVOX API (api.tts.quest) を合成完了までポーリングして再生
        const playedWeb = await this.tryWebVoicevox(text, speaker, reqId);
        if (playedWeb || reqId !== this.activeRequestId) return;

        // 3. フォールバック：ブラウザ内蔵の音声合成（選んだキャラごとに声の高さ・速度を変化させる）
        this.speakWithBrowserTTS(text, speaker);
    }

    private async tryLocalVoicevox(text: string, speaker: number, reqId: number): Promise<boolean> {
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 900);

            const queryRes = await fetch(
                `http://127.0.0.1:50021/audio_query?text=${encodeURIComponent(text)}&speaker=${speaker}`,
                { method: 'POST', signal: controller.signal }
            );
            clearTimeout(timeout);
            if (!queryRes.ok || reqId !== this.activeRequestId) return false;

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
            if (!synthRes.ok || reqId !== this.activeRequestId) return false;

            const blob = await synthRes.blob();
            const url = URL.createObjectURL(blob);
            // ローカルVOICEVOXは queryJson.speedScale で既に速度反映済みなので playbackRate は 1.0 のままにする
            await this.playAudioUrl(url, true, false);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Web版 VOICEVOX API (tts.quest v3)
     * サーバー側でMP3合成が完了するまで audioStatusUrl をポーリングしてから再生する
     */
    private async tryWebVoicevox(text: string, speaker: number, reqId: number): Promise<boolean> {
        try {
            const res = await fetch(
                `https://api.tts.quest/v3/voicevox/synthesis?text=${encodeURIComponent(text)}&speaker=${speaker}`
            );
            if (!res.ok || reqId !== this.activeRequestId) return false;
            const data = await res.json();
            if (!data || !data.mp3StreamingUrl) return false;

            // audioStatusUrl がある場合、isAudioReady が true になるまで最大8秒待つ
            if (data.audioStatusUrl) {
                for (let i = 0; i < 16; i++) {
                    if (reqId !== this.activeRequestId) return false;
                    try {
                        const statusRes = await fetch(data.audioStatusUrl);
                        if (statusRes.ok) {
                            const statusData = await statusRes.json();
                            if (statusData.isAudioReady) {
                                break;
                            }
                            if (statusData.isAudioError) {
                                return false;
                            }
                        }
                    } catch { /* ignore */ }
                    await new Promise(r => setTimeout(r, 500));
                }
            } else {
                await new Promise(r => setTimeout(r, 1200));
            }

            if (reqId !== this.activeRequestId) return false;

            const playUrl = data.mp3DownloadUrl || data.mp3StreamingUrl;
            await this.playAudioUrl(playUrl, false);
            return true;
        } catch {
            return false;
        }
    }

    private playAudioUrl(url: string, revokeOnEnd: boolean, applyPlaybackRate: boolean = true): Promise<void> {
        return new Promise((resolve, reject) => {
            const audio = new Audio(url);
            if (applyPlaybackRate) {
                audio.playbackRate = this.settings.speedScale;
            }
            this.currentAudio = audio;

            audio.onended = () => {
                if (revokeOnEnd) URL.revokeObjectURL(url);
                this.currentAudio = null;
                this.setSpeaking(false);
                resolve();
            };

            audio.onerror = (err) => {
                if (revokeOnEnd) URL.revokeObjectURL(url);
                this.currentAudio = null;
                this.setSpeaking(false);
                reject(err);
            };

            audio.play().catch((err) => {
                if (revokeOnEnd) URL.revokeObjectURL(url);
                this.currentAudio = null;
                this.setSpeaking(false);
                reject(err);
            });
        });
    }

    private speakWithBrowserTTS(text: string, speakerId: number): void {
        if (!('speechSynthesis' in window)) {
            this.setSpeaking(false);
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

        utter.onend = () => this.setSpeaking(false);
        utter.onerror = () => this.setSpeaking(false);
        window.speechSynthesis.speak(utter);
    }
}

export const voiceManager = new VoiceManager();
