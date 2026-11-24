import { useState } from 'react';
import { useGoogleLogin } from '@react-oauth/google';
import { LogIn, Loader2, KeyRound, HelpCircle, Sparkles, ExternalLink, X } from 'lucide-react';
import { memoryManager } from '../ai/memory';

interface GoogleLoginProps {
    onLoginSuccess: (token: string) => void;
    onStartLocalMode: (apiKey: string) => void;
}

/**
 * AI答案採点システム (ai-exam-grader) と同じ 3ステップの Gemini APIキー無料取得ガイドモーダル
 */
export function ApiKeyGuideModal({
    isOpen,
    onClose,
    showInput = false,
    currentKey = '',
    onSaveKey,
}: {
    isOpen: boolean;
    onClose: () => void;
    showInput?: boolean;
    currentKey?: string;
    onSaveKey?: (newKey: string) => void;
}) {
    const [keyInput, setKeyInput] = useState(currentKey);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-slate-950/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-slate-800 border border-slate-700 rounded-2xl p-6 max-w-lg w-full shadow-2xl relative text-left text-slate-200">
                <button
                    type="button"
                    onClick={onClose}
                    className="absolute top-4 right-4 text-slate-400 hover:text-white p-1"
                >
                    <X size={18} />
                </button>

                <div className="flex items-center gap-2.5 mb-3">
                    <span className="text-2xl">🔑</span>
                    <div>
                        <h3 className="text-base font-bold text-white">Gemini APIキーの無料取得手順（約1分）</h3>
                        <p className="text-xs text-slate-400">
                            Googleアカウントがあれば完全無料・クレジットカード不要で即座に発行できます
                        </p>
                    </div>
                </div>

                <div className="space-y-3 text-xs text-slate-300 bg-slate-900/70 p-4 rounded-xl border border-slate-700/80 mb-4">
                    <div className="flex items-start gap-2.5">
                        <span className="w-5 h-5 rounded-full bg-indigo-600 text-white flex items-center justify-center font-bold text-[11px] shrink-0 mt-0.5">
                            1
                        </span>
                        <div>
                            <span className="font-bold text-white">Google AI Studio にアクセス:</span>
                            <p className="text-slate-400 mt-0.5">
                                以下のボタンをクリックし、お持ちのGoogleアカウントでログインします。
                            </p>
                            <a
                                href="https://aistudio.google.com/app/apikey"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold px-3 py-1.5 rounded-lg mt-2 transition text-xs shadow-sm"
                            >
                                <span>🔗 Google AI Studio でキーを発行する</span>
                                <ExternalLink size={13} />
                            </a>
                        </div>
                    </div>

                    <div className="flex items-start gap-2.5 pt-2.5 border-t border-slate-800">
                        <span className="w-5 h-5 rounded-full bg-indigo-600 text-white flex items-center justify-center font-bold text-[11px] shrink-0 mt-0.5">
                            2
                        </span>
                        <div>
                            <span className="font-bold text-white">「Create API key」をクリック:</span>
                            <p className="text-slate-400 mt-0.5">
                                青い「Create API key（APIキーを作成）」ボタンを押し、表示された英数字のキー（例:{' '}
                                <code className="text-emerald-300 bg-slate-800 px-1 py-0.5 rounded">AIzaSy...</code>）をコピーします。
                            </p>
                        </div>
                    </div>

                    <div className="flex items-start gap-2.5 pt-2.5 border-t border-slate-800">
                        <span className="w-5 h-5 rounded-full bg-indigo-600 text-white flex items-center justify-center font-bold text-[11px] shrink-0 mt-0.5">
                            3
                        </span>
                        <div>
                            <span className="font-bold text-white">本アプリの「Gemini APIキー」欄に貼り付け:</span>
                            <p className="text-slate-400 mt-0.5">
                                入力枠にペーストしてスタート（または保存）を押せば完了です！あなたのブラウザ内に安全に記憶されます。
                            </p>
                        </div>
                    </div>
                </div>

                {showInput && onSaveKey && (
                    <div className="mb-4 bg-slate-900/90 p-3.5 rounded-xl border border-emerald-500/30">
                        <label className="block text-xs font-semibold text-emerald-300 mb-1.5">
                            🔑 Gemini APIキーを設定・変更
                        </label>
                        <div className="flex gap-2">
                            <input
                                type="password"
                                value={keyInput}
                                onChange={(e) => setKeyInput(e.target.value)}
                                placeholder="AIzaSy..."
                                className="flex-1 bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-emerald-400"
                            />
                            <button
                                type="button"
                                onClick={() => {
                                    onSaveKey(keyInput.trim());
                                    onClose();
                                }}
                                className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-4 py-2 rounded-lg text-xs transition shrink-0"
                            >
                                保存する
                            </button>
                        </div>
                    </div>
                )}

                <div className="bg-amber-500/10 border border-amber-500/20 text-amber-200 px-3 py-2 rounded-lg text-[11px] mb-4">
                    <strong>💡 無料枠について:</strong> Google AI Studioの無料枠で1日あたり最大250回以上たっぷりとハコさんと会話できます。料金が勝手に発生することはありません。
                </div>

                <button
                    type="button"
                    onClick={onClose}
                    className="w-full bg-slate-700 hover:bg-slate-600 text-white font-bold py-2.5 rounded-xl text-xs transition"
                >
                    閉じる
                </button>
            </div>
        </div>
    );
}

