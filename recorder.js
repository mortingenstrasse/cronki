// ============================================================
// recorder.js — Sampler tab (mic recording + chop marking)
//               AudioTrack instrument recording
// ============================================================

// ---- SAMPLER ----
let samplerMediaRecorder = null;
let samplerAudioChunks   = [];
let samplerStream        = null;
let samplerAnalyser      = null;
let samplerAnimationId   = null;

function getActiveSamplerInst() {
    const seq = state.sequences[state.currentSequence];
    return seq.instruments.find(i => i.id === state.activeInstrumentId && i.type === 'sampler')
        || seq.instruments.find(i => i.type === 'sampler');
}

async function toggleSamplerRec() {
    initAudio();
    if (state.sampler.isRecording) {
        stopSamplerRecording();
    } else {
        const inst = getActiveSamplerInst();
        if (!inst) { alert('No sampler instrument selected. Add a SAMPLER instrument in the Sequence tab first.'); return; }
        await startSamplerRecording(inst);
    }
}

async function startSamplerRecording(inst) {
    try {
        samplerStream         = await navigator.mediaDevices.getUserMedia({ audio: true });
        samplerMediaRecorder  = new MediaRecorder(samplerStream);
        samplerAudioChunks    = [];

        samplerMediaRecorder.ondataavailable = e => { if (e.data.size > 0) samplerAudioChunks.push(e.data); };
        samplerMediaRecorder.onstop = async () => {
            const blob = new Blob(samplerAudioChunks, { type: 'audio/webm' });
            inst.recordedBuffer = await audioCtx.decodeAudioData(await blob.arrayBuffer());
            inst.chops = inst.chops || [];
            drawWaveform();
            updateSamplerLCD('RECORDING FINISHED');
        };

        samplerMediaRecorder.start();
        state.sampler.isRecording      = true;
        state.sampler.currentInstId    = inst.id;
        state.sampler.recordingStartTime = audioCtx.currentTime;
        inst.chops = [];

        document.getElementById('sampler-rec-btn').classList.add('recording');
        document.getElementById('sampler-vinyl').classList.add('rotating');
        updateSamplerLCD('RECORDING...');

        // VU meter
        const src = audioCtx.createMediaStreamSource(samplerStream);
        samplerAnalyser = audioCtx.createAnalyser(); samplerAnalyser.fftSize = 256;
        src.connect(samplerAnalyser);
        updateSamplerVU();

        setTimeout(() => { if (state.sampler.isRecording) stopSamplerRecording(); }, 30000);
    } catch(err) {
        console.error('Microphone error:', err);
        alert('Could not access microphone.');
    }
}

function stopSamplerRecording() {
    if (!samplerMediaRecorder || !state.sampler.isRecording) return;
    samplerMediaRecorder.stop();
    samplerStream.getTracks().forEach(t => t.stop());
    state.sampler.isRecording = false;
    document.getElementById('sampler-rec-btn').classList.remove('recording');
    document.getElementById('sampler-vinyl').classList.remove('rotating');
    cancelAnimationFrame(samplerAnimationId);
    document.getElementById('sampler-vu-bar').style.height = '0%';
}

function updateSamplerVU() {
    if (!state.sampler.isRecording) return;
    const data = new Uint8Array(samplerAnalyser.frequencyBinCount);
    samplerAnalyser.getByteFrequencyData(data);
    const avg = data.reduce((a,b) => a+b) / data.length;
    document.getElementById('sampler-vu-bar').style.height = Math.min(100,(avg/128)*100) + '%';
    samplerAnimationId = requestAnimationFrame(updateSamplerVU);
}

function updateSamplerLCD(text) {
    document.getElementById('sampler-lcd').textContent = text;
}

function renderSamplerPads() {
    const grid = document.getElementById('sampler-pad-grid');
    grid.innerHTML = '';
    const inst = getActiveSamplerInst();
    for (let i = 0; i < 16; i++) {
        const pad = document.createElement('div');
        pad.className = 'pad';
        if (inst && inst.chops && inst.chops.find(c => c.pad === i)) pad.classList.add('has-sample');
        pad.dataset.pad = i;
        pad.textContent = 'PAD ' + (i + 1);
        pad.onmousedown  = () => startChop(i);
        pad.onmouseup    = () => endChop(i);
        pad.ontouchstart = e => { e.preventDefault(); startChop(i); };
        pad.ontouchend   = e => { e.preventDefault(); endChop(i); };
        grid.appendChild(pad);
    }
}

function startChop(padIndex) {
    const inst = getActiveSamplerInst();
    if (!state.sampler.isRecording) { if (inst) playChopFromInst(inst, padIndex); return; }
    state.sampler.activeChop = { pad: padIndex, start: audioCtx.currentTime - state.sampler.recordingStartTime };
    document.querySelector(`#sampler-pad-grid .pad[data-pad="${padIndex}"]`).classList.add('chopping');
}

