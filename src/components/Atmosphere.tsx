import React, { useState, useEffect } from 'react';

interface AtmosphereProps {
    emotion?: string;
    intensity?: number;
}

type TimeOfDay = 'dawn' | 'morning' | 'afternoon' | 'dusk' | 'evening' | 'night';

const getTimeOfDay = (): TimeOfDay => {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 7) return 'dawn';
    if (hour >= 7 && hour < 12) return 'morning';
    if (hour >= 12 && hour < 16) return 'afternoon';
    if (hour >= 16 && hour < 19) return 'dusk';
    if (hour >= 19 && hour < 22) return 'evening';
    return 'night';
};

const getTimeColors = (time: TimeOfDay) => {
    switch (time) {
        case 'dawn':
            return { bg1: '#1e1028', bg2: '#2a1535', accent: '#ff7eb3', glow: 'rgba(255,126,179,0.25)' };
        case 'morning':
            return { bg1: '#0c1a2e', bg2: '#132d4a', accent: '#56ccf2', glow: 'rgba(86,204,242,0.20)' };
        case 'afternoon':
            return { bg1: '#101828', bg2: '#1a2540', accent: '#60a5fa', glow: 'rgba(96,165,250,0.18)' };
        case 'dusk':
            return { bg1: '#1f1020', bg2: '#331a38', accent: '#f97316', glow: 'rgba(249,115,22,0.25)' };
        case 'evening':
            return { bg1: '#12101e', bg2: '#1e1a34', accent: '#c084fc', glow: 'rgba(192,132,252,0.20)' };
        case 'night':
            return { bg1: '#080810', bg2: '#0d0d1a', accent: '#818cf8', glow: 'rgba(129,140,248,0.15)' };
    }
};

const getEmotionOverlay = (emotion?: string) => {
    switch (emotion?.toLowerCase()) {
        case 'joy': return 'rgba(251,191,36,0.12)';
        case 'anger': return 'rgba(239,68,68,0.10)';
        case 'sadness': return 'rgba(59,130,246,0.10)';
        case 'surprise': return 'rgba(236,72,153,0.10)';
        case 'calm': return 'rgba(52,211,153,0.08)';
        default: return 'transparent';
    }
};

export const Atmosphere: React.FC<AtmosphereProps> = ({ emotion, intensity = 5 }) => {
    const [timeOfDay, setTimeOfDay] = useState<TimeOfDay>(getTimeOfDay());

    // Update time of day every minute
    useEffect(() => {
        const interval = setInterval(() => {
            setTimeOfDay(getTimeOfDay());
        }, 60000);
        return () => clearInterval(interval);
    }, []);

    const colors = getTimeColors(timeOfDay);
    const emotionOverlay = getEmotionOverlay(emotion);
    const glowSize = 300 + (intensity || 5) * 30;

    return (
        <>
            <style>{`
                @keyframes atmosphereFloat1 {
                    0%, 100% { transform: translate(0, 0) scale(1); }
                    33% { transform: translate(30px, -20px) scale(1.05); }
                    66% { transform: translate(-20px, 15px) scale(0.95); }
                }
                @keyframes atmosphereFloat2 {
                    0%, 100% { transform: translate(0, 0) scale(1); }
                    50% { transform: translate(-40px, -30px) scale(1.1); }
                }
                @keyframes twinkle {
                    0%, 100% { opacity: 0.3; }
                    50% { opacity: 0.8; }
                }
            `}</style>

            {/* Base gradient background */}
            <div style={{
                position: 'fixed',
                inset: 0,
                zIndex: 0,
                background: `linear-gradient(135deg, ${colors.bg1} 0%, ${colors.bg2} 50%, ${colors.bg1} 100%)`,
                transition: 'background 3s ease',
            }} />

            {/* Floating glow orb 1 */}
            <div style={{
                position: 'fixed',
                top: '15%',
                right: '10%',
                width: `${glowSize}px`,
                height: `${glowSize}px`,
                borderRadius: '50%',
                background: `radial-gradient(circle, ${colors.glow}, transparent 70%)`,
                animation: 'atmosphereFloat1 20s infinite ease-in-out',
                zIndex: 0,
                pointerEvents: 'none',
            }} />

            {/* Floating glow orb 2 */}
            <div style={{
                position: 'fixed',
                bottom: '20%',
                left: '5%',
                width: `${glowSize * 0.7}px`,
                height: `${glowSize * 0.7}px`,
                borderRadius: '50%',
                background: `radial-gradient(circle, ${colors.accent}15, transparent 70%)`,
                animation: 'atmosphereFloat2 25s infinite ease-in-out',
                zIndex: 0,
                pointerEvents: 'none',
            }} />

            {/* Emotion overlay */}
            <div style={{
                position: 'fixed',
                inset: 0,
                zIndex: 0,
                background: emotionOverlay,
                transition: 'background 2s ease',
                pointerEvents: 'none',
            }} />

            {/* Stars (night only) */}
            {(timeOfDay === 'night' || timeOfDay === 'evening') && (
                <div style={{ position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none', overflow: 'hidden' }}>
                    {Array.from({ length: 20 }).map((_, i) => (
                        <div
                            key={i}
                            style={{
                                position: 'absolute',
                                top: `${Math.random() * 60}%`,
                                left: `${Math.random() * 100}%`,
                                width: `${1 + Math.random() * 2}px`,
                                height: `${1 + Math.random() * 2}px`,
                                borderRadius: '50%',
                                background: '#ffffff',
                                opacity: 0.3 + Math.random() * 0.4,
                                animation: `twinkle ${3 + Math.random() * 4}s infinite ease-in-out`,
                                animationDelay: `${Math.random() * 5}s`,
                            }}
                        />
                    ))}
                </div>
            )}

            {/* Time indicator (subtle) */}
            <div style={{
                position: 'fixed',
                bottom: '8px',
                left: '12px',
                fontSize: '10px',
                color: colors.accent,
                opacity: 0.4,
                zIndex: 1,
                letterSpacing: '0.1em',
                fontWeight: 500,
                pointerEvents: 'none',
            }}>
                {timeOfDay.toUpperCase()}
            </div>
        </>
    );
};
