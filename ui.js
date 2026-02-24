// ============================================================
// ui.js — All UI rendering and interaction:
//   Opening screen, XY pad, Performance mode, Tab nav,
//   Sequence management, Instrument management, EQ modal,
//   Piano roll, Pad grid, Sound library, Project save/load,
//   Menu, Toast
// ============================================================

// ---- Opening screen permissions ----
let openingMidiAccess = null;

function setPermStatus(id, text, cls) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    el.className = 'perm-status' + (cls ? ' ' + cls : '');
}

async function requestOpeningPermissions() {
    // Microphone
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(t => t.stop());
        setPermStatus('perm-mic-status', '✓ Granted', 'ok');
    } catch(e) {
        setPermStatus('perm-mic-status', '✗ Denied', 'err');
    }
    // Audio output
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const out = devices.find(d => d.kind === 'audiooutput');
        setPermStatus('perm-audio-status', out ? '✓ ' + (out.label || 'Ready') : '✓ Default', 'ok');
    } catch(e) {
        setPermStatus('perm-audio-status', '✓ Default', 'ok');
    }
    // MIDI - update menu device when available
    if (openingMidiAccess) {
        const inputs = [...openingMidiAccess.inputs.values()];
        const nm = inputs.length ? inputs[0].name : 'No device';
        setPermStatus('perm-midi-status', '✓ ' + nm, 'ok');
        const btn = document.getElementById('perm-midi-btn');
        if (btn) btn.style.display = 'none';
    }
}

async function requestOpeningMidi() {
    const btn = document.getElementById('perm-midi-btn');
    setPermStatus('perm-midi-status', 'Connecting...', '');
    try {
        openingMidiAccess = await navigator.requestMIDIAccess();
        const inputs = [...openingMidiAccess.inputs.values()];
        const nm = inputs.length ? inputs[0].name : 'Ready (no device)';
        setPermStatus('perm-midi-status', '✓ ' + nm, 'ok');
        if (btn) btn.style.display = 'none';
    } catch(e) {
        setPermStatus('perm-midi-status', '✗ Denied', 'err');
    }
}

// Auto-run permissions on page load
window.addEventListener('DOMContentLoaded', () => {
    requestOpeningPermissions();
    // Auto-add sampler to the initial sequence after a short delay (scripts need to load)
    setTimeout(() => {
        if (state && state.sequences && state.sequences.length > 0) {
            autoAddSampler();
        }
    }, 100);
});

function startEngine() {
    initAudio();
    const screen = document.getElementById('opening-screen');
    screen.style.transition = 'opacity 0.6s'; screen.style.opacity = '0';
    const el = document.documentElement;
    if (el.requestFullscreen) el.requestFullscreen();
    else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
    setTimeout(() => screen.style.display = 'none', 650);
}

// ---- XY Pad ----
function initXYPad() {
    const pad    = document.getElementById('xy-pad');
    const cursor = document.getElementById('xy-cursor');
    if (!pad) return;

    function applyXY(x, y) {
        const freq = Math.exp(Math.log(200) + x * (Math.log(20000) - Math.log(200)));
        const wet  = (1 - y) * 0.8;
        if (masterFilter) masterFilter.frequency.setTargetAtTime(freq, audioCtx.currentTime, 0.02);
        if (masterWet)    masterWet.gain.setTargetAtTime(wet, audioCtx.currentTime, 0.02);
        if (masterDry)    masterDry.gain.setTargetAtTime(1 - wet*0.5, audioCtx.currentTime, 0.02);
        cursor.style.left = (x*100)+'%'; cursor.style.top = (y*100)+'%';
    }
    function getXY(e) {
        const r = pad.getBoundingClientRect();
        const cx = e.touches ? e.touches[0].clientX : e.clientX;
        const cy = e.touches ? e.touches[0].clientY : e.clientY;
        return { x: Math.max(0,Math.min(1,(cx-r.left)/r.width)), y: Math.max(0,Math.min(1,(cy-r.top)/r.height)) };
    }
    let active = false;
    pad.addEventListener('mousedown',  e => { active=true; initAudio(); const p=getXY(e); applyXY(p.x,p.y); });
    pad.addEventListener('mousemove',  e => { if(active){ const p=getXY(e); applyXY(p.x,p.y); } });
    pad.addEventListener('mouseup',    () => active=false);
    pad.addEventListener('mouseleave', () => active=false);
    pad.addEventListener('touchstart', e => { e.preventDefault(); initAudio(); const p=getXY(e); applyXY(p.x,p.y); }, {passive:false});
    pad.addEventListener('touchmove',  e => { e.preventDefault(); const p=getXY(e); applyXY(p.x,p.y); }, {passive:false});
}

