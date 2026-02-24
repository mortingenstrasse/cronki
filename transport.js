// ============================================================
// transport.js — Sequencer transport (play/rec/stop/BPM),
//                Song tab, Tape export, MIDI input
// ============================================================

let playInterval    = null;
let metronomeOsc    = null;
let countdownTimeout = null;

// ---- Sequence transport ----
function toggleRec() {
    if (state.isRecording) {
        state.isRecording = false;
        document.querySelector('.btn-rec').classList.remove('recording');
        clearCountdown(); updateLCD();
    } else {
        startCountdownThenRecord();
    }
}

function clearCountdown() {
    if (countdownTimeout) { clearTimeout(countdownTimeout); countdownTimeout = null; }
    const el = document.getElementById('countdown-display');
    if (el) el.textContent = '';
}

function startCountdownThenRecord() {
    const el      = document.getElementById('countdown-display');
    const beatMs  = 60000 / state.bpm;
    const steps   = ['4','3','2','1','GO'];
    let i = 0;
    function tick() {
        if (i < steps.length) {
            if (el) { el.textContent = steps[i]; el.classList.toggle('go', steps[i] === 'GO'); }
            playMetronomeClick(); i++;
            countdownTimeout = setTimeout(tick, beatMs);
        } else {
            if (el) { el.textContent = '●'; el.classList.remove('go'); }
            state.isRecording = true;
            document.querySelector('.btn-rec').classList.add('recording');
            if (!state.isPlaying) startPlayback();
            updateLCD();
            countdownTimeout = setTimeout(() => { if (el && el.textContent === '●') el.textContent = ''; }, 500);
        }
    }
    tick();
}

function togglePlay() { state.isPlaying ? stopPlayback() : startPlayback(); }

function startPlayback() {
    initAudio();
    state.isPlaying   = true;
    state.currentBeat = 0;
    document.querySelector('.btn-play').classList.add('playing');

    const seq         = state.sequences[state.currentSequence];
    const totalBeats  = seq.length * 4;
    const beatDuration = 60000 / state.bpm / 4;

    playInterval = setInterval(() => {
        highlightBeat(state.currentBeat);
        if (state.bpmActive && state.currentBeat % 4 === 0) playMetronomeClick();

        seq.instruments.forEach(inst => {
            if (inst.muted) return;
            const hasSolo = seq.instruments.some(i => i.solo);
            if (hasSolo && !inst.solo) return;
            (seq.notes[inst.id] || [])
                .filter(n => n.beat === state.currentBeat && !n._justRecorded)
                .forEach(n => playNoteForInstrument(inst, n.pad));
        });

        state.currentBeat = (state.currentBeat + 1) % totalBeats;
        updateLCD();
    }, beatDuration);
    updateLCD();
}

function stopPlayback() {
    state.isPlaying   = false;
    state.currentBeat = 0;
    if (playInterval) { clearInterval(playInterval); playInterval = null; }
    document.querySelector('.btn-play').classList.remove('playing');
    highlightBeat(-1); updateLCD();
}

function playNoteForInstrument(inst, padIndex) {
    if (!audioCtx || !inst.eqNodes) return;
    const dest = inst.eqNodes.low;
    if (inst.type === 'drums') {
        const snd = drumSounds[drumPadMap[padIndex]];
        if (snd) snd(audioCtx, dest); else playMetronomeClick();
    } else if (inst.type === 'sampler') {
        playChopFromInst(inst, padIndex, inst.tuning || 0, dest);
    } else if (inst.type === 'audiotrack') {
        playAudioTrackBuffer(inst, dest);
    } else if (inst.type === 'library') {
        playLibrarySample(inst, padIndex);
    } else {
        // keys or lofi — decode stored pad index back to semiOffset
        let semi;
        if (padIndex >= 1000)      semi = (padIndex - 1000) - 60;
        else if (padIndex >= 100)  semi = (Math.floor(padIndex/100)-4)*12 + PAD_SEMITONE[padIndex%100];
        else                       semi = PAD_SEMITONE[padIndex];
        if (inst.type === 'lofi')  playLofiNoteByMidi(audioCtx, dest, semi);
        else                       playKeyNoteByMidi(audioCtx, dest, semi);
    }
}

function playMetronomeClick() {
    if (!audioCtx) return;
    const osc = audioCtx.createOscillator(), g = audioCtx.createGain();
    osc.type = 'sine'; osc.frequency.value = 1000;
    g.gain.setValueAtTime(0.1, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.05);
    osc.connect(g); g.connect(audioCtx.destination);
    osc.start(); osc.stop(audioCtx.currentTime + 0.05);
}