function endChop(padIndex) {
    if (!state.sampler.isRecording || !state.sampler.activeChop || state.sampler.activeChop.pad !== padIndex) return;
    const inst = getActiveSamplerInst(); if (!inst) return;
    const endTime = audioCtx.currentTime - state.sampler.recordingStartTime;
    inst.chops = (inst.chops || []).filter(c => c.pad !== padIndex);
    inst.chops.push({ pad: padIndex, start: state.sampler.activeChop.start, end: endTime });
    state.sampler.activeChop = null;
    const pad = document.querySelector(`#sampler-pad-grid .pad[data-pad="${padIndex}"]`);
    pad.classList.remove('chopping'); pad.classList.add('has-sample');
    drawWaveform();
}

// ---- Sampler + AudioTrack playback (shared) ----
function playChopFromInst(inst, padIndex, tuning = 0, destination = null) {
    if (!inst || !inst.recordedBuffer) return;
    const chop = (inst.chops || []).find(c => c.pad === padIndex); if (!chop) return;
    const src  = audioCtx.createBufferSource();
    src.buffer = inst.recordedBuffer;
    src.playbackRate.value = Math.pow(2, (tuning || 0) / 12);
    src.connect(destination || (inst.eqNodes ? inst.eqNodes.low : masterGain));
    src.start(0, chop.start, chop.end - chop.start);
}

function playAudioTrackBuffer(inst, destination = null) {
    if (!inst || !inst.recordedBuffer) return;
    const src = audioCtx.createBufferSource();
    src.buffer = inst.recordedBuffer;
    src.connect(destination || (inst.eqNodes ? inst.eqNodes.low : masterGain));
    src.start(0);
}

// ---- Sampler waveform canvas ----
function drawWaveform() {
    const canvas = document.getElementById('sampler-waveform');
    const ctx2   = canvas.getContext('2d');
    const W = canvas.width  = canvas.offsetWidth;
    const H = canvas.height = canvas.offsetHeight;
    ctx2.fillStyle = '#222'; ctx2.fillRect(0, 0, W, H);

    const inst = getActiveSamplerInst();
    if (!inst || !inst.recordedBuffer) return;
    const data = inst.recordedBuffer.getChannelData(0);
    const step = Math.ceil(data.length / W), amp = H / 2;

    ctx2.strokeStyle = varColor('--orange');
    ctx2.beginPath(); ctx2.moveTo(0, amp);
    for (let i = 0; i < W; i++) {
        let mn = 1, mx = -1;
        for (let j = 0; j < step; j++) { const v = data[i*step+j]; if(v<mn)mn=v; if(v>mx)mx=v; }
        ctx2.lineTo(i, (1+mn)*amp); ctx2.lineTo(i, (1+mx)*amp);
    }
    ctx2.stroke();

    (inst.chops || []).forEach(c => {
        const x1 = (c.start / inst.recordedBuffer.duration) * W;
        const x2 = (c.end   / inst.recordedBuffer.duration) * W;
        ctx2.fillStyle = 'rgba(242,92,25,0.3)'; ctx2.fillRect(x1, 0, x2-x1, H);
        ctx2.strokeStyle = '#fff'; ctx2.strokeRect(x1, 0, x2-x1, H);
        ctx2.fillStyle = '#fff'; ctx2.font = '10px monospace';
        ctx2.fillText(c.pad+1, x1+2, 12);
    });
}

// ---- AUDIO TRACK ----
let audioTrackMediaRecorder  = null;
let audioTrackChunks         = [];
let audioTrackStream         = null;
let audioTrackAnalyser       = null;
let audioTrackAnimId         = null;
let audioTrackCurrentInstId  = null;

function addAudioTrack() {
    closeModal('add-instrument-modal');
    initAudio();
    const seq = state.sequences[state.currentSequence];
    const id  = ++instrumentIdCounter;
    const instrument = {
        id, type: 'audiotrack', name: `AUDIO ${id}`,
        muted: false, solo: false,
        eq: { low:0, mid:0, high:0, volume:80 },
        gainNode: null, eqNodes: null,
        recordedBuffer: null, audioBlob: null
    };
    if (audioCtx) setupInstrumentAudio(instrument);
    seq.instruments.push(instrument);
    seq.notes[id] = [{ beat: 0, pad: 0 }];
    state.activeInstrumentId = id;
    renderInstruments(); renderPads();
    openAudioTrackModal(id);
}

function openAudioTrackModal(instId) {
    const seq  = state.sequences[state.currentSequence];
    const inst = seq.instruments.find(i => i.id === instId); if (!inst) return;
    audioTrackCurrentInstId = instId;
    document.getElementById('audiotrack-modal-name').textContent = inst.name;
    document.getElementById('audiotrack-status').textContent = inst.recordedBuffer ? 'Recording ready. Re-record or play.' : 'Ready to record';
    document.getElementById('audiotrack-rec-btn').textContent = '⏺ RECORD';
    document.getElementById('audiotrack-rec-btn').classList.remove('recording');
    document.getElementById('audiotrack-play-btn').disabled = !inst.recordedBuffer;
    drawAudioTrackWaveform(inst);
    document.getElementById('audiotrack-modal').classList.add('active');
}

