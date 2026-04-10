import React, { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI, Type, LiveServerMessage, Modality } from "@google/genai";

// Initialize Gemini - Using the injected process.env.API_KEY as per guidelines
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

const LANGUAGES = [
  { code: 'auto', name: 'Auto Detect' },
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Spanish' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'it', name: 'Italian' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'zh', name: 'Chinese (Simplified)' },
  { code: 'ja', name: 'Japanese' },
  { code: 'ko', name: 'Korean' },
  { code: 'ru', name: 'Russian' },
  { code: 'hi', name: 'Hindi' },
  { code: 'ar', name: 'Arabic' },
  { code: 'tr', name: 'Turkish' },
  { code: 'nl', name: 'Dutch' },
  { code: 'pl', name: 'Polish' },
  { code: 'vi', name: 'Vietnamese' },
  { code: 'th', name: 'Thai' },
  { code: 'id', name: 'Indonesian' },
  { code: 'bn', name: 'Bengali' },
  { code: 'pa', name: 'Punjabi' },
  { code: 'el', name: 'Greek' },
  { code: 'he', name: 'Hebrew' },
  { code: 'sv', name: 'Swedish' },
  { code: 'no', name: 'Norwegian' },
  { code: 'da', name: 'Danish' },
  { code: 'fi', name: 'Finnish' },
  { code: 'cs', name: 'Czech' },
  { code: 'hu', name: 'Hungarian' },
  { code: 'ro', name: 'Romanian' },
  { code: 'uk', name: 'Ukrainian' },
  { code: 'tl', name: 'Filipino' },
  { code: 'ms', name: 'Malay' },
  { code: 'fa', name: 'Persian' },
  { code: 'ta', name: 'Tamil' },
  { code: 'te', name: 'Telugu' },
  { code: 'mr', name: 'Marathi' },
];

const MODELS = [
  { id: 'gemini-3-flash-preview', name: 'Gemini 3.0 Flash (Balanced)' },
  { id: 'gemini-flash-lite-latest', name: 'Gemini 2.5 Flash Lite (Fastest)' },
  { id: 'gemini-3-pro-preview', name: 'Gemini 3.0 Pro (Highest Quality)' },
];

interface HistoryItem {
  id: string;
  timestamp: number;
  type: 'voice' | 'text';
  inputLanguage: string;
  targetLanguage: string;
  original: string;
  translation: string;
  pronunciation?: string;
  resultType: 'translation' | 'grammar';
}

