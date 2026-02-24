// ============================================================
// script.js — Global state, app bootstrap
// All logic is split across:
//   audioCore.js   — AudioContext, master chain, VU, WAV encoder, VinylFX
//   synthEngine.js — Drums, Synth (sawtooth), Lo-Fi synth
//   recorder.js    — Sampler recording + chop logic, AudioTrack recording
//   transport.js   — Play/Rec/Stop, sequencer loop, tape, song, MIDI
//   ui.js          — All render/UI functions, save/load, library, toast
// ============================================================

// ---- Global state ----
let state = {
    currentSequence: 0,
    sequences: [{
        name: 'SEQ 01',
        length: 4,
        instruments: [],
        notes: {}
    }],
    activeInstrumentId: null,
    isPlaying: false,
    isRecording: false,
    currentBeat: 0,
    bpm: 120,
    bpmActive: false,

    // Song arrangement (array of sequence indexes)
    songArrangement: [],

    // Tape recorder
    tapeRecording: false,
    tapePlaying: false,
    recordedBlob: null,

    // Sampler recording state (buffer + chops live on the instrument object itself)
    sampler: {
        isRecording: false,
        recordingStartTime: 0,
        activeChop: null,
        currentInstId: null
    }
};

// Monotonically increasing ID for every new instrument
let instrumentIdCounter = 0;

// ---- BPM input listener ----
window.addEventListener('DOMContentLoaded', () => {
    const bpmInput = document.getElementById('bpm-input');
    if (bpmInput) {
        bpmInput.addEventListener('change', e => {
            state.bpm = parseInt(e.target.value) || 120;
            if (state.isPlaying) { stopPlayback(); startPlayback(); }
        });
    }

    // XY pad and first-touch audio init
    initXYPad();
    document.addEventListener('click',      () => initAudio(), { once: true });
    document.addEventListener('touchstart', () => initAudio(), { once: true });

    // Boot the UI
    init();
});
