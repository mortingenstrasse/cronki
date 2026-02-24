// ============================================================
// synthEngine.js — Synthesized instrument voices:
//   • Drum synthesizer
//   • SYNTH — bright sawtooth poly synth (full MIDI range)
//   • LO-FI SYNTH — warm, dusty, detuned square+triangle
// ============================================================

// ---- DRUM SOUNDS (all synthesized via Web Audio) ----
const drumSounds = {
    kick: (ctx, dest) => {
        const osc = ctx.createOscillator(), g = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(150, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
        g.gain.setValueAtTime(1, ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
        osc.connect(g); g.connect(dest);
        osc.start(); osc.stop(ctx.currentTime + 0.5);
    },
    snare: (ctx, dest) => {
        // noise burst
        const bufSize = ctx.sampleRate * 0.2;
        const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < bufSize; i++) d[i] = Math.random() * 2 - 1;
        const noise = ctx.createBufferSource(); noise.buffer = buf;
        const ng = ctx.createGain();
        ng.gain.setValueAtTime(0.5, ctx.currentTime);
        ng.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);
        noise.connect(ng); ng.connect(dest); noise.start();
        // body
        const osc = ctx.createOscillator(), og = ctx.createGain();
        osc.type = 'triangle'; osc.frequency.value = 180;
        og.gain.setValueAtTime(0.7, ctx.currentTime);
        og.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);
        osc.connect(og); og.connect(dest);
        osc.start(); osc.stop(ctx.currentTime + 0.2);
    },
    hihat: (ctx, dest) => {
        const bufSize = ctx.sampleRate * 0.1;
        const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < bufSize; i++) d[i] = Math.random() * 2 - 1;
        const noise = ctx.createBufferSource(); noise.buffer = buf;
        const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7000;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.3, ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);
        noise.connect(f); f.connect(g); g.connect(dest); noise.start();
    },
    clap: (ctx, dest) => {
        const bufSize = ctx.sampleRate * 0.15;
        const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < bufSize; i++) d[i] = Math.random() * 2 - 1;
        const noise = ctx.createBufferSource(); noise.buffer = buf;
        const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1200;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.5, ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);
        noise.connect(f); f.connect(g); g.connect(dest); noise.start();
    },
    tom1: (ctx, dest) => {
        const osc = ctx.createOscillator(), g = ctx.createGain(); osc.type = 'sine';
        osc.frequency.setValueAtTime(200, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(80, ctx.currentTime + 0.3);
        g.gain.setValueAtTime(0.7, ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
        osc.connect(g); g.connect(dest); osc.start(); osc.stop(ctx.currentTime + 0.3);
    },
    tom2: (ctx, dest) => {
        const osc = ctx.createOscillator(), g = ctx.createGain(); osc.type = 'sine';
        osc.frequency.setValueAtTime(150, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(60, ctx.currentTime + 0.35);
        g.gain.setValueAtTime(0.7, ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.35);
        osc.connect(g); g.connect(dest); osc.start(); osc.stop(ctx.currentTime + 0.35);
    },
    rim: (ctx, dest) => {
        const osc = ctx.createOscillator(), g = ctx.createGain();
        osc.type = 'square'; osc.frequency.value = 1800;
        g.gain.setValueAtTime(0.3, ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.05);
        osc.connect(g); g.connect(dest); osc.start(); osc.stop(ctx.currentTime + 0.05);
    },
    crash: (ctx, dest) => {
        const bufSize = ctx.sampleRate * 0.8;
        const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < bufSize; i++) d[i] = Math.random() * 2 - 1;
        const noise = ctx.createBufferSource(); noise.buffer = buf;
        const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 5000;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.4, ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.8);
        noise.connect(f); f.connect(g); g.connect(dest); noise.start();
    }
};

const drumPadMap = ['kick','snare','hihat','clap','tom1','tom2','rim','crash',
                    'kick','snare','hihat','clap','tom1','tom2','rim','crash'];