// ---- Performance mode ----
let perfOctave = 4;
const MIDI_NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const PAD_SEMITONE    = [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15];

function openPerformanceMode() {
    const seq  = state.sequences[state.currentSequence];
    const inst = seq.instruments.find(i => i.id === state.activeInstrumentId);
    if (!inst) { showToast('⚠️ Select an instrument first'); return; }
    document.getElementById('perf-title').textContent = inst.name + ' — PERFORMANCE MODE';
    document.getElementById('performance-view').style.display = 'flex';
    renderPerfPianoRoll(); renderPerfPads();
}
function closePerformanceMode() {
    document.getElementById('performance-view').style.display = 'none';
    renderPianoRoll();
}
function perfOctaveShift(dir) {
    perfOctave = Math.max(0, Math.min(8, perfOctave + dir));
    document.getElementById('perf-octave-val').textContent = perfOctave;
    renderPerfPads();
}
function renderPerfPianoRoll() {
    const seq  = state.sequences[state.currentSequence];
    const grid = document.getElementById('perf-piano-roll-grid');
    grid.innerHTML = '';
    const total = seq.length * 4;
    for (let i = 0; i < total; i++) {
        const b = document.createElement('div'); b.className = 'piano-beat'; b.dataset.beat = i;
        if (i%4===0) { const m=document.createElement('div'); m.className='beat-marker'; m.textContent=Math.floor(i/4)+1; b.appendChild(m); }
        grid.appendChild(b);
    }
}
function renderPerfPads() {
    const seq  = state.sequences[state.currentSequence];
    const inst = seq.instruments.find(i => i.id === state.activeInstrumentId);
    const grid = document.getElementById('perf-pad-grid');
    grid.innerHTML = '';
    for (let i = 0; i < 16; i++) {
        const pad = document.createElement('div'); pad.className = 'perf-pad'; pad.dataset.pad = i;
        if (inst) {
            if (inst.type === 'drums')   pad.textContent = drumPadMap[i%drumPadMap.length].toUpperCase();
            else if (inst.type === 'sampler') { pad.textContent='CHOP '+(i+1); if(inst.chops&&inst.chops.find(c=>c.pad===i))pad.classList.add('has-sample'); }
            else if (inst.type === 'library') { const pn=inst.padNames?inst.padNames[i]:null; pad.textContent=pn||'-'; if(pn)pad.classList.add('has-sample'); }
            else { const s=PAD_SEMITONE[i]; pad.textContent=MIDI_NOTE_NAMES[s%12]+(perfOctave+Math.floor(s/12)); }
        }
        pad.addEventListener('mousedown', () => perfHitPad(i));
        pad.addEventListener('touchstart', e => { e.preventDefault(); perfHitPad(i); }, {passive:false});
        grid.appendChild(pad);
    }
}
function perfHitPad(padIndex) {
    initAudio();
    const seq  = state.sequences[state.currentSequence];
    const inst = seq.instruments.find(i => i.id === state.activeInstrumentId);
    if (!inst) return;
    if (!inst.gainNode) setupInstrumentAudio(inst);
    const pp = document.querySelector(`#perf-pad-grid .perf-pad[data-pad="${padIndex}"]`);
    if (pp) { pp.classList.add('hit'); setTimeout(()=>pp.classList.remove('hit'),100); }
    const mp = document.querySelector(`#pad-grid .pad[data-pad="${padIndex}"]`);
    if (mp) { mp.classList.add('hit'); setTimeout(()=>mp.classList.remove('hit'),100); }

    const dest = inst.eqNodes ? inst.eqNodes.low : masterGain;
    if      (inst.type === 'drums')   { const s=drumSounds[drumPadMap[padIndex%drumPadMap.length]]; if(s)s(audioCtx,dest); }
    else if (inst.type === 'sampler') { playChopFromInst(inst, padIndex, inst.tuning||0, dest); }
    else if (inst.type === 'library') { playLibrarySample(inst, padIndex); }
    else {
        const semi = (perfOctave-4)*12 + PAD_SEMITONE[padIndex];
        if (inst.type === 'lofi') playLofiNoteByMidi(audioCtx, dest, semi);
        else                      playKeyNoteByMidi(audioCtx, dest, semi);
    }

    if (state.isRecording && state.isPlaying) {
        let stored = padIndex;
        if (!['drums','sampler','library'].includes(inst.type)) stored = padIndex + perfOctave*100;
        const note = { beat:state.currentBeat, pad:stored, time:audioCtx.currentTime, _justRecorded:true };
        seq.notes[inst.id].push(note);
        setTimeout(()=>{ note._justRecorded=false; }, 60000/state.bpm/4);
        renderNotesOnPianoRoll(); renderPerfPianoRoll();
    }
}
function updatePerfButton() {
    let btn = document.getElementById('perf-mode-btn');
    if (!btn) {
        btn = document.createElement('div'); btn.id='perf-mode-btn'; btn.className='transport-btn perf-btn';
        btn.title='Performance Mode'; btn.textContent='PERFORMANCE'; btn.onclick=openPerformanceMode;
        const t = document.querySelector('.transport-controls'); if (t) t.insertBefore(btn,t.firstChild);
    }
    const seq  = state.sequences[state.currentSequence];
    const inst = seq.instruments.find(i => i.id === state.activeInstrumentId);
    btn.style.display = (inst && !['sampler','audiotrack'].includes(inst.type)) ? 'flex' : 'none';
}

