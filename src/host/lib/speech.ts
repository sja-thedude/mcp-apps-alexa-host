import { useCallback, useEffect, useRef, useState } from "react";

/* Minimal typings for the Web Speech API (not in lib.dom for all targets). */
interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: { transcript: string };
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}
type RecognitionCtor = new () => SpeechRecognitionLike;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const speechRecognitionSupported = () => recognitionCtor() !== null;

/**
 * Browser speech-to-text. `continuous` keeps listening across pauses (for
 * dictating long answers); otherwise it stops after the first utterance.
 */
export function useDictation(opts: { continuous?: boolean; onFinal?: (text: string) => void } = {}) {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const onFinalRef = useRef(opts.onFinal);
  onFinalRef.current = opts.onFinal;

  const stop = useCallback(() => {
    recRef.current?.stop();
  }, []);

  const start = useCallback(() => {
    const Ctor = recognitionCtor();
    if (!Ctor) {
      setError("Voice input isn't supported in this browser — try Chrome or Edge, or type instead.");
      return;
    }
    recRef.current?.abort();
    const rec = new Ctor();
    rec.lang = navigator.language || "en-US";
    rec.continuous = Boolean(opts.continuous);
    rec.interimResults = true;
    rec.onresult = (e) => {
      let live = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) onFinalRef.current?.(r[0].transcript.trim());
        else live += r[0].transcript;
      }
      setInterim(live);
    };
    rec.onerror = (e) => {
      if (e.error !== "aborted" && e.error !== "no-speech") {
        setError(e.error === "not-allowed" ? "Microphone access was blocked." : `Voice input error: ${e.error}`);
      }
    };
    rec.onend = () => {
      setListening(false);
      setInterim("");
    };
    recRef.current = rec;
    setError(null);
    setListening(true);
    try {
      rec.start();
    } catch {
      setListening(false);
    }
  }, [opts.continuous]);

  useEffect(() => () => recRef.current?.abort(), []);

  return { listening, interim, error, start, stop, supported: speechRecognitionSupported() };
}

/** Best available English voice: neural/natural voices first, then well-known clear voices. */
function pickVoice(): SpeechSynthesisVoice | undefined {
  const voices = speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith("en"));
  const rank = (v: SpeechSynthesisVoice) => {
    if (/natural|neural|premium|enhanced/i.test(v.name)) return 0;
    if (/Google US English|Microsoft (Aria|Jenny|Ava|Emma)/i.test(v.name)) return 1;
    if (/Samantha|Ava|Allison|Susan|Zoe/i.test(v.name)) return 2;
    if (v.lang === "en-US") return 3;
    return 4;
  };
  return voices.sort((a, b) => rank(a) - rank(b))[0];
}

/** Makes text sound natural when read aloud (no symbols, brackets or markdown). */
export function speakable(text: string): string {
  return text
    .replace(/\[[^\]]*\]/g, "")
    .replace(/[*_#`>]/g, "")
    .replace(/\s—\s|\s-\s/g, ", ")
    .replace(/\/100\b/g, " out of 100")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Speaks text with the browser's speech synthesis, preferring a natural English voice. */
export function speak(text: string, opts: { onEnd?: () => void; rate?: number } = {}): void {
  if (typeof speechSynthesis === "undefined") {
    opts.onEnd?.();
    return;
  }
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(speakable(text));
  const voice = pickVoice();
  if (voice) u.voice = voice;
  u.rate = opts.rate ?? 1;
  u.pitch = 1;
  u.onend = () => opts.onEnd?.();
  u.onerror = () => opts.onEnd?.();
  speechSynthesis.speak(u);
}

// Voices load asynchronously in Chrome; warm the list so the first reply uses the best voice.
if (typeof speechSynthesis !== "undefined") speechSynthesis.getVoices();

export function stopSpeaking(): void {
  if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
}