// ---- SYNTH (bright sawtooth, full MIDI range) ----
// padIndex-based (for non-MIDI playback)
const keyNotes = [261.63,293.66,329.63,349.23,392.00,440.00,493.88,523.25,
                  587.33,659.25,698.46,783.99,880.00,987.77,1046.50,1174.66];

function playKeyNote(ctx, dest, noteIndex) {
    playKeyNoteByMidi(ctx, dest, noteIndex - 9);
}

function playKeyNoteByMidi(ctx, dest, semiOffset) {
    const freq = 261.63 * Math.pow(2, semiOffset / 12);
    const now  = ctx.currentTime;
    const osc  = ctx.createOscillator();
    const filt = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.value = freq;
    filt.type = 'lowpass';
    filt.frequency.setValueAtTime(2000, now);
    filt.frequency.exponentialRampToValueAtTime(500, now + 0.5);
    gain.gain.setValueAtTime(0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.5);
    osc.connect(filt); filt.connect(gain); gain.connect(dest);
    osc.start(now); osc.stop(now + 0.5);
}

// ---- LO-FI SYNTH ----
// Warm, dusty tone: detuned square+triangle, tape-wow LFO,
// bit-crush waveshaper, heavy lowpass rolloff.
// Same MIDI-range recording as SYNTH.
function playLofiNoteByMidi(ctx, dest, semiOffset) {
    const freq = 261.63 * Math.pow(2, semiOffset / 12);
    const now  = ctx.currentTime;

    // Two detuned oscillators for warmth/thickness
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    osc1.type = 'square';   osc1.frequency.value = freq * 0.998;
    osc2.type = 'triangle'; osc2.frequency.value = freq * 1.006;

    // Tape wow: slow LFO modulating pitch gently
    const lfo    = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.type = 'sine'; lfo.frequency.value = 3.2;
    lfoGain.gain.value = freq * 0.003;
    lfo.connect(lfoGain);
    lfoGain.connect(osc1.frequency);
    lfoGain.connect(osc2.frequency);
    lfo.start(now); lfo.stop(now + 1.1);

    // Mix both oscs
    const mix = ctx.createGain(); mix.gain.value = 0.5;
    osc1.connect(mix); osc2.connect(mix);

    // Bit-crush waveshaper (low bit-depth texture)
    const crusher = ctx.createWaveShaper();
    crusher.curve = makeLofiCrushCurve(28);

    // Heavy warm lowpass (lo-fi rolls off highs hard)
    const lpf = ctx.createBiquadFilter();
    lpf.type = 'lowpass';
    lpf.frequency.setValueAtTime(900, now);
    lpf.frequency.exponentialRampToValueAtTime(380, now + 0.7);
    lpf.Q.value = 0.9;

    // Remove mud
    const hpf = ctx.createBiquadFilter();
    hpf.type = 'highpass'; hpf.frequency.value = 55;

    // ADSR envelope — slow attack, long warm release
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(0.26, now + 0.02);   // attack
    env.gain.linearRampToValueAtTime(0.18, now + 0.12);   // decay
    env.gain.exponentialRampToValueAtTime(0.001, now + 1.0); // release

    // Chain: mix → crusher → hpf → lpf → env → dest
    mix.connect(crusher); crusher.connect(hpf); hpf.connect(lpf); lpf.connect(env); env.connect(dest);

    osc1.start(now); osc1.stop(now + 1.1);
    osc2.start(now); osc2.stop(now + 1.1);
}

function makeLofiCrushCurve(bits) {
    const steps = Math.pow(2, bits);
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
        const x = (i / 128) - 1;
        curve[i] = Math.round(x * steps) / steps;
    }
    return curve;
}

function playLofiNote(ctx, dest, noteIndex) {
    playLofiNoteByMidi(ctx, dest, noteIndex - 9);
}