// ---- Tab navigation ----
function setTab(tabId, btnElement) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById(tabId+'-view').classList.add('active');
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    btnElement.classList.add('active');
    if (tabId === 'sampler') { renderSamplerPads(); drawWaveform(); }
    else if (tabId === 'song') { updatePatternPool(); }
}

// ---- Sequence management ----
function loadSequence() {
    const seqIndex = parseInt(document.getElementById('seq-select').value);
    state.currentSequence = seqIndex;
    const seq = state.sequences[seqIndex];
    document.querySelectorAll('.length-btn').forEach(b => b.classList.toggle('active', parseInt(b.textContent)===seq.length));
    renderInstruments(); renderPianoRoll(); renderPads();
}
function addNewSequence() {
    const i    = state.sequences.length;
    const name = `SEQ ${String(i+1).padStart(2,'0')}`;
    state.sequences.push({ name, length:4, instruments:[], notes:{} });
    const sel = document.getElementById('seq-select');
    const opt = document.createElement('option'); opt.value=i; opt.textContent=name;
    sel.appendChild(opt); sel.value=i; loadSequence();
    // Auto-add one sampler instrument
    autoAddSampler();
}
function duplicateSequence() {
    const src  = state.sequences[state.currentSequence];
    const idx  = state.sequences.length;
    const name = `SEQ ${String(idx+1).padStart(2,'0')}`;
    const newInsts = src.instruments.map(inst => {
        const c = { id:inst.id, type:inst.type, name:inst.name, muted:inst.muted, solo:inst.solo,
                    eq:{...inst.eq}, tuning:inst.tuning||0, gainNode:null, eqNodes:null };
        if (inst.type==='sampler')    { c.chops=JSON.parse(JSON.stringify(inst.chops||[])); c.recordedBuffer=inst.recordedBuffer; }
        if (inst.type==='audiotrack') { c.recordedBuffer=inst.recordedBuffer; }
        if (inst.type==='library')    { c.bankName=inst.bankName; c.samples=inst.samples; c.padNames=inst.padNames?[...inst.padNames]:null; c.audioBuffers=inst.audioBuffers||{}; }
        return c;
    });
    const newNotes = {};
    for (const [id,arr] of Object.entries(src.notes)) newNotes[id]=JSON.parse(JSON.stringify(arr));
    state.sequences.push({ name, length:src.length, instruments:newInsts, notes:newNotes });
    const sel = document.getElementById('seq-select');
    const opt = document.createElement('option'); opt.value=idx; opt.textContent=name;
    sel.appendChild(opt); sel.value=idx; state.currentSequence=idx;
    newInsts.forEach(inst => setupInstrumentAudio(inst));
    loadSequence(); showToast('⧉ Sequence duplicated!');
}
function setLength(len) {
    const seq = state.sequences[state.currentSequence]; seq.length = len;
    document.querySelectorAll('.length-btn').forEach(b => b.classList.toggle('active', parseInt(b.textContent)===len));
    renderPianoRoll();
}

// ---- Instrument management ----
function showAddInstrumentModal() { document.getElementById('add-instrument-modal').classList.add('active'); }
function closeModal(id) { document.getElementById(id).classList.remove('active'); }

function autoAddSampler() {
    const seq = state.sequences[state.currentSequence];
    if (seq.instruments.length > 0) return; // already has instruments
    const id = ++instrumentIdCounter;
    const instrument = { id, type:'sampler', name:`SAMPLER ${id}`, muted:false, solo:false,
        eq:{low:0,mid:0,high:0,volume:80}, gainNode:null, eqNodes:null,
        recordedBuffer:null, chops:[] };
    if (audioCtx) setupInstrumentAudio(instrument);
    seq.instruments.push(instrument); seq.notes[id] = [];
    state.activeInstrumentId = id;
    renderInstruments(); renderPads();
}

