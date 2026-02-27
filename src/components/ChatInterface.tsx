import React, { useState, useEffect, useRef } from 'react';
import { Send, Clock, Cpu } from 'lucide-react';
import { Brain } from '../ai/brain';
import type { BrainState } from '../ai/types';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';

interface ChatProps {
    brain: Brain;
    onUpdate: () => void;
    brainState: BrainState;
}

export const ChatInterface: React.FC<ChatProps> = ({ brain, onUpdate, brainState }) => {
    const [input, setInput] = useState('');
    const [isThinking, setIsThinking] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!input.trim()) return;

        const userInput = input;
        setInput('');
        setIsThinking(true);

        // Simulate thinking delay for "feeling"
        await new Promise(r => setTimeout(r, 600));

        await brain.processInput(userInput);
        setIsThinking(false);
        onUpdate();
    };

    const bottomRef = useRef<HTMLDivElement>(null);

    // Scroll to bottom on new messages and initial load
    useEffect(() => {
        const scrollToBottom = () => {
            bottomRef.current?.scrollIntoView({ behavior: 'auto' });
        };
        scrollToBottom();
        const t = setTimeout(scrollToBottom, 300);
        return () => clearTimeout(t);
    }, [brainState.episodes.length, isThinking]);

    return (
        <div className="flex flex-col h-full bg-[rgba(30,30,35,0.6)] backdrop-blur-md rounded-2xl border border-[rgba(255,255,255,0.1)] shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="p-4 border-b border-[rgba(255,255,255,0.05)] flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Cpu className="text-purple-400" size={20} />
                    <span className="font-semibold text-white tracking-wide">Hakoniwa AI</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-400">
                    <Clock size={14} />
                    <span>{format(new Date(), 'PP HH:mm', { locale: ja })}</span>
                </div>
            </div>

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
                        <span style={{
                            fontSize: '10px',
                            marginBottom: '4px',
                            paddingLeft: '8px',
                            paddingRight: '8px',
                            opacity: 0.5,
                            fontWeight: 500,
                            letterSpacing: '0.05em',
                        }}>
                            {ep.speaker === 'user' ? 'YOU' : 'HAKONIWA'}
                        </span>
                        <div style={{
                            maxWidth: '85%',
                            padding: '12px 16px',
                            borderRadius: ep.speaker === 'user' ? '16px 4px 16px 16px' : '4px 16px 16px 16px',
                            fontSize: '14px',
                            lineHeight: '1.7',
                            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
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

            {/* Input */}
            <form onSubmit={handleSubmit} style={{ padding: '16px', background: 'rgba(0,0,0,0.2)', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                <div style={{ maxWidth: '720px', width: '100%', margin: '0 auto', position: 'relative', display: 'flex', alignItems: 'center', gap: '12px' }}>
                    {/* Mini Sphere Indicator */}
                    <MiniSphere emotion={brainState.currentEmotion} intensity={brainState.currentIntensity} />

                    <input
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        placeholder="話しかける..."
                        className="flex-1 bg-white/5 border border-white/10 rounded-xl py-3 px-4 pr-12 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50 transition-all font-medium"
                    />
                    <button
                        type="submit"
                        disabled={!input.trim() || isThinking}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-lg bg-purple-600/80 text-white hover:bg-purple-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <Send size={16} />
                    </button>
                </div>
            </form>
        </div>
    );
};

// Mini Sphere for input area with fluid animation
const MiniSphere: React.FC<{ emotion?: string; intensity?: number }> = ({ emotion = 'Neutral', intensity = 5 }) => {
    const getColors = () => {
        switch (emotion?.toLowerCase()) {
            case 'joy': return { from: '#fb923c', to: '#fde047', accent: '#fbbf24' };
            case 'anger': return { from: '#dc2626', to: '#ea580c', accent: '#f97316' };
            case 'sadness': return { from: '#1d4ed8', to: '#312e81', accent: '#4f46e5' };
            case 'calm': return { from: '#6ee7b7', to: '#22d3ee', accent: '#14b8a6' };
            case 'surprise': return { from: '#f472b6', to: '#a855f7', accent: '#d946ef' };
            default: return { from: '#94a3b8', to: '#64748b', accent: '#cbd5e1' };
        }
    };

    const colors = getColors();
    const blobSpeed1 = Math.max(2, 10 - (intensity || 5) * 0.8);
    const blobSpeed2 = Math.max(2.5, 12 - (intensity || 5) * 1);
    const pulseDuration = Math.max(0.5, 4 - ((intensity || 5) * 0.35));

    return (
        <>
            <style>{`
                @keyframes miniPulse {
                    0%, 100% { transform: scale(1); box-shadow: 0 0 12px rgba(251, 146, 60, 0.4); }
                    50% { transform: scale(1.08); box-shadow: 0 0 18px rgba(251, 146, 60, 0.6); }
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