function updateLCD() {
    const bar    = Math.floor(state.currentBeat / 4) + 1;
    const beat   = (state.currentBeat % 4) + 1;
    const status = state.isRecording ? 'REC' : (state.isPlaying ? 'PLAY' : 'STOP');
    const el = document.getElementById('seq-lcd');
    el.textContent = `BAR ${bar}:${beat} | ${status}`;
    el.style.color = state.isRecording ? '#f00' : '#f25c19';
}

function toggleBPM() {
    state.bpmActive = !state.bpmActive;
    document.getElementById('bpm-toggle').classList.toggle('active', state.bpmActive);
}

// ---- Song tab ----
function updatePatternPool() {
    const pool = document.getElementById('patternPool');
    pool.innerHTML = '';
    state.sequences.forEach((seq, i) => {
        const item = document.createElement('div');
        item.className = 'pool-item'; item.textContent = seq.name;
        item.onclick = () => addToSong(i);
        pool.appendChild(item);
    });
}

function addToSong(seqIndex) {
    const seq = state.sequences[seqIndex];
    state.songArrangement.push(seqIndex);
    const tl    = document.getElementById('songTimeline');
    const block = document.createElement('div');
    block.className = 'timeline-block';
    block.innerHTML = `<span>${seq.name}</span><span style="font-size:8px;color:#666;">${seq.length} bars</span>
        <div class="remove-block" onclick="removeFromSong(event,${state.songArrangement.length-1})">✕</div>`;
    tl.appendChild(block);
}

function removeFromSong(event, index) {
    event.stopPropagation();
    state.songArrangement.splice(index, 1);
    renderSongTimeline();
}

function renderSongTimeline() {
    const tl = document.getElementById('songTimeline');
    tl.innerHTML = '<div style="position:absolute;left:10px;top:5px;color:#999;font-size:10px;pointer-events:none;">SONG ARRANGEMENT ▶</div>';
    state.songArrangement.forEach((si, i) => {
        const seq = state.sequences[si];
        const b   = document.createElement('div');
        b.className = 'timeline-block';
        b.innerHTML = `<span>${seq.name}</span><span style="font-size:8px;color:#666;">${seq.length} bars</span>
            <div class="remove-block" onclick="removeFromSong(event,${i})">✕</div>`;
        tl.appendChild(b);
    });
}

// ---- Tape tab ----
let mediaRecorder        = null;
let recordedChunks       = [];
let songPlaybackInterval = null;
let currentSongPosition  = 0;

function playTape() {
    if (!state.songArrangement.length) { alert('No song arrangement! Add sequences in SONG tab first.'); return; }
    initAudio();
    state.tapePlaying = true; currentSongPosition = 0;
    document.getElementById('tape-play-btn').classList.add('playing');
    document.getElementById('tape-reel-a').classList.add('tape-spinning'); document.getElementById('tape-reel-b').classList.add('tape-spinning');
    ;
    document.getElementById('tape-status').textContent = '▶ PLAYING';
    playSongFromPosition(); startVUMeter(); startVinylFX();
}

function playSongFromPosition() {
    if (!state.tapePlaying || currentSongPosition >= state.songArrangement.length) { stopTape(); return; }
    const seqIndex   = state.songArrangement[currentSongPosition];
    const seq        = state.sequences[seqIndex];
    const totalBeats = seq.length * 4;
    const beatDur    = 60000 / state.bpm / 4;
    let currentBeat  = 0;
    seq.instruments.forEach(inst => { if (!inst.gainNode) setupInstrumentAudio(inst); });

    songPlaybackInterval = setInterval(() => {
        if (!state.tapePlaying) { clearInterval(songPlaybackInterval); return; }
        seq.instruments.forEach(inst => {
            if (inst.muted) return;
            const hasSolo = seq.instruments.some(i => i.solo); if (hasSolo && !inst.solo) return;
            (seq.notes[inst.id]||[]).filter(n => n.beat === currentBeat).forEach(n => playNoteForInstrument(inst, n.pad));
        });
        if (++currentBeat >= totalBeats) { clearInterval(songPlaybackInterval); currentSongPosition++; playSongFromPosition(); }
    }, beatDur);
}

function stopTape() {
    state.tapePlaying = false;
    if (songPlaybackInterval) { clearInterval(songPlaybackInterval); songPlaybackInterval = null; }
    document.getElementById('tape-play-btn').classList.remove('playing');
    document.getElementById('tape-reel-a').classList.remove('tape-spinning'); document.getElementById('tape-reel-b').classList.remove('tape-spinning');
    ;
    if (!state.tapeRecording) document.getElementById('tape-status').textContent = '● READY';
    document.getElementById('tape-status').classList.remove('recording');
    stopVUMeter(); stopVinylFX();
    if (state.tapeRecording && mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop(); state.tapeRecording = false;
        document.getElementById('tape-rec-btn').classList.remove('recording');
    }
}