async function toggleAudioTrackRecord() {
    if (audioTrackMediaRecorder && audioTrackMediaRecorder.state === 'recording') stopAudioTrackRecord();
    else await startAudioTrackRecord();
}

async function startAudioTrackRecord() {
    initAudio();
    try {
        audioTrackStream        = await navigator.mediaDevices.getUserMedia({ audio: true });
        audioTrackMediaRecorder = new MediaRecorder(audioTrackStream);
        audioTrackChunks = [];
        audioTrackMediaRecorder.ondataavailable = e => { if (e.data.size > 0) audioTrackChunks.push(e.data); };
        audioTrackMediaRecorder.onstop = async () => {
            const seq  = state.sequences[state.currentSequence];
            const inst = seq.instruments.find(i => i.id === audioTrackCurrentInstId); if (!inst) return;
            const blob = new Blob(audioTrackChunks, { type: 'audio/webm' });
            inst.audioBlob      = blob;
            inst.recordedBuffer = await audioCtx.decodeAudioData(await blob.arrayBuffer());
            document.getElementById('audiotrack-status').textContent = 'Recording done!';
            document.getElementById('audiotrack-play-btn').disabled = false;
            drawAudioTrackWaveform(inst);
            renderPads(); renderNotesOnPianoRoll();
        };
        audioTrackMediaRecorder.start();
        document.getElementById('audiotrack-rec-btn').textContent = '⏹ STOP';
        document.getElementById('audiotrack-rec-btn').classList.add('recording');
        document.getElementById('audiotrack-status').textContent = 'Recording...';
        const src = audioCtx.createMediaStreamSource(audioTrackStream);
        audioTrackAnalyser = audioCtx.createAnalyser(); audioTrackAnalyser.fftSize = 256;
        src.connect(audioTrackAnalyser); updateAudioTrackVU();
        setTimeout(() => { if (audioTrackMediaRecorder && audioTrackMediaRecorder.state === 'recording') stopAudioTrackRecord(); }, 60000);
    } catch(err) { alert('Could not access microphone.'); }
}

function stopAudioTrackRecord() {
    if (!audioTrackMediaRecorder || audioTrackMediaRecorder.state !== 'recording') return;
    audioTrackMediaRecorder.stop();
    audioTrackStream.getTracks().forEach(t => t.stop());
    cancelAnimationFrame(audioTrackAnimId);
    document.getElementById('audiotrack-vu-bar').style.width  = '0%';
    document.getElementById('audiotrack-rec-btn').textContent = '⏺ RECORD';
    document.getElementById('audiotrack-rec-btn').classList.remove('recording');
}

function updateAudioTrackVU() {
    if (!audioTrackAnalyser) return;
    const data = new Uint8Array(audioTrackAnalyser.frequencyBinCount);
    audioTrackAnalyser.getByteFrequencyData(data);
    const avg = data.reduce((a,b)=>a+b) / data.length;
    document.getElementById('audiotrack-vu-bar').style.width = Math.min(100,(avg/128)*100) + '%';
    if (audioTrackMediaRecorder && audioTrackMediaRecorder.state === 'recording')
        audioTrackAnimId = requestAnimationFrame(updateAudioTrackVU);
}

function playAudioTrackPreview() {
    const seq  = state.sequences[state.currentSequence];
    const inst = seq.instruments.find(i => i.id === audioTrackCurrentInstId);
    if (!inst || !inst.recordedBuffer) return;
    initAudio(); playAudioTrackBuffer(inst);
}

function drawAudioTrackWaveform(inst) {
    const canvas = document.getElementById('audiotrack-waveform'); if (!canvas) return;
    const ctx2   = canvas.getContext('2d');
    const W = canvas.width  = canvas.offsetWidth || 300;
    const H = canvas.height = 60;
    ctx2.fillStyle = '#111'; ctx2.fillRect(0, 0, W, H);
    if (!inst || !inst.recordedBuffer) return;
    const data = inst.recordedBuffer.getChannelData(0);
    const step = Math.ceil(data.length / W), amp = H / 2;
    ctx2.strokeStyle = '#4fc'; ctx2.lineWidth = 1;
    ctx2.beginPath(); ctx2.moveTo(0, amp);
    for (let i = 0; i < W; i++) {
        let mn = 1, mx = -1;
        for (let j = 0; j < step; j++) { const v = data[i*step+j]||0; if(v<mn)mn=v; if(v>mx)mx=v; }
        ctx2.lineTo(i, (1+mn)*amp); ctx2.lineTo(i, (1+mx)*amp);
    }
    ctx2.stroke();
}