function addInstrument(type) {
    closeModal('add-instrument-modal');
    const seq  = state.sequences[state.currentSequence];
    const id   = ++instrumentIdCounter;
    const nameMap = { drums:`DRUMS ${id}`, sampler:`SAMPLER ${id}`, lofi:`LO-FI ${id}` };
    const name = nameMap[type] || `KEYS ${id}`;
    const instrument = { id, type, name, muted:false, solo:false,
        eq:{low:0,mid:0,high:0,volume:80}, gainNode:null, eqNodes:null };
    if (type === 'sampler') { instrument.recordedBuffer=null; instrument.chops=[]; }
    if (audioCtx) setupInstrumentAudio(instrument);
    seq.instruments.push(instrument); seq.notes[id] = [];
    state.activeInstrumentId = id;
    renderInstruments(); renderPads();
}

function renderInstruments() {
    const seq  = state.sequences[state.currentSequence];
    const cont = document.getElementById('instrument-list');
    cont.innerHTML = '';
    seq.instruments.forEach(inst => {
        const icon = { drums:'🥁', sampler:'🎙️', library:'📂', audiotrack:'🎤', lofi:'🌫️' }[inst.type] || '🎹';
        const div  = document.createElement('div');
        div.className = 'track-item' + (inst.id===state.activeInstrumentId?' active':'') + (inst.muted?' muted':'') + (inst.solo?' solo':'');
        div.onclick = e => { if (!e.target.classList.contains('track-ctrl-btn')) setActiveInstrument(inst.id); };
        div.innerHTML = `
            <div class="track-icon ${inst.type}">${icon}</div>
            <div class="track-info"><div class="track-name">${inst.name}</div></div>
            <div class="track-controls">
                <button class="track-ctrl-btn" onclick="openEQ(${inst.id})" title="Edit">E</button>
                <button class="track-ctrl-btn ${inst.solo?'active':''}" onclick="toggleSolo(${inst.id})" title="Solo">S</button>
                <button class="track-ctrl-btn ${inst.muted?'active':''}" onclick="toggleMute(${inst.id})" title="Mute">M</button>
                <button class="track-ctrl-btn del" onclick="deleteInstrument(${inst.id})" title="Delete">✕</button>
            </div>`;
        cont.appendChild(div);
    });
    updatePerfButton();
}

function setActiveInstrument(id) { state.activeInstrumentId=id; renderInstruments(); renderPads(); }

function toggleSolo(id) {
    const inst = state.sequences[state.currentSequence].instruments.find(i=>i.id===id);
    if (inst) { inst.solo=!inst.solo; updateInstrumentGains(); renderInstruments(); }
}
function toggleMute(id) {
    const inst = state.sequences[state.currentSequence].instruments.find(i=>i.id===id);
    if (inst) { inst.muted=!inst.muted; updateInstrumentGains(); renderInstruments(); }
}
function updateInstrumentGains() {
    const seq     = state.sequences[state.currentSequence];
    const hasSolo = seq.instruments.some(i=>i.solo);
    seq.instruments.forEach(inst => {
        if (!inst.gainNode) return;
        inst.gainNode.gain.value = (inst.muted || (hasSolo && !inst.solo)) ? 0 : inst.eq.volume/100;
    });
}
function deleteInstrument(id) {
    const seq = state.sequences[state.currentSequence];
    const idx = seq.instruments.findIndex(i=>i.id===id); if (idx<0) return;
    const inst = seq.instruments[idx]; if (inst.gainNode) inst.gainNode.disconnect();
    seq.instruments.splice(idx,1); delete seq.notes[id];
    if (state.activeInstrumentId===id) state.activeInstrumentId = seq.instruments.length>0?seq.instruments[0].id:null;
    renderInstruments(); renderPads();
}

// ---- EQ modal ----
function openEQ(instId) {
    state.activeInstrumentId = instId;
    const inst = state.sequences[state.currentSequence].instruments.find(i=>i.id===instId);
    if (!inst) return;
    document.getElementById('eq-inst-name').textContent = inst.name;
    ['low','mid','high'].forEach(b => {
        document.getElementById(`eq-${b}`).value     = inst.eq[b];
        document.getElementById(`eq-${b}-val`).textContent = inst.eq[b]+' dB';
    });
    document.getElementById('eq-vol').value          = inst.eq.volume;
    document.getElementById('eq-vol-val').textContent = inst.eq.volume+'%';
    const tg = document.getElementById('tuning-group');
    if (inst.type==='sampler') {
        tg.style.display='flex';
        document.getElementById('eq-tuning').value          = inst.tuning||0;
        document.getElementById('eq-tuning-val').textContent = inst.tuning||0;
    } else { tg.style.display='none'; }
    document.getElementById('eq-modal').classList.add('active');
}
function updateEQ() {
    const inst = state.sequences[state.currentSequence].instruments.find(i=>i.id===state.activeInstrumentId);
    if (!inst) return;
    ['low','mid','high'].forEach(b => {
        inst.eq[b] = parseInt(document.getElementById(`eq-${b}`).value);
        document.getElementById(`eq-${b}-val`).textContent = inst.eq[b]+' dB';
    });
    inst.eq.volume = parseInt(document.getElementById('eq-vol').value);
    document.getElementById('eq-vol-val').textContent = inst.eq.volume+'%';
    if (inst.type==='sampler') {
        inst.tuning = parseInt(document.getElementById('eq-tuning').value);
        document.getElementById('eq-tuning-val').textContent = inst.tuning;
    }
    if (inst.eqNodes) { inst.eqNodes.low.gain.value=inst.eq.low; inst.eqNodes.mid.gain.value=inst.eq.mid; inst.eqNodes.high.gain.value=inst.eq.high; }
    if (inst.gainNode && !inst.muted) inst.gainNode.gain.value = inst.eq.volume/100;
}

