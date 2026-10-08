export type OrbState = "idle" | "listening" | "thinking" | "speaking";

const LABEL: Record<OrbState, string> = {
  idle: "Tap to talk",
  listening: "Listening…",
  thinking: "Thinking…",
  speaking: "Speaking… tap to stop",
};

/** Alexa-style light ring: cyan/blue while active, calm when idle. */
export function VoiceOrb({ state, size = 56, onClick, disabled }: { state: OrbState; size?: number; onClick?: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={LABEL[state]}
      title={LABEL[state]}
      className={`orb orb-${state} relative grid shrink-0 place-items-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-50`}
      style={{ width: size, height: size }}
    >
      <span className="orb-ring absolute inset-0 rounded-full" />
      <span className="orb-core absolute rounded-full" style={{ inset: size * 0.12 }} />
      <svg viewBox="0 0 24 24" className="relative h-[38%] w-[38%] text-white" fill="currentColor" aria-hidden>
        {state === "speaking" ? (
          <rect x="7" y="7" width="10" height="10" rx="2" />
        ) : (
          <path d="M12 15a3 3 0 003-3V6a3 3 0 10-6 0v6a3 3 0 003 3zm5-3a5 5 0 01-10 0H5a7 7 0 006 6.92V21h2v-2.08A7 7 0 0019 12h-2z" />
        )}
      </svg>
    </button>
  );
}

export function orbLabel(state: OrbState): string {
  return LABEL[state];
}