function floatTo16BitPCM(float32Array: Float32Array): ArrayBuffer {
  const buffer = new ArrayBuffer(float32Array.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < float32Array.length; i++) {
    let s = Math.max(-1, Math.min(1, float32Array[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}

function base64Encode(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

function App() {
  const [isDarkMode, setIsDarkMode] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('theme');
      return saved === 'dark' || (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches);
    }
    return false;
  });

  const [savedSettings] = useState(() => {
    if (typeof window === 'undefined') return {};
    try {
      const saved = localStorage.getItem('echoScribeSettings');
      return saved ? JSON.parse(saved) : {};
    } catch (e) {
      return {};
    }
  });

  const [history, setHistory] = useState<HistoryItem[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const saved = localStorage.getItem('echoScribeHistory');
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      return [];
    }
  });
  
  const [showHistory, setShowHistory] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStep, setProcessingStep] = useState(''); 
  const [resultType, setResultType] = useState<'translation' | 'grammar'>('translation');
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [transcript, setTranscript] = useState('');
  const [translation, setTranslation] = useState('');
  const [pronunciation, setPronunciation] = useState('');
  const [inputMode, setInputMode] = useState<'voice' | 'text'>(() => {
    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('share_text')) {
        return 'text';
    }
    return 'voice';
  });

  const [inputText, setInputText] = useState(() => {
    if (typeof window === 'undefined') return '';
    const params = new URLSearchParams(window.location.search);
    const shareText = params.get('share_text');
    if (shareText) return shareText;
    return localStorage.getItem('echoScribeDraft') || '';
  });
  
  const [inputLanguage, setInputLanguage] = useState(() => {
    if (typeof window === 'undefined') return 'auto';
    const params = new URLSearchParams(window.location.search);
    return params.get('share_source') || 'auto';
  });

  const [autoDetectHints, setAutoDetectHints] = useState<string[]>([]);
  const [showHintSelector, setShowHintSelector] = useState(false);
  const [targetLanguage, setTargetLanguage] = useState(() => {
    if (typeof window === 'undefined') return 'es';
    const params = new URLSearchParams(window.location.search);
    return params.get('share_target') || 'es';
  });
  
  const [showSettings, setShowSettings] = useState(false);
  const [showVolumePopup, setShowVolumePopup] = useState(false);
  const [micGain, setMicGain] = useState(savedSettings.micGain ?? 1.0);
  const [speechRate, setSpeechRate] = useState(savedSettings.speechRate ?? 1.0);
  const [speechVolume, setSpeechVolume] = useState(savedSettings.speechVolume ?? 1.0);
  const [selectedModel, setSelectedModel] = useState(savedSettings.selectedModel ?? 'gemini-3-flash-preview');
  const [profanityFilter, setProfanityFilter] = useState(savedSettings.profanityFilter ?? false);
  const [showPronunciation, setShowPronunciation] = useState(savedSettings.showPronunciation ?? false);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const [isSourceCopied, setIsSourceCopied] = useState(false);
  const [isTargetCopied, setIsTargetCopied] = useState(false);
  const [isSourceShared, setIsSourceShared] = useState(false);
  const [isTargetShared, setIsTargetShared] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recordingTime, setRecordingTime] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const streamDestinationRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  const liveSessionRef = useRef<any>(null);
  const liveProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const liveContextRef = useRef<AudioContext | null>(null);
  const currentTranscriptRef = useRef<string>('');

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [isDarkMode]);

  useEffect(() => {
    const settings = { micGain, speechRate, speechVolume, selectedModel, profanityFilter, showPronunciation };
    localStorage.setItem('echoScribeSettings', JSON.stringify(settings));
  }, [micGain, speechRate, speechVolume, selectedModel, profanityFilter, showPronunciation]);

  useEffect(() => {
    localStorage.setItem('echoScribeHistory', JSON.stringify(history));
  }, [history]);

  useEffect(() => {
    const handler = setTimeout(() => {
      localStorage.setItem('echoScribeDraft', inputText);
    }, 1000);
    return () => clearTimeout(handler);
  }, [inputText]);

  useEffect(() => {
    if (!isRecording || !transcript.trim() || resultType !== 'translation') return;
    const timeoutId = setTimeout(() => {
      translateText(transcript, targetLanguage, true);
    }, 1500);
    return () => clearTimeout(timeoutId);
  }, [transcript, isRecording, targetLanguage, resultType]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = speechVolume;
  }, [speechVolume, audioUrl]);

  useEffect(() => {
    setCurrentTime(0);
    setDuration(0);
    setIsPlaying(false);
  }, [audioUrl]);

  const addToHistory = (item: Omit<HistoryItem, 'id' | 'timestamp'>) => {
    const newItem: HistoryItem = { ...item, id: crypto.randomUUID(), timestamp: Date.now() };
    setHistory(prev => [newItem, ...prev].slice(0, 50)); 
  };

  const handleLoadHistory = (item: HistoryItem) => {
    setInputMode(item.type);
    setInputLanguage(item.inputLanguage);
    setTargetLanguage(item.targetLanguage);
    setResultType(item.resultType);
    if (item.type === 'text') setInputText(item.original);
    setTranscript(item.original);
    setTranslation(item.translation);
    setPronunciation(item.pronunciation || '');
    setAudioUrl(null); 
    setError(null);
    setShowHistory(false);
  };

  const handleDeleteHistory = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setHistory(prev => prev.filter(item => item.id !== id));
  };

  const handleClearHistory = () => {
    if (confirm('Are you sure you want to clear all history?')) setHistory([]);
  };

  const handleStartOver = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    setIsPlaying(false);
    setTranscript('');
    setTranslation('');
    setPronunciation('');
    setAudioUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
    });
    setRecordingTime(0);
    setInputText(''); 
    setError(null);
    setResultType('translation');
    window.history.replaceState({}, '', window.location.pathname);
  };

  const handleError = (err: any) => {
    console.error("App Error:", err);
    let message = "An unexpected error occurred.";
    const errString = err?.message || String(err);
    if (errString.includes("NotAllowedError") || errString.includes("Permission denied")) {
      message = "Microphone access denied. Please allow microphone permissions.";
    } else if (errString.includes("NotFoundError")) {
      message = "No microphone found. Please connect one and try again.";
    } else if (errString.includes("fetch") || errString.includes("network")) {
      message = "Network error. Please check your internet connection.";
    } else if (errString.includes("API_KEY") || errString.includes("api key")) {
        message = "Missing or invalid API Key. Please ensure it is configured correctly.";
    } else {
      message = errString.length > 100 ? "An error occurred while processing." : errString;
    }
    setError(message);
  };

  const setupAudioContext = (stream: MediaStream) => {
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close();
    }
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    audioContextRef.current = audioContext;
    const source = audioContext.createMediaStreamSource(stream);
    sourceRef.current = source;
    const gainNode = audioContext.createGain();
    gainNode.gain.value = micGain;
    gainNodeRef.current = gainNode;
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    analyserRef.current = analyser;
    const destination = audioContext.createMediaStreamDestination();
    streamDestinationRef.current = destination;
    source.connect(gainNode);
    gainNode.connect(destination);
    gainNode.connect(analyser);
    drawVisualizer(analyser);
    return { destinationStream: destination.stream, audioContext, source };
  };

  const drawVisualizer = (analyser: AnalyserNode) => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    const draw = () => {
      if (!isRecording && !canvasRef.current) return;
      animationFrameRef.current = requestAnimationFrame(draw);
      analyser.getByteFrequencyData(dataArray);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const width = canvas.width;
      const height = canvas.height;
      const barWidth = (width / bufferLength) * 2.5;
      let x = 0;
      for (let i = 0; i < bufferLength; i++) {
        const barHeight = (dataArray[i] / 255) * height;
        ctx.fillStyle = isDarkMode ? '#38bdf8' : '#0ea5e9';
        ctx.fillRect(x, height - barHeight, barWidth, barHeight);
        x += barWidth + 1;
      }
    };
    draw();
  };

  const stopAudioContext = () => {
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    if (sourceRef.current) sourceRef.current.disconnect();
    if (gainNodeRef.current) gainNodeRef.current.disconnect();
    if (analyserRef.current) analyserRef.current.disconnect();
    if (streamDestinationRef.current) streamDestinationRef.current.disconnect();
    if (liveProcessorRef.current) {
      liveProcessorRef.current.disconnect();
      liveProcessorRef.current = null;
    }
    if (liveContextRef.current && liveContextRef.current.state !== 'closed') {
      liveContextRef.current.close();
      liveContextRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close();
    }
  };

  useEffect(() => {
    if (gainNodeRef.current) gainNodeRef.current.gain.value = micGain;
  }, [micGain]);

  const startRecording = async () => {
    try {
      setError(null);
      const rawStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const { destinationStream } = setupAudioContext(rawStream);

      mediaRecorderRef.current = new MediaRecorder(destinationStream);
      chunksRef.current = [];
      mediaRecorderRef.current.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mediaRecorderRef.current.onstop = () => {
         rawStream.getTracks().forEach(track => track.stop());
         handleRecordingStop();
      };
      mediaRecorderRef.current.start();

      setTranscript('');
      setTranslation('');
      setPronunciation('');
      setAudioUrl(null);
      setRecordingTime(0);
      setResultType('translation');
      currentTranscriptRef.current = '';

      const liveCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      liveContextRef.current = liveCtx;
      const liveSource = liveCtx.createMediaStreamSource(rawStream);
      const processor = liveCtx.createScriptProcessor(4096, 1, 1);
      liveProcessorRef.current = processor;

      let hintText = "";
      if (inputLanguage === 'auto' && autoDetectHints.length > 0) {
        const hintNames = autoDetectHints.map(c => LANGUAGES.find(l => l.code === c)?.name).join(", ");
        hintText = ` Detection hints (likely languages): ${hintNames}.`;
      }

      const liveSessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        callbacks: {
          onopen: () => {
            liveSource.connect(processor);
            processor.connect(liveCtx.destination);
          },
          onmessage: (message: LiveServerMessage) => {
            if (message.serverContent?.inputTranscription?.text) {
              const text = message.serverContent.inputTranscription.text;
              currentTranscriptRef.current += text;
              setTranscript(prev => prev + text);
            }
          },
          onerror: (e) => { console.error("Live API Session Error", e); }
        },
        config: {
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {}, 
          systemInstruction: `You are a passive listener/transcriber.${hintText}`,
        }
      });
      liveSessionRef.current = liveSessionPromise;

      processor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);
        const pcm16 = floatTo16BitPCM(inputData);
        const base64 = base64Encode(pcm16);
        liveSessionPromise.then(session => {
          session.sendRealtimeInput({ media: { mimeType: 'audio/pcm;rate=16000', data: base64 } });
        }).catch(() => {
            // Unhandled rejection flood prevention if connection is severed
        });
      };

      setIsRecording(true);
      timerRef.current = window.setInterval(() => setRecordingTime((prev) => prev + 1), 1000);
    } catch (err) {
      handleError(err);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop(); 
      setIsRecording(false);
      if (timerRef.current) clearInterval(timerRef.current);
      if (liveSessionRef.current) {
        liveSessionRef.current.then((session: any) => session.close()).catch(() => {});
        liveSessionRef.current = null;
      }
      stopAudioContext();
    }
  };

  const handleRecordingStop = async () => {
    const audioBlob = new Blob(chunksRef.current, { type: 'audio/webm' });
    const url = URL.createObjectURL(audioBlob);
    setAudioUrl(url);
    if (currentTranscriptRef.current.trim().length > 0) {
      setTranscript(currentTranscriptRef.current); 
      const result = await translateText(currentTranscriptRef.current, targetLanguage);
       if (result) addToHistory({ type: 'voice', inputLanguage, targetLanguage, original: currentTranscriptRef.current, translation: result.translation, pronunciation: result.pronunciation, resultType: 'translation' });
    } else {
      await transcribeAudio(audioBlob);
    }
  };

  const transcribeAudio = async (audioBlob: Blob) => {
    setIsProcessing(true);
    setProcessingStep('transcribing');
    setError(null);
    try {
      const base64Audio = await blobToBase64(audioBlob);
      const isAuto = inputLanguage === 'auto';
      const hints = isAuto && autoDetectHints.length > 0 ? ` Hints: ${autoDetectHints.map(c => LANGUAGES.find(l => l.code === c)?.name).join(", ")}.` : "";
      const prompt = `Transcribe this audio file accurately.${hints} Return only the text.`;
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        contents: { parts: [{ inlineData: { mimeType: 'audio/webm', data: base64Audio } }, { text: prompt }] }
      });
      const text = response.text || "";
      if (text) {
        setTranscript(text);
        const result = await translateText(text, targetLanguage);
        if (result) addToHistory({ type: 'voice', inputLanguage, targetLanguage, original: text, translation: result.translation, pronunciation: result.pronunciation, resultType: 'translation' });
      }
    } catch (err) { handleError(err); } finally { setIsProcessing(false); }
  };

  const translateText = async (textToTranslate: string, targetLangCode: string, isLive: boolean = false) => {
    if (!textToTranslate) return null;
    if (!isLive) { setProcessingStep('translating'); setIsProcessing(true); setPronunciation(''); }
    try {
      const targetLangName = LANGUAGES.find(l => l.code === targetLangCode)?.name || targetLangCode;
      const promptText = `Translate the following text into ${targetLangName}: "${textToTranslate}"`;
      let result = { translation: "", pronunciation: "" };
      if (showPronunciation) {
        const response = await ai.models.generateContent({
            model: selectedModel,
            contents: promptText,
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: { translation: { type: Type.STRING }, pronunciation: { type: Type.STRING } },
                    required: ["translation"]
                }
            }
        });
        try {
            result = JSON.parse(response.text || "{}");
        } catch (e) {
            result.translation = response.text || "";
        }
      } else {
        const response = await ai.models.generateContent({ model: selectedModel, contents: promptText });
        result.translation = response.text || "";
      }
      setTranslation(result.translation);
      if (result.pronunciation) setPronunciation(result.pronunciation);
      return result;
    } catch (err) { if (!isLive) handleError(err); return null; } finally { if (!isLive) setIsProcessing(false); }
  };

  const blobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };

  const handleTextTranslate = async () => {
    if (!inputText.trim()) return;
    setResultType('translation');
    setTranscript(inputText);
    setAudioUrl(null);
    setTranslation('');
    const result = await translateText(inputText, targetLanguage);
    if (result) addToHistory({ type: 'text', inputLanguage, targetLanguage, original: inputText, translation: result.translation, pronunciation: result.pronunciation, resultType: 'translation' });
  };

  const handleGrammarCheck = async () => {
    if (!inputText.trim()) return;
    setResultType('grammar');
    setProcessingStep('correcting');
    setIsProcessing(true);
    setTranscript(inputText);
    setAudioUrl(null);
    try {
      const response = await ai.models.generateContent({ model: selectedModel, contents: `Correct the grammar and spelling: "${inputText}". Return only corrected text.` });
      const corrected = response.text || "";
      setTranslation(corrected);
      addToHistory({ type: 'text', inputLanguage, targetLanguage: 'Grammar', original: inputText, translation: corrected, pronunciation: '', resultType: 'grammar' });
    } catch (err) { handleError(err); } finally { setIsProcessing(false); }
  };

  const handleLoadDraft = () => { setInputText("How are you today?\nWhere is the nearest train station?"); setInputLanguage('en'); };
  const formatTime = (seconds: number) => { const mins = Math.floor(seconds / 60); const secs = seconds % 60; return `${mins}:${secs.toString().padStart(2, '0')}`; };
  const formatAudioTime = (time: number) => { if (!time || isNaN(time)) return "0:00"; const mins = Math.floor(time / 60); const secs = Math.floor(time % 60); return `${mins}:${secs.toString().padStart(2, '0')}`; };
  const formatTimestamp = (ts: number) => new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  const handleTargetLanguageChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newLang = e.target.value;
    setTargetLanguage(newLang);
    if (transcript && resultType === 'translation') translateText(transcript, newLang);
  };

  const togglePlayback = () => {
    if (audioRef.current) {
        if (isPlaying) audioRef.current.pause();
        else audioRef.current.play();
        setIsPlaying(!isPlaying);
    }
  };

  const handleSpeak = (text: string, langCode: string) => {
    if (!text) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    if (langCode && langCode !== 'auto') utterance.lang = langCode;
    utterance.rate = speechRate;
    utterance.volume = speechVolume;
    window.speechSynthesis.speak(utterance);
  };
  
  const handleCopy = async (text: string, isSource: boolean) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      if (isSource) { setIsSourceCopied(true); setTimeout(() => setIsSourceCopied(false), 2000); }
      else { setIsTargetCopied(true); setTimeout(() => setIsTargetCopied(false), 2000); }
    } catch (err) {}
  };

  const toggleHint = (code: string) => setAutoDetectHints(prev => prev.includes(code) ? prev.filter(c => c !== code) : [...prev, code]);
  const getInputLanguageName = () => LANGUAGES.find(l => l.code === inputLanguage)?.name || 'Input Language';

  return (
    <div className="min-h-screen relative overflow-hidden text-slate-800 dark:text-slate-200 font-sans transition-colors duration-300">
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden -z-10 bg-slate-50 dark:bg-slate-950 transition-colors duration-300">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-primary-200 dark:bg-primary-600 rounded-full blur-3xl opacity-30 animate-blob"></div>
        <div className="absolute top-0 right-1/4 w-96 h-96 bg-purple-200 dark:bg-purple-600 rounded-full blur-3xl opacity-30 animate-blob animation-delay-2000"></div>
      </div>

      <div className="container mx-auto px-4 py-8 max-w-3xl">
        <header className="text-center mb-10 relative">
          <div className="absolute right-0 top-0 flex gap-2">
            <button onClick={() => setIsDarkMode(!isDarkMode)} className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 rounded-full transition-colors"><i className={`fa-solid ${isDarkMode ? 'fa-sun' : 'fa-moon'} text-xl`}></i></button>
            <button onClick={() => setShowHistory(true)} className="p-2 text-slate-400 hover:text-slate-600 rounded-full transition-colors"><i className="fa-solid fa-clock-rotate-left text-xl"></i></button>
            <button onClick={() => setShowSettings(true)} className="p-2 text-slate-400 hover:text-slate-600 rounded-full transition-colors"><i className="fa-solid fa-gear text-xl"></i></button>
          </div>
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary-500 shadow-lg mb-4 text-white"><i className="fa-solid fa-microphone-lines text-2xl"></i></div>
          <h1 className="text-4xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-slate-800 to-slate-600 dark:from-white dark:to-slate-300 mb-2">EchoScribe</h1>
        </header>

        <div className="glass-card rounded-3xl p-8 shadow-xl mb-8 text-center relative overflow-hidden">
          <div className="flex justify-center mb-6 bg-slate-100/50 dark:bg-slate-800/50 p-1 rounded-xl inline-flex">
            <button onClick={() => setInputMode('voice')} className={`px-6 py-2 rounded-lg text-sm font-semibold transition-all ${inputMode === 'voice' ? 'bg-white dark:bg-slate-700 text-primary-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>Voice</button>
            <button onClick={() => setInputMode('text')} className={`px-6 py-2 rounded-lg text-sm font-semibold transition-all ${inputMode === 'text' ? 'bg-white dark:bg-slate-700 text-primary-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>Text</button>
          </div>

          <div className="flex flex-col md:flex-row items-center justify-center gap-4 mb-4">
            <div className="w-full md:w-56 text-left">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">Input</label>
              <select value={inputLanguage} onChange={(e) => setInputLanguage(e.target.value)} disabled={isRecording} className="w-full bg-white/60 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 p-3 rounded-xl appearance-none cursor-pointer">
                {LANGUAGES.map(lang => <option key={lang.code} value={lang.code}>{lang.name}</option>)}
              </select>
            </div>
            <div className="w-full md:w-56 text-left">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">Output</label>
              <select value={targetLanguage} onChange={handleTargetLanguageChange} disabled={isRecording} className="w-full bg-white/60 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 p-3 rounded-xl appearance-none cursor-pointer">
                {LANGUAGES.filter(l => l.code !== 'auto').map(lang => <option key={lang.code} value={lang.code}>{lang.name}</option>)}
              </select>
            </div>
          </div>

          {inputLanguage === 'auto' && (
            <div className="mb-6 animate-fade-in-up">
              <button onClick={() => setShowHintSelector(!showHintSelector)} className="text-xs font-bold py-1.5 px-3 rounded-full border bg-primary-50 dark:bg-primary-900/30 border-primary-200 dark:border-primary-800 text-primary-600 mb-2 transition-all">Hints {autoDetectHints.length > 0 ? `(${autoDetectHints.length})` : ''}</button>
              {showHintSelector && (
                <div className="bg-slate-50/50 dark:bg-slate-900/50 p-4 rounded-2xl border border-slate-200 dark:border-slate-700 mb-4 flex flex-wrap gap-2 max-h-40 overflow-y-auto">
                   {LANGUAGES.filter(l => l.code !== 'auto').map(lang => (
                     <button key={lang.code} onClick={() => toggleHint(lang.code)} className={`px-3 py-1 rounded-lg text-xs transition-all ${autoDetectHints.includes(lang.code) ? 'bg-primary-500 text-white' : 'bg-white dark:bg-slate-800 border'}`}>{lang.name}</button>
                   ))}
                </div>
              )}
              <div className="flex flex-wrap justify-center gap-1.5 min-h-[1.5rem] mt-2">
                {autoDetectHints.map(code => (
                    <span key={code} className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-primary-100 dark:bg-primary-900/40 text-primary-600 border border-primary-200">{LANGUAGES.find(l => l.code === code)?.name}</span>
                ))}
              </div>
            </div>
          )}

          {inputMode === 'voice' ? (
            <div className="flex flex-col items-center">
              <canvas ref={canvasRef} width="600" height="100" className={`w-full h-24 mb-6 ${!isRecording ? 'opacity-20' : 'opacity-100'} transition-opacity`} />
              <div className="text-4xl font-mono mb-4 text-slate-700 dark:text-slate-300">{formatTime(recordingTime)}</div>
              <button onClick={isRecording ? stopRecording : startRecording} className={`w-24 h-24 rounded-full flex items-center justify-center text-white transition-all shadow-lg hover:scale-105 active:scale-95 ${isRecording ? 'bg-red-500 animate-pulse' : 'bg-primary-500'}`}>
                <i className={`fa-solid ${isRecording ? 'fa-stop' : 'fa-microphone'} text-3xl`}></i>
              </button>
            </div>
          ) : (
            <div className="w-full max-w-lg mx-auto">
              <textarea value={inputText} onChange={(e) => setInputText(e.target.value)} placeholder="Type or paste text here..." className="w-full h-32 p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white/60 dark:bg-slate-800/60 resize-none mb-4 transition-all focus:ring-2 focus:ring-primary-500 focus:outline-none" />
              <div className="grid grid-cols-2 gap-4">
                <button onClick={handleTextTranslate} disabled={isProcessing || !inputText.trim()} className="py-3 rounded-xl bg-primary-500 hover:bg-primary-600 text-white font-bold transition-colors disabled:opacity-50">Translate</button>
                <button onClick={handleGrammarCheck} disabled={isProcessing || !inputText.trim()} className="py-3 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white font-bold transition-colors disabled:opacity-50">Grammar</button>
              </div>
            </div>
          )}
          {error && <div className="mt-4 p-3 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded-lg border border-red-200 dark:border-red-800 transition-all">{error}</div>}
        </div>

        {(transcript || translation) && (
          <div className="animate-fade-in-up">
            {/* Start Over Button (Only if not recording and has content) */}
            {!isRecording && (transcript || translation) && (
                <div className="flex justify-center mb-6">
                    <button
                        onClick={handleStartOver}
                        className="group flex items-center gap-2 px-5 py-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-red-300 dark:hover:border-red-800 hover:bg-red-50 dark:hover:bg-red-900/10 text-slate-600 dark:text-slate-300 hover:text-red-600 dark:hover:text-red-400 rounded-full font-medium transition-all shadow-sm hover:shadow-md"
                    >
                        <i className="fa-solid fa-rotate-right group-hover:-rotate-180 transition-transform duration-500"></i>
                        Start Over
                    </button>
                </div>
            )}
            
            <div className="grid md:grid-cols-2 gap-6">
              <div className="glass-card rounded-2xl p-6 border-l-4 border-primary-400 flex flex-col">
                <audio ref={audioRef} src={audioUrl || undefined} className="hidden" onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)} onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)} onEnded={() => setIsPlaying(false)} onPause={() => setIsPlaying(false)} onPlay={() => setIsPlaying(true)} />
                <div className="flex justify-between items-center mb-4">
                  <h3 className="font-semibold">{getInputLanguageName()}</h3>
                  <div className="flex gap-2">
                    <button onClick={() => handleCopy(transcript, true)} className="p-2 text-slate-400 hover:text-primary-600 transition-colors"><i className={`fa-solid ${isSourceCopied ? 'fa-check text-green-500' : 'fa-copy'}`}></i></button>
                    <button onClick={() => handleSpeak(transcript, inputLanguage)} className="p-2 text-slate-400 hover:text-primary-600 transition-colors"><i className="fa-solid fa-volume-high"></i></button>
                  </div>
                </div>
                <p className="whitespace-pre-wrap flex-grow">{transcript}</p>
                {audioUrl && (
                  <div className="mt-4 p-2 bg-slate-100 dark:bg-slate-800 rounded-lg flex items-center gap-3">
                    <button onClick={togglePlayback} className="w-8 h-8 rounded-full bg-primary-500 text-white flex items-center justify-center transition-colors hover:bg-primary-600"><i className={`fa-solid ${isPlaying ? 'fa-pause' : 'fa-play'} text-xs`}></i></button>
                    <div className="flex-grow text-[10px] font-mono">{formatAudioTime(currentTime)} / {formatAudioTime(duration)}</div>
                  </div>
                )}
              </div>
              <div className={`glass-card rounded-2xl p-6 border-l-4 flex flex-col ${resultType === 'grammar' ? 'border-emerald-400' : 'border-purple-400'}`}>
                <div className="flex justify-between items-center mb-4">
                  <h3 className="font-semibold">{resultType === 'grammar' ? 'Correction' : 'Translation'}</h3>
                  <div className="flex gap-2">
                    <button onClick={() => handleCopy(translation, false)} className="p-2 text-slate-400 hover:text-purple-600 transition-colors"><i className={`fa-solid ${isTargetCopied ? 'fa-check text-green-500' : 'fa-copy'}`}></i></button>
                    <button onClick={() => handleSpeak(translation, resultType === 'grammar' ? inputLanguage : targetLanguage)} className="p-2 text-slate-400 hover:text-purple-600 transition-colors"><i className="fa-solid fa-volume-high"></i></button>
                  </div>
                </div>
                <p className="whitespace-pre-wrap flex-grow">{translation}</p>
                {pronunciation && <p className="text-[10px] text-slate-500 italic mt-3 border-t dark:border-slate-700 pt-2 font-mono">Pronunciation: {pronunciation}</p>}
              </div>
            </div>
          </div>
        )}
      </div>

      {showHistory && (
         <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-fade-in">
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col border border-slate-200 dark:border-slate-700">
              <div className="px-6 py-4 border-b dark:border-slate-700 flex justify-between items-center bg-slate-50 dark:bg-slate-900/50">
                  <h2 className="text-lg font-bold">History</h2>
                  <div className="flex items-center gap-4">
                    <button onClick={handleClearHistory} className="text-xs text-red-500 hover:underline">Clear all</button>
                    <button onClick={() => setShowHistory(false)} className="hover:text-slate-500"><i className="fa-solid fa-xmark text-lg"></i></button>
                  </div>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
                  {history.length === 0 ? <div className="text-center py-12 text-slate-400"><i className="fa-solid fa-clock-rotate-left text-4xl mb-3 opacity-20"></i><p>No history yet</p></div> : history.map(item => (
                      <div key={item.id} onClick={() => handleLoadHistory(item)} className="p-4 border dark:border-slate-700 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700/50 cursor-pointer transition-all group">
                          <div className="flex justify-between text-[10px] text-slate-400 mb-2 font-bold uppercase tracking-wider">
                              <span>{item.type} • {formatTimestamp(item.timestamp)}</span>
                              <button onClick={(e) => handleDeleteHistory(item.id, e)} className="opacity-0 group-hover:opacity-100 hover:text-red-500 transition-opacity"><i className="fa-solid fa-trash"></i></button>
                          </div>
                          <div className="flex gap-3 items-center text-sm">
                              <span className="truncate flex-1 text-slate-500">{item.original}</span>
                              <i className="fa-solid fa-arrow-right text-slate-300"></i>
                              <span className="truncate flex-1 text-primary-600 font-semibold">{item.translation}</span>
                          </div>
                      </div>
                  ))}
              </div>
            </div>
         </div>
      )}

      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-fade-in">
          <div className="bg-white dark:bg-slate-800 rounded-2xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto border border-slate-200 dark:border-slate-700">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold">Settings</h2>
              <button onClick={() => setShowSettings(false)} className="hover:text-slate-500"><i className="fa-solid fa-xmark text-lg"></i></button>
            </div>
            <div className="space-y-6">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Microphone Sensitivity ({Math.round(micGain * 100)}%)</label>
                <input type="range" min="0" max="2" step="0.1" value={micGain} onChange={(e) => setMicGain(parseFloat(e.target.value))} className="w-full accent-primary-500" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Model</label>
                <select value={selectedModel} onChange={(e) => setSelectedModel(e.target.value)} className="w-full border dark:border-slate-700 p-3 rounded-xl bg-white dark:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-primary-500">
                  {MODELS.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </div>
              <div className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-900 rounded-xl">
                <span className="text-sm font-medium">Show Pronunciation Guide</span>
                <input type="checkbox" checked={showPronunciation} onChange={(e) => setShowPronunciation(e.target.checked)} className="w-5 h-5 accent-primary-500 cursor-pointer" />
              </div>
              <div className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-900 rounded-xl">
                <span className="text-sm font-medium">Profanity Filter</span>
                <input type="checkbox" checked={profanityFilter} onChange={(e) => setProfanityFilter(e.target.checked)} className="w-5 h-5 accent-primary-500 cursor-pointer" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Speech Synthesis Rate ({speechRate}x)</label>
                <input type="range" min="0.5" max="2" step="0.1" value={speechRate} onChange={(e) => setSpeechRate(parseFloat(e.target.value))} className="w-full accent-primary-500" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Playback Volume ({Math.round(speechVolume * 100)}%)</label>
                <input type="range" min="0" max="1" step="0.1" value={speechVolume} onChange={(e) => setSpeechVolume(parseFloat(e.target.value))} className="w-full accent-primary-500" />
              </div>
            </div>
            <button onClick={() => setShowSettings(false)} className="w-full mt-8 py-3.5 bg-slate-800 dark:bg-slate-700 text-white rounded-xl font-bold shadow-lg shadow-slate-200 dark:shadow-none transition-all active:scale-[0.98]">Done</button>
          </div>
        </div>
      )}
    </div>
  );
}

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<App />);
}