// ---- Piano roll ----
function renderPianoRoll() {
    const seq  = state.sequences[state.currentSequence];
    const grid = document.getElementById('piano-roll-grid');
    grid.innerHTML = '';
    for (let i = 0; i < seq.length*4; i++) {
        const b = document.createElement('div'); b.className='piano-beat'; b.dataset.beat=i;
        if (i%4===0) { const m=document.createElement('div'); m.className='beat-marker'; m.textContent=Math.floor(i/4)+1; b.appendChild(m); }
        grid.appendChild(b);
    }
    renderNotesOnPianoRoll();
}

function renderNotesOnPianoRoll() {
    const seq  = state.sequences[state.currentSequence];
    const grid = document.getElementById('piano-roll-grid');
    const inst = seq.instruments.find(i=>i.id===state.activeInstrumentId);
    grid.querySelectorAll('.piano-note').forEach(n=>n.remove());
    if (!state.activeInstrumentId || !seq.notes[state.activeInstrumentId]) return;

    seq.notes[state.activeInstrumentId].forEach(note => {
        const beatEl = grid.querySelector(`[data-beat="${note.beat}"]`); if (!beatEl) return;
        const noteEl = document.createElement('div'); noteEl.className='piano-note';
        noteEl.style.top='5px'; noteEl.style.left='2px'; noteEl.style.width='80%';
        noteEl.style.top = (5 + (note.pad % 16)*3) + 'px';

        if (inst && inst.type==='sampler' && inst.recordedBuffer) {
            const chop = inst.chops.find(c=>c.pad===note.pad);
            if (chop) { const cv=mkWaveCanvas(inst.recordedBuffer,chop.start,chop.end,'var(--orange)'); noteEl.appendChild(cv); noteEl.style.background='transparent'; noteEl.style.border='1px solid var(--orange)'; }
        } else if (inst && inst.type==='audiotrack' && inst.recordedBuffer) {
            const cv=mkWaveCanvas(inst.recordedBuffer,0,inst.recordedBuffer.duration,'#4fc'); noteEl.appendChild(cv); noteEl.style.background='transparent'; noteEl.style.border='1px solid #4fc';
        }
        beatEl.appendChild(noteEl);
    });
}

function mkWaveCanvas(buffer, startSec, endSec, color) {
    const cv = document.createElement('canvas'); cv.width=40; cv.height=10; cv.style.width='100%'; cv.style.height='100%';
    drawSmallWaveformFromBuffer(cv, buffer, startSec, endSec, color);
    return cv;
}

function drawSmallWaveformFromBuffer(canvas, buffer, startSec, endSec, color) {
    const ctx2    = canvas.getContext('2d');
    const data    = buffer.getChannelData(0);
    const startI  = Math.floor(startSec * buffer.sampleRate);
    const endI    = Math.floor(endSec   * buffer.sampleRate);
    const slice   = data.slice(startI, endI);
    ctx2.fillStyle = color || 'rgba(242,92,25,0.5)';
    const step = Math.ceil(slice.length / canvas.width), amp = canvas.height/2;
    for (let i = 0; i < canvas.width; i++) {
        let mn=1,mx=-1;
        for (let j=0;j<step;j++){const v=slice[i*step+j];if(v<mn)mn=v;if(v>mx)mx=v;}
        ctx2.fillRect(i, (1+mn)*amp, 1, Math.max(1,(mx-mn)*amp));
    }
}

function highlightBeat(beatIndex) {
    document.querySelectorAll('.piano-beat').forEach((b,i) => b.classList.toggle('active', i===beatIndex));
}