function rewindTape() {
    currentSongPosition = 0;
    document.getElementById('tape-status').textContent = '⏪ REWOUND';
    setTimeout(() => { if (!state.tapePlaying) document.getElementById('tape-status').textContent = '● READY'; }, 1000);
}

function recTape() {
    if (!state.songArrangement.length) { alert('No song arrangement! Add sequences in SONG tab first.'); return; }
    initAudio();
    const dest = audioCtx.createMediaStreamDestination();
    masterAnalyser.connect(dest);
    recordedChunks = [];
    mediaRecorder  = new MediaRecorder(dest.stream, { mimeType: 'audio/webm;codecs=opus' });
    mediaRecorder.ondataavailable = e => { if (e.data.size > 0) recordedChunks.push(e.data); };
    mediaRecorder.onstop = async () => {
        document.getElementById('tape-status').textContent = '⏳ CONVERTING TO WAV...';
        const webmBlob = new Blob(recordedChunks, { type: 'audio/webm' });
        try { state.recordedBlob = await convertToWav(webmBlob); }
        catch(e) { state.recordedBlob = webmBlob; }
        const btn = document.getElementById('save-song-btn');
        if (btn) btn.style.display = 'flex';
        document.getElementById('tape-status').textContent = '✓ READY — HIT SAVE';
    };
    state.tapeRecording = true;
    mediaRecorder.start();
    document.getElementById('tape-rec-btn').classList.add('recording');
    document.getElementById('tape-status').textContent = '⏺ RECORDING...';
    document.getElementById('tape-status').classList.add('recording');
    playTape();
}

async function getSong() {
    if (!state.recordedBlob) return;
    const fileName = 'cronki-song.wav';
    if (navigator.canShare && navigator.canShare({ files: [new File([state.recordedBlob], fileName, {type:'audio/wav'})] })) {
        try { await navigator.share({ title:'My Cronki Song', text:'Made with Cronki 🎛️', files:[new File([state.recordedBlob],fileName,{type:'audio/wav'})] }); return; }
        catch(e) { if (e.name==='AbortError') return; }
    }
    const url = URL.createObjectURL(state.recordedBlob);
    const a   = document.createElement('a'); a.href = url; a.download = fileName;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function downloadRecording() { getSong(); }

// ---- MIDI ----
let midiAccess = null, midiInputs = [];
const MIDI_PAD_BASE = 60;

async function requestMidiAccess() {
    const el = document.getElementById('menu-midi-device');
    if (!navigator.requestMIDIAccess) { if (el) el.textContent = 'MIDI not supported'; return; }
    try {
        midiAccess = await navigator.requestMIDIAccess();
        setupMidiInputs(); midiAccess.onstatechange = setupMidiInputs;
        showToast('🎹 MIDI connected!');
    } catch(e) { if (el) el.textContent = 'MIDI permission denied'; }
}

function setupMidiInputs() {
    const el = document.getElementById('menu-midi-device');
    midiInputs = [];
    if (!midiAccess) return;
    midiAccess.inputs.forEach(inp => { inp.onmidimessage = onMidiMessage; midiInputs.push(inp.name); });
    if (el) el.textContent = midiInputs.length ? midiInputs.join(', ') : 'No MIDI device found';
    if (midiInputs.length) showToast('🎹 ' + midiInputs[0]);
}

function onMidiMessage(e) {
    const [status, note, velocity] = e.data;
    if ((status & 0xf0) !== 0x90 || velocity === 0) return;

    const seq  = state.sequences[state.currentSequence];
    const inst = seq.instruments.find(i => i.id === state.activeInstrumentId);

    const isMelodic = inst && !['drums','sampler','library','audiotrack'].includes(inst.type);
    if (isMelodic) {
        const semi = note - 60;
        if (inst.type === 'lofi') playLofiNoteByMidi(audioCtx, masterGain, semi);
        else                      playKeyNoteByMidi(audioCtx, masterGain, semi);

        // Visual
        const displayPad = (((note - MIDI_PAD_BASE) % 16) + 16) % 16;
        const pp = document.querySelector(`#perf-pad-grid .perf-pad[data-pad="${displayPad}"]`);
        if (pp) { pp.classList.add('hit'); setTimeout(()=>pp.classList.remove('hit'),100); }

        // Record
        if (state.isRecording && state.isPlaying) {
            const stored = 1000 + note;
            const rec = { beat: state.currentBeat, pad: stored, time: audioCtx.currentTime, _justRecorded: true };
            seq.notes[inst.id].push(rec);
            setTimeout(()=>{ rec._justRecorded=false; }, 60000/state.bpm/4);
            renderNotesOnPianoRoll();
            if (document.getElementById('performance-view').style.display !== 'none') renderPerfPianoRoll();
        }
    } else {
        const padIndex = note - MIDI_PAD_BASE;
        if (padIndex >= 0 && padIndex < 16) hitPad(padIndex);
    }
}
