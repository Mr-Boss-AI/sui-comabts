type SoundName =
  | "hit"
  | "crit"
  | "block"
  | "dodge"
  | "victory"
  | "defeat"
  | "turn_start"
  | "equip"
  | "unequip"
  | "purchase"
  | "level_up"
  | "chat"
  | "challenge"
  | "countdown";

const FREQUENCIES: Record<SoundName, [number, number, string]> = {
  // [frequency, duration_ms, type]
  hit: [220, 100, "square"],
  crit: [440, 200, "sawtooth"],
  block: [150, 80, "triangle"],
  dodge: [600, 120, "sine"],
  victory: [523, 400, "sine"],
  defeat: [130, 600, "sawtooth"],
  turn_start: [880, 60, "sine"],
  equip: [400, 100, "triangle"],
  unequip: [300, 80, "triangle"],
  purchase: [660, 150, "sine"],
  level_up: [523, 300, "sine"],
  chat: [1000, 40, "sine"],
  challenge: [440, 200, "square"],
  countdown: [800, 80, "sine"],
};

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!audioCtx) {
    audioCtx = new AudioContext();
  }
  return audioCtx;
}

export function playSound(name: SoundName) {
  try {
    const ctx = getAudioContext();
    const [freq, duration, type] = FREQUENCIES[name];
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = type as OscillatorType;
    osc.frequency.value = freq;
    gain.gain.value = 0.15;
    gain.gain.exponentialRampToValueAtTime(
      0.001,
      ctx.currentTime + duration / 1000
    );

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration / 1000);

    // Victory gets a second note
    if (name === "victory") {
      setTimeout(() => {
        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.type = "sine";
        osc2.frequency.value = 659;
        gain2.gain.value = 0.15;
        gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
        osc2.connect(gain2);
        gain2.connect(ctx.destination);
        osc2.start();
        osc2.stop(ctx.currentTime + 0.5);
      }, 200);
    }
  } catch {
    // Audio not available
  }
}

let soundEnabled = true;

export function toggleSound(): boolean {
  soundEnabled = !soundEnabled;
  return soundEnabled;
}

export function isSoundEnabled(): boolean {
  return soundEnabled;
}

export function playSoundIf(name: SoundName) {
  if (soundEnabled) playSound(name);
}