// ---- Pad grid ----
function renderPads() {
    const seq  = state.sequences[state.currentSequence];
    const inst = seq.instruments.find(i=>i.id===state.activeInstrumentId);
    const grid = document.getElementById('pad-grid');
    grid.innerHTML = '';
    const noteLabels = ['C','D','E','F','G','A','B','C+','D+','E+','F+','G+','A+','B+','C++','D++'];

    for (let i = 0; i < 16; i++) {
        const pad = document.createElement('div'); pad.className='pad'; pad.dataset.pad=i;
        if (inst) {
            if      (inst.type==='drums')     { pad.textContent=drumPadMap[i].toUpperCase().slice(0,3); }
            else if (inst.type==='sampler')   { pad.textContent='CHOP '+(i+1); if(inst.chops&&inst.chops.find(c=>c.pad===i))pad.classList.add('has-sample'); }
            else if (inst.type==='audiotrack'){ if(i===0){pad.textContent=inst.recordedBuffer?'▶ PLAY':'⏺ RECORD';if(inst.recordedBuffer)pad.classList.add('has-sample');}else{pad.textContent='-';pad.style.opacity='0.2';} }
            else if (inst.type==='library')   { const pn=inst.padNames[i]; if(pn){pad.textContent=pn;pad.classList.add('has-sample');}else{pad.textContent='-';pad.style.opacity='0.3';} }
            else                              { pad.textContent=noteLabels[i]; } // keys / lofi
        }
        pad.onmousedown  = () => hitPad(i);
        pad.ontouchstart = e => { e.preventDefault(); hitPad(i); };
        grid.appendChild(pad);
    }
}

function hitPad(padIndex) {
    initAudio();
    const seq  = state.sequences[state.currentSequence];
    const inst = seq.instruments.find(i=>i.id===state.activeInstrumentId);
    if (!inst) return;
    if (!inst.gainNode) setupInstrumentAudio(inst);

    const pad = document.querySelector(`.pad[data-pad="${padIndex}"]`);
    if (pad) { pad.classList.add('hit'); setTimeout(()=>pad.classList.remove('hit'),100); }

    const dest = inst.eqNodes ? inst.eqNodes.low : masterGain;
    if      (inst.type==='drums')     { const s=drumSounds[drumPadMap[padIndex]]; if(s)s(audioCtx,dest); else playMetronomeClick(); }
    else if (inst.type==='sampler')   { playChopFromInst(inst,padIndex,inst.tuning||0,dest); }
    else if (inst.type==='audiotrack'){ if(padIndex===0) openAudioTrackModal(inst.id); return; }
    else if (inst.type==='library')   { playLibrarySample(inst,padIndex); }
    else {
        let actualPad=padIndex, playOctave=4;
        if (padIndex>=100) { playOctave=Math.floor(padIndex/100); actualPad=padIndex%100; }
        const semi = (playOctave-4)*12 + PAD_SEMITONE[actualPad];
        if (inst.type==='lofi') playLofiNoteByMidi(audioCtx, dest, semi);
        else                    playKeyNoteByMidi(audioCtx, dest, semi);
    }

    if (state.isRecording && state.isPlaying) {
        const note = { beat:state.currentBeat, pad:padIndex, time:audioCtx.currentTime, _justRecorded:true };
        seq.notes[inst.id].push(note);
        setTimeout(()=>{ note._justRecorded=false; }, 60000/state.bpm/4);
        renderNotesOnPianoRoll();
    }
}

// ---- Sound Library ----
let currentLibraryBank = null;
const libraryAudioPreviews = {};

