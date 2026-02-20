// =============================================
        // AUDIO CONTEXT & SETUP
        // =============================================
        let audioCtx = null;
        let masterGain = null;
        let masterAnalyser = null;
        let masterFilter = null;
        let masterReverb = null;
        let masterDry = null;
        let masterWet = null;

        function createReverbBuffer(ctx, seconds = 2.5, decay = 2.0) {
            const rate = ctx.sampleRate;
            const length = rate * seconds;
            const impulse = ctx.createBuffer(2, length, rate);
            for (let c = 0; c < 2; c++) {
                const ch = impulse.getChannelData(c);
                for (let i = 0; i < length; i++) {
                    ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
                }
            }
            return impulse;
        }

        function initAudio() {
            if (audioCtx) return;
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            masterGain = audioCtx.createGain();
            masterGain.gain.value = 0.8;

            // Filter (cutoff controlled by XY X axis)
            masterFilter = audioCtx.createBiquadFilter();
            masterFilter.type = 'lowpass';
            masterFilter.frequency.value = 20000;
            masterFilter.Q.value = 1;

            // Reverb (convolver + wet/dry mix)
            masterReverb = audioCtx.createConvolver();
            masterReverb.buffer = createReverbBuffer(audioCtx);
            masterDry = audioCtx.createGain();
            masterDry.gain.value = 1;
            masterWet = audioCtx.createGain();
            masterWet.gain.value = 0;

            masterAnalyser = audioCtx.createAnalyser();
            masterAnalyser.fftSize = 256;

            // Chain: masterGain -> filter -> dry -> analyser -> destination
            //                            -> reverb -> wet -> analyser
            masterGain.connect(masterFilter);
            masterFilter.connect(masterDry);
            masterFilter.connect(masterReverb);
            masterReverb.connect(masterWet);
            masterDry.connect(masterAnalyser);
            masterWet.connect(masterAnalyser);
            masterAnalyser.connect(audioCtx.destination);
        }

        // =============================================
        // OPENING SCREEN
        // =============================================
        function startEngine() {
            initAudio();
            const screen = document.getElementById('opening-screen');
            screen.style.transition = 'opacity 0.6s';
            screen.style.opacity = '0';
            // Request fullscreen
            const el = document.documentElement;
            if (el.requestFullscreen) el.requestFullscreen();
            else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
            setTimeout(() => screen.style.display = 'none', 650);
        }

        // =============================================
        // XY PAD
        // =============================================
        function initXYPad() {
            const pad = document.getElementById('xy-pad');
            const cursor = document.getElementById('xy-cursor');
            if (!pad) return;

            function applyXY(x, y) {
                // X: filter cutoff 200Hz - 20000Hz (log scale)
                const minF = Math.log(200), maxF = Math.log(20000);
                const freq = Math.exp(minF + x * (maxF - minF));
                // Y: reverb wet 0 - 0.8 (inverted: top = max reverb)
                const wet = (1 - y) * 0.8;

                if (masterFilter) masterFilter.frequency.setTargetAtTime(freq, audioCtx.currentTime, 0.02);
                if (masterWet) masterWet.gain.setTargetAtTime(wet, audioCtx.currentTime, 0.02);
                if (masterDry) masterDry.gain.setTargetAtTime(1 - wet * 0.5, audioCtx.currentTime, 0.02);

                cursor.style.left = (x * 100) + '%';
                cursor.style.top = (y * 100) + '%';
            }

            function getXY(e) {
                const rect = pad.getBoundingClientRect();
                const cx = e.touches ? e.touches[0].clientX : e.clientX;
                const cy = e.touches ? e.touches[0].clientY : e.clientY;
                return {
                    x: Math.max(0, Math.min(1, (cx - rect.left) / rect.width)),
                    y: Math.max(0, Math.min(1, (cy - rect.top) / rect.height))
                };
            }

            let active = false;
            pad.addEventListener('mousedown', e => { active = true; initAudio(); const {x,y} = getXY(e); applyXY(x,y); });
            pad.addEventListener('mousemove', e => { if (active) { const {x,y} = getXY(e); applyXY(x,y); } });
            pad.addEventListener('mouseup', () => active = false);
            pad.addEventListener('mouseleave', () => active = false);
            pad.addEventListener('touchstart', e => { e.preventDefault(); initAudio(); const {x,y} = getXY(e); applyXY(x,y); }, {passive:false});
            pad.addEventListener('touchmove', e => { e.preventDefault(); const {x,y} = getXY(e); applyXY(x,y); }, {passive:false});
        }

        window.addEventListener('DOMContentLoaded', initXYPad);

        // Initialize on first user interaction
        document.addEventListener('click', () => initAudio(), { once: true });
        document.addEventListener('touchstart', () => initAudio(), { once: true });

        // =============================================
        // STATE MANAGEMENT
        // =============================================
        let state = {
            currentSequence: 0,
            sequences: [
                {
                    name: 'SEQ 01',
                    length: 4,
                    instruments: [],
                    notes: {} // { instId: [{ beat, pad, time }] }
                }
            ],
            activeInstrumentId: null,
            isPlaying: false,
            isRecording: false,
            currentBeat: 0,
            bpm: 120,
            bpmActive: false,

            // Song arrangement
            songArrangement: [],

            // Tape
            tapeRecording: false,
            tapePlaying: false,
            recordedBlob: null,

            // Sampler
            sampler: {
                isRecording: false,
                recordingStartTime: 0,
                recordedBuffer: null,
                chops: [], // [{ pad, start, end }]
                activeChop: null // { pad, start }
            }
        };

        let playInterval = null;
        let metronomeOsc = null;

        // Instrument counter for unique IDs
        let instrumentIdCounter = 0;

        // =============================================
        // DUMMY SOUNDS (Web Audio Synthesized)
        // =============================================

        // Drum sounds (synthesized)
        const drumSounds = {
            kick: (ctx, dest) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(150, ctx.currentTime);
                osc.frequency.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
                gain.gain.setValueAtTime(1, ctx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
                osc.connect(gain);
                gain.connect(dest);
                osc.start(ctx.currentTime);
                osc.stop(ctx.currentTime + 0.5);
            },
            snare: (ctx, dest) => {
                // Noise
                const bufferSize = ctx.sampleRate * 0.2;
                const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
                const data = buffer.getChannelData(0);
                for (let i = 0; i < bufferSize; i++) {
                    data[i] = Math.random() * 2 - 1;
                }
                const noise = ctx.createBufferSource();
                noise.buffer = buffer;
                const noiseGain = ctx.createGain();
                noiseGain.gain.setValueAtTime(0.5, ctx.currentTime);
                noiseGain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);
                noise.connect(noiseGain);
                noiseGain.connect(dest);
                noise.start(ctx.currentTime);

                // Body
                const osc = ctx.createOscillator();
                const oscGain = ctx.createGain();
                osc.type = 'triangle';
                osc.frequency.value = 180;
                oscGain.gain.setValueAtTime(0.7, ctx.currentTime);
                oscGain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);
                osc.connect(oscGain);
                oscGain.connect(dest);
                osc.start(ctx.currentTime);
                osc.stop(ctx.currentTime + 0.2);
            },
            hihat: (ctx, dest) => {
                const bufferSize = ctx.sampleRate * 0.1;
                const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
                const data = buffer.getChannelData(0);
                for (let i = 0; i < bufferSize; i++) {
                    data[i] = Math.random() * 2 - 1;
                }
                const noise = ctx.createBufferSource();
                noise.buffer = buffer;
                const filter = ctx.createBiquadFilter();
                filter.type = 'highpass';
                filter.frequency.value = 7000;
                const gain = ctx.createGain();
                gain.gain.setValueAtTime(0.3, ctx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);
                noise.connect(filter);
                filter.connect(gain);
                gain.connect(dest);
                noise.start(ctx.currentTime);
            },
            clap: (ctx, dest) => {
                const bufferSize = ctx.sampleRate * 0.15;
                const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
                const data = buffer.getChannelData(0);
                for (let i = 0; i < bufferSize; i++) {
                    data[i] = Math.random() * 2 - 1;
                }
                const noise = ctx.createBufferSource();
                noise.buffer = buffer;
                const filter = ctx.createBiquadFilter();
                filter.type = 'bandpass';
                filter.frequency.value = 1200;
                const gain = ctx.createGain();
                gain.gain.setValueAtTime(0.5, ctx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);
                noise.connect(filter);
                filter.connect(gain);
                gain.connect(dest);
                noise.start(ctx.currentTime);
            },
            tom1: (ctx, dest) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(200, ctx.currentTime);
                osc.frequency.exponentialRampToValueAtTime(80, ctx.currentTime + 0.3);
                gain.gain.setValueAtTime(0.7, ctx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
                osc.connect(gain);
                gain.connect(dest);
                osc.start(ctx.currentTime);
                osc.stop(ctx.currentTime + 0.3);
            },
            tom2: (ctx, dest) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(150, ctx.currentTime);
                osc.frequency.exponentialRampToValueAtTime(60, ctx.currentTime + 0.35);
                gain.gain.setValueAtTime(0.7, ctx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.35);
                osc.connect(gain);
                gain.connect(dest);
                osc.start(ctx.currentTime);
                osc.stop(ctx.currentTime + 0.35);
            },
            rim: (ctx, dest) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'square';
                osc.frequency.value = 1800;
                gain.gain.setValueAtTime(0.3, ctx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.05);
                osc.connect(gain);
                gain.connect(dest);
                osc.start(ctx.currentTime);
                osc.stop(ctx.currentTime + 0.05);
            },
            crash: (ctx, dest) => {
                const bufferSize = ctx.sampleRate * 0.8;
                const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
                const data = buffer.getChannelData(0);
                for (let i = 0; i < bufferSize; i++) {
                    data[i] = Math.random() * 2 - 1;
                }
                const noise = ctx.createBufferSource();
                noise.buffer = buffer;
                const filter = ctx.createBiquadFilter();
                filter.type = 'highpass';
                filter.frequency.value = 5000;
                const gain = ctx.createGain();
                gain.gain.setValueAtTime(0.4, ctx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.8);
                noise.connect(filter);
                filter.connect(gain);
                gain.connect(dest);
                noise.start(ctx.currentTime);
            }
        };

        const drumPadMap = ['kick', 'snare', 'hihat', 'clap', 'tom1', 'tom2', 'rim', 'crash',
                           'kick', 'snare', 'hihat', 'clap', 'tom1', 'tom2', 'rim', 'crash'];

        // Keys sounds (simple synth)
        const keyNotes = [261.63, 293.66, 329.63, 349.23, 392.00, 440.00, 493.88, 523.25,
                         587.33, 659.25, 698.46, 783.99, 880.00, 987.77, 1046.50, 1174.66];

        function playKeyNote(ctx, dest, noteIndex) {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sawtooth';
            osc.frequency.value = keyNotes[noteIndex] || 440;

            const filter = ctx.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.setValueAtTime(2000, ctx.currentTime);
            filter.frequency.exponentialRampToValueAtTime(500, ctx.currentTime + 0.5);

            gain.gain.setValueAtTime(0.3, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);

            osc.connect(filter);
            filter.connect(gain);
            gain.connect(dest);
            osc.start(ctx.currentTime);
            osc.stop(ctx.currentTime + 0.5);
        }

        // =============================================
        // TAB NAVIGATION
        // =============================================
        function setTab(tabId, btnElement) {
            document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
            document.getElementById(tabId + '-view').classList.add('active');
            document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
            btnElement.classList.add('active');

            if (tabId === 'sampler') {
                renderSamplerPads();
                drawWaveform();
            } else if (tabId === 'song') {
                updatePatternPool();
            }
        }

        // =============================================
        // SEQUENCE MANAGEMENT
        // =============================================
        function loadSequence() {
            const seqIndex = parseInt(document.getElementById('seq-select').value);
            state.currentSequence = seqIndex;
            const seq = state.sequences[seqIndex];

            // Update length buttons
            document.querySelectorAll('.length-btn').forEach(btn => {
                btn.classList.toggle('active', parseInt(btn.textContent) === seq.length);
            });

            renderInstruments();
            renderPianoRoll();
            renderPads();
        }

        function addNewSequence() {
            const newIndex = state.sequences.length;
            const name = `SEQ ${String(newIndex + 1).padStart(2, '0')}`;
            state.sequences.push({
                name: name,
                length: 4,
                instruments: [],
                notes: {}
            });

            const select = document.getElementById('seq-select');
            const option = document.createElement('option');
            option.value = newIndex;
            option.textContent = name;
            select.appendChild(option);
            select.value = newIndex;
            loadSequence();
        }

        function setLength(len) {
            const seq = state.sequences[state.currentSequence];
            seq.length = len;

            document.querySelectorAll('.length-btn').forEach(btn => {
                btn.classList.toggle('active', parseInt(btn.textContent) === len);
            });

            renderPianoRoll();
        }

        // =============================================
        // INSTRUMENT MANAGEMENT
        // =============================================
        function showAddInstrumentModal() {
            document.getElementById('add-instrument-modal').classList.add('active');
        }

        function closeModal(id) {
            document.getElementById(id).classList.remove('active');
        }

        function addInstrument(type) {
            closeModal('add-instrument-modal');

            const seq = state.sequences[state.currentSequence];
            const id = ++instrumentIdCounter;
            const name = type === 'drums' ? `DRUMS ${id}` : `KEYS ${id}`;

            const instrument = {
                id: id,
                type: type,
                name: name,
                muted: false,
                solo: false,
                eq: { low: 0, mid: 0, high: 0, volume: 80 },
                gainNode: null,
                eqNodes: null
            };

            // Create audio nodes for this instrument
            if (audioCtx) {
                setupInstrumentAudio(instrument);
            }

            seq.instruments.push(instrument);
            seq.notes[id] = [];

            // Set as active
            state.activeInstrumentId = id;

            renderInstruments();
            renderPads();
        }

        function setupInstrumentAudio(inst) {
            if (!audioCtx) return;

            inst.gainNode = audioCtx.createGain();
            inst.gainNode.gain.value = inst.eq.volume / 100;

            inst.eqNodes = {
                low: audioCtx.createBiquadFilter(),
                mid: audioCtx.createBiquadFilter(),
                high: audioCtx.createBiquadFilter()
            };

            inst.eqNodes.low.type = 'lowshelf';
            inst.eqNodes.low.frequency.value = 320;
            inst.eqNodes.low.gain.value = inst.eq.low;

            inst.eqNodes.mid.type = 'peaking';
            inst.eqNodes.mid.frequency.value = 1000;
            inst.eqNodes.mid.Q.value = 0.5;
            inst.eqNodes.mid.gain.value = inst.eq.mid;

            inst.eqNodes.high.type = 'highshelf';
            inst.eqNodes.high.frequency.value = 3200;
            inst.eqNodes.high.gain.value = inst.eq.high;

            inst.eqNodes.low.connect(inst.eqNodes.mid);
            inst.eqNodes.mid.connect(inst.eqNodes.high);
            inst.eqNodes.high.connect(inst.gainNode);
            inst.gainNode.connect(masterGain);
        }

        function renderInstruments() {
            const seq = state.sequences[state.currentSequence];
            const container = document.getElementById('instrument-list');
            container.innerHTML = '';

            seq.instruments.forEach(inst => {
                const div = document.createElement('div');
                div.className = 'track-item' +
                    (inst.id === state.activeInstrumentId ? ' active' : '') +
                    (inst.muted ? ' muted' : '') +
                    (inst.solo ? ' solo' : '');
                div.onclick = (e) => {
                    if (e.target.classList.contains('track-ctrl-btn')) return;
                    setActiveInstrument(inst.id);
                };

                div.innerHTML = `
                    <div class="track-icon ${inst.type}">${inst.type === 'drums' ? '🥁' : (inst.type === 'sampler' ? '🎙️' : (inst.type === 'library' ? '📂' : '🎹'))}</div>
                    <div class="track-info">
                        <div class="track-name">${inst.name}</div>
                    </div>
                    <div class="track-controls">
                        <button class="track-ctrl-btn" onclick="openEQ(${inst.id})" title="Edit">E</button>
                        <button class="track-ctrl-btn ${inst.solo ? 'active' : ''}" onclick="toggleSolo(${inst.id})" title="Solo">S</button>
                        <button class="track-ctrl-btn ${inst.muted ? 'active' : ''}" onclick="toggleMute(${inst.id})" title="Mute">M</button>
                        <button class="track-ctrl-btn del" onclick="deleteInstrument(${inst.id})" title="Delete">✕</button>
                    </div>
                `;
                container.appendChild(div);
            });
        }

        function setActiveInstrument(id) {
            state.activeInstrumentId = id;
            renderInstruments();
            renderPads();
        }

        function toggleSolo(id) {
            const seq = state.sequences[state.currentSequence];
            const inst = seq.instruments.find(i => i.id === id);
            if (inst) {
                inst.solo = !inst.solo;
                updateInstrumentGains();
                renderInstruments();
            }
        }

        function toggleMute(id) {
            const seq = state.sequences[state.currentSequence];
            const inst = seq.instruments.find(i => i.id === id);
            if (inst) {
                inst.muted = !inst.muted;
                updateInstrumentGains();
                renderInstruments();
            }
        }

        function updateInstrumentGains() {
            const seq = state.sequences[state.currentSequence];
            const hasSolo = seq.instruments.some(i => i.solo);

            seq.instruments.forEach(inst => {
                if (inst.gainNode) {
                    if (inst.muted) {
                        inst.gainNode.gain.value = 0;
                    } else if (hasSolo && !inst.solo) {
                        inst.gainNode.gain.value = 0;
                    } else {
                        inst.gainNode.gain.value = inst.eq.volume / 100;
                    }
                }
            });
        }

        function deleteInstrument(id) {
            const seq = state.sequences[state.currentSequence];
            const index = seq.instruments.findIndex(i => i.id === id);
            if (index > -1) {
                const inst = seq.instruments[index];
                if (inst.gainNode) {
                    inst.gainNode.disconnect();
                }
                seq.instruments.splice(index, 1);
                delete seq.notes[id];

                if (state.activeInstrumentId === id) {
                    state.activeInstrumentId = seq.instruments.length > 0 ? seq.instruments[0].id : null;
                }

                renderInstruments();
                renderPads();
            }
        }

        // EQ
        function openEQ(instId) {
            state.activeInstrumentId = instId;
            const seq = state.sequences[state.currentSequence];
            const inst = seq.instruments.find(i => i.id === instId);
            if (!inst) return;

            document.getElementById('eq-inst-name').textContent = inst.name;
            document.getElementById('eq-low').value = inst.eq.low;
            document.getElementById('eq-mid').value = inst.eq.mid;
            document.getElementById('eq-high').value = inst.eq.high;
            document.getElementById('eq-vol').value = inst.eq.volume;

            document.getElementById('eq-low-val').textContent = inst.eq.low + ' dB';
            document.getElementById('eq-mid-val').textContent = inst.eq.mid + ' dB';
            document.getElementById('eq-high-val').textContent = inst.eq.high + ' dB';
            document.getElementById('eq-vol-val').textContent = inst.eq.volume + '%';

            const tuningGroup = document.getElementById('tuning-group');
            if (inst.type === 'sampler') {
                tuningGroup.style.display = 'flex';
                document.getElementById('eq-tuning').value = inst.tuning || 0;
                document.getElementById('eq-tuning-val').textContent = inst.tuning || 0;
            } else {
                tuningGroup.style.display = 'none';
            }

            document.getElementById('eq-modal').classList.add('active');
        }

        function updateEQ() {
            const seq = state.sequences[state.currentSequence];
            const inst = seq.instruments.find(i => i.id === state.activeInstrumentId);
            if (!inst) return;

            inst.eq.low = parseInt(document.getElementById('eq-low').value);
            inst.eq.mid = parseInt(document.getElementById('eq-mid').value);
            inst.eq.high = parseInt(document.getElementById('eq-high').value);
            inst.eq.volume = parseInt(document.getElementById('eq-vol').value);

            document.getElementById('eq-low-val').textContent = inst.eq.low + ' dB';
            document.getElementById('eq-mid-val').textContent = inst.eq.mid + ' dB';
            document.getElementById('eq-high-val').textContent = inst.eq.high + ' dB';
            document.getElementById('eq-vol-val').textContent = inst.eq.volume + '%';

            if (inst.type === 'sampler') {
                inst.tuning = parseInt(document.getElementById('eq-tuning').value);
                document.getElementById('eq-tuning-val').textContent = inst.tuning;
            }

            // Apply to audio nodes
            if (inst.eqNodes) {
                inst.eqNodes.low.gain.value = inst.eq.low;
                inst.eqNodes.mid.gain.value = inst.eq.mid;
                inst.eqNodes.high.gain.value = inst.eq.high;
            }
            if (inst.gainNode && !inst.muted) {
                inst.gainNode.gain.value = inst.eq.volume / 100;
            }
        }

        // =============================================
        // PIANO ROLL
        // =============================================
        function renderPianoRoll() {
            const seq = state.sequences[state.currentSequence];
            const grid = document.getElementById('piano-roll-grid');
            grid.innerHTML = '';

            const totalBeats = seq.length * 4; // 4 beats per bar

            for (let i = 0; i < totalBeats; i++) {
                const beat = document.createElement('div');
                beat.className = 'piano-beat';
                beat.dataset.beat = i;

                if (i % 4 === 0) {
                    const marker = document.createElement('div');
                    marker.className = 'beat-marker';
                    marker.textContent = Math.floor(i / 4) + 1;
                    beat.appendChild(marker);
                }

                grid.appendChild(beat);
            }

            // Render recorded notes
            renderNotesOnPianoRoll();
        }

        function renderNotesOnPianoRoll() {
            const seq = state.sequences[state.currentSequence];
            const grid = document.getElementById('piano-roll-grid');
            const inst = seq.instruments.find(i => i.id === state.activeInstrumentId);

            // Remove existing notes
            grid.querySelectorAll('.piano-note').forEach(n => n.remove());

            // Add notes for active instrument
            if (state.activeInstrumentId && seq.notes[state.activeInstrumentId]) {
                seq.notes[state.activeInstrumentId].forEach(note => {
                    const beatEl = grid.querySelector(`[data-beat="${note.beat}"]`);
                    if (beatEl) {
                        const noteEl = document.createElement('div');
                        noteEl.className = 'piano-note';
                        noteEl.style.top = (5 + note.pad * 3) + 'px';
                        noteEl.style.left = '2px';
                        noteEl.style.width = '80%';
                        
                        if (inst && inst.type === 'sampler' && state.sampler.recordedBuffer) {
                            const chop = state.sampler.chops.find(c => c.pad === note.pad);
                            if (chop) {
                                const canvas = document.createElement('canvas');
                                canvas.width = 40;
                                canvas.height = 10;
                                canvas.style.width = '100%';
                                canvas.style.height = '100%';
                                drawSmallWaveform(canvas, chop);
                                noteEl.appendChild(canvas);
                                noteEl.style.background = 'transparent';
                                noteEl.style.border = '1px solid var(--orange)';
                            }
                        }
                        
                        beatEl.appendChild(noteEl);
                    }
                });
            }
        }

        function drawSmallWaveform(canvas, chop) {
            const ctx = canvas.getContext('2d');
            const data = state.sampler.recordedBuffer.getChannelData(0);
            const startIdx = Math.floor(chop.start * state.sampler.recordedBuffer.sampleRate);
            const endIdx = Math.floor(chop.end * state.sampler.recordedBuffer.sampleRate);
            const slice = data.slice(startIdx, endIdx);
            
            ctx.fillStyle = 'rgba(242, 92, 25, 0.5)';
            const step = Math.ceil(slice.length / canvas.width);
            const amp = canvas.height / 2;
            for (let i = 0; i < canvas.width; i++) {
                let min = 1.0;
                let max = -1.0;
                for (let j = 0; j < step; j++) {
                    const datum = slice[(i * step) + j];
                    if (datum < min) min = datum;
                    if (datum > max) max = datum;
                }
                ctx.fillRect(i, (1 + min) * amp, 1, Math.max(1, (max - min) * amp));
            }
        }

        function highlightBeat(beatIndex) {
            document.querySelectorAll('.piano-beat').forEach((b, i) => {
                b.classList.toggle('active', i === beatIndex);
            });
        }

        // =============================================
        // PAD GRID
        // =============================================
        function renderPads() {
            const seq = state.sequences[state.currentSequence];
            const inst = seq.instruments.find(i => i.id === state.activeInstrumentId);
            const grid = document.getElementById('pad-grid');
            grid.innerHTML = '';

            for (let i = 0; i < 16; i++) {
                const pad = document.createElement('div');
                pad.className = 'pad';
                pad.dataset.pad = i;

                if (inst) {
                    if (inst.type === 'drums') {
                        pad.textContent = drumPadMap[i].toUpperCase().slice(0, 3);
                    } else if (inst.type === 'sampler') {
                        pad.textContent = "CHOP " + (i + 1);
                        if (state.sampler.chops.find(c => c.pad === i)) {
                            pad.classList.add('has-sample');
                        }
                    } else if (inst.type === 'library') {
                        const padName = inst.padNames[i];
                        if (padName) {
                            pad.textContent = padName;
                            pad.classList.add('has-sample');
                        } else {
                            pad.textContent = '-';
                            pad.style.opacity = '0.3';
                        }
                    } else {
                        const notes = ['C', 'D', 'E', 'F', 'G', 'A', 'B', 'C+', 'D+', 'E+', 'F+', 'G+', 'A+', 'B+', 'C++', 'D++'];
                        pad.textContent = notes[i];
                    }
                }

                pad.onmousedown = () => hitPad(i);
                pad.ontouchstart = (e) => { e.preventDefault(); hitPad(i); };

                grid.appendChild(pad);
            }
        }

        function hitPad(padIndex) {
            initAudio();

            const seq = state.sequences[state.currentSequence];
            const inst = seq.instruments.find(i => i.id === state.activeInstrumentId);
            if (!inst) return;

            // Ensure audio nodes are set up
            if (!inst.gainNode) {
                setupInstrumentAudio(inst);
            }

            // Visual feedback
            const pad = document.querySelector(`.pad[data-pad="${padIndex}"]`);
            if (pad) {
                pad.classList.add('hit');
                setTimeout(() => pad.classList.remove('hit'), 100);
            }

            // Play sound
            const destination = inst.eqNodes ? inst.eqNodes.low : masterGain;

            if (inst.type === 'drums') {
                const soundName = drumPadMap[padIndex];
                if (drumSounds[soundName]) {
                    drumSounds[soundName](audioCtx, destination);
                } else {
                    playMetronomeClick();
                }
            } else if (inst.type === 'sampler') {
                playChop(padIndex, inst.tuning || 0, destination);
            } else if (inst.type === 'library') {
                playLibrarySample(inst, padIndex);
            } else {
                playKeyNote(audioCtx, destination, padIndex);
            }

            // Record if recording
            if (state.isRecording && state.isPlaying) {
                const note = {
                    beat: state.currentBeat,
                    pad: padIndex,
                    time: audioCtx.currentTime,
                    _justRecorded: true  // prevent double sound this tick
                };
                seq.notes[inst.id].push(note);
                // Clear the flag after this tick duration
                setTimeout(() => { note._justRecorded = false; }, 60000 / state.bpm / 4);
                renderNotesOnPianoRoll();
            }
        }

        // =============================================
        // TRANSPORT CONTROLS
        // =============================================
        let countdownTimeout = null;

        function toggleRec() {
            if (state.isRecording) {
                // Stop recording immediately
                state.isRecording = false;
                const btn = document.querySelector('.btn-rec');
                btn.classList.remove('recording');
                clearCountdown();
                updateLCD();
            } else {
                // Start countdown then record
                startCountdownThenRecord();
            }
        }

        function clearCountdown() {
            if (countdownTimeout) { clearTimeout(countdownTimeout); countdownTimeout = null; }
            const el = document.getElementById('countdown-display');
            if (el) el.textContent = '';
        }

        function startCountdownThenRecord() {
            const el = document.getElementById('countdown-display');
            const beatMs = 60000 / state.bpm;
            const steps = ['4', '3', '2', '1', 'GO'];
            let i = 0;

            // Pulse metronome click during countdown
            function tick() {
                if (i < steps.length) {
                    if (el) {
                        el.textContent = steps[i];
                        el.classList.remove('go');
                        if (steps[i] === 'GO') el.classList.add('go');
                    }
                    playMetronomeClick();
                    i++;
                    countdownTimeout = setTimeout(tick, beatMs);
                } else {
                    // Countdown done - start recording
                    if (el) {
                        el.textContent = '●';
                        el.classList.remove('go');
                    }
                    state.isRecording = true;
                    const btn = document.querySelector('.btn-rec');
                    btn.classList.add('recording');
                    if (!state.isPlaying) startPlayback();
                    updateLCD();
                    // Clear dot after a moment
                    countdownTimeout = setTimeout(() => {
                        if (el && el.textContent === '●') el.textContent = '';
                    }, 500);
                }
            }
            tick();
        }

        function togglePlay() {
            if (state.isPlaying) {
                stopPlayback();
            } else {
                startPlayback();
            }
        }

        function startPlayback() {
            initAudio();
            state.isPlaying = true;
            state.currentBeat = 0;

            const btn = document.querySelector('.btn-play');
            btn.classList.add('playing');

            const seq = state.sequences[state.currentSequence];
            const totalBeats = seq.length * 4;
            const beatDuration = 60000 / state.bpm / 4; // 16th notes

            playInterval = setInterval(() => {
                highlightBeat(state.currentBeat);

                // Play metronome if active
                if (state.bpmActive && state.currentBeat % 4 === 0) {
                    playMetronomeClick();
                }

                // Play recorded notes (skip notes recorded THIS tick to prevent double sound)
                seq.instruments.forEach(inst => {
                    if (inst.muted) return;
                    const hasSolo = seq.instruments.some(i => i.solo);
                    if (hasSolo && !inst.solo) return;

                    const notes = seq.notes[inst.id] || [];
                    notes.filter(n => n.beat === state.currentBeat && !n._justRecorded).forEach(n => {
                        playNoteForInstrument(inst, n.pad);
                    });
                });

                state.currentBeat = (state.currentBeat + 1) % totalBeats;
                updateLCD();
            }, beatDuration);

            updateLCD();
        }

        function stopPlayback() {
            state.isPlaying = false;
            state.currentBeat = 0;

            if (playInterval) {
                clearInterval(playInterval);
                playInterval = null;
            }

            document.querySelector('.btn-play').classList.remove('playing');
            highlightBeat(-1);
            updateLCD();
        }

        function playNoteForInstrument(inst, padIndex) {
            if (!audioCtx || !inst.eqNodes) return;

            const destination = inst.eqNodes.low;

            if (inst.type === 'drums') {
                const soundName = drumPadMap[padIndex];
                if (drumSounds[soundName]) {
                    drumSounds[soundName](audioCtx, destination);
                } else {
                    playMetronomeClick();
                }
            } else if (inst.type === 'sampler') {
                playChop(padIndex, inst.tuning || 0, destination);
            } else if (inst.type === 'library') {
                playLibrarySample(inst, padIndex);
            } else {
                playKeyNote(audioCtx, destination, padIndex);
            }
        }

        function playMetronomeClick() {
            if (!audioCtx) return;
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = 'sine';
            osc.frequency.value = 1000;
            gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.05);
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.start(audioCtx.currentTime);
            osc.stop(audioCtx.currentTime + 0.05);
        }

        function updateLCD() {
            const seq = state.sequences[state.currentSequence];
            const bar = Math.floor(state.currentBeat / 4) + 1;
            const beat = (state.currentBeat % 4) + 1;
            const status = state.isRecording ? 'REC' : (state.isPlaying ? 'PLAY' : 'STOP');
            document.getElementById('seq-lcd').textContent = `BAR ${bar}:${beat} | ${status}`;
            document.getElementById('seq-lcd').style.color = state.isRecording ? '#f00' : '#f25c19';
        }

        // BPM
        function toggleBPM() {
            state.bpmActive = !state.bpmActive;
            document.getElementById('bpm-toggle').classList.toggle('active', state.bpmActive);
        }

        document.getElementById('bpm-input').addEventListener('change', (e) => {
            state.bpm = parseInt(e.target.value) || 120;
            if (state.isPlaying) {
                stopPlayback();
                startPlayback();
            }
        });

        // =============================================
        // SONG TAB
        // =============================================
        function updatePatternPool() {
            const pool = document.getElementById('patternPool');
            pool.innerHTML = '';

            state.sequences.forEach((seq, index) => {
                const item = document.createElement('div');
                item.className = 'pool-item';
                item.textContent = seq.name;
                item.onclick = () => addToSong(index);
                pool.appendChild(item);
            });
        }

        function addToSong(seqIndex) {
            const seq = state.sequences[seqIndex];
            state.songArrangement.push(seqIndex);

            const timeline = document.getElementById('songTimeline');
            const block = document.createElement('div');
            block.className = 'timeline-block';
            block.dataset.index = state.songArrangement.length - 1;

            block.innerHTML = `
                <span>${seq.name}</span>
                <span style="font-size:8px;color:#666;">${seq.length} bars</span>
                <div class="remove-block" onclick="removeFromSong(event, ${state.songArrangement.length - 1})">✕</div>
            `;

            timeline.appendChild(block);
        }

        function removeFromSong(event, index) {
            event.stopPropagation();
            state.songArrangement.splice(index, 1);
            renderSongTimeline();
        }

        function renderSongTimeline() {
            const timeline = document.getElementById('songTimeline');
            timeline.innerHTML = '<div style="position: absolute; left: 10px; top: 5px; color: #999; font-size: 10px; pointer-events:none;">SONG ARRANGEMENT ▶</div>';

            state.songArrangement.forEach((seqIndex, i) => {
                const seq = state.sequences[seqIndex];
                const block = document.createElement('div');
                block.className = 'timeline-block';
                block.innerHTML = `
                    <span>${seq.name}</span>
                    <span style="font-size:8px;color:#666;">${seq.length} bars</span>
                    <div class="remove-block" onclick="removeFromSong(event, ${i})">✕</div>
                `;
                timeline.appendChild(block);
            });
        }

        // =============================================
        // TAPE TAB - Recording & Export
        // =============================================
        let mediaRecorder = null;
        let recordedChunks = [];
        let songPlaybackInterval = null;
        let currentSongPosition = 0;
        let vuAnimationFrame = null;

        function playTape() {
            if (state.songArrangement.length === 0) {
                alert('No song arrangement! Add sequences in SONG tab first.');
                return;
            }

            initAudio();
            state.tapePlaying = true;
            currentSongPosition = 0;

            document.getElementById('tape-play-btn').classList.add('playing');
            document.getElementById('spool1').classList.add('spinning');
            document.getElementById('spool2').classList.add('spinning');
            document.getElementById('tape-status').textContent = '▶ PLAYING';

            playSongFromPosition();
            startVUMeter();
            startVinylFX();
        }

        function playSongFromPosition() {
            if (!state.tapePlaying || currentSongPosition >= state.songArrangement.length) {
                stopTape();
                return;
            }

            const seqIndex = state.songArrangement[currentSongPosition];
            const seq = state.sequences[seqIndex];
            const totalBeats = seq.length * 4;
            const beatDuration = 60000 / state.bpm / 4;
            let currentBeat = 0;

            // Ensure all instruments have audio nodes
            seq.instruments.forEach(inst => {
                if (!inst.gainNode) {
                    setupInstrumentAudio(inst);
                }
            });

            songPlaybackInterval = setInterval(() => {
                if (!state.tapePlaying) {
                    clearInterval(songPlaybackInterval);
                    return;
                }

                // Play notes for current beat
                seq.instruments.forEach(inst => {
                    if (inst.muted) return;
                    const hasSolo = seq.instruments.some(i => i.solo);
                    if (hasSolo && !inst.solo) return;

                    const notes = seq.notes[inst.id] || [];
                    notes.filter(n => n.beat === currentBeat).forEach(n => {
                        playNoteForInstrument(inst, n.pad);
                    });
                });

                currentBeat++;

                if (currentBeat >= totalBeats) {
                    clearInterval(songPlaybackInterval);
                    currentSongPosition++;
                    playSongFromPosition();
                }
            }, beatDuration);
        }

        function stopTape() {
            state.tapePlaying = false;

            if (songPlaybackInterval) {
                clearInterval(songPlaybackInterval);
                songPlaybackInterval = null;
            }

            document.getElementById('tape-play-btn').classList.remove('playing');
            document.getElementById('spool1').classList.remove('spinning');
            document.getElementById('spool2').classList.remove('spinning');
            if (!state.tapeRecording) {
                document.getElementById('tape-status').textContent = '● READY';
            }
            document.getElementById('tape-status').classList.remove('recording');

            stopVUMeter();
            stopVinylFX();

            // Stop recording if active
            if (state.tapeRecording && mediaRecorder && mediaRecorder.state !== 'inactive') {
                mediaRecorder.stop(); // triggers onstop async which shows the file
                state.tapeRecording = false;
                document.getElementById('tape-rec-btn').classList.remove('recording');
            }
        }

        function rewindTape() {
            currentSongPosition = 0;
            document.getElementById('tape-status').textContent = '⏪ REWOUND';
            setTimeout(() => {
                if (!state.tapePlaying) {
                    document.getElementById('tape-status').textContent = '● READY';
                }
            }, 1000);
        }

        function recTape() {
            if (state.songArrangement.length === 0) {
                alert('No song arrangement! Add sequences in SONG tab first.');
                return;
            }

            initAudio();

            // Create a destination for recording
            const dest = audioCtx.createMediaStreamDestination();
            masterAnalyser.connect(dest);

            recordedChunks = [];
            mediaRecorder = new MediaRecorder(dest.stream, {
                mimeType: 'audio/webm;codecs=opus'
            });

            mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) {
                    recordedChunks.push(e.data);
                }
            };

            mediaRecorder.onstop = async () => {
                const webmBlob = new Blob(recordedChunks, { type: 'audio/webm' });
                document.getElementById('tape-status').textContent = '⏳ CONVERTING TO WAV...';
                try {
                    const wavBlob = await convertToWav(webmBlob);
                    state.recordedBlob = wavBlob;
                } catch(e) {
                    console.warn('WAV conversion failed, keeping webm:', e);
                    state.recordedBlob = webmBlob;
                }
                // Show save button in deck controls
                const btn = document.getElementById('save-song-btn');
                if (btn) btn.style.display = 'flex';
                document.getElementById('tape-status').textContent = '✓ READY — HIT SAVE';
            };

            state.tapeRecording = true;
            mediaRecorder.start();

            document.getElementById('tape-rec-btn').classList.add('recording');
            document.getElementById('tape-status').textContent = '⏺ RECORDING...';
            document.getElementById('tape-status').classList.add('recording');

            // Start playback
            playTape();
        }

        async function getSong() {
            if (!state.recordedBlob) return;

            const fileName = 'cronki-song.wav';

            // Try Web Share API first (works on mobile + Electron with share support)
            if (navigator.canShare && navigator.canShare({ files: [new File([state.recordedBlob], fileName, { type: 'audio/wav' })] })) {
                try {
                    const file = new File([state.recordedBlob], fileName, { type: 'audio/wav' });
                    await navigator.share({
                        title: 'My Cronki Song',
                        text: 'Made with Cronki 🎛️',
                        files: [file]
                    });
                    return;
                } catch(e) {
                    if (e.name !== 'AbortError') {
                        console.warn('Share failed, falling back to download:', e);
                    } else {
                        return; // user cancelled
                    }
                }
            }

            // Fallback: direct file download
            const url = URL.createObjectURL(state.recordedBlob);
            const a = document.createElement('a');
            a.href = url;
            a.download = fileName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        }

        // Keep old name as alias for compatibility
        function downloadRecording() { getSong(); }

        // VU Meter animation
        function startVUMeter() {
            if (!masterAnalyser) return;

            const dataArray = new Uint8Array(masterAnalyser.frequencyBinCount);

            function updateVU() {
                if (!state.tapePlaying && !state.tapeRecording) return;

                masterAnalyser.getByteFrequencyData(dataArray);

                // Calculate average levels for left/right (simplified)
                let sum = 0;
                for (let i = 0; i < dataArray.length; i++) {
                    sum += dataArray[i];
                }
                const avg = sum / dataArray.length;
                const level = Math.min(40, (avg / 255) * 50);

                document.getElementById('vu-left').style.height = level + 'px';
                document.getElementById('vu-right').style.height = (level * 0.9 + Math.random() * 5) + 'px';

                vuAnimationFrame = requestAnimationFrame(updateVU);
            }

            updateVU();
        }

        function stopVUMeter() {
            if (vuAnimationFrame) {
                cancelAnimationFrame(vuAnimationFrame);
                vuAnimationFrame = null;
            }
            document.getElementById('vu-left').style.height = '5px';
            document.getElementById('vu-right').style.height = '5px';
        }

        // =============================================
        // INITIALIZATION
        // =============================================
        function init() {
            renderPianoRoll();
            renderPads();
            renderInstruments();
            updatePatternPool();
            
            // Ensure we have an active instrument
            if (state.sequences[state.currentSequence].instruments.length > 0 && !state.activeInstrumentId) {
                state.activeInstrumentId = state.sequences[state.currentSequence].instruments[0].id;
                renderInstruments();
                renderPads();
            }
        }

        init();
        // =============================================
        // SAMPLER LOGIC
        // =============================================
        let samplerMediaRecorder = null;
        let samplerAudioChunks = [];
        let samplerStream = null;
        let samplerAnalyser = null;
        let samplerAnimationId = null;

        async function toggleSamplerRec() {
            initAudio();
            if (state.sampler.isRecording) {
                stopSamplerRecording();
            } else {
                await startSamplerRecording();
            }
        }

        async function startSamplerRecording() {
            try {
                samplerStream = await navigator.mediaDevices.getUserMedia({ audio: true });
                samplerMediaRecorder = new MediaRecorder(samplerStream);
                samplerAudioChunks = [];

                samplerMediaRecorder.ondataavailable = (e) => {
                    if (e.data.size > 0) samplerAudioChunks.push(e.data);
                };

                samplerMediaRecorder.onstop = async () => {
                    const blob = new Blob(samplerAudioChunks, { type: 'audio/wav' });
                    const arrayBuffer = await blob.arrayBuffer();
                    state.sampler.recordedBuffer = await audioCtx.decodeAudioData(arrayBuffer);
                    drawWaveform();
                    updateSamplerLCD("RECORDING FINISHED");
                };

                samplerMediaRecorder.start();
                state.sampler.isRecording = true;
                state.sampler.recordingStartTime = audioCtx.currentTime;
                state.sampler.chops = [];
                
                document.getElementById('sampler-rec-btn').classList.add('recording');
                document.getElementById('sampler-vinyl').classList.add('rotating');
                updateSamplerLCD("RECORDING...");

                // VU Meter
                const source = audioCtx.createMediaStreamSource(samplerStream);
                samplerAnalyser = audioCtx.createAnalyser();
                samplerAnalyser.fftSize = 256;
                source.connect(samplerAnalyser);
                updateSamplerVU();

                // Max 30 seconds
                setTimeout(() => {
                    if (state.sampler.isRecording) stopSamplerRecording();
                }, 30000);

            } catch (err) {
                console.error("Error accessing microphone:", err);
                alert("Could not access microphone.");
            }
        }

        function stopSamplerRecording() {
            if (samplerMediaRecorder && state.sampler.isRecording) {
                samplerMediaRecorder.stop();
                samplerStream.getTracks().forEach(track => track.stop());
                state.sampler.isRecording = false;
                
                document.getElementById('sampler-rec-btn').classList.remove('recording');
                document.getElementById('sampler-vinyl').classList.remove('rotating');
                cancelAnimationFrame(samplerAnimationId);
                document.getElementById('sampler-vu-bar').style.height = '0%';
            }
        }

        function updateSamplerVU() {
            if (!state.sampler.isRecording) return;
            const dataArray = new Uint8Array(samplerAnalyser.frequencyBinCount);
            samplerAnalyser.getByteFrequencyData(dataArray);
            const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
            const height = Math.min(100, (average / 128) * 100);
            document.getElementById('sampler-vu-bar').style.height = height + '%';
            samplerAnimationId = requestAnimationFrame(updateSamplerVU);
        }

        function updateSamplerLCD(text) {
            document.getElementById('sampler-lcd').textContent = text;
        }

        function renderSamplerPads() {
            const grid = document.getElementById('sampler-pad-grid');
            grid.innerHTML = '';
            for (let i = 0; i < 16; i++) {
                const pad = document.createElement('div');
                pad.className = 'pad';
                if (state.sampler.chops.find(c => c.pad === i)) {
                    pad.classList.add('has-sample');
                }
                pad.dataset.pad = i;
                pad.textContent = "PAD " + (i + 1);

                pad.onmousedown = () => startChop(i);
                pad.onmouseup = () => endChop(i);
                pad.ontouchstart = (e) => { e.preventDefault(); startChop(i); };
                pad.ontouchend = (e) => { e.preventDefault(); endChop(i); };

                grid.appendChild(pad);
            }
        }

        function startChop(padIndex) {
            if (!state.sampler.isRecording) {
                playChop(padIndex);
                return;
            }
            state.sampler.activeChop = {
                pad: padIndex,
                start: audioCtx.currentTime - state.sampler.recordingStartTime
            };
            const pad = document.querySelector(`#sampler-pad-grid .pad[data-pad="${padIndex}"]`);
            pad.classList.add('chopping');
        }

        function endChop(padIndex) {
            if (!state.sampler.isRecording || !state.sampler.activeChop || state.sampler.activeChop.pad !== padIndex) return;
            
            const endTime = audioCtx.currentTime - state.sampler.recordingStartTime;
            state.sampler.chops = state.sampler.chops.filter(c => c.pad !== padIndex);
            state.sampler.chops.push({
                pad: padIndex,
                start: state.sampler.activeChop.start,
                end: endTime
            });
            
            state.sampler.activeChop = null;
            const pad = document.querySelector(`#sampler-pad-grid .pad[data-pad="${padIndex}"]`);
            pad.classList.remove('chopping');
            pad.classList.add('has-sample');
            drawWaveform();
        }

        function playChop(padIndex, tuning = 0, destination = null) {
            if (!state.sampler.recordedBuffer) return;
            const chop = state.sampler.chops.find(c => c.pad === padIndex);
            if (!chop) return;

            const source = audioCtx.createBufferSource();
            source.buffer = state.sampler.recordedBuffer;
            
            // Tuning: 1 semitone = 2^(1/12)
            source.playbackRate.value = Math.pow(2, tuning / 12);
            
            const dest = destination || masterGain;
            source.connect(dest);
            source.start(0, chop.start, chop.end - chop.start);
        }

        function drawWaveform() {
            const canvas = document.getElementById('sampler-waveform');
            const ctx = canvas.getContext('2d');
            const width = canvas.width = canvas.offsetWidth;
            const height = canvas.height = canvas.offsetHeight;

            ctx.fillStyle = '#222';
            ctx.fillRect(0, 0, width, height);

            if (!state.sampler.recordedBuffer) return;

            const data = state.sampler.recordedBuffer.getChannelData(0);
            const step = Math.ceil(data.length / width);
            const amp = height / 2;

            ctx.strokeStyle = varColor('--orange');
            ctx.beginPath();
            ctx.moveTo(0, amp);

            for (let i = 0; i < width; i++) {
                let min = 1.0;
                let max = -1.0;
                for (let j = 0; j < step; j++) {
                    const datum = data[(i * step) + j];
                    if (datum < min) min = datum;
                    if (datum > max) max = datum;
                }
                ctx.lineTo(i, (1 + min) * amp);
                ctx.lineTo(i, (1 + max) * amp);
            }
            ctx.stroke();

            // Draw chops
            state.sampler.chops.forEach(chop => {
                const x1 = (chop.start / state.sampler.recordedBuffer.duration) * width;
                const x2 = (chop.end / state.sampler.recordedBuffer.duration) * width;
                ctx.fillStyle = 'rgba(242, 92, 25, 0.3)';
                ctx.fillRect(x1, 0, x2 - x1, height);
                ctx.strokeStyle = '#fff';
                ctx.strokeRect(x1, 0, x2 - x1, height);
                ctx.fillStyle = '#fff';
                ctx.font = '10px monospace';
                ctx.fillText(chop.pad + 1, x1 + 2, 12);
            });
        }

        function varColor(name) {
            return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
        }
        // =============================================
        // VINYL FX (TAPE NOISE) - Always-on signature sound
        // =============================================
        let vinylAudio = null;
        let vinylGainNode = null;
        let vinylConnected = false;

        function initVinylFX() {
            if (vinylConnected) return;
            vinylAudio = new Audio(VINYL_FX_DATA);
            vinylAudio.loop = true;
            vinylAudio.volume = 0.18;

            try {
                const source = audioCtx.createMediaElementSource(vinylAudio);
                vinylGainNode = audioCtx.createGain();
                vinylGainNode.gain.value = 0.18;
                source.connect(vinylGainNode);
                vinylGainNode.connect(masterGain);
                vinylConnected = true;
            } catch(e) {
                console.warn('Vinyl FX connect error:', e);
            }
        }

        function startVinylFX() {
            if (!audioCtx) return;
            if (!vinylConnected) initVinylFX();
            if (vinylAudio && vinylAudio.paused) {
                vinylAudio.play().catch(e => console.log('Vinyl play error:', e));
            }
        }

        function stopVinylFX() {
            if (vinylAudio && !vinylAudio.paused) {
                vinylAudio.pause();
                vinylAudio.currentTime = 0;
            }
        }

        // =============================================
        // SOUND LIBRARY
        // =============================================
        let currentLibraryBank = null;
        const libraryAudioPreviews = {};

        function openSoundLibrary() {
            closeModal('add-instrument-modal');
            currentLibraryBank = null;
            renderLibraryBanks();
            renderLibraryPads();
            document.getElementById('library-inst-name').value = '';
            document.getElementById('sound-library-modal').classList.add('active');
        }

        function renderLibraryBanks() {
            const nav = document.getElementById('library-nav');
            nav.innerHTML = '';

            Object.keys(SOUND_BANK_DATA).forEach(bankName => {
                const btn = document.createElement('button');
                btn.className = 'library-bank-btn' + (bankName === currentLibraryBank ? ' active' : '');
                btn.textContent = bankName.toUpperCase();
                btn.onclick = () => {
                    currentLibraryBank = bankName;
                    document.getElementById('library-inst-name').value = bankName;
                    renderLibraryBanks();
                    renderLibraryPads();
                };
                nav.appendChild(btn);
            });
        }

        function renderLibraryPads() {
            const container = document.getElementById('library-pads');
            container.innerHTML = '';

            if (!currentLibraryBank || !SOUND_BANK_DATA[currentLibraryBank]) {
                container.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:#555;font-size:10px;padding:20px;">SELECT A BANK ABOVE</div>';
                return;
            }

            const samples = SOUND_BANK_DATA[currentLibraryBank];
            Object.entries(samples).forEach(([padName, dataUrl]) => {
                const pad = document.createElement('div');
                pad.className = 'library-pad';
                pad.textContent = padName;
                pad.onclick = () => previewLibrarySample(padName, dataUrl, pad);
                container.appendChild(pad);
            });
        }

        function previewLibrarySample(name, dataUrl, padEl) {
            Object.values(libraryAudioPreviews).forEach(a => { try { a.pause(); a.currentTime = 0; } catch(e){} });
            document.querySelectorAll('.library-pad.preview').forEach(p => p.classList.remove('preview'));

            const audio = new Audio(dataUrl);
            libraryAudioPreviews[name] = audio;
            audio.play().catch(e => console.log('Preview error:', e));
            padEl.classList.add('preview');
            audio.onended = () => padEl.classList.remove('preview');
        }

        function confirmAddLibraryInstrument() {
            if (!currentLibraryBank) {
                alert('Please select a sound bank first.');
                return;
            }

            const instName = document.getElementById('library-inst-name').value.trim() || currentLibraryBank;
            const samples = SOUND_BANK_DATA[currentLibraryBank];

            Object.values(libraryAudioPreviews).forEach(a => { try { a.pause(); a.currentTime = 0; } catch(e){} });
            closeModal('sound-library-modal');

            initAudio();
            const seq = state.sequences[state.currentSequence];
            const id = ++instrumentIdCounter;

            const instrument = {
                id: id,
                type: 'library',
                name: instName,
                muted: false,
                solo: false,
                eq: { low: 0, mid: 0, high: 0, volume: 80 },
                gainNode: null,
                eqNodes: null,
                bankName: currentLibraryBank,
                samples: samples,
                padNames: Object.keys(samples),
                audioBuffers: {}
            };

            if (audioCtx) setupInstrumentAudio(instrument);

            seq.instruments.push(instrument);
            seq.notes[id] = [];
            state.activeInstrumentId = id;

            renderInstruments();
            renderPads();
        }

        function playLibrarySample(inst, padIndex) {
            const padName = inst.padNames[padIndex];
            if (!padName) return;

            if (!audioCtx) return;
            if (!inst.gainNode) setupInstrumentAudio(inst);

            if (inst.audioBuffers[padName]) {
                _triggerLibBuffer(inst, inst.audioBuffers[padName]);
                return;
            }

            // Load buffer from base64 data URL via fetch (data URLs work without server)
            fetch(inst.samples[padName])
                .then(r => r.arrayBuffer())
                .then(ab => audioCtx.decodeAudioData(ab))
                .then(buffer => {
                    inst.audioBuffers[padName] = buffer;
                    _triggerLibBuffer(inst, buffer);
                })
                .catch(e => console.error('Sample load error:', e));
        }

        function _triggerLibBuffer(inst, buffer) {
            if (!audioCtx) return;
            const source = audioCtx.createBufferSource();
            source.buffer = buffer;
            const dest = inst.eqNodes ? inst.eqNodes.low : masterGain;
            source.connect(dest);
            source.start(0);
        }

        // =============================================
        // WAV ENCODER
        // =============================================
        async function convertToWav(webmBlob) {
            const arrayBuffer = await webmBlob.arrayBuffer();
            const decoded = await audioCtx.decodeAudioData(arrayBuffer);

            const numChannels = decoded.numberOfChannels;
            const sampleRate = decoded.sampleRate;
            const numSamples = decoded.length;
            const bytesPerSample = 2; // 16-bit PCM

            // Interleave channels
            const interleaved = new Int16Array(numSamples * numChannels);
            for (let ch = 0; ch < numChannels; ch++) {
                const channelData = decoded.getChannelData(ch);
                for (let i = 0; i < numSamples; i++) {
                    const sample = Math.max(-1, Math.min(1, channelData[i]));
                    interleaved[i * numChannels + ch] = sample < 0
                        ? sample * 0x8000
                        : sample * 0x7FFF;
                }
            }

            const dataSize = interleaved.byteLength;
            const wavBuffer = new ArrayBuffer(44 + dataSize);
            const view = new DataView(wavBuffer);

            // RIFF header
            writeString(view, 0, 'RIFF');
            view.setUint32(4, 36 + dataSize, true);
            writeString(view, 8, 'WAVE');
            // fmt chunk
            writeString(view, 12, 'fmt ');
            view.setUint32(16, 16, true);              // chunk size
            view.setUint16(20, 1, true);               // PCM format
            view.setUint16(22, numChannels, true);
            view.setUint32(24, sampleRate, true);
            view.setUint32(28, sampleRate * numChannels * bytesPerSample, true); // byte rate
            view.setUint16(32, numChannels * bytesPerSample, true); // block align
            view.setUint16(34, 16, true);              // bits per sample
            // data chunk
            writeString(view, 36, 'data');
            view.setUint32(40, dataSize, true);

            // Write PCM samples
            const pcmView = new Int16Array(wavBuffer, 44);
            pcmView.set(interleaved);

            return new Blob([wavBuffer], { type: 'audio/wav' });
        }

        function writeString(view, offset, str) {
            for (let i = 0; i < str.length; i++) {
                view.setUint8(offset + i, str.charCodeAt(i));
            }
        }

        // =============================================
        // MENU
        // =============================================
        function openMenu() {
            detectAudioDevices();
            document.getElementById('menu-modal').classList.add('active');
        }

        async function detectAudioDevices() {
            const inputEl = document.getElementById('menu-input-device');
            const outputEl = document.getElementById('menu-output-device');

            try {
                // Request permission to get device labels
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                stream.getTracks().forEach(t => t.stop());

                const devices = await navigator.mediaDevices.enumerateDevices();
                const inputs  = devices.filter(d => d.kind === 'audioinput');
                const outputs = devices.filter(d => d.kind === 'audiooutput');

                const inputName  = inputs.length  ? (inputs[0].label  || 'Default Microphone') : 'No input found';
                const outputName = outputs.length ? (outputs[0].label || 'Default Speaker')    : 'No output found';

                if (inputEl)  inputEl.textContent  = inputName;
                if (outputEl) outputEl.textContent = outputName;
            } catch(e) {
                if (inputEl)  inputEl.textContent  = 'Permission required';
                if (outputEl) outputEl.textContent = 'Default Speaker';
            }
        }

        // =============================================
        // SAVE / OPEN PROJECT  (JSON via file download/upload)
        // =============================================
        function menuSave() {
            // Serialize state - exclude audio nodes (not serializable)
            const saveData = {
                version: 1,
                bpm: state.bpm,
                currentSequence: state.currentSequence,
                sequences: state.sequences.map(seq => ({
                    name: seq.name,
                    length: seq.length,
                    notes: seq.notes,
                    instruments: seq.instruments.map(inst => ({
                        id: inst.id,
                        type: inst.type,
                        name: inst.name,
                        muted: inst.muted,
                        solo: inst.solo,
                        eq: inst.eq,
                        tuning: inst.tuning,
                        // library instrument data
                        bankName: inst.bankName || null,
                        padNames: inst.padNames || null,
                        // sampler chops ref
                        samplerChops: inst.type === 'sampler' ? state.sampler.chops : null
                    }))
                })),
                songArrangement: state.songArrangement,
                instrumentIdCounter: instrumentIdCounter
            };

            const json = JSON.stringify(saveData, null, 2);
            const blob = new Blob([json], { type: 'application/json' });
            const url  = URL.createObjectURL(blob);
            const a    = document.createElement('a');
            a.href     = url;
            a.download = 'cronki-project.cronki';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 1000);

            closeModal('menu-modal');
            showToast('💾 Project saved!');
        }

        function menuOpen() {
            document.getElementById('open-project-file').click();
        }

        function menuOpenFile(input) {
            const file = input.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const data = JSON.parse(e.target.result);
                    loadProjectData(data);
                    closeModal('menu-modal');
                    showToast('📂 Project loaded!');
                } catch(err) {
                    alert('Could not load project file. Make sure it\'s a valid .cronki file.');
                }
            };
            reader.readAsText(file);
            input.value = ''; // reset so same file can be reopened
        }

        function loadProjectData(data) {
            if (!data.version) return;

            // Restore BPM
            state.bpm = data.bpm || 120;
            document.getElementById('bpm-input').value = state.bpm;

            // Restore instrument counter
            instrumentIdCounter = data.instrumentIdCounter || 0;

            // Restore sequences
            state.sequences = data.sequences.map(seq => {
                const instruments = seq.instruments.map(instData => {
                    const inst = {
                        id: instData.id,
                        type: instData.type,
                        name: instData.name,
                        muted: instData.muted || false,
                        solo: instData.solo || false,
                        eq: instData.eq || { low: 0, mid: 0, high: 0, volume: 80 },
                        tuning: instData.tuning || 0,
                        gainNode: null,
                        eqNodes: null
                    };

                    // Restore library instrument samples
                    if (inst.type === 'library' && instData.bankName && SOUND_BANK_DATA[instData.bankName]) {
                        inst.bankName  = instData.bankName;
                        inst.samples   = SOUND_BANK_DATA[instData.bankName];
                        inst.padNames  = instData.padNames || Object.keys(inst.samples);
                        inst.audioBuffers = {};
                    }

                    return inst;
                });

                return {
                    name: seq.name,
                    length: seq.length,
                    instruments: instruments,
                    notes: seq.notes
                };
            });

            // Rebuild seq selector
            const select = document.getElementById('seq-select');
            select.innerHTML = '';
            state.sequences.forEach((seq, i) => {
                const opt = document.createElement('option');
                opt.value = i;
                opt.textContent = seq.name;
                select.appendChild(opt);
            });

            state.currentSequence = Math.min(data.currentSequence || 0, state.sequences.length - 1);
            select.value = state.currentSequence;
            state.songArrangement = data.songArrangement || [];

            // Re-init audio nodes
            initAudio();
            state.sequences.forEach(seq => {
                seq.instruments.forEach(inst => setupInstrumentAudio(inst));
            });

            // Set active instrument
            const curSeq = state.sequences[state.currentSequence];
            state.activeInstrumentId = curSeq.instruments.length > 0 ? curSeq.instruments[0].id : null;

            renderInstruments();
            renderPads();
            renderPianoRoll();
            updatePatternPool();
            renderSongTimeline();
        }

        // =============================================
        // TOAST NOTIFICATION
        // =============================================
        function showToast(msg) {
            let toast = document.getElementById('cronki-toast');
            if (!toast) {
                toast = document.createElement('div');
                toast.id = 'cronki-toast';
                document.body.appendChild(toast);
            }
            toast.textContent = msg;
            toast.classList.add('visible');
            clearTimeout(toast._timeout);
            toast._timeout = setTimeout(() => toast.classList.remove('visible'), 2500);
        }