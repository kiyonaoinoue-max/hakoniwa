import React, { useState, useEffect, useRef } from 'react';
import { Send, Clock, Cpu, Camera, Mic, MicOff, Volume2, VolumeX, Settings2, X } from 'lucide-react';
import { Brain } from '../ai/brain';
import type { BrainState } from '../ai/types';
import { voiceManager, VOICEVOX_SPEAKERS } from '../ai/voice';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';

interface ChatProps {
    brain: Brain;
    onUpdate: () => void;
    brainState: BrainState;
}

/**
 * アップロードされた画像ファイルを最大長辺 800px の JPEG DataURL にリサイズ・圧縮するヘルパー
 * （localStorage や Google Drive の容量圧迫を防ぎつつ Gemini Vision には十分な解像度を保つ）
 */
async function compressImageFile(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const maxDim = 800;
                let { width, height } = img;
                if (width > maxDim || height > maxDim) {
                    if (width > height) {
                        height = Math.round((height * maxDim) / width);
                        width = maxDim;
                    } else {
                        width = Math.round((width * maxDim) / height);
                        height = maxDim;
                    }
                }
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                if (!ctx) {
                    resolve(e.target?.result as string);
                    return;
                }
                ctx.drawImage(img, 0, 0, width, height);
                resolve(canvas.toDataURL('image/jpeg', 0.82));
            };
            img.onerror = reject;
            img.src = e.target?.result as string;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

