import { useState, useMemo, useEffect } from 'react';
import { memoryManager } from './ai/memory';
import { Brain } from './ai/brain';
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

  useEffect(() => {
    // If already authenticated (e.g., token persisted or just connected), initialize memory
    if (isAuthenticated) {
      let isMounted = true;
      const init = async () => {
        setIsInitializing(true);
        await memoryManager.initialize();
        if (isMounted) {
          setBrainState({ ...brain.getMemoryState() });
          setIsInitializing(false);

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
              }, 500);
            }, 500);
          }, 1000);
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
        <div className="flex flex-col gap-4 w-full md:w-64 md:flex-shrink-0 items-center justify-start pt-4 md:pt-10">
          <HakoniwaSphere
            emotion={brainState.currentEmotion}
            intensity={brainState.currentIntensity}
          />

          <div className="md:hidden text-xs text-slate-500 mb-2">Hakoniwa Core</div>

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
