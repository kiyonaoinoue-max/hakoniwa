// VOICEVOX (ローカルエンジン + Web API + ブラウザTTSフォールバック) & Web Speech API 音声認識マネージャー

export interface VoiceSpeakerOption {
    id: number;
    name: string;
    description: string;
}

export const VOICEVOX_SPEAKERS: VoiceSpeakerOption[] = [
    { id: 47, name: 'ナースロボ＿タイプＴ (ノーマル)', description: '落ち着いて控えめ・優しいAIボイス（ハコさん推奨！）' },
    { id: 48, name: 'ナースロボ＿タイプＴ (楽々)', description: '少し明るく親しみやすいAIボイス' },
    { id: 14, name: '冥鳴ひまり (ノーマル)', description: '柔らかくて上品・聞き心地の良い声' },
    { id: 61, name: '中国うさぎ (ノーマル)', description: 'おっとり控えめで可愛らしい声' },
    { id: 2,  name: '四国めたん (ノーマル)', description: 'ハキハキして清楚な声' },
    { id: 10, name: '雨晴はう (ノーマル)', description: '素直で優しい声' },
    { id: 8,  name: '春日部つむぎ (ノーマル)', description: '元気でフレンドリーな声' },
    { id: 3,  name: 'ずんだもん (ノーマル)', description: 'マスコットらしい可愛い声' },
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
            enabled: false, // デフォルトはOFF（ユーザーがスピーカーボタンでONにできる）
            speakerId: 47,  // ナースロボ＿タイプＴ (控えめで優しい声)
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
            .replace(/https?:\/\/[^\s]+/g, '') // URL除去
            .replace(/🔗\s*出典:?/g, '')
            .replace(/[★☆]{2,}/g, (m) => `星${(m.match(/★/g) || []).length}つ。`)
            .replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '') // 絵文字除去
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 280); // 長すぎる場合は最初の280文字まで
    }

    /**
     * ハコさんの返答をVOICEVOXで読み上げる
     * force=true の場合は設定がOFFでもテスト再生する
     */
    public async speak(rawText: string, force: boolean = false): Promise<void> {
        if (!this.settings.enabled && !force) return;

        const text = this.cleanTextForSpeech(rawText);
        if (!text) return;

        this.stop();
        this.setSpeaking(true);

        const speaker = this.settings.speakerId;

        // 1. まずローカルPCの VOICEVOX エンジン (http://127.0.0.1:50021) を試行 (待ち時間ゼロ＆無制限)
        const playedLocal = await this.tryLocalVoicevox(text, speaker);
        if (playedLocal) return;

        // 2. 次に Web版 VOICEVOX API (tts.quest) を試行 (スマホ・Vercel環境でもVOICEVOXの声が出る！)
        const playedWeb = await this.tryWebVoicevox(text, speaker);
        if (playedWeb) return;

        // 3. フォールバック：ブラウザ内蔵の音声合成（少し高めの優しいトーンに調整）
        this.speakWithBrowserTTS(text);
    }

    private async tryLocalVoicevox(text: string, speaker: number): Promise<boolean> {
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 1200);

            const queryRes = await fetch(
                `http://127.0.0.1:50021/audio_query?text=${encodeURIComponent(text)}&speaker=${speaker}`,
                { method: 'POST', signal: controller.signal }
            );
            clearTimeout(timeout);
            if (!queryRes.ok) return false;

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
            if (!synthRes.ok) return false;

            const blob = await synthRes.blob();
            const url = URL.createObjectURL(blob);
            await this.playAudioUrl(url, true);
            return true;
        } catch {
            return false;
        }
    }

    private async tryWebVoicevox(text: string, speaker: number): Promise<boolean> {
        try {
            const res = await fetch(
                `https://api.tts.quest/v3/voicevox/synthesis?text=${encodeURIComponent(text)}&speaker=${speaker}`
            );
            if (!res.ok) return false;
            const data = await res.json();
            if (!data || !data.mp3StreamingUrl) return false;

            // 音声生成完了を少し待ってから再生
            await this.playAudioUrl(data.mp3StreamingUrl, false);
            return true;
        } catch {
            return false;
        }
    }

    private playAudioUrl(url: string, revokeOnEnd: boolean): Promise<void> {
        return new Promise((resolve, reject) => {
            const audio = new Audio(url);
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

    private speakWithBrowserTTS(text: string): void {
        if (!('speechSynthesis' in window)) {
            this.setSpeaking(false);
            return;
        }
        const utter = new SpeechSynthesisUtterance(text);
        utter.lang = 'ja-JP';
        utter.pitch = 1.15; // 少し可愛らしく柔らかい声色に
        utter.rate = 1.0;

        const voices = window.speechSynthesis.getVoices();
        const jaVoice = voices.find(v => v.lang.includes('ja') && (v.name.includes('Nanami') || v.name.includes('Kyoko') || v.name.includes('Google')));
        if (jaVoice) utter.voice = jaVoice;

        utter.onend = () => this.setSpeaking(false);
        utter.onerror = () => this.setSpeaking(false);
        window.speechSynthesis.speak(utter);
    }
}

export const voiceManager = new VoiceManager();