function openSoundLibrary() {
    closeModal('add-instrument-modal'); currentLibraryBank=null;
    renderLibraryBanks(); renderLibraryPads();
    document.getElementById('library-inst-name').value='';
    document.getElementById('sound-library-modal').classList.add('active');
}
function renderLibraryBanks() {
    const nav = document.getElementById('library-nav'); nav.innerHTML='';
    Object.keys(SOUND_BANK_DATA).forEach(bankName => {
        const btn = document.createElement('button');
        btn.className='library-bank-btn'+(bankName===currentLibraryBank?' active':'');
        btn.textContent=bankName.toUpperCase();
        btn.onclick=()=>{ currentLibraryBank=bankName; document.getElementById('library-inst-name').value=bankName; renderLibraryBanks(); renderLibraryPads(); };
        nav.appendChild(btn);
    });
}
function renderLibraryPads() {
    const cont = document.getElementById('library-pads'); cont.innerHTML='';
    if (!currentLibraryBank||!SOUND_BANK_DATA[currentLibraryBank]) { cont.innerHTML='<div style="grid-column:1/-1;text-align:center;color:#555;font-size:10px;padding:20px;">SELECT A BANK ABOVE</div>'; return; }
    Object.entries(SOUND_BANK_DATA[currentLibraryBank]).forEach(([name,dataUrl]) => {
        const p=document.createElement('div'); p.className='library-pad'; p.textContent=name;
        p.onclick=()=>previewLibrarySample(name,dataUrl,p); cont.appendChild(p);
    });
}
function previewLibrarySample(name, dataUrl, padEl) {
    Object.values(libraryAudioPreviews).forEach(a=>{try{a.pause();a.currentTime=0;}catch(e){}});
    document.querySelectorAll('.library-pad.preview').forEach(p=>p.classList.remove('preview'));
    const a = new Audio(dataUrl); libraryAudioPreviews[name]=a;
    a.play().catch(()=>{}); padEl.classList.add('preview'); a.onended=()=>padEl.classList.remove('preview');
}
function confirmAddLibraryInstrument() {
    if (!currentLibraryBank) { alert('Please select a sound bank first.'); return; }
    const name    = document.getElementById('library-inst-name').value.trim()||currentLibraryBank;
    const samples = SOUND_BANK_DATA[currentLibraryBank];
    Object.values(libraryAudioPreviews).forEach(a=>{try{a.pause();a.currentTime=0;}catch(e){}});
    closeModal('sound-library-modal'); initAudio();
    const seq=state.sequences[state.currentSequence], id=++instrumentIdCounter;
    const instrument={ id, type:'library', name, muted:false, solo:false, eq:{low:0,mid:0,high:0,volume:80},
        gainNode:null,eqNodes:null,bankName:currentLibraryBank,samples,padNames:Object.keys(samples),audioBuffers:{} };
    if (audioCtx) setupInstrumentAudio(instrument);
    seq.instruments.push(instrument); seq.notes[id]=[]; state.activeInstrumentId=id;
    renderInstruments(); renderPads();
}
function playLibrarySample(inst, padIndex) {
    const padName=inst.padNames[padIndex]; if(!padName||!audioCtx) return;
    if (!inst.gainNode) setupInstrumentAudio(inst);
    if (inst.audioBuffers[padName]) { _triggerLibBuffer(inst,inst.audioBuffers[padName]); return; }
    fetch(inst.samples[padName]).then(r=>r.arrayBuffer()).then(ab=>audioCtx.decodeAudioData(ab))
        .then(buf=>{ inst.audioBuffers[padName]=buf; _triggerLibBuffer(inst,buf); }).catch(console.error);
}
function _triggerLibBuffer(inst, buffer) {
    const src=audioCtx.createBufferSource(); src.buffer=buffer;
    src.connect(inst.eqNodes?inst.eqNodes.low:masterGain); src.start(0);
}

// ---- Project Save / Load ----
function openMenu() { detectAudioDevices(); document.getElementById('menu-modal').classList.add('active'); }
async function detectAudioDevices() {
    const iEl=document.getElementById('menu-input-device'), oEl=document.getElementById('menu-output-device');
    try {
        const s=await navigator.mediaDevices.getUserMedia({audio:true}); s.getTracks().forEach(t=>t.stop());
        const devs=await navigator.mediaDevices.enumerateDevices();
        if(iEl) iEl.textContent=(devs.find(d=>d.kind==='audioinput')||{}).label||'Default Microphone';
        if(oEl) oEl.textContent=(devs.find(d=>d.kind==='audiooutput')||{}).label||'Default Speaker';
    } catch(e) { if(iEl)iEl.textContent='Permission required'; if(oEl)oEl.textContent='Default Speaker'; }
}

async function menuSave() {
    async function bufToB64(buffer) {
        if (!buffer) return null;
        const numCh=buffer.numberOfChannels,sr=buffer.sampleRate,len=buffer.length,bps=2;
        const interleaved=new Int16Array(len*numCh);
        for(let ch=0;ch<numCh;ch++){const d=buffer.getChannelData(ch);for(let i=0;i<len;i++){const s=Math.max(-1,Math.min(1,d[i]));interleaved[i*numCh+ch]=s<0?s*0x8000:s*0x7FFF;}}
        const dSize=interleaved.byteLength,wav=new ArrayBuffer(44+dSize),v=new DataView(wav);
        function ws(o,s){for(let i=0;i<s.length;i++)v.setUint8(o+i,s.charCodeAt(i));}
        ws(0,'RIFF');v.setUint32(4,36+dSize,true);ws(8,'WAVE');ws(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);
        v.setUint16(22,numCh,true);v.setUint32(24,sr,true);v.setUint32(28,sr*numCh*bps,true);v.setUint16(32,numCh*bps,true);
        v.setUint16(34,16,true);ws(36,'data');v.setUint32(40,dSize,true);new Int16Array(wav,44).set(interleaved);
        const bytes=new Uint8Array(wav); let bin=''; for(let i=0;i<bytes.length;i++) bin+=String.fromCharCode(bytes[i]);
        return btoa(bin);
    }

    const sequences = await Promise.all(state.sequences.map(async seq => ({
        name:seq.name, length:seq.length, notes:seq.notes,
        instruments: await Promise.all(seq.instruments.map(async inst => {
            const d={ id:inst.id,type:inst.type,name:inst.name,muted:inst.muted,solo:inst.solo,
                      eq:inst.eq,tuning:inst.tuning,bankName:inst.bankName||null,padNames:inst.padNames||null };
            if (inst.type==='sampler')   { d.samplerChops=inst.chops||[]; d.samplerAudioB64=await bufToB64(inst.recordedBuffer); }
            if (inst.type==='audiotrack') d.audioTrackB64=await bufToB64(inst.recordedBuffer);
            return d;
        }))
    })));

    const blob=new Blob([JSON.stringify({version:2,bpm:state.bpm,currentSequence:state.currentSequence,sequences,songArrangement:state.songArrangement,instrumentIdCounter},null,2)],{type:'application/json'});
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='cronki-project.cronki';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    closeModal('menu-modal'); showToast('💾 Project saved!');
}

