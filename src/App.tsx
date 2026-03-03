import { useState, useMemo, useEffect } from 'react';
import { memoryManager } from './ai/memory';
import { Brain } from './ai/brain';
import { weatherManager } from './ai/weather';
import type { WeatherData } from './ai/weather';
import { ChatInterface } from './components/ChatInterface';
import { HakoniwaSphere } from './components/HakoniwaSphere';
import { Atmosphere } from './components/Atmosphere';
import { GoogleLoginScreen } from './components/GoogleLoginScreen';
import type { BrainState } from './ai/types';

function App() {
  // Initialize Brain once
  const brain = useMemo(() => new Brain(memoryManager), []);

  // State for re-rendering UI when Brain updates
  const [brainState, setBrainState] = useState<BrainState | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(memoryManager.isDriveConnected());
  const [isInitializing, setIsInitializing] = useState(false);
  const [weather, setWeather] = useState<WeatherData | null>(null);

  useEffect(() => {
    // If already authenticated (e.g., token persisted or just connected), initialize memory
    if (isAuthenticated) {
      let isMounted = true;
      const init = async () => {
        setIsInitializing(true);
        await memoryManager.initialize();

        // Fetch weather
        const weatherData = await weatherManager.fetchWeather();
        if (weatherData && isMounted) setWeather(weatherData);

        if (isMounted) {
          setBrainState({ ...brain.getMemoryState() });
          setIsInitializing(false);

          // Request notification permission
          if ('Notification' in window && Notification.permission === 'default') {
            Notification.requestPermission();
          }

          // Run intro sequence only after memory is loaded
          setTimeout(async () => {
            const greeting = await brain.generateGreeting();
            if (greeting && isMounted) setBrainState({ ...brain.getMemoryState() });

            setTimeout(async () => {
              const mealMessage = await brain.checkMealTrigger();
              if (mealMessage && isMounted) setBrainState({ ...brain.getMemoryState() });

              setTimeout(async () => {
                const fortuneMessage = await brain.checkFortuneTrigger();
                if (fortuneMessage && isMounted) setBrainState({ ...brain.getMemoryState() });

                setTimeout(async () => {
                  const recMessage = await brain.checkRecommendationTrigger();
                  if (recMessage && isMounted) setBrainState({ ...brain.getMemoryState() });
                }, 500);
              }, 500);
            }, 500);
          }, 1000);

          // Poll reminders every 30 seconds
          const reminderInterval = setInterval(() => {
            if (!isMounted) return;
            const reminderMsg = brain.checkReminders();
            if (reminderMsg) setBrainState({ ...brain.getMemoryState() });
          }, 30000);

          // Cleanup interval on unmount
          return () => {
            isMounted = false;
            clearInterval(reminderInterval);
          };
        }
      };
      init();
      return () => { isMounted = false; };
    }
  }, [isAuthenticated, brain]);

  const handleUpdate = () => {
    setBrainState({ ...brain.getMemoryState() });
  };

  const handleLoginSuccess = async (token: string) => {
    setIsInitializing(true);
    await memoryManager.connectDrive(token);
    setIsAuthenticated(true);
    // The useEffect will catch the isAuthenticated change and load the state
  };

  if (!isAuthenticated) {
    return <GoogleLoginScreen onLoginSuccess={handleLoginSuccess} />;
  }

  if (isInitializing || !brainState) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="animate-pulse flex flex-col items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-emerald-500/20 border border-emerald-500/40"></div>
          <div className="text-emerald-400 font-medium tracking-widest text-sm">LOADING MEMORY...</div>
        </div>
      </div>
    );
  }

  return (
    <>
      <Atmosphere emotion={brainState.currentEmotion} intensity={brainState.currentIntensity} />
      <div className="flex flex-col md:flex-row gap-6 w-full min-h-screen max-w-6xl mx-auto p-4" style={{ position: 'relative', zIndex: 1 }}>

        {/* Visual Core & Sidebar (Responsive: Top on mobile, Left on desktop) */}
        <div className="flex flex-col gap-4 w-full md:w-64 md:flex-shrink-0 items-center justify-start pt-4 md:pt-6 md:sticky md:top-0 md:max-h-screen md:overflow-y-auto md:pb-6" style={{ scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.1) transparent' }}>
          <HakoniwaSphere
            emotion={brainState.currentEmotion}
            intensity={brainState.currentIntensity}
          />

          <div className="md:hidden text-xs text-slate-500 mb-2">Hakoniwa Core</div>

          {/* Mode & Trust Card */}
          <div className="w-full bg-[rgba(30,30,35,0.6)] backdrop-blur-md rounded-2xl border border-[rgba(255,255,255,0.1)] p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-slate-300 font-medium text-sm uppercase tracking-wider">Mode</h3>
              <span className={`text-xs px-2 py-0.5 rounded-full ${brainState.modeState.currentMode === 'seed'
                ? 'bg-green-500/20 text-green-300 border border-green-500/30'
                : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                }`}>
                {brainState.modeState.currentMode === 'seed' ? '🌱 日常' : '🌾 共創'}
              </span>
            </div>
            <div className="space-y-2">
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-slate-400">💰 信頼残高</span>
                  <span className="text-slate-300 font-medium">{brainState.modeState.trustScore}/100</span>
                </div>
                <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-700 ${brainState.modeState.trustScore >= 70 ? 'bg-gradient-to-r from-emerald-400 to-emerald-300' :
                      brainState.modeState.trustScore >= 50 ? 'bg-gradient-to-r from-blue-400 to-blue-300' :
                        brainState.modeState.trustScore >= 30 ? 'bg-gradient-to-r from-yellow-400 to-yellow-300' :
                          'bg-gradient-to-r from-red-400 to-red-300'
                      }`}
                    style={{ width: `${brainState.modeState.trustScore}%` }}
                  />
                </div>
              </div>
              <div className="flex justify-between text-[10px] text-slate-500">
                <span>日常 {brainState.modeState.totalSeedCount}回</span>
                <span>共創 {brainState.modeState.totalHarvestCount}回</span>
              </div>
            </div>
          </div>

          {/* HP (API Usage) Card */}
          {(() => {
            const api = brain.getApiUsage();
            const hpColor = api.percent >= 60 ? 'from-emerald-400 to-emerald-300'
              : api.percent >= 30 ? 'from-yellow-400 to-yellow-300'
                : 'from-red-400 to-red-300';
            const hpTextColor = api.percent >= 60 ? 'text-emerald-300'
              : api.percent >= 30 ? 'text-yellow-300'
                : 'text-red-300';
            const hpLabel = api.percent >= 80 ? '元気！' : api.percent >= 60 ? '好調' : api.percent >= 30 ? 'ちょっと疲れてきた' : api.percent >= 10 ? '休憩が必要...' : '限界...';
            return (
              <div className="w-full bg-[rgba(30,30,35,0.6)] backdrop-blur-md rounded-2xl border border-[rgba(255,255,255,0.1)] p-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-slate-300 font-medium text-sm uppercase tracking-wider">HP</h3>
                  <span className={`text-xs font-bold ${hpTextColor}`}>{api.remaining}/{api.max}</span>
                </div>
                <div className="h-3 bg-white/10 rounded-full overflow-hidden mb-2">
                  <div
                    className={`h-full rounded-full transition-all duration-700 bg-gradient-to-r ${hpColor}`}
                    style={{ width: `${api.percent}%` }}
                  />
                </div>
                <div className="flex justify-between items-center">
                  <span className={`text-[11px] ${hpTextColor}`}>❤️ {hpLabel}</span>
                  <span className="text-[10px] text-slate-500">本日 {api.used}回使用</span>
                </div>
              </div>
            );
          })()}

          {/* Weather Card */}
          {weather && (
            <div className="w-full bg-[rgba(30,30,35,0.6)] backdrop-blur-md rounded-2xl border border-[rgba(255,255,255,0.1)] p-4">
              <h3 className="text-slate-300 font-medium mb-2 text-sm uppercase tracking-wider">Weather</h3>
              <div className="flex items-center gap-3">
                <span className="text-3xl">{weather.weatherEmoji}</span>
                <div>
                  <div className="text-white text-lg font-bold">{weather.temperature}°C</div>
                  <div className="text-slate-400 text-xs">{weather.weatherLabel}</div>
                </div>
              </div>
              {weather.precipitationProbability > 0 && (
                <div className="mt-2 text-xs text-blue-300 flex items-center gap-1">
                  <span>💧</span>
                  <span>降水確率 {weather.precipitationProbability}%</span>
                </div>
              )}
              {weather.windSpeed > 15 && (
                <div className="mt-1 text-xs text-slate-400 flex items-center gap-1">
                  <span>💨</span>
                  <span>風速 {weather.windSpeed}km/h</span>
                </div>
              )}
            </div>
          )}

          {/* Personality Card */}
          <div className="w-full bg-[rgba(30,30,35,0.6)] backdrop-blur-md rounded-2xl border border-[rgba(255,255,255,0.1)] p-4">
            <h3 className="text-slate-300 font-medium mb-3 text-sm uppercase tracking-wider">Personality</h3>
            <div className="space-y-2 text-xs">
              {[
                { key: 'humor', label: '😄 ユーモア', color: 'bg-yellow-400' },
                { key: 'detail', label: '📝 詳細度', color: 'bg-blue-400' },
                { key: 'empathy', label: '💗 共感度', color: 'bg-pink-400' },
                { key: 'curiosity', label: '🔍 好奇心', color: 'bg-emerald-400' },
                { key: 'proactivity', label: '🚀 積極性', color: 'bg-orange-400' },
                { key: 'formality', label: '🎩 丁寧さ', color: 'bg-purple-400' },
              ].map(({ key, label, color }) => (
                <div key={key} className="flex items-center gap-2">
                  <span className="w-20 text-slate-400 shrink-0">{label}</span>
                  <div className="flex-1 h-2 bg-white/10 rounded-full overflow-hidden">
                    <div
                      className={`h-full ${color} rounded-full transition-all duration-500`}
                      style={{ width: `${((brainState.personality as any)[key] || 0) * 100}%` }}
                    />
                  </div>
                  <span className="text-slate-500 w-7 text-right">
                    {Math.round(((brainState.personality as any)[key] || 0) * 100)}
                  </span>
                </div>
              ))}
              {brainState.personality.updateCount > 0 && (
                <div className="text-slate-500 text-[10px] mt-1 text-right">
                  更新 {brainState.personality.updateCount}回
                </div>
              )}
            </div>
          </div>

          {/* User Model Card */}
          <div className="w-full bg-[rgba(30,30,35,0.6)] backdrop-blur-md rounded-2xl border border-[rgba(255,255,255,0.1)] p-4 flex flex-col h-40 md:h-48 overflow-hidden">
            <h3 className="text-slate-300 font-medium mb-3 text-sm uppercase tracking-wider">User Model</h3>
            <div className="overflow-y-auto space-y-2 text-xs text-slate-400">
              {Object.entries(brainState.userModel.patterns).map(([key, pattern]) => (
                <div key={key} className="p-2 bg-white/5 rounded border border-white/5">
                  <div className="text-purple-300 font-bold mb-1">{key}</div>
                  <div>Counts: {pattern.dataPoints.length}</div>
                  <div>Last: {new Date(pattern.dataPoints[pattern.dataPoints.length - 1]).toLocaleTimeString()}</div>
                </div>
              ))}
              {Object.keys(brainState.userModel.patterns).length === 0 && (
                <div className="italic opacity-50">No patterns learned yet.</div>
              )}
            </div>
          </div>

          {/* Semantic Memory Card */}
          <div className="w-full bg-[rgba(30,30,35,0.6)] backdrop-blur-md rounded-2xl border border-[rgba(255,255,255,0.1)] p-4 flex flex-col h-60 md:flex-1 overflow-hidden">
            <h3 className="text-slate-300 font-medium mb-3 text-sm uppercase tracking-wider">Memory</h3>
            <div className="overflow-y-auto space-y-2 text-xs">
              {Object.values(brainState.semantics).map((sem) => (
                <div key={sem.term} className="p-2 bg-white/5 rounded border border-white/5 group hover:bg-white/10 transition-colors cursor-default">
                  <span className="text-emerald-300 font-bold">{sem.term}</span>
                  <span className="text-slate-500 mx-1">:</span>
                  <span className="text-slate-300">{sem.definition}</span>
                </div>
              ))}
              {Object.keys(brainState.semantics).length === 0 && (
                <div className="italic opacity-50 text-slate-500">No concepts learned.</div>
              )}
            </div>
          </div>
        </div>

        {/* Main Chat Area */}
        <div className="flex-1 h-full min-h-[600px] flex flex-col">
          <ChatInterface brain={brain} onUpdate={handleUpdate} brainState={brainState} />
        </div>
      </div>
    </>
  );
}

export default App;
