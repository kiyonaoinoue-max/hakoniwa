import { useState } from 'react';
import { useGoogleLogin } from '@react-oauth/google';
import { LogIn, Loader2 } from 'lucide-react';

interface GoogleLoginProps {
    onLoginSuccess: (token: string) => void;
}

export function GoogleLoginScreen({ onLoginSuccess }: GoogleLoginProps) {
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

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

    return (
        <div className="min-h-screen flex items-center justify-center bg-slate-900 text-slate-200 p-4">
            <div className="max-w-md w-full bg-slate-800 rounded-2xl shadow-xl overflow-hidden border border-slate-700">
                <div className="p-8 text-center space-y-6">
                    <div className="w-20 h-20 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto border border-emerald-500/30">
                        <LogIn className="w-10 h-10 text-emerald-400" />
                    </div>

                    <div className="space-y-2">
                        <h2 className="text-2xl font-bold text-white tracking-wide">Hakoniwa AI</h2>
                        <p className="text-slate-400 text-sm">
                            ハコさんの記憶ストレージとして Google Drive を使用します。
                        </p>
                    </div>

                    <div className="bg-slate-900/50 rounded-lg p-4 text-xs text-slate-400 text-left space-y-2">
                        <p className="flex items-start gap-2">
                            <span className="text-emerald-400 mt-0.5">✓</span>
                            <span>あなた専用の「hakoniwa_memory.json」を作成・読み書きするためだけに使用します。</span>
                        </p>
                        <p className="flex items-start gap-2">
                            <span className="text-emerald-400 mt-0.5">✓</span>
                            <span>既存の個人的なファイルにアクセスすることはありません。</span>
                        </p>
                    </div>

                    {error && (
                        <div className="p-3 bg-red-500/10 border border-red-500/20 rounded text-red-400 text-sm">
                            {error}
                        </div>
                    )}

                    <button
                        onClick={handleLoginClick}
                        disabled={isLoading}
                        className="w-full relative py-3 px-4 bg-white hover:bg-slate-100 text-slate-800 rounded-xl font-medium transition-all transform active:scale-[0.98] shadow-md flex items-center justify-center gap-3 disabled:opacity-70 disabled:cursor-not-allowed"
                    >
                        {isLoading ? (
                            <>
                                <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
                                <span>接続中...</span>
                            </>
                        ) : (
                            <>
                                <svg className="w-5 h-5" viewBox="0 0 24 24">
                                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                                </svg>
                                <span>Google でログインして接続</span>
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
}
