import React, { useMemo } from 'react';

interface Props {
    emotion?: string;
    intensity?: number;
}

export const HakoniwaSphere: React.FC<Props> = ({ emotion = 'Neutral', intensity = 5 }) => {

    const colors = useMemo(() => {
        switch (emotion.toLowerCase()) {
            case 'joy': return { from: '#fb923c', to: '#fde047', accent: '#fbbf24', particle: '#fff7ed' };
            case 'anger': return { from: '#dc2626', to: '#ea580c', accent: '#f97316', particle: '#fef2f2' };
            case 'sadness': return { from: '#1d4ed8', to: '#312e81', accent: '#4f46e5', particle: '#e0e7ff' };
            case 'calm': return { from: '#6ee7b7', to: '#22d3ee', accent: '#14b8a6', particle: '#ecfdf5' };
            case 'surprise': return { from: '#f472b6', to: '#a855f7', accent: '#d946ef', particle: '#fdf4ff' };
            default: return { from: '#94a3b8', to: '#64748b', accent: '#cbd5e1', particle: '#f1f5f9' };
        }
    }, [emotion]);

    // Animation speeds tied to intensity
    const blobSpeed1 = Math.max(2, 12 - intensity * 1);
    const blobSpeed2 = Math.max(3, 15 - intensity * 1.2);
    const blobSpeed3 = Math.max(2.5, 10 - intensity * 0.8);
    const pulseDuration = Math.max(0.5, 4 - (intensity * 0.35));
    const scale = 1 + (intensity * 0.03);
    const orbitSpeed = Math.max(4, 20 - intensity * 1.5);
    const particleSpeed = Math.max(3, 12 - intensity * 0.8);

    // Generate particles based on intensity
    const particles = useMemo(() => {
        const count = Math.min(8, 3 + Math.floor(intensity / 2));
        return Array.from({ length: count }, (_, i) => ({
            id: i,
            size: 2 + Math.random() * 3,
            delay: (i * (particleSpeed / count)),
            startAngle: (360 / count) * i,
            radius: 20 + Math.random() * 30,
            opacity: 0.4 + Math.random() * 0.5,
        }));
    }, [intensity, particleSpeed]);

    return (
        <div style={{ position: 'relative', width: '192px', height: '192px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {/* Outer Glow */}
            <div
                style={{
                    position: 'absolute',
                    width: '100%',
                    height: '100%',
                    borderRadius: '9999px',
                    filter: 'blur(24px)',
                    opacity: 0.4,
                    background: `linear-gradient(to bottom right, ${colors.from}, ${colors.to})`,
                    animation: `hk-pulse ${pulseDuration}s infinite ease-in-out`
                }}
            />

            {/* Orbiting Ring 1 */}
            <div style={{
                position: 'absolute',
                width: '160px',
                height: '160px',
                borderRadius: '9999px',
                border: `1px solid ${colors.accent}40`,
                animation: `hk-orbit ${orbitSpeed}s linear infinite`,
                transformStyle: 'preserve-3d',
                transform: 'rotateX(60deg)',
            }}>
                <div style={{
                    position: 'absolute',
                    top: '-3px',
                    left: '50%',
                    width: '6px',
                    height: '6px',
                    borderRadius: '9999px',
                    background: colors.accent,
                    boxShadow: `0 0 8px ${colors.accent}`,
                    transform: 'translateX(-50%)',
                }} />
            </div>

            {/* Orbiting Ring 2 */}
            <div style={{
                position: 'absolute',
                width: '150px',
                height: '150px',
                borderRadius: '9999px',
                border: `1px solid ${colors.from}30`,
                animation: `hk-orbit ${orbitSpeed * 1.3}s linear infinite reverse`,
                transformStyle: 'preserve-3d',
                transform: 'rotateX(75deg) rotateY(30deg)',
            }}>
                <div style={{
                    position: 'absolute',
                    top: '-2px',
                    left: '50%',
                    width: '4px',
                    height: '4px',
                    borderRadius: '9999px',
                    background: colors.from,
                    boxShadow: `0 0 6px ${colors.from}`,
                    transform: 'translateX(-50%)',
                }} />
            </div>

            {/* Core Sphere Container */}
            <div
                style={{
                    position: 'relative',
                    width: '128px',
                    height: '128px',
                    borderRadius: '9999px',
                    overflow: 'hidden',
                    boxShadow: `inset 0 4px 20px rgba(0,0,0,0.4), 0 8px 32px rgba(0,0,0,0.3), 0 0 40px ${colors.accent}20`,
                    border: '2px solid rgba(255,255,255,0.3)',
                    transition: 'all 0.5s ease',
                    transform: `scale(${scale})`,
                    background: `radial-gradient(circle at 30% 30%, ${colors.from}, ${colors.to} 70%, ${colors.to})`
                }}
            >
                {/* Dark base layer */}
                <div style={{
                    position: 'absolute',
                    inset: 0,
                    background: 'radial-gradient(circle at 70% 70%, rgba(0,0,0,0.3), transparent 60%)',
                    borderRadius: '9999px'
                }} />

                {/* Fluid Blob 1 - Bright highlight */}
                <div style={{
                    position: 'absolute',
                    top: '-20%',
                    left: '-20%',
                    width: '140%',
                    height: '140%',
                    background: `radial-gradient(ellipse at 30% 30%, ${colors.accent}, transparent 50%)`,
                    animation: `hk-blob1 ${blobSpeed1}s infinite ease-in-out`,
                    borderRadius: '40% 60% 70% 30% / 40% 30% 70% 60%',
                    opacity: 0.8
                }} />

                {/* Fluid Blob 2 - Mid tone */}
                <div style={{
                    position: 'absolute',
                    top: '10%',
                    left: '10%',
                    width: '120%',
                    height: '120%',
                    background: `radial-gradient(ellipse at 70% 60%, ${colors.from}, transparent 45%)`,
                    animation: `hk-blob2 ${blobSpeed2}s infinite ease-in-out`,
                    borderRadius: '60% 40% 30% 70% / 60% 30% 70% 40%',
                    opacity: 0.9
                }} />

                {/* Fluid Blob 3 - Deep shadow */}
                <div style={{
                    position: 'absolute',
                    bottom: '-30%',
                    right: '-30%',
                    width: '100%',
                    height: '100%',
                    background: `radial-gradient(ellipse at 80% 80%, rgba(0,0,0,0.5), transparent 50%)`,
                    animation: `hk-blob3 ${blobSpeed3}s infinite ease-in-out`,
                    borderRadius: '30% 70% 40% 60% / 50% 60% 40% 50%'
                }} />

                {/* Plasma swirl effect */}
                <div style={{
                    position: 'absolute',
                    inset: '10%',
                    borderRadius: '9999px',
                    background: `conic-gradient(from 0deg, transparent, ${colors.accent}30, transparent, ${colors.from}20, transparent)`,
                    animation: `hk-spin ${blobSpeed1 * 0.8}s linear infinite`,
                    mixBlendMode: 'screen',
                }} />

                {/* Energy wave ring */}
                <div style={{
                    position: 'absolute',
                    inset: '15%',
                    borderRadius: '9999px',
                    border: `1px solid ${colors.particle}30`,
                    animation: `hk-wave ${blobSpeed2 * 0.5}s ease-in-out infinite`,
                }} />

                {/* Floating particles inside sphere */}
                {particles.map(p => (
                    <div key={p.id} style={{
                        position: 'absolute',
                        width: `${p.size}px`,
                        height: `${p.size}px`,
                        borderRadius: '9999px',
                        background: colors.particle,
                        boxShadow: `0 0 ${p.size * 2}px ${colors.accent}`,
                        opacity: p.opacity,
                        left: '50%',
                        top: '50%',
                        animation: `hk-float-${p.id % 4} ${particleSpeed}s ${p.delay}s ease-in-out infinite`,
                        mixBlendMode: 'screen',
                    }} />
                ))}

                {/* Surface shimmer */}
                <div style={{
                    position: 'absolute',
                    top: '5%',
                    left: '15%',
                    width: '70%',
                    height: '50%',
                    background: `linear-gradient(180deg, rgba(255,255,255,0.4) 0%, transparent 100%)`,
                    borderRadius: '50%',
                    filter: 'blur(8px)',
                    animation: `hk-shimmer ${blobSpeed1 * 0.7}s infinite ease-in-out`
                }} />

                {/* Highlight/Reflection */}
                <div style={{
                    position: 'absolute',
                    top: '10px',
                    left: '18px',
                    width: '40px',
                    height: '24px',
                    background: 'rgba(255,255,255,0.6)',
                    borderRadius: '9999px',
                    filter: 'blur(6px)',
                    transform: 'rotate(-45deg)'
                }} />

                {/* Secondary small highlight */}
                <div style={{
                    position: 'absolute',
                    top: '30px',
                    left: '34px',
                    width: '14px',
                    height: '10px',
                    background: 'rgba(255,255,255,0.5)',
                    borderRadius: '9999px',
                    filter: 'blur(3px)'
                }} />
            </div>

            <style>{`
                @keyframes hk-pulse {
                    0%, 100% { transform: scale(1); opacity: 0.4; }
                    50% { transform: scale(1.15); opacity: 0.6; }
                }
                @keyframes hk-orbit {
                    from { transform: rotateX(60deg) rotateZ(0deg); }
                    to { transform: rotateX(60deg) rotateZ(360deg); }
                }
                @keyframes hk-spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
                @keyframes hk-wave {
                    0%, 100% { transform: scale(1); opacity: 0.3; }
                    50% { transform: scale(1.2); opacity: 0.1; }
                }
                @keyframes hk-blob1 {
                    0%, 100% { 
                        transform: translate(0, 0) rotate(0deg) scale(1);
                        border-radius: 40% 60% 70% 30% / 40% 30% 70% 60%;
                    }
                    25% { 
                        transform: translate(10%, 15%) rotate(90deg) scale(1.1);
                        border-radius: 60% 40% 30% 70% / 60% 30% 70% 40%;
                    }
                    50% { 
                        transform: translate(-5%, 10%) rotate(180deg) scale(0.95);
                        border-radius: 30% 70% 40% 60% / 50% 60% 40% 50%;
                    }
                    75% { 
                        transform: translate(-10%, -5%) rotate(270deg) scale(1.05);
                        border-radius: 50% 50% 60% 40% / 40% 50% 50% 60%;
                    }
                }
                @keyframes hk-blob2 {
                    0%, 100% { 
                        transform: translate(0, 0) rotate(0deg);
                        border-radius: 60% 40% 30% 70% / 60% 30% 70% 40%;
                    }
                    33% { 
                        transform: translate(-15%, 10%) rotate(120deg);
                        border-radius: 40% 60% 50% 50% / 50% 40% 60% 50%;
                    }
                    66% { 
                        transform: translate(10%, -10%) rotate(240deg);
                        border-radius: 50% 50% 40% 60% / 40% 60% 40% 60%;
                    }
                }
                @keyframes hk-blob3 {
                    0%, 100% { 
                        transform: translate(0, 0) scale(1);
                        border-radius: 30% 70% 40% 60% / 50% 60% 40% 50%;
                    }
                    50% { 
                        transform: translate(15%, -15%) scale(1.15);
                        border-radius: 60% 40% 60% 40% / 40% 60% 40% 60%;
                    }
                }
                @keyframes hk-shimmer {
                    0%, 100% { opacity: 0.3; transform: translateY(0); }
                    50% { opacity: 0.5; transform: translateY(5%); }
                }
                @keyframes hk-float-0 {
                    0%, 100% { transform: translate(-15px, -20px); opacity: 0; }
                    20% { opacity: 1; }
                    50% { transform: translate(20px, 10px); opacity: 0.8; }
                    80% { opacity: 1; }
                }
                @keyframes hk-float-1 {
                    0%, 100% { transform: translate(25px, -10px); opacity: 0; }
                    15% { opacity: 1; }
                    50% { transform: translate(-20px, 25px); opacity: 0.7; }
                    85% { opacity: 1; }
                }
                @keyframes hk-float-2 {
                    0%, 100% { transform: translate(-10px, 30px); opacity: 0; }
                    25% { opacity: 1; }
                    50% { transform: translate(15px, -25px); opacity: 0.9; }
                    75% { opacity: 1; }
                }
                @keyframes hk-float-3 {
                    0%, 100% { transform: translate(20px, 20px); opacity: 0; }
                    10% { opacity: 1; }
                    50% { transform: translate(-25px, -15px); opacity: 0.6; }
                    90% { opacity: 1; }
                }
            `}</style>

            {/* Status Label */}
            <div style={{ position: 'absolute', bottom: '-40px', textAlign: 'center', width: '100%' }}>
                <div style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', color: '#94a3b8', fontWeight: 600, marginBottom: '4px' }}>Condition</div>
                <div style={{ fontSize: '14px', fontWeight: 700, color: '#cbd5e1' }}>{emotion} <span style={{ fontSize: '10px', opacity: 0.5 }}>Lv.{intensity}</span></div>
            </div>
        </div>
    );
};
