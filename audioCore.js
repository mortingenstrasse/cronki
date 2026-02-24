// ============================================================
// audioCore.js — Audio context, master chain, reverb,
//                vinyl FX, VU meter, WAV encoder
// ============================================================

let audioCtx    = null;
let masterGain  = null;
let masterAnalyser = null;
let masterFilter   = null;
let masterReverb   = null;
let masterDry   = null;
let masterWet   = null;

function createReverbBuffer(ctx, seconds = 2.5, decay = 2.0) {
    const rate   = ctx.sampleRate;
    const length = rate * seconds;
    const impulse = ctx.createBuffer(2, length, rate);
    for (let c = 0; c < 2; c++) {
        const ch = impulse.getChannelData(c);
        for (let i = 0; i < length; i++)
            ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
    return impulse;
}

function initAudio() {
    if (audioCtx) return;
    audioCtx    = new (window.AudioContext || window.webkitAudioContext)();
    masterGain  = audioCtx.createGain();
    masterGain.gain.value = 0.8;

    masterFilter = audioCtx.createBiquadFilter();
    masterFilter.type = 'lowpass';
    masterFilter.frequency.value = 20000;
    masterFilter.Q.value = 1;

    masterReverb = audioCtx.createConvolver();
    masterReverb.buffer = createReverbBuffer(audioCtx);
    masterDry = audioCtx.createGain(); masterDry.gain.value = 1;
    masterWet = audioCtx.createGain(); masterWet.gain.value = 0;

    masterAnalyser = audioCtx.createAnalyser();
    masterAnalyser.fftSize = 256;

    masterGain.connect(masterFilter);
    masterFilter.connect(masterDry);
    masterFilter.connect(masterReverb);
    masterReverb.connect(masterWet);
    masterDry.connect(masterAnalyser);
    masterWet.connect(masterAnalyser);
    masterAnalyser.connect(audioCtx.destination);
}

// Per-instrument gain + 3-band EQ chain
function setupInstrumentAudio(inst) {
    if (!audioCtx) return;
    inst.gainNode = audioCtx.createGain();
    inst.gainNode.gain.value = inst.eq.volume / 100;
    inst.eqNodes = {
        low:  audioCtx.createBiquadFilter(),
        mid:  audioCtx.createBiquadFilter(),
        high: audioCtx.createBiquadFilter()
    };
    inst.eqNodes.low.type  = 'lowshelf';  inst.eqNodes.low.frequency.value  = 320;  inst.eqNodes.low.gain.value  = inst.eq.low;
    inst.eqNodes.mid.type  = 'peaking';   inst.eqNodes.mid.frequency.value  = 1000; inst.eqNodes.mid.Q.value = 0.5; inst.eqNodes.mid.gain.value  = inst.eq.mid;
    inst.eqNodes.high.type = 'highshelf'; inst.eqNodes.high.frequency.value = 3200; inst.eqNodes.high.gain.value = inst.eq.high;
    inst.eqNodes.low.connect(inst.eqNodes.mid);
    inst.eqNodes.mid.connect(inst.eqNodes.high);
    inst.eqNodes.high.connect(inst.gainNode);
    inst.gainNode.connect(masterGain);
}

// ---- Vinyl FX (lo-fi tape noise) ----
let vinylAudio = null, vinylGainNode = null, vinylConnected = false;

function initVinylFX() {
    if (vinylConnected) return;
    vinylAudio = new Audio(VINYL_FX_DATA);
    vinylAudio.loop = true;
    vinylAudio.volume = 0.18;
    try {
        const src = audioCtx.createMediaElementSource(vinylAudio);
        vinylGainNode = audioCtx.createGain();
        vinylGainNode.gain.value = 0.55;
        src.connect(vinylGainNode);
        vinylGainNode.connect(masterGain);
        vinylConnected = true;
    } catch(e) { console.warn('Vinyl FX connect error:', e); }
}
function startVinylFX() {
    if (!audioCtx) return;
    if (!vinylConnected) initVinylFX();
    if (vinylAudio && vinylAudio.paused) vinylAudio.play().catch(() => {});
}
function stopVinylFX() {
    if (vinylAudio && !vinylAudio.paused) { vinylAudio.pause(); vinylAudio.currentTime = 0; }
}

// ---- VU Meter (tape view) ----
let vuAnimationFrame = null;
function startVUMeter() {
    if (!masterAnalyser) return;
    const data = new Uint8Array(masterAnalyser.frequencyBinCount);
    function frame() {
        if (!state.tapePlaying && !state.tapeRecording) return;
        masterAnalyser.getByteFrequencyData(data);
        let sum = 0; for (let i = 0; i < data.length; i++) sum += data[i];
        const level = Math.min(40, (sum / data.length / 255) * 50);
        document.getElementById('vu-left').style.height  = level + 'px';
        document.getElementById('vu-right').style.height = (level * 0.9 + Math.random() * 5) + 'px';
        vuAnimationFrame = requestAnimationFrame(frame);
    }
    frame();
}
function stopVUMeter() {
    if (vuAnimationFrame) { cancelAnimationFrame(vuAnimationFrame); vuAnimationFrame = null; }
    document.getElementById('vu-left').style.height  = '5px';
    document.getElementById('vu-right').style.height = '5px';
}

// ---- WAV encoder (webm blob → WAV blob) ----
async function convertToWav(webmBlob) {
    const decoded = await audioCtx.decodeAudioData(await webmBlob.arrayBuffer());
    return audioBufToWavBlob(decoded);
}
function audioBufToWavBlob(buf) {
    const numCh = buf.numberOfChannels, sr = buf.sampleRate, len = buf.length, bps = 2;
    const interleaved = new Int16Array(len * numCh);
    for (let ch = 0; ch < numCh; ch++) {
        const d = buf.getChannelData(ch);
        for (let i = 0; i < len; i++) {
            const s = Math.max(-1, Math.min(1, d[i]));
            interleaved[i * numCh + ch] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
    }
    const dataSize = interleaved.byteLength;
    const out  = new ArrayBuffer(44 + dataSize);
    const view = new DataView(out);
    function ws(o, s) { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); }
    ws(0,'RIFF'); view.setUint32(4, 36+dataSize, true); ws(8,'WAVE');
    ws(12,'fmt '); view.setUint32(16,16,true); view.setUint16(20,1,true);
    view.setUint16(22,numCh,true); view.setUint32(24,sr,true);
    view.setUint32(28,sr*numCh*bps,true); view.setUint16(32,numCh*bps,true);
    view.setUint16(34,16,true); ws(36,'data'); view.setUint32(40,dataSize,true);
    new Int16Array(out, 44).set(interleaved);
    return new Blob([out], { type: 'audio/wav' });
}

// ---- Helpers ----
function varColor(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
function writeString(view, offset, str) {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
}