export function GoogleLoginScreen({ onLoginSuccess, onStartLocalMode }: GoogleLoginProps) {
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [apiKey, setApiKey] = useState(memoryManager.getCustomApiKey());
    const [showGuide, setShowGuide] = useState(false);

    const login = useGoogleLogin({
        onSuccess: (codeResponse) => {
            setIsLoading(false);
            if (codeResponse.access_token) {
                onLoginSuccess(codeResponse.access_token);
            } else {
                setError('認証に成功しましたが、アクセストークンが取得できませんでした。');
            }
        },
        onError: (error) => {
            setIsLoading(false);
            console.error('Login Failed:', error);
            setError('Googleログインに失敗しました。');
        },
        scope: 'https://www.googleapis.com/auth/drive.file',
    });

    const handleLoginClick = () => {
        setIsLoading(true);
        setError(null);
        login();
    };

    const handleLocalStart = (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        const trimmed = apiKey.trim();
        const envKey = import.meta.env.VITE_GEMINI_API_KEY;
        const hasEnvKey = Boolean(envKey && envKey !== 'YOUR_GEMINI_API_KEY_HERE');

        if (!trimmed && !hasEnvKey) {
            setError('Gemini APIキーを入力してください（「❓ 取得方法」から1分で無料取得できます）');
            return;
        }
        onStartLocalMode(trimmed);
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-slate-900 text-slate-200 p-4">
            <div className="max-w-md w-full bg-slate-800 rounded-2xl shadow-xl overflow-hidden border border-slate-700">
                <div className="p-7 text-center space-y-5">
                    <div className="w-16 h-16 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto border border-emerald-500/30">
                        <Sparkles className="w-8 h-8 text-emerald-400" />
                    </div>

                    <div className="space-y-1.5">
                        <h2 className="text-2xl font-bold text-white tracking-wide">Hakoniwa AI</h2>
                        <p className="text-slate-400 text-xs leading-relaxed">
                            あなたとの会話で日々学び、成長するパーソナルAI「ハコニワ」🏯🌸
                        </p>
                    </div>

                    {error && (
                        <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-xs text-left">
                            {error}
                        </div>
                    )}

                    {/* ① かんたんスタート（ブラウザ保存 ＋ 初回インタビュー形式） */}
                    <form
                        onSubmit={handleLocalStart}
                        className="bg-slate-900/70 rounded-xl p-4 border border-emerald-500/30 text-left space-y-3"
                    >
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-emerald-300 flex items-center gap-1.5">
                                🌱 かんたんスタート（ブラウザ保存）
                            </span>
                            <button
                                type="button"
                                onClick={() => setShowGuide(true)}
                                className="inline-flex items-center gap-1 text-indigo-300 hover:text-indigo-200 text-[11px] underline font-semibold transition"
                            >
                                <HelpCircle size={12} />
                                <span>❓ APIキーの取得方法（1分）</span>
                            </button>
                        </div>

                        <p className="text-[11px] text-slate-400 leading-relaxed">
                            無料のGemini APIキーを1つ入れるだけで、面倒な設定なしですぐに始められます。お名前や地域はあとでハコさんが会話の中で優しくお聞きします！
                        </p>

                        <div className="relative">
                            <KeyRound size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                            <input
                                type="password"
                                value={apiKey}
                                onChange={(e) => setApiKey(e.target.value)}
                                placeholder="Gemini APIキー (AIzaSy...)"
                                className="w-full bg-slate-800 border border-slate-700 rounded-lg py-2.5 pl-9 pr-3 text-xs text-white font-mono placeholder-slate-500 focus:outline-none focus:border-emerald-400"
                            />
                        </div>

                        <button
                            type="submit"
                            className="w-full py-2.5 px-4 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 font-bold rounded-xl text-xs transition-all transform active:scale-[0.98] shadow-md flex items-center justify-center gap-2"
                        >
                            <Sparkles size={15} />
                            <span>ハコさんと話しはじめる（ブラウザ保存）</span>
                        </button>
                    </form>

                    <div className="flex items-center gap-3 text-[11px] text-slate-500">
                        <div className="flex-1 h-px bg-slate-700" />
                        <span>または（クラウド同期・マスター用）</span>
                        <div className="flex-1 h-px bg-slate-700" />
                    </div>

                    {/* ② Google Drive 接続（マスター・クラウド同期用） */}
                    <div className="space-y-2">
                        <button
                            type="button"
                            onClick={handleLoginClick}
                            disabled={isLoading}
                            className="w-full relative py-2.5 px-4 bg-white hover:bg-slate-100 text-slate-800 rounded-xl text-xs font-medium transition-all transform active:scale-[0.98] shadow-md flex items-center justify-center gap-2.5 disabled:opacity-70 disabled:cursor-not-allowed"
                        >
                            {isLoading ? (
                                <>
                                    <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
                                    <span>接続中...</span>
                                </>
                            ) : (
                                <>
                                    <LogIn className="w-4 h-4 text-slate-700" />
                                    <span>Google Drive でログインして接続</span>
                                </>
                            )}
                        </button>
                        <p className="text-[10px] text-slate-500">
                            ※PC・スマホ・LINE間で同じ「hakoniwa_memory.json」を共有する場合はこちら
                        </p>
                    </div>
                </div>
            </div>

            <ApiKeyGuideModal
                isOpen={showGuide}
                onClose={() => setShowGuide(false)}
                showInput={true}
                currentKey={apiKey}
                onSaveKey={(newKey) => setApiKey(newKey)}
            />
        </div>
    );
}