function menuOpen() { document.getElementById('open-project-file').click(); }
function menuOpenFile(input) {
    const file=input.files[0]; if(!file) return;
    const r=new FileReader();
    r.onload=e=>{ try{ loadProjectData(JSON.parse(e.target.result)); closeModal('menu-modal'); showToast('📂 Project loaded!'); } catch(err){ alert('Could not load project file.'); } };
    r.readAsText(file); input.value='';
}

function loadProjectData(data) {
    if (!data.version) return;
    async function b64ToBuf(b64) {
        if (!b64||!audioCtx) return null;
        try { const bin=atob(b64),bytes=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) bytes[i]=bin.charCodeAt(i); return await audioCtx.decodeAudioData(bytes.buffer); }
        catch(e){ console.warn('Audio decode error',e); return null; }
    }
    state.bpm=data.bpm||120; document.getElementById('bpm-input').value=state.bpm;
    instrumentIdCounter=data.instrumentIdCounter||0;
    initAudio();
    state.sequences=data.sequences.map(seq => {
        const instruments=seq.instruments.map(d => {
            const inst={ id:d.id,type:d.type,name:d.name,muted:d.muted||false,solo:d.solo||false,
                         eq:d.eq||{low:0,mid:0,high:0,volume:80},tuning:d.tuning||0,gainNode:null,eqNodes:null };
            if (inst.type==='library'&&d.bankName&&SOUND_BANK_DATA[d.bankName]) {
                inst.bankName=d.bankName; inst.samples=SOUND_BANK_DATA[d.bankName];
                inst.padNames=d.padNames||Object.keys(inst.samples); inst.audioBuffers={};
            }
            if (inst.type==='sampler') { inst.chops=d.samplerChops||[]; inst.recordedBuffer=null; if(d.samplerAudioB64) b64ToBuf(d.samplerAudioB64).then(buf=>{inst.recordedBuffer=buf;renderNotesOnPianoRoll();drawWaveform();}); }
            if (inst.type==='audiotrack') { inst.recordedBuffer=null; if(d.audioTrackB64) b64ToBuf(d.audioTrackB64).then(buf=>{inst.recordedBuffer=buf;renderNotesOnPianoRoll();renderPads();}); }
            return inst;
        });
        return { name:seq.name, length:seq.length, instruments, notes:seq.notes };
    });
    const sel=document.getElementById('seq-select'); sel.innerHTML='';
    state.sequences.forEach((s,i)=>{ const o=document.createElement('option'); o.value=i; o.textContent=s.name; sel.appendChild(o); });
    state.currentSequence=Math.min(data.currentSequence||0,state.sequences.length-1); sel.value=state.currentSequence;
    state.songArrangement=data.songArrangement||[];
    state.sequences.forEach(s=>s.instruments.forEach(setupInstrumentAudio));
    const cur=state.sequences[state.currentSequence]; state.activeInstrumentId=cur.instruments.length>0?cur.instruments[0].id:null;
    renderInstruments(); renderPads(); renderPianoRoll(); updatePatternPool(); renderSongTimeline();
}

// ---- Toast ----
function showToast(msg) {
    let t=document.getElementById('cronki-toast');
    if (!t) { t=document.createElement('div'); t.id='cronki-toast'; document.body.appendChild(t); }
    t.textContent=msg; t.classList.add('visible'); clearTimeout(t._timeout);
    t._timeout=setTimeout(()=>t.classList.remove('visible'),2500);
}

// ---- Init ----
function init() {
    renderPianoRoll(); renderPads(); renderInstruments(); updatePatternPool();
    if (state.sequences[state.currentSequence].instruments.length>0 && !state.activeInstrumentId) {
        state.activeInstrumentId=state.sequences[state.currentSequence].instruments[0].id;
        renderInstruments(); renderPads();
    }
}
