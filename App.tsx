
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Message, ChatSession, UserSettings, GreetingData, GroundingSource } from './types';
import { ICONS, QUOTES } from './constants';
import * as gemini from './services/gemini';
import { storageService } from './services/storage';

const Logo: React.FC = () => (
  <div className="relative w-8 h-8 flex items-center justify-center animate-logo-float">
    <div className="absolute inset-0 bg-gradient-to-tr from-pink-500 via-purple-500 to-indigo-600 rounded-lg shadow-lg rotate-45 opacity-80" />
    <div className="relative z-10 flex gap-1.5 items-center">
      <div className="w-1.5 h-1.5 bg-white rounded-full animate-blink shadow-sm" />
      <div className="w-1.5 h-1.5 bg-white rounded-full animate-blink shadow-sm" />
    </div>
    <div className="absolute -bottom-1 w-4 h-0.5 bg-white/40 rounded-full blur-[1px]" />
  </div>
);

const App: React.FC = () => {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [settings, setSettings] = useState<UserSettings>({ theme: 'dark', volume: 0.8, playbackSpeed: 1.0 });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [greeting, setGreeting] = useState<GreetingData | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sessionsRef = useRef<ChatSession[]>([]);

  // Reliability: Update ref whenever sessions change for the persistence listener
  useEffect(() => {
    sessionsRef.current = sessions;
    storageService.saveSessions(sessions);
  }, [sessions]);

  // Reliability: Persist active session ID and settings
  useEffect(() => {
    storageService.saveActiveSessionId(activeSessionId);
  }, [activeSessionId]);

  useEffect(() => {
    storageService.saveSettings(settings);
  }, [settings]);

  // Initial load and global persistence listeners
  useEffect(() => {
    const savedSessions = storageService.getSessions();
    const savedSettings = storageService.getSettings();
    const savedActiveId = storageService.getActiveSessionId();

    if (savedSettings) setSettings(savedSettings);

    if (savedSessions && savedSessions.length > 0) {
      setSessions(savedSessions);
      if (savedActiveId && savedSessions.some(s => s.id === savedActiveId)) {
        setActiveSessionId(savedActiveId);
      } else {
        setActiveSessionId(savedSessions[0].id);
      }
    } else {
      createNewSession();
    }

    const handleGlobalSave = () => {
      storageService.saveSessions(sessionsRef.current);
    };

    const handleStorageEvent = (e: StorageEvent) => {
      if (e.key === 'mini_ai_sessions' && e.newValue) {
        setSessions(JSON.parse(e.newValue));
      }
      if (e.key === 'mini_ai_settings' && e.newValue) {
        setSettings(JSON.parse(e.newValue));
      }
    };

    window.addEventListener('beforeunload', handleGlobalSave);
    window.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') handleGlobalSave();
    });
    window.addEventListener('storage', handleStorageEvent);

    const now = new Date();
    const hours = now.getHours();
    let timeGreeting = "Morning";
    if (hours >= 12 && hours < 17) timeGreeting = "Afternoon";
    if (hours >= 17) timeGreeting = "Evening";

    const randomQuote = QUOTES[Math.floor(Math.random() * QUOTES.length)];
    setGreeting({
      timeStr: `Good ${timeGreeting}`,
      dateStr: now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }),
      quote: randomQuote.text,
      emoji: randomQuote.emoji
    });

    return () => {
      window.removeEventListener('beforeunload', handleGlobalSave);
      window.removeEventListener('storage', handleStorageEvent);
    };
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [sessions, activeSessionId, isTyping, errorMsg]);

  const backgroundColors = useMemo(() => {
    const hours = new Date().getHours();
    if (hours >= 5 && hours < 12) return 'from-amber-200 via-pink-400 to-sky-400';
    if (hours >= 12 && hours < 17) return 'from-sky-400 via-emerald-300 to-indigo-400';
    if (hours >= 17 && hours < 21) return 'from-orange-400 via-purple-500 to-pink-600';
    return 'from-indigo-950 via-purple-900 to-pink-900';
  }, []);

  const createNewSession = useCallback(() => {
    const newId = Date.now().toString();
    const newSession: ChatSession = {
      id: newId,
      title: 'New Conversation',
      messages: [],
      createdAt: Date.now()
    };
    setSessions(prev => [newSession, ...prev]);
    setActiveSessionId(newId);
  }, []);

  const deleteSession = (id: string) => {
    setSessions(prev => {
      const filtered = prev.filter(s => s.id !== id);
      if (activeSessionId === id) {
        const nextId = filtered.length > 0 ? filtered[0].id : null;
        setActiveSessionId(nextId);
        if (filtered.length === 0) setTimeout(createNewSession, 0);
      }
      return filtered;
    });
  };

  const handleSend = async (textOverride?: string) => {
    const text = textOverride || input;
    if (!text.trim() || !activeSessionId) return;

    setErrorMsg(null);
    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      text: text,
      timestamp: Date.now()
    };

    setSessions(prev => prev.map(s => s.id === activeSessionId 
      ? { ...s, messages: [...s.messages, userMsg], title: s.messages.length === 0 ? text.substring(0, 30) : s.title }
      : s
    ));
    setInput('');
    setIsTyping(true);

    try {
      const activeSession = sessionsRef.current.find(s => s.id === activeSessionId);
      const history = activeSession?.messages.map(m => ({
        role: m.role,
        parts: [{ text: m.text }]
      })) || [];

      const result = await gemini.getResponse(text, history);
      const botText = result.text;
      
      const groundingSources: GroundingSource[] = result.grounding
        .filter(chunk => chunk.web)
        .map(chunk => ({ title: chunk.web?.title, uri: chunk.web?.uri }));

      let cleanedText = botText;
      let psychAnalysis = "";
      const psychRegex = /\{.*"PsychologicalInsight".*?\}/gs;
      const match = botText.match(psychRegex);
      if (match) {
        psychAnalysis = match[0];
        cleanedText = botText.replace(psychRegex, "").trim();
      }

      const botMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: 'model',
        text: cleanedText,
        timestamp: Date.now(),
        psychAnalysis,
        groundingSources
      };

      setSessions(prev => prev.map(s => s.id === activeSessionId 
        ? { ...s, messages: [...s.messages, botMsg] }
        : s
      ));

      await handlePlayAudio(cleanedText);

    } catch (error: any) {
      console.error("Gemini Error:", error);
      setErrorMsg(error?.message || "Something went wrong. Please check your connection.");
    } finally {
      setIsTyping(false);
    }
  };

  const handlePlayAudio = async (text: string) => {
    try {
      const base64 = await gemini.textToSpeech(text);
      if (base64) {
        if (!audioContextRef.current) {
          audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        }
        const ctx = audioContextRef.current;
        const bytes = gemini.decodeBase64(base64);
        const buffer = await gemini.decodeAudioData(bytes, ctx);
        
        if (audioSourceRef.current) {
          try { audioSourceRef.current.stop(); } catch(e){}
        }
        
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.playbackRate.value = settings.playbackSpeed;
        
        const gainNode = ctx.createGain();
        gainNode.gain.value = settings.volume;
        
        source.connect(gainNode);
        gainNode.connect(ctx.destination);
        
        audioSourceRef.current = source;
        source.start(0);
      }
    } catch (e) {
      console.error("Audio playback error", e);
    }
  };

  const handleCopyMessage = (msg: Message) => {
    navigator.clipboard.writeText(msg.text).then(() => {
      setCopiedId(msg.id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  };

  const handleGenerateImage = async () => {
    if (!input.trim() || !activeSessionId) return;
    setErrorMsg(null);
    setIsGeneratingImage(true);
    try {
      const url = await gemini.generateImage(input);
      if (url) {
        const imgMsg: Message = {
          id: Date.now().toString(),
          role: 'model',
          text: `Generated image for: "${input}"`,
          imageUrl: url,
          timestamp: Date.now()
        };
        setSessions(prev => prev.map(s => s.id === activeSessionId 
          ? { ...s, messages: [...s.messages, imgMsg] }
          : s
        ));
        setInput('');
      } else {
        setErrorMsg("Failed to generate image. Please try a different prompt.");
      }
    } catch (e: any) {
      setErrorMsg(e?.message || "Image generation failed.");
    } finally {
      setIsGeneratingImage(false);
    }
  };

  const startVoiceInput = () => {
    const SpeechRec = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
    if (!SpeechRec) {
      alert("Speech recognition not supported in this browser.");
      return;
    }
    const recognition = new SpeechRec();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onstart = () => setIsRecording(true);
    recognition.onend = () => setIsRecording(false);
    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setInput(transcript);
      handleSend(transcript);
    };
    recognition.onerror = () => setIsRecording(false);
    recognition.start();
  };

  const currentSession = useMemo(() => sessions.find(s => s.id === activeSessionId), [sessions, activeSessionId]);

  const parsePsychInsight = (insight?: string) => {
    if (!insight) return null;
    try {
      const match = insight.match(/\{.*"PsychologicalInsight":\s*"(.*)".*\}/s);
      return match ? match[1] : null;
    } catch (e) {
      return null;
    }
  };

  return (
    <div className={`h-screen w-full relative flex items-center justify-center transition-all duration-1000 ${settings.theme === 'dark' ? 'dark' : ''}`}>
      <div className={`absolute inset-0 -z-10 animate-gradient bg-gradient-to-br ${backgroundColors} opacity-40 dark:opacity-60 transition-colors duration-2000`} />
      <div className="absolute inset-0 -z-10 backdrop-blur-3xl bg-white/40 dark:bg-black/40 transition-colors duration-1000" />

      <main className="w-full max-w-md h-[95vh] md:h-[90vh] glass shadow-2xl relative flex flex-col overflow-hidden sm:rounded-3xl border border-white/30">
        
        <header className="px-6 py-4 flex items-center justify-between border-b border-white/10 shrink-0 bg-white/5 backdrop-blur-md z-10">
          <div className="flex items-center gap-3">
            <button onClick={() => setSidebarOpen(true)} className="p-2 hover:bg-white/10 rounded-full text-zinc-800 dark:text-zinc-200 transition-colors">
              <ICONS.History />
            </button>
            <div className="flex items-center gap-2">
              <Logo />
              <h1 className="text-xl font-bold bg-gradient-to-r from-pink-500 via-purple-500 to-indigo-600 bg-clip-text text-transparent tracking-tight">MINI</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button 
              onClick={() => setSettings(s => ({ ...s, theme: s.theme === 'dark' ? 'light' : 'dark' }))}
              className="p-2 hover:bg-white/10 rounded-full text-zinc-800 dark:text-zinc-200"
            >
              {settings.theme === 'dark' ? <ICONS.Sun /> : <ICONS.Moon />}
            </button>
            <div className="group relative">
               <button className="p-2 hover:bg-white/10 rounded-full text-zinc-800 dark:text-zinc-200">
                  <ICONS.Settings />
               </button>
               <div className="absolute right-0 top-10 w-52 glass rounded-2xl hidden group-hover:block p-4 z-50 shadow-2xl animate-in fade-in zoom-in duration-200 border border-white/20">
                  <label className="text-[10px] uppercase tracking-wider font-bold opacity-60 block mb-2 dark:text-white px-2">Voice & Audio</label>
                  <div className="space-y-4 p-2">
                    <div>
                      <div className="flex justify-between text-[10px] mb-1 dark:text-white"><span>Volume</span><span>{Math.round(settings.volume * 100)}%</span></div>
                      <input type="range" min="0" max="1" step="0.1" value={settings.volume} onChange={e => setSettings({...settings, volume: parseFloat(e.target.value)})} className="w-full accent-pink-500" />
                    </div>
                    <div>
                      <div className="flex justify-between text-[10px] mb-1 dark:text-white"><span>Speed</span><span>{settings.playbackSpeed}x</span></div>
                      <input type="range" min="0.5" max="2" step="0.1" value={settings.playbackSpeed} onChange={e => setSettings({...settings, playbackSpeed: parseFloat(e.target.value)})} className="w-full accent-purple-500" />
                    </div>
                  </div>
               </div>
            </div>
          </div>
        </header>

        <div id="mini-chat-container" ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-10 scroll-smooth z-0">
          {(!currentSession || currentSession.messages.length === 0) && greeting && (
            <div className="flex flex-col items-center justify-center h-full text-center space-y-8 py-10 px-4">
              <div className="relative">
                <div className="absolute inset-0 bg-pink-500/20 rounded-full blur-3xl animate-glow scale-150" />
                <div className="text-8xl animate-emoji relative z-10 drop-shadow-2xl select-none">
                  {greeting.emoji}
                </div>
              </div>
              <div className="space-y-4 max-w-sm mx-auto">
                <div className="space-y-1">
                  <h2 className="text-4xl font-black dark:text-white stagger-1 bg-gradient-to-b from-zinc-800 to-zinc-500 dark:from-white dark:to-zinc-400 bg-clip-text text-transparent tracking-tight leading-none italic uppercase">
                    {greeting.timeStr}!
                  </h2>
                  <p className="text-[11px] font-bold text-pink-500/90 stagger-2 tracking-[0.4em] uppercase">
                    {greeting.dateStr}
                  </p>
                </div>
                
                <div className="relative px-6 py-6 glass rounded-[2.5rem] border border-white/20 stagger-3 shadow-2xl backdrop-blur-2xl">
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-pink-500 text-white text-[9px] font-black tracking-widest uppercase rounded-full shadow-lg">Daily Muse</div>
                  <p className="text-zinc-800 dark:text-zinc-100 italic text-[15px] font-medium leading-relaxed font-serif">
                    &ldquo;{greeting.quote}&rdquo;
                  </p>
                </div>

                <div className="pt-4 flex flex-wrap justify-center gap-3 stagger-4">
                  {[{l:'Trending News',p:'Show me the most impactful news of the hour.'},{l:'Inspire Me',p:'Give me a unique thought to ponder on.'},{l:'Creative Art',p:'Generate a high-fashion elegant aesthetic art'}].map(item => (
                     <button 
                       key={item.l} 
                       onClick={() => { setInput(item.p); handleSend(item.p); }} 
                       className="px-6 py-3 text-[10px] glass rounded-full hover:bg-white/20 hover:border-pink-500/30 border border-white/20 transition-all shadow-lg font-black uppercase tracking-[0.1em] dark:text-white active:scale-95"
                     >
                       {item.l}
                     </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {currentSession?.messages.map((msg) => (
            <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-in slide-in-from-bottom-4 duration-300`}>
              <div className={`max-w-[88%] flex flex-col gap-3 ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                <div className={`message-bubble p-5 glass relative shadow-xl backdrop-blur-2xl border transition-all duration-300 ${msg.role === 'user' ? 'bg-zinc-800/10 dark:bg-white/10 border-white/30 rounded-[2.5rem] rounded-tr-md' : 'bg-white/40 dark:bg-white/5 border-white/20 rounded-[2.5rem] rounded-tl-md'}`}>
                  {msg.imageUrl && (
                    <div className="mb-5 overflow-hidden rounded-[1.5rem] shadow-2xl bg-black/5 dark:bg-white/5 border border-white/10 group/img cursor-zoom-in">
                      <img src={msg.imageUrl} className="w-full h-auto object-cover transition-transform duration-700 group-hover/img:scale-110" alt="AI Generated" />
                    </div>
                  )}
                  
                  <div className="space-y-4">
                    <p className={`text-[15px] leading-relaxed whitespace-pre-wrap font-medium selection:bg-pink-500/30 ${msg.role === 'user' ? 'text-zinc-800 dark:text-zinc-100' : 'text-zinc-900 dark:text-zinc-200'}`}>
                      {msg.text}
                    </p>

                    {msg.groundingSources && msg.groundingSources.length > 0 && (
                      <div className="pt-4 mt-2 border-t border-black/5 dark:border-white/5 space-y-3">
                        <div className="flex items-center gap-2 opacity-50">
                           <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 shadow-sm" />
                           <p className="text-[10px] uppercase tracking-widest font-black">Verified Research</p>
                        </div>
                        <div className="flex flex-col gap-2">
                          {msg.groundingSources.map((source, idx) => (
                            <a key={idx} href={source.uri} target="_blank" rel="noopener noreferrer" className="p-3 glass bg-indigo-500/5 hover:bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 text-[11px] rounded-2xl flex items-center justify-between transition-all border border-indigo-500/10 active:scale-[0.98] group/link">
                              <span className="truncate font-bold tracking-tight">{source.title || "Reference URL"}</span>
                              <div className="p-1.5 bg-white/10 dark:bg-black/10 rounded-lg group-hover/link:bg-indigo-500 group-hover/link:text-white transition-colors">
                                <svg className="transition-transform group-hover/link:scale-110" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3"/></svg>
                              </div>
                            </a>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="mt-5 flex items-center justify-between pt-1 border-t border-black/[0.03] dark:border-white/[0.03]">
                    <span className="text-[10px] opacity-30 font-black tracking-[0.1em] uppercase">{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    <div className="flex items-center gap-2">
                      <button 
                        onClick={() => handleCopyMessage(msg)}
                        className={`p-2.5 rounded-full transition-all active:scale-90 ${copiedId === msg.id ? 'text-green-500 bg-green-500/10' : 'text-zinc-400 hover:text-pink-500 hover:bg-pink-500/10'}`}
                        title="Copy text"
                      >
                        <ICONS.Copy />
                      </button>
                      {msg.role === 'model' && (
                        <button 
                          onClick={() => handlePlayAudio(msg.text)} 
                          className="p-2.5 -mr-2 text-zinc-400 hover:text-pink-500 hover:bg-pink-500/10 rounded-full transition-all active:scale-90" 
                          title="Narrate response"
                        >
                          <ICONS.Volume2 />
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {msg.role === 'model' && msg.psychAnalysis && parsePsychInsight(msg.psychAnalysis) && (
                  <div className="max-w-full px-5 py-3 glass bg-pink-500/[0.03] dark:bg-pink-500/[0.08] border border-pink-500/20 rounded-[1.5rem] self-start flex flex-col gap-1.5 animate-in fade-in slide-in-from-left-4 duration-1000">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-pink-500 animate-pulse shadow-sm shadow-pink-500/40" />
                      <span className="text-[10px] font-black text-pink-500 uppercase tracking-[0.2em]">MINI Emotion Engine</span>
                    </div>
                    <p className="text-[11px] text-zinc-600 dark:text-zinc-300 font-semibold italic leading-relaxed">
                      {parsePsychInsight(msg.psychAnalysis)}
                    </p>
                  </div>
                )}
              </div>
            </div>
          ))}

          {isTyping && (
            <div className="flex justify-start">
              <div className="p-6 glass rounded-[3rem] rounded-tl-md animate-pulse flex items-center space-x-2.5 border border-white/20">
                <div className="w-2.5 h-2.5 bg-pink-500 rounded-full animate-bounce [animation-duration:0.8s]" />
                <div className="w-2.5 h-2.5 bg-purple-500 rounded-full animate-bounce [animation-duration:0.8s] [animation-delay:0.2s]" />
                <div className="w-2.5 h-2.5 bg-indigo-500 rounded-full animate-bounce [animation-duration:0.8s] [animation-delay:0.4s]" />
              </div>
            </div>
          )}

          {errorMsg && (
            <div className="flex justify-center p-2 sticky bottom-4 z-20">
              <div className="glass bg-red-500/10 border-red-500/30 p-6 rounded-[2.5rem] text-center w-full shadow-2xl animate-in slide-up-fade animate-shake relative overflow-hidden group/error">
                <button 
                  onClick={() => setErrorMsg(null)}
                  className="absolute top-4 right-4 p-2.5 rounded-full hover:bg-red-500/20 text-red-500 transition-all opacity-0 group-hover/error:opacity-100 flex items-center justify-center border border-transparent hover:border-red-500/20"
                  title="Dismiss alert"
                >
                  <ICONS.X />
                </button>
                <div className="flex flex-col items-center gap-4">
                  <div className="p-3 bg-red-500/20 rounded-2xl text-red-500 shadow-inner">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                  </div>
                  <div className="space-y-1">
                    <p className="text-red-700 dark:text-red-400 text-[14px] font-black leading-tight">System Disruption</p>
                    <p className="text-red-600/70 dark:text-red-400/60 text-[11px] font-bold uppercase tracking-widest">{errorMsg}</p>
                  </div>
                  <button 
                    onClick={() => { const last = currentSession?.messages[currentSession.messages.length-1]; if(last?.role==='user') handleSend(last.text); }} 
                    className="w-full max-w-[200px] px-8 py-3 bg-red-500 text-white text-[11px] uppercase tracking-[0.25em] font-black rounded-full hover:bg-red-600 transition-all active:scale-95 shadow-xl shadow-red-500/30 border border-red-400/20"
                  >
                    Restore Link
                  </button>
                </div>
              </div>
            </div>
          )}

          {isGeneratingImage && (
             <div className="flex justify-start">
                <div className="p-10 glass rounded-[3.5rem] w-full flex flex-col items-center space-y-6 border border-white/30 shadow-2xl">
                   <div className="relative">
                      <div className="w-16 h-16 border-[5px] border-t-pink-500 border-white/10 rounded-full animate-spin shadow-lg shadow-pink-500/20" />
                      <div className="absolute inset-0 blur-3xl bg-pink-500/30 animate-pulse" />
                   </div>
                   <div className="text-center space-y-2">
                     <p className="text-[13px] font-black uppercase tracking-[0.3em] bg-gradient-to-r from-pink-500 to-indigo-500 bg-clip-text text-transparent">Synthesizing Vision</p>
                     <p className="text-[10px] font-bold opacity-40 uppercase tracking-[0.2em]">Crafting Pixel Reality...</p>
                   </div>
                </div>
             </div>
          )}
        </div>

        <footer className="p-6 border-t border-white/10 shrink-0 bg-white/5 backdrop-blur-3xl z-10">
          <div className="relative flex items-end gap-3 max-w-xl mx-auto">
            <button 
              onClick={handleGenerateImage} 
              disabled={isGeneratingImage || !input.trim()} 
              title="Magic Visual" 
              className="p-4 glass rounded-full hover:bg-pink-500/20 text-zinc-600 dark:text-zinc-400 disabled:opacity-30 border border-white/20 mb-1 transition-all hover:scale-110 active:scale-90 shadow-lg"
            >
              <ICONS.Image />
            </button>
            <div className="flex-1 relative flex items-center group">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                placeholder="Talk to MINI..."
                rows={1}
                className="w-full glass bg-white/10 dark:bg-black/20 rounded-[2.5rem] py-4.5 pl-8 pr-16 focus:outline-none focus:ring-2 focus:ring-pink-500/30 hover:border-pink-500/40 text-[15px] resize-none text-zinc-900 dark:text-white border border-white/20 placeholder:text-zinc-500 transition-all duration-300 shadow-inner"
              />
              <button 
                onClick={startVoiceInput} 
                title="Voice Assistant" 
                className={`absolute right-3.5 p-3 rounded-full transition-all hover:scale-110 active:scale-90 ${isRecording ? 'bg-red-500 text-white shadow-2xl shadow-red-500/50 animate-pulse' : 'text-zinc-400 hover:bg-white/10 hover:text-pink-500'}`}
              >
                <ICONS.Mic />
              </button>
            </div>
            <button 
              onClick={() => handleSend()} 
              disabled={isTyping || !input.trim()} 
              className="p-4.5 bg-gradient-to-tr from-pink-500 via-purple-600 to-indigo-600 text-white rounded-full disabled:opacity-50 mb-1 transition-all hover:shadow-2xl hover:shadow-pink-500/50 active:scale-90 flex items-center justify-center group/send shadow-xl"
            >
              <div className="group-hover/send:translate-x-1 group-hover/send:-translate-y-1 transition-transform duration-300">
                <ICONS.Send />
              </div>
            </button>
          </div>
          <div className="mt-5 flex flex-col items-center gap-1.5 opacity-20">
             <p className="text-[9px] font-black uppercase tracking-[0.4em] dark:text-white">MINI PERSONAL ASSISTANT • AI v2.5</p>
             <div className="flex gap-3">
                <div className="w-1.5 h-1.5 rounded-full bg-pink-500 animate-pulse" />
                <div className="w-1.5 h-1.5 rounded-full bg-purple-500 animate-pulse [animation-delay:0.2s]" />
                <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse [animation-delay:0.4s]" />
             </div>
          </div>
        </footer>

        {sidebarOpen && (
          <div className="absolute inset-0 z-50">
            <div className="absolute inset-0 bg-black/70 backdrop-blur-md animate-in fade-in duration-500" onClick={() => setSidebarOpen(false)} />
            <div className="relative w-4/5 h-full glass bg-zinc-950/95 text-white flex flex-col border-r border-white/10 shadow-2xl animate-in slide-in-from-left-4 duration-400">
              <div className="p-10 border-b border-white/5 flex items-center justify-between bg-white/5">
                <div className="flex flex-col gap-1.5">
                   <h3 className="font-black text-2xl tracking-tighter uppercase italic bg-gradient-to-r from-pink-500 to-indigo-400 bg-clip-text text-transparent">Memory Bank</h3>
                   <span className="text-[10px] font-bold opacity-40 uppercase tracking-[0.3em]">Temporal Sync Status: Active</span>
                </div>
                <button onClick={() => { createNewSession(); setSidebarOpen(false); }} className="p-4 bg-pink-500/10 hover:bg-pink-500/20 text-pink-500 rounded-[1.5rem] hover:scale-110 transition-all border border-pink-500/20 shadow-lg shadow-pink-500/10" title="New Memory"><ICONS.Sun /></button>
              </div>
              <div className="flex-1 overflow-y-auto p-6 space-y-5 custom-scrollbar">
                {sessions.map((s) => (
                  <div 
                    key={s.id} 
                    className={`group flex items-center justify-between p-6 rounded-[2.5rem] border transition-all cursor-pointer shadow-sm ${activeSessionId === s.id ? 'bg-pink-500/15 border-pink-500/40 shadow-pink-500/5' : 'hover:bg-white/5 border-transparent'}`} 
                    onClick={() => { setActiveSessionId(s.id); setSidebarOpen(false); }}
                  >
                    <div className="flex flex-col gap-2 w-[80%]">
                      <span className="text-[15px] font-bold truncate leading-tight tracking-tight">{s.title || "Temporal Fragment"}</span>
                      <div className="flex items-center gap-2.5 opacity-30">
                        <span className="text-[9px] font-black uppercase tracking-widest">{new Date(s.createdAt).toLocaleDateString()}</span>
                        <div className="w-1.5 h-1.5 rounded-full bg-white/20" />
                        <span className="text-[9px] font-black uppercase tracking-widest">{s.messages.length} Data Units</span>
                      </div>
                    </div>
                    <button onClick={(e) => { e.stopPropagation(); deleteSession(s.id); }} className="opacity-0 group-hover:opacity-100 p-3 hover:bg-red-500/20 hover:text-red-400 rounded-2xl transition-all active:scale-90" title="Erase Temporal Record"><ICONS.Trash /></button>
                  </div>
                ))}
              </div>
              <div className="p-8 border-t border-white/5 bg-white/5 flex items-center justify-center">
                 <p className="text-[10px] font-black opacity-10 uppercase tracking-[0.6em] animate-pulse">Neural Link Finalized</p>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default App;