export const ChatInterface: React.FC<ChatProps> = ({ brain, onUpdate, brainState }) => {
    const [input, setInput] = useState('');
    const [attachedImage, setAttachedImage] = useState<string | null>(null);
    const [isThinking, setIsThinking] = useState(false);

    // 音声読み上げ (VOICEVOX) 状態
    const [voiceEnabled, setVoiceEnabled] = useState(voiceManager.getSettings().enabled);
    const [selectedSpeaker, setSelectedSpeaker] = useState(voiceManager.getSettings().speakerId);
    const [showVoiceMenu, setShowVoiceMenu] = useState(false);
    const [isSpeaking, setIsSpeaking] = useState(false);

    // 音声認識 (マイク入力) 状態
    const [isListening, setIsListening] = useState(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const recognitionRef = useRef<any>(null);

    const fileInputRef = useRef<HTMLInputElement>(null);
    const scrollRef = useRef<HTMLDivElement>(null);
    const bottomRef = useRef<HTMLDivElement>(null);
    const lastSpokenEpisodeIdRef = useRef<string | null>(
        brainState.episodes.length > 0 ? brainState.episodes[brainState.episodes.length - 1].id : null
    );

    useEffect(() => {
        voiceManager.setOnSpeakingChange((speaking) => {
            setIsSpeaking(speaking);
        });
    }, []);

    // 新しいAIメッセージが追加されたら（自動トリガー含む）、音声ONなら自動でVOICEVOX読み上げ
    useEffect(() => {
        if (brainState.episodes.length === 0) return;
        const lastEp = brainState.episodes[brainState.episodes.length - 1];
        if (lastEp.id !== lastSpokenEpisodeIdRef.current) {
            lastSpokenEpisodeIdRef.current = lastEp.id;
            if (lastEp.speaker === 'ai' && voiceManager.getSettings().enabled) {
                voiceManager.speak(lastEp.content);
            }
        }
    }, [brainState.episodes]);

    const toggleVoiceEnabled = () => {
        const next = !voiceEnabled;
        setVoiceEnabled(next);
        voiceManager.setEnabled(next);
        if (next) {
            voiceManager.speak('音声読み上げをオンにしました。よろしくお願いしますね。', true);
        }
    };

    const handleSpeakerChange = (speakerId: number) => {
        setSelectedSpeaker(speakerId);
        voiceManager.setSpeakerId(speakerId);
        voiceManager.speak('こんにちは、ハコです。この声でお話ししますね。', true);
    };

    // --- 画像選択 & クリップボード貼り付け処理 ---
    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
            const compressed = await compressImageFile(file);
            setAttachedImage(compressed);
        } catch (err) {
            console.error('Image compression failed:', err);
        }
        e.target.value = '';
    };

    const handlePaste = async (e: React.ClipboardEvent<HTMLInputElement>) => {
        const items = e.clipboardData?.items;
        if (!items) return;
        for (let i = 0; i < items.length; i++) {
            if (items[i].type.startsWith('image/')) {
                const file = items[i].getAsFile();
                if (file) {
                    e.preventDefault();
                    const compressed = await compressImageFile(file);
                    setAttachedImage(compressed);
                    break;
                }
            }
        }
    };

    // --- マイク音声入力 (Web Speech API) ---
    const toggleListening = () => {
        if (isListening) {
            recognitionRef.current?.stop();
            setIsListening(false);
            return;
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (!SpeechRecognition) {
            alert('お使いのブラウザは音声入力（Web Speech API）に対応していません。ChromeやEdgeをお試しください。');
            return;
        }

        const recognition = new SpeechRecognition();
        recognition.lang = 'ja-JP';
        recognition.interimResults = true;
        recognition.continuous = false;

        const baseInput = input ? input + ' ' : '';

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        recognition.onresult = (event: any) => {
            let transcript = '';
            for (let i = 0; i < event.results.length; i++) {
                transcript += event.results[i][0].transcript;
            }
            setInput(baseInput + transcript);
        };

        recognition.onend = () => {
            setIsListening(false);
        };

        recognition.onerror = () => {
            setIsListening(false);
        };

        recognitionRef.current = recognition;
        recognition.start();
        setIsListening(true);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!input.trim() && !attachedImage) return;

        if (isListening) {
            recognitionRef.current?.stop();
            setIsListening(false);
        }

        const userInput = input;
        const imageToSend = attachedImage || undefined;
        setInput('');
        setAttachedImage(null);
        setIsThinking(true);

        // Simulate thinking delay for "feeling"
        await new Promise(r => setTimeout(r, 600));

        await brain.processInput(userInput, imageToSend);
        setIsThinking(false);
        onUpdate();
    };

    // Scroll to bottom on new messages and initial load
    useEffect(() => {
        const scrollToBottom = () => {
            bottomRef.current?.scrollIntoView({ behavior: 'auto' });
        };
        scrollToBottom();
        const t = setTimeout(scrollToBottom, 300);
        return () => clearTimeout(t);
    }, [brainState.episodes.length, isThinking]);

    const currentSpeakerObj = VOICEVOX_SPEAKERS.find(s => s.id === selectedSpeaker) || VOICEVOX_SPEAKERS[0];

    return (
        <div className="flex flex-col h-full bg-[rgba(30,30,35,0.6)] backdrop-blur-md rounded-2xl border border-[rgba(255,255,255,0.1)] shadow-2xl overflow-hidden relative">
            {/* Header */}
            <div className="p-4 border-b border-[rgba(255,255,255,0.05)] flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Cpu className="text-purple-400" size={20} />
                    <span className="font-semibold text-white tracking-wide">Hakoniwa AI</span>
                    {isSpeaking && (
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30 animate-pulse">
                            🔊 お話し中...
                        </span>
                    )}
                </div>

                <div className="flex items-center gap-3">
                    {/* Voice ON/OFF Toggle */}
                    <button
                        type="button"
                        onClick={toggleVoiceEnabled}
                        title={voiceEnabled ? '音声読み上げ ON (クリックでOFF)' : '音声読み上げ OFF (クリックでON)'}
                        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all border ${
                            voiceEnabled
                                ? 'bg-purple-500/20 text-purple-200 border-purple-500/40 shadow-sm'
                                : 'bg-white/5 text-slate-400 border-white/10 hover:text-slate-200'
                        }`}
                    >
                        {voiceEnabled ? <Volume2 size={14} className="text-purple-300" /> : <VolumeX size={14} />}
                        <span className="hidden sm:inline">{voiceEnabled ? '声 ON' : '声 OFF'}</span>
                    </button>

                    {/* Voice Character Selector Button */}
                    <button
                        type="button"
                        onClick={() => setShowVoiceMenu(!showVoiceMenu)}
                        title="ハコさんの声（VOICEVOX）を選ぶ"
                        className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs bg-white/5 text-slate-300 border border-white/10 hover:bg-white/10 transition-colors"
                    >
                        <Settings2 size={13} />
                        <span className="hidden md:inline max-w-[110px] truncate">{currentSpeakerObj.name.split(' ')[0]}</span>
                    </button>

                    <div className="flex items-center gap-1.5 text-xs text-slate-400">
                        <Clock size={14} />
                        <span>{format(new Date(), 'PP HH:mm', { locale: ja })}</span>
                    </div>
                </div>
            </div>

            {/* VOICEVOX Voice Settings Popover */}
            {showVoiceMenu && (
                <div className="absolute right-4 top-14 z-30 w-80 bg-slate-900/95 backdrop-blur-xl border border-white/15 rounded-xl p-4 shadow-2xl text-xs">
                    <div className="flex items-center justify-between mb-2">
                        <span className="font-semibold text-white text-sm">🎀 ハコさんの声設定 (VOICEVOX)</span>
                        <button
                            type="button"
                            onClick={() => setShowVoiceMenu(false)}
                            className="text-slate-400 hover:text-white p-1"
                        >
                            <X size={15} />
                        </button>
                    </div>
                    <p className="text-slate-400 text-[11px] mb-3 leading-relaxed">
                        お好みの声を選ぶと試し聴きができます。スマホや外出先でもVOICEVOXの声でお話しします。
                    </p>
                    <div className="space-y-1.5 max-h-60 overflow-y-auto pr-1">
                        {VOICEVOX_SPEAKERS.map((sp) => (
                            <button
                                key={sp.id}
                                type="button"
                                onClick={() => handleSpeakerChange(sp.id)}
                                className={`w-full text-left p-2 rounded-lg border transition-all flex flex-col gap-0.5 ${
                                    selectedSpeaker === sp.id
                                        ? 'bg-purple-600/25 border-purple-500/50 text-white'
                                        : 'bg-white/5 border-white/5 text-slate-300 hover:bg-white/10'
                                }`}
                            >
                                <div className="font-medium flex items-center justify-between">
                                    <span>{sp.name}</span>
                                    {selectedSpeaker === sp.id && <span className="text-[10px] text-purple-300">✓ 選択中</span>}
                                </div>
                                <div className="text-[10px] text-slate-400">{sp.description}</div>
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* Messages */}
            <div
                ref={scrollRef}
                style={{
                    flex: 1,
                    overflowY: 'auto',
                    padding: '16px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px',
                    maxWidth: '720px',
                    width: '100%',
                    margin: '0 auto',
                }}
            >
                {brainState.episodes.map((ep) => (
                    <div
                        key={ep.id}
                        style={{
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: ep.speaker === 'user' ? 'flex-end' : 'flex-start',
                        }}
                    >
                        <div className="flex items-center gap-1.5 mb-1 px-2">
                            <span style={{
                                fontSize: '10px',
                                opacity: 0.5,
                                fontWeight: 500,
                                letterSpacing: '0.05em',
                            }}>
                                {ep.speaker === 'user' ? 'YOU' : 'HAKONIWA'}
                            </span>
                            {ep.speaker === 'ai' && (
                                <button
                                    type="button"
                                    onClick={() => voiceManager.speak(ep.content, true)}
                                    title="このメッセージを声で聴く"
                                    className="opacity-40 hover:opacity-100 text-slate-300 transition-opacity"
                                >
                                    <Volume2 size={12} />
                                </button>
                            )}
                        </div>
                        <div style={{
                            maxWidth: '85%',
                            padding: '12px 16px',
                            borderRadius: ep.speaker === 'user' ? '16px 4px 16px 16px' : '4px 16px 16px 16px',
                            fontSize: '14px',
                            lineHeight: '1.7',
                            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                            whiteSpace: 'pre-wrap',
                            ...(ep.speaker === 'user'
                                ? {
                                    background: 'linear-gradient(135deg, #4f46e5, #7c3aed)',
                                    color: '#ffffff',
                                }
                                : {
                                    background: '#e2e8f0',
                                    color: '#1e293b',
                                }
                            ),
                        }}>
                            {ep.imageUrl && (
                                <div className="mb-2">
                                    <img
                                        src={ep.imageUrl}
                                        alt="添付写真"
                                        className="rounded-lg max-h-56 w-auto object-cover border border-white/20"
                                    />
                                </div>
                            )}
                            {ep.content}
                        </div>
                    </div>
                ))}
                {isThinking && (
                    <div className="flex justify-start">
                        <div className="bg-white/10 text-slate-200 p-3 rounded-2xl rounded-bl-sm border border-white/5 flex gap-1 items-center">
                            <span className="animate-bounce">.</span>
                            <span className="animate-bounce delay-100">.</span>
                            <span className="animate-bounce delay-200">.</span>
                        </div>
                    </div>
                )}
                <div ref={bottomRef} />
            </div>

            {/* Attached Image Preview Bar */}
            {attachedImage && (
                <div className="px-4 pt-3 pb-1 bg-black/30 border-t border-white/5">
                    <div className="max-w-[720px] mx-auto flex items-center gap-3">
                        <div className="relative inline-block">
                            <img
                                src={attachedImage}
                                alt="送信プレビュー"
                                className="h-16 w-16 object-cover rounded-lg border border-purple-400/50 shadow"
                            />
                            <button
                                type="button"
                                onClick={() => setAttachedImage(null)}
                                className="absolute -top-2 -right-2 bg-slate-900 text-white rounded-full p-0.5 border border-white/20 hover:bg-red-600 transition-colors"
                                title="写真を取り消す"
                            >
                                <X size={12} />
                            </button>
                        </div>
                        <span className="text-xs text-purple-200">
                            📸 写真を添付中（このまま送信するとハコさんが写真を見てお返事します！）
                        </span>
                    </div>
                </div>
            )}

            {/* Input */}
            <form onSubmit={handleSubmit} style={{ padding: '16px', background: 'rgba(0,0,0,0.2)', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                <div style={{ maxWidth: '720px', width: '100%', margin: '0 auto', position: 'relative', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {/* Mini Sphere Indicator */}
                    <MiniSphere emotion={brainState.currentEmotion} intensity={brainState.currentIntensity} />

                    {/* Hidden File Input for Camera / Photo */}
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        onChange={handleFileSelect}
                        className="hidden"
                    />

                    {/* Photo Upload Button */}
                    <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isThinking}
                        title="写真を見せる（クリックで画像選択、または入力欄にCtrl+Vで貼り付け）"
                        className={`p-3 rounded-xl border transition-all shrink-0 ${
                            attachedImage
                                ? 'bg-purple-600/30 border-purple-400 text-purple-200'
                                : 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10 hover:text-white'
                        }`}
                    >
                        <Camera size={18} />
                    </button>

                    {/* Voice Mic Input Button */}
                    <button
                        type="button"
                        onClick={toggleListening}
                        disabled={isThinking}
                        title={isListening ? '音声入力を停止' : '声で話しかける（マイク音声入力）'}
                        className={`p-3 rounded-xl border transition-all shrink-0 ${
                            isListening
                                ? 'bg-red-500/30 border-red-400 text-red-200 animate-pulse'
                                : 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10 hover:text-white'
                        }`}
                    >
                        {isListening ? <MicOff size={18} /> : <Mic size={18} />}
                    </button>

                    <div className="relative flex-1 flex items-center">
                        <input
                            type="text"
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onPaste={handlePaste}
                            placeholder={isListening ? '🎙️ お話しください...' : attachedImage ? '写真について一言添える（そのまま送信もOK）...' : '話しかける...（写真の貼り付けもOK）'}
                            className="w-full bg-white/5 border border-white/10 rounded-xl py-3 px-4 pr-12 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50 transition-all font-medium"
                        />
                        <button
                            type="submit"
                            disabled={(!input.trim() && !attachedImage) || isThinking}
                            className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-lg bg-purple-600/80 text-white hover:bg-purple-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <Send size={16} />
                        </button>
                    </div>
                </div>
            </form>
        </div>
    );
};

// Mini Sphere for input area with fluid animation (synced with main sphere)
const MiniSphere: React.FC<{ emotion?: string; intensity?: number }> = ({ emotion = 'Neutral', intensity = 5 }) => {
    const getColors = () => {
        switch (emotion?.toLowerCase()) {
            case 'joy': return { from: '#fb923c', to: '#fde047', accent: '#fbbf24', particle: '#fff7ed' };
            case 'anger': return { from: '#dc2626', to: '#ea580c', accent: '#f97316', particle: '#fef2f2' };
            case 'sadness': return { from: '#1d4ed8', to: '#312e81', accent: '#4f46e5', particle: '#e0e7ff' };
            case 'calm': return { from: '#6ee7b7', to: '#22d3ee', accent: '#14b8a6', particle: '#ecfdf5' };
            case 'surprise': return { from: '#f472b6', to: '#a855f7', accent: '#d946ef', particle: '#fdf4ff' };
            default: return { from: '#94a3b8', to: '#64748b', accent: '#cbd5e1', particle: '#f1f5f9' };
        }
    };

    const colors = getColors();
    const blobSpeed1 = Math.max(2, 10 - (intensity || 5) * 0.8);
    const blobSpeed2 = Math.max(2.5, 12 - (intensity || 5) * 1);
    const pulseDuration = Math.max(0.5, 4 - ((intensity || 5) * 0.35));
    const spinSpeed = Math.max(2, 8 - (intensity || 5) * 0.5);

    return (
        <>
            <style>{`
                @keyframes miniPulse {
                    0%, 100% { transform: scale(1); box-shadow: 0 0 12px ${colors.from}66; }
                    50% { transform: scale(1.08); box-shadow: 0 0 20px ${colors.from}99; }
                }
                @keyframes miniBlob1 {
                    0%, 100% { transform: translate(0, 0) rotate(0deg); }
                    33% { transform: translate(15%, 10%) rotate(120deg); }
                    66% { transform: translate(-10%, 15%) rotate(240deg); }
                }
                @keyframes miniBlob2 {
                    0%, 100% { transform: translate(0, 0) scale(1); }
                    50% { transform: translate(-15%, -10%) scale(1.2); }
                }
                @keyframes miniSpin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
                @keyframes miniWave {
                    0%, 100% { transform: scale(1); opacity: 0.3; }
                    50% { transform: scale(1.3); opacity: 0.1; }
                }
                @keyframes miniParticle1 {
                    0%, 100% { transform: translate(-6px, -8px); opacity: 0; }
                    20%, 80% { opacity: 1; }
                    50% { transform: translate(8px, 4px); opacity: 0.8; }
                }
                @keyframes miniParticle2 {
                    0%, 100% { transform: translate(10px, -4px); opacity: 0; }
                    15%, 85% { opacity: 1; }
                    50% { transform: translate(-8px, 10px); opacity: 0.7; }
                }
                @keyframes miniParticle3 {
                    0%, 100% { transform: translate(-4px, 10px); opacity: 0; }
                    25%, 75% { opacity: 1; }
                    50% { transform: translate(6px, -10px); opacity: 0.9; }
                }
            `}</style>
            <div
                style={{
                    position: 'relative',
                    width: '40px',
                    height: '40px',
                    borderRadius: '9999px',
                    background: `radial-gradient(circle at 30% 30%, ${colors.from}, ${colors.to})`,
                    boxShadow: `0 0 16px ${colors.from}80, inset 0 2px 8px rgba(0,0,0,0.3)`,
                    animation: `miniPulse ${pulseDuration}s infinite ease-in-out`,
                    flexShrink: 0,
                    overflow: 'hidden',
                    border: '1px solid rgba(255,255,255,0.3)'
                }}
                title={`${emotion} Lv.${intensity}`}
            >
                {/* Mini Blob 1 */}
                <div style={{
                    position: 'absolute',
                    top: '-30%',
                    left: '-30%',
                    width: '160%',
                    height: '160%',
                    background: `radial-gradient(ellipse at 40% 40%, ${colors.accent}, transparent 50%)`,
                    animation: `miniBlob1 ${blobSpeed1}s infinite ease-in-out`,
                    borderRadius: '40% 60% 50% 50%',
                    opacity: 0.8
                }} />

                {/* Mini Blob 2 */}
                <div style={{
                    position: 'absolute',
                    bottom: '-30%',
                    right: '-30%',
                    width: '120%',
                    height: '120%',
                    background: `radial-gradient(ellipse at 60% 60%, rgba(0,0,0,0.4), transparent 50%)`,
                    animation: `miniBlob2 ${blobSpeed2}s infinite ease-in-out`,
                    borderRadius: '50% 50% 40% 60%'
                }} />

                {/* Mini plasma swirl */}
                <div style={{
                    position: 'absolute',
                    inset: '10%',
                    borderRadius: '9999px',
                    background: `conic-gradient(from 0deg, transparent, ${colors.accent}40, transparent, ${colors.from}30, transparent)`,
                    animation: `miniSpin ${spinSpeed}s linear infinite`,
                    mixBlendMode: 'screen',
                }} />

                {/* Mini energy wave */}
                <div style={{
                    position: 'absolute',
                    inset: '20%',
                    borderRadius: '9999px',
                    border: `1px solid ${colors.particle}40`,
                    animation: `miniWave ${blobSpeed2 * 0.5}s ease-in-out infinite`,
                }} />

                {/* Mini particles */}
                {[0, 1, 2].map(i => (
                    <div key={i} style={{
                        position: 'absolute',
                        width: '2px',
                        height: '2px',
                        borderRadius: '9999px',
                        background: colors.particle,
                        boxShadow: `0 0 4px ${colors.accent}`,
                        left: '50%',
                        top: '50%',
                        animation: `miniParticle${i + 1} ${blobSpeed1 * 0.8}s ${i * 0.8}s ease-in-out infinite`,
                        mixBlendMode: 'screen',
                    }} />
                ))}

                {/* Highlight */}
                <div style={{
                    position: 'absolute',
                    top: '4px',
                    left: '6px',
                    width: '12px',
                    height: '8px',
                    background: 'rgba(255,255,255,0.6)',
                    borderRadius: '9999px',
                    filter: 'blur(2px)',
                    transform: 'rotate(-30deg)'
                }} />
            </div>
        </>
    );
};
