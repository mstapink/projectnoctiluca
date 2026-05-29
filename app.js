class JamBoardCore {
    constructor() {
        this.audio = new AudioEngine();
        
        this.BPM = 110;
        this.stepTime = 60 / this.BPM / 2;
        this.audio.setDelayTime(this.stepTime * 1.5); 
        
        this.rows = ['Rhythm', 'Bass', 'Melody', 'FX', 'Vocals'];
        this.STEPS = 8;
        this.MAX_TIMELINE_SLOTS = 16;
        
        this.playbackMode = 'STOPPED';
        this.currentStep = 0;
        this.nextNoteTime = 0;
        this.timerID = null;
        this.loopMemory = [];
        this.songMemory = [];
        this.currentMacroStep = 0;
        this.activeSongLoops = [];
        this.rowVolumes = [1, 1, 1, 1, 1];
        this.voiceVolumes = [1, 1, 1, 1, 1]; 
        this.activeRhythm = 'STRAIGHT';
        
        this.editingLoopId = null;
        this.editingSongId = null;
        
        this.colorMap = { 'red': 'rgba(255, 51, 102, 0.4)', 'yellow': 'rgba(255, 204, 0, 0.4)', 'blue': 'rgba(0, 204, 255, 0.4)', 'green': 'rgba(51, 255, 102, 0.4)', 'purple': 'rgba(204, 51, 255, 0.4)' };
        this.solidColors = { 'red': '#ff3366', 'yellow': '#ffcc00', 'blue': '#00ccff', 'green': '#33ff66', 'purple': '#cc33ff', 'voice': '#aaa' };

        this.gridEl = document.getElementById('grid');
        this.cells = [];
        this.voiceCells = [];
        
        this.initUI();
        this.bindEvents();
    }

    initUI() {
        for (let r = 0; r < this.rows.length; r++) {
            const controls = document.createElement('div'); controls.className = 'row-controls';
            const label = document.createElement('div'); label.className = 'row-label'; label.innerText = this.rows[r];
            const volSlider = document.createElement('input'); volSlider.type = 'range'; volSlider.className = 'row-volume'; volSlider.min = '0'; volSlider.max = '1'; volSlider.step = '0.05'; volSlider.value = '1';
            volSlider.addEventListener('input', e => { this.rowVolumes[r] = parseFloat(e.target.value); });
            controls.appendChild(label); controls.appendChild(volSlider); this.gridEl.appendChild(controls);
            
            this.cells[r] = [];
            for (let c = 0; c < this.STEPS; c++) {
                const cell = document.createElement('div'); cell.className = 'cell'; cell.dataset.row = r; cell.dataset.col = c; 
                this.gridEl.appendChild(cell); this.cells[r].push(cell);
                cell.addEventListener('dragover', e => e.preventDefault()); cell.addEventListener('drop', e => this.handleGridDrop(e, cell));
            }
            
            const fxSlot = document.createElement('div'); fxSlot.className = 'row-fx-slot'; fxSlot.dataset.row = r;
            this.gridEl.appendChild(fxSlot);
            fxSlot.addEventListener('dragover', e => e.preventDefault()); fxSlot.addEventListener('drop', e => this.handleGridDrop(e, fxSlot));

            const vControls = document.createElement('div'); vControls.className = 'row-controls voice-sub-controls';
            const vLabel = document.createElement('div'); vLabel.className = 'row-label'; vLabel.style.color = '#777'; vLabel.innerText = '🎙 MIC';
            const vVol = document.createElement('input'); vVol.type = 'range'; vVol.className = 'row-volume'; vVol.min = '0'; vVol.max = '1'; vVol.step = '0.05'; vVol.value = '1';
            vVol.style.accentColor = '#aaa';
            vVol.addEventListener('input', e => { this.voiceVolumes[r] = parseFloat(e.target.value); });
            vControls.appendChild(vLabel); vControls.appendChild(vVol); this.gridEl.appendChild(vControls);

            this.voiceCells[r] = [];
            for (let c = 0; c < this.STEPS; c++) {
                const vCell = document.createElement('div'); vCell.className = 'cell voice-sub-cell'; 
                vCell.dataset.row = r; vCell.dataset.col = c; vCell.dataset.isVoice = 'true';
                this.gridEl.appendChild(vCell); this.voiceCells[r].push(vCell);
                vCell.addEventListener('dragover', e => e.preventDefault()); vCell.addEventListener('drop', e => this.handleGridDrop(e, vCell));
            }

            const vFxSlot = document.createElement('div'); vFxSlot.className = 'row-fx-slot voice-sub-fx'; 
            vFxSlot.dataset.row = r; vFxSlot.dataset.isVoice = 'true';
            this.gridEl.appendChild(vFxSlot);
            vFxSlot.addEventListener('dragover', e => e.preventDefault()); vFxSlot.addEventListener('drop', e => this.handleGridDrop(e, vFxSlot));
        }

        this.buildTimelineRow();

        document.querySelectorAll('#palette .block, #palette .fx-token').forEach(el => { 
            el.addEventListener('dragstart', e => { 
                e.dataTransfer.setData('source', 'palette'); e.dataTransfer.setData('type', el.dataset.type);
                if (el.dataset.type === 'block') { e.dataTransfer.setData('color', el.dataset.color); } 
                else { e.dataTransfer.setData('fx', el.dataset.fx); }
            }); 
        });
    }

    buildTimelineRow() {
        const row = document.createElement('div');
        row.className = 'timeline-row';
        for(let i = 0; i < this.MAX_TIMELINE_SLOTS; i++) {
            const slot = document.createElement('div'); slot.className = 'timeline-slot';
            slot.addEventListener('dragover', e => e.preventDefault());
            slot.addEventListener('drop', e => {
                e.preventDefault();
                const source = e.dataTransfer.getData('source');
                if (source === 'bank') {
                    const loopId = e.dataTransfer.getData('loopId');
                    if (loopId) {
                        const dragging = document.querySelector('.dragging');
                        if (dragging && dragging.classList.contains('loop-token')) {
                            const clone = dragging.cloneNode(true);
                            clone.classList.remove('dragging');
                            clone.addEventListener('click', (ev) => { if(ev.shiftKey || ev.ctrlKey || ev.metaKey) clone.remove(); });
                            clone.addEventListener('dblclick', () => { this.loadLoopToGrid(clone.dataset.loopId); });
                            
                            setTimeout(() => {
                                slot.innerHTML = '';
                                slot.appendChild(clone);
                            }, 0);
                        }
                    }
                }
            });
            row.appendChild(slot);
        }
        document.getElementById('timeline-container').appendChild(row);
    }

    bindEvents() {
        document.getElementById('bpm-slider').addEventListener('input', (e) => { 
            let val = parseInt(e.target.value);
            if (e.ctrlKey || e.metaKey) {
                const commonBPMs = [60, 70, 80, 90, 100, 110, 120, 128, 140, 150, 160, 174, 180, 200];
                val = commonBPMs.reduce((prev, curr) => Math.abs(curr - val) < Math.abs(prev - val) ? curr : prev);
                e.target.value = val;
            }
            this.BPM = val; 
            document.getElementById('bpm-display').innerText = this.BPM; 
            this.stepTime = 60 / this.BPM / 2; 
            this.audio.setDelayTime(this.stepTime * 1.5);
        });

        document.getElementById('sel-key').addEventListener('change', (e) => { this.audio.setTheory(parseInt(e.target.value), this.audio.activeScale); });
        document.getElementById('sel-scale').addEventListener('change', (e) => { this.audio.setTheory(this.audio.activeKey, e.target.value); });
        document.getElementById('sel-rhythm').addEventListener('change', (e) => { this.activeRhythm = e.target.value; });

        document.getElementById('btn-stop').addEventListener('click', () => this.stopEngine());
        
        document.getElementById('btn-play-grid').addEventListener('click', () => { 
            this.audio.resume();
            if (this.playbackMode === 'GRID') return; 
            this.stopEngine(); 
            this.playbackMode = 'GRID'; 
            this.updateUIState(false); 
            this.nextNoteTime = this.audio.currentTime + 0.05; 
            this.currentStep = 0; 
            this.schedule(); 
        });
        
        document.getElementById('btn-play-song').addEventListener('click', () => { 
            this.audio.resume();
            if (this.playbackMode === 'SONG') return; 
            this.stopEngine(); 
            this.playbackMode = 'SONG'; 
            this.updateUIState(true); 
            this.nextNoteTime = this.audio.currentTime + 0.05; 
            this.currentStep = 0; 
            this.currentMacroStep = 0; 
            this.schedule(); 
        });
        
        document.getElementById('btn-clear').addEventListener('click', () => { 
            document.querySelectorAll('.cell').forEach(c => c.innerHTML = ''); 
            document.querySelectorAll('.row-fx-slot').forEach(s => s.innerHTML = ''); 
            this.resetEditMode();
        });

        document.getElementById('btn-kit').addEventListener('click', (e) => { 
            const newKit = this.audio.cycleKit();
            e.target.innerText = `ACTIVE KIT: ${newKit}`; 
            
            document.querySelectorAll('#grid .block').forEach(b => {
                if (b.dataset.type === 'block') { 
                    b.dataset.kit = newKit;
                    b.title = newKit;
                }
            });
        });

        const micBtn = document.getElementById('btn-mic');
        let mediaRecorder; let chunks = []; let isRecordingVoice = false;

        micBtn.addEventListener('click', async () => {
            this.audio.resume(); 
            if (!isRecordingVoice) {
                try {
                    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                    mediaRecorder = new MediaRecorder(stream);
                    chunks = [];
                    mediaRecorder.ondataavailable = e => chunks.push(e.data);
                    mediaRecorder.onstop = async () => {
                        const blob = new Blob(chunks, { type: 'audio/webm' });
                        const arrayBuffer = await blob.arrayBuffer();
                        const rawBuffer = await this.audio.ctx.decodeAudioData(arrayBuffer);
                        
                        const audioBuffer = this.audio.trimVoiceBuffer(rawBuffer);
                        
                        if (!this.audio.voiceBuffers) this.audio.voiceBuffers = [];
                        const vId = this.audio.voiceBuffers.length;
                        this.audio.voiceBuffers.push(audioBuffer);
                        this.createVoiceBankToken(vId);
                    };
                    mediaRecorder.start();
                    isRecordingVoice = true;
                    micBtn.style.backgroundColor = 'var(--red)';
                    micBtn.innerText = '🔴 STOP REC';
                } catch (e) {
                    micBtn.innerText = 'MIC DENIED';
                }
            } else {
                if (mediaRecorder && mediaRecorder.state !== 'inactive') {
                    mediaRecorder.stop();
                    mediaRecorder.stream.getTracks().forEach(t => t.stop());
                }
                isRecordingVoice = false;
                micBtn.style.backgroundColor = '#444';
                micBtn.innerText = '🎤 REC VOICE';
            }
        });

        document.getElementById('btn-save').addEventListener('click', () => this.saveLoop());
        document.getElementById('btn-save-new').addEventListener('click', () => this.saveLoop(true));
        
        document.getElementById('btn-save-song').addEventListener('click', () => this.saveSong());
        document.getElementById('btn-save-song-new').addEventListener('click', () => this.saveSong(true));
        
        document.getElementById('btn-add-timeline').addEventListener('click', () => this.buildTimelineRow());
        document.getElementById('btn-remove-timeline').addEventListener('click', () => {
            const rows = document.querySelectorAll('.timeline-row');
            if (rows.length > 1) rows[rows.length - 1].remove();
        });

        document.getElementById('btn-clear-song').addEventListener('click', () => {
            document.querySelectorAll('.timeline-slot').forEach(slot => slot.innerHTML = '');
            this.resetSongEditMode();
        });

        document.body.addEventListener('dragover', e => e.preventDefault());
        
        document.body.addEventListener('drop', e => {
            e.preventDefault(); e.stopPropagation();
            const source = e.dataTransfer.getData('source');
            const validSources = ['grid', 'voice-bank', 'bank', 'song-bank'];
            
            if (validSources.includes(source) && !e.target.closest('.cell') && !e.target.closest('.row-fx-slot') && !e.target.closest('.timeline-slot')) {
                const dragging = document.querySelector('.dragging');
                if (dragging) { 
                    const parent = dragging.parentElement;
                    const type = dragging.dataset.type;
                    const fxType = dragging.dataset.fx;
                    const vid = dragging.dataset.vid;
                    const targetVoiceBank = e.target.closest('#voice-bank');
                    
                    setTimeout(() => {
                        if (targetVoiceBank && source === 'grid' && type === 'voice') {
                            const existing = document.querySelector(`#voice-bank .voice-block[data-vid="${vid}"]`);
                            if (!existing) this.createVoiceBankToken(vid);
                        }
                        
                        dragging.remove();
                        
                        if (parent && source === 'grid') {
                            if (type === 'fx') this.layoutFxTokens(parent, fxType);
                            if (type === 'block' || type === 'voice') this.layoutBlocks(parent);
                        }

                        if (source === 'bank') this.loopMemory[dragging.dataset.loopId] = null;
                        if (source === 'song-bank') this.songMemory[dragging.dataset.songId] = null;
                    }, 0); 
                }
            }
        });
    }

    updateUIState(locked = false) {
        const workspace = document.getElementById('main-workspace');
        const playGridBtn = document.getElementById('btn-play-grid');
        
        if (locked) {
            workspace.classList.add('locked');
            playGridBtn.disabled = true;
        } else {
            workspace.classList.remove('locked');
            playGridBtn.disabled = false;
        }
    }

    saveLoop(asNew = false) {
        const snapshot = {
            bpm: this.BPM,
            key: this.audio.activeKey,
            scale: this.audio.activeScale,
            rhythm: this.activeRhythm,
            kitIndex: this.audio.activeKitIndex,
            steps: [],
            rowFx: [],
            voiceRowFx: []
        };
        
        const parseFx = (container) => {
            return Array.from(container.querySelectorAll('.fx-token')).map(el => ({
                fx: el.dataset.fx,
                amount: parseFloat(el.dataset.amount),
                boundColor: el.dataset.boundColor || 'all'
            }));
        };

        for (let r = 0; r < this.rows.length; r++) {
            const slot = document.querySelector(`.row-fx-slot[data-row="${r}"]:not(.voice-sub-fx)`);
            const vSlot = document.querySelector(`.voice-sub-fx[data-row="${r}"]`);
            snapshot.rowFx.push(parseFx(slot));
            snapshot.voiceRowFx.push(parseFx(vSlot));
        }

        for (let step = 0; step < this.STEPS; step++) {
            const stepData = [];
            for (let r = 0; r < this.rows.length; r++) {
                const cell = this.cells[r][step];
                const vCell = this.voiceCells[r][step];
                
                const blocks = Array.from(cell.querySelectorAll('.block')).map(b => ({
                    type: 'block',
                    color: b.dataset.color,
                    pitch: parseInt(b.dataset.pitch),
                    speed: parseFloat(b.dataset.speed || 1.0),
                    volume: parseFloat(b.dataset.volume),
                    kit: b.dataset.kit || this.audio.KITS[this.audio.activeKitIndex]
                }));
                
                const voiceBlocks = Array.from(vCell.querySelectorAll('.block')).map(b => ({
                    type: 'voice',
                    vid: b.dataset.vid,
                    pitch: parseInt(b.dataset.pitch),
                    speed: parseFloat(b.dataset.speed || 1.0),
                    volume: parseFloat(b.dataset.volume)
                }));
                
                stepData.push({ blocks, cellFx: parseFx(cell), voiceBlocks, voiceCellFx: parseFx(vCell) });
            }
            snapshot.steps.push(stepData);
        }

        if (this.editingLoopId !== null && !asNew) {
            this.loopMemory[this.editingLoopId] = snapshot;
            this.updateAllLoopTokens(this.editingLoopId, snapshot);
            this.resetEditMode();
        } else {
            const loopId = this.loopMemory.length;
            this.loopMemory.push(snapshot);
            this.createLoopToken(loopId, snapshot);
            if (asNew) {
                this.resetEditMode();
            }
        }
    }

    createLoopToken(loopId, snapshot) {
        const token = document.createElement('div'); token.className = 'loop-token'; token.dataset.loopId = loopId; token.draggable = true;
        const miniColContainer = document.createElement('div'); miniColContainer.className = 'mini-container'; miniColContainer.style.display = 'flex'; miniColContainer.style.width = '100%'; miniColContainer.style.height = '100%'; miniColContainer.style.gap = '1px';
        this.generateTokenVisuals(snapshot, miniColContainer);
        token.appendChild(miniColContainer);
        
        token.addEventListener('dragstart', e => { e.dataTransfer.setData('source', 'bank'); e.dataTransfer.setData('loopId', loopId); setTimeout(() => token.classList.add('dragging'), 0); });
        token.addEventListener('dragend', () => token.classList.remove('dragging')); 
        
        token.addEventListener('click', e => {
            if (e.shiftKey || e.ctrlKey || e.metaKey) {
                token.remove();
                this.loopMemory[loopId] = null;
            }
        });
        
        token.addEventListener('dblclick', () => { this.loadLoopToGrid(loopId); });
        document.getElementById('loop-bank').appendChild(token);
    }

    updateAllLoopTokens(loopId, snapshot) {
        const tokens = document.querySelectorAll(`.loop-token[data-loop-id="${loopId}"]`);
        tokens.forEach(token => { const container = token.querySelector('.mini-container'); this.generateTokenVisuals(snapshot, container); });
    }

    saveSong(asNew = false) {
        const seqs = this.getTimelineSequences();
        const snapshot = {
            bpm: this.BPM,
            key: this.audio.activeKey,
            scale: this.audio.activeScale,
            rhythm: this.activeRhythm,
            kitIndex: this.audio.activeKitIndex,
            sequences: seqs
        };
        
        if (this.editingSongId !== null && !asNew) {
            this.songMemory[this.editingSongId] = snapshot;
            this.resetSongEditMode();
        } else {
            const songId = this.songMemory.length;
            this.songMemory.push(snapshot);
            
            const token = document.createElement('div');
            token.className = 'song-token';
            token.innerText = 'S' + songId;
            token.dataset.songId = songId;
            token.draggable = true;
            
            token.addEventListener('dragstart', e => { 
                e.dataTransfer.setData('source', 'song-bank'); 
                e.dataTransfer.setData('songId', songId); 
                setTimeout(() => token.classList.add('dragging'), 0); 
            });
            token.addEventListener('dragend', () => token.classList.remove('dragging'));

            token.addEventListener('click', e => {
                if (e.shiftKey || e.ctrlKey || e.metaKey) {
                    token.remove();
                    this.songMemory[songId] = null;
                }
            });

            token.addEventListener('dblclick', () => this.loadSong(songId));
            document.getElementById('song-bank').appendChild(token);
            
            if (asNew) {
                this.resetSongEditMode();
            }
        }
    }

    loadSong(songId) {
        if (!this.songMemory[songId]) return;
        
        this.editingSongId = parseInt(songId);
        const btnSaveSong = document.getElementById('btn-save-song');
        btnSaveSong.innerText = 'UPDATE SONG';
        btnSaveSong.style.backgroundColor = 'var(--yellow)';
        btnSaveSong.style.color = '#000';
        document.getElementById('btn-save-song-new').style.display = 'inline-block';

        const songData = this.songMemory[songId];
        const seqs = songData.sequences || songData;

        if (songData.bpm) {
            this.BPM = songData.bpm;
            document.getElementById('bpm-slider').value = this.BPM;
            document.getElementById('bpm-display').innerText = this.BPM;
            this.stepTime = 60 / this.BPM / 2;
            this.audio.setDelayTime(this.stepTime * 1.5);
        }
        if (songData.key && songData.scale) {
            this.audio.setTheory(songData.key, songData.scale);
            document.getElementById('sel-key').value = songData.key;
            document.getElementById('sel-scale').value = songData.scale;
        }
        if (songData.rhythm) {
            this.activeRhythm = songData.rhythm;
            document.getElementById('sel-rhythm').value = songData.rhythm;
        }
        if (songData.kitIndex !== undefined) {
            this.audio.activeKitIndex = songData.kitIndex;
            document.getElementById('btn-kit').innerText = `ACTIVE KIT: ${this.audio.KITS[songData.kitIndex]}`;
        }
        
        const container = document.getElementById('timeline-container');
        container.innerHTML = '';
        
        seqs.forEach(seq => {
            this.buildTimelineRow();
            const rows = document.querySelectorAll('.timeline-row');
            const targetRow = rows[rows.length - 1];
            const slots = targetRow.querySelectorAll('.timeline-slot');
            
            for(let i=0; i < seq.length; i++) {
                if (seq[i] !== -1 && this.loopMemory[seq[i]]) {
                    const token = document.querySelector(`.loop-token[data-loop-id="${seq[i]}"]`);
                    if (token) {
                        const clone = token.cloneNode(true);
                        clone.addEventListener('click', (ev) => { if(ev.shiftKey || ev.ctrlKey || ev.metaKey) clone.remove(); });
                        clone.addEventListener('dblclick', () => { this.loadLoopToGrid(clone.dataset.loopId); });
                        slots[i].appendChild(clone);
                    }
                }
            }
        });
    }

    resetSongEditMode() {
        this.editingSongId = null;
        const btnSaveSong = document.getElementById('btn-save-song'); 
        btnSaveSong.innerText = 'SAVE SONG'; 
        btnSaveSong.style.backgroundColor = 'var(--purple)'; 
        btnSaveSong.style.color = '#fff';
        document.getElementById('btn-save-song-new').style.display = 'none';
    }

    displayLoopVisualOnly(loopId) {
        if (loopId === -1 || !this.loopMemory[loopId]) return;
        document.querySelectorAll('.cell').forEach(c => c.innerHTML = ''); document.querySelectorAll('.row-fx-slot').forEach(s => s.innerHTML = '');

        const loop = this.loopMemory[loopId];
        const buildFxArr = (target, fxArr) => {
            if (!fxArr || !Array.isArray(fxArr)) return;
            const typesPresent = new Set();
            fxArr.forEach(fData => { target.appendChild(this.createFxDOM(fData.fx, fData.amount, fData.boundColor)); typesPresent.add(fData.fx); });
            typesPresent.forEach(type => this.layoutFxTokens(target, type));
        };

        for (let r = 0; r < this.rows.length; r++) {
            const slot = document.querySelector(`.row-fx-slot[data-row="${r}"]:not(.voice-sub-fx)`);
            const vSlot = document.querySelector(`.voice-sub-fx[data-row="${r}"]`);
            if (loop.rowFx && Array.isArray(loop.rowFx[r])) buildFxArr(slot, loop.rowFx[r]);
            if (loop.voiceRowFx && Array.isArray(loop.voiceRowFx[r])) buildFxArr(vSlot, loop.voiceRowFx[r]);
        }

        for (let step = 0; step < this.STEPS; step++) {
            for (let r = 0; r < this.rows.length; r++) {
                const cellData = loop.steps[step][r];
                const cell = this.cells[r][step]; const vCell = this.voiceCells[r][step];
                if (cellData.blocks) {
                    cellData.blocks.forEach(b => { cell.appendChild(this.createBlockDOM(b.color, b.pitch, b.volume, b.kit, b.speed)); });
                    this.layoutBlocks(cell);
                }
                if (cellData.voiceBlocks) {
                    cellData.voiceBlocks.forEach(b => { vCell.appendChild(this.createVoiceBlockDOM(b.vid, b.pitch, b.volume, b.speed)); });
                    this.layoutBlocks(vCell);
                }
                if (cellData.cellFx) buildFxArr(cell, cellData.cellFx);
                if (cellData.voiceCellFx) buildFxArr(vCell, cellData.voiceCellFx);
            }
        }
    }

    loadLoopToGrid(loopId) {
        this.editingLoopId = parseInt(loopId);
        const btnSave = document.getElementById('btn-save'); btnSave.innerText = 'UPDATE LOOP'; btnSave.style.backgroundColor = 'var(--yellow)'; btnSave.style.color = '#000';
        document.getElementById('btn-save-new').style.display = 'inline-block';

        const loop = this.loopMemory[loopId];

        if (loop.bpm) {
            this.BPM = loop.bpm;
            document.getElementById('bpm-slider').value = this.BPM;
            document.getElementById('bpm-display').innerText = this.BPM;
            this.stepTime = 60 / this.BPM / 2;
            this.audio.setDelayTime(this.stepTime * 1.5);
        }
        if (loop.key && loop.scale) {
            this.audio.setTheory(loop.key, loop.scale);
            document.getElementById('sel-key').value = loop.key;
            document.getElementById('sel-scale').value = loop.scale;
        }
        if (loop.rhythm) {
            this.activeRhythm = loop.rhythm;
            document.getElementById('sel-rhythm').value = loop.rhythm;
        }
        if (loop.kitIndex !== undefined) {
            this.audio.activeKitIndex = loop.kitIndex;
            document.getElementById('btn-kit').innerText = `ACTIVE KIT: ${this.audio.KITS[loop.kitIndex]}`;
        }

        this.displayLoopVisualOnly(this.editingLoopId);
    }

    resetEditMode() {
        this.editingLoopId = null;
        const btnSave = document.getElementById('btn-save'); 
        btnSave.innerText = 'SAVE LOOP'; 
        btnSave.style.backgroundColor = 'var(--orange)'; 
        btnSave.style.color = '#000';
        document.getElementById('btn-save-new').style.display = 'none';
    }

    generateTokenVisuals(snapshot, container) {
        container.innerHTML = '';
        for(let c = 0; c < this.STEPS; c++) {
            const col = document.createElement('div'); col.className = 'mini-col';
            for(let r = 0; r < this.rows.length; r++) {
                const blk = document.createElement('div'); blk.className = 'mini-block';
                const stepData = snapshot.steps[c][r];
                let bg = 'transparent';
                if (stepData.blocks && stepData.blocks.length > 0) bg = this.colorMap[stepData.blocks[0].color];
                else if (stepData.voiceBlocks && stepData.voiceBlocks.length > 0) bg = '#888';
                blk.style.backgroundColor = bg; col.appendChild(blk);
            }
            container.appendChild(col);
        }
    }

    updateBlockVisuals(block, v) {
        const fillRatio = Math.min(1.0, v);
        block.querySelector('.vol-bar').style.height = `${fillRatio * 100}%`;
        const overdrive = Math.max(0, v - 1.0); 
        if (overdrive > 0) {
            const g = Math.floor(255 * (1 - overdrive));
            block.style.setProperty('border-color', `rgb(255, ${g}, 0)`, 'important');
        } else { 
            if (block.classList.contains('voice-block')) {
                block.style.setProperty('border-color', '#ff66b2', 'important'); 
            } else {
                block.style.setProperty('border-color', 'transparent', 'important'); 
            }
        }
    }

    layoutBlocks(target) {
        if (!target.classList.contains('cell')) return;
        const blocks = target.querySelectorAll('.block'); const count = blocks.length; if (count === 0) return;
        const h = 100 / count; 
        blocks.forEach((b, i) => { b.style.position = 'absolute'; b.style.height = `${h}%`; b.style.width = 'calc(100% - 14px)'; b.style.left = '7px'; b.style.bottom = `${i * h}%`; });
    }

    layoutFxTokens(target, fxData) {
        const tokens = target.querySelectorAll(`.fx-token[data-fx="${fxData}"]`); const count = tokens.length; if (count === 0) return;
        const h = 35 / count; 
        tokens.forEach((t, i) => {
            t.style.height = `${h}px`; t.style.zIndex = '3';
            if (fxData === 'crush' || fxData === 'reverb') { t.style.top = `${5 + (i * h)}px`; t.style.bottom = 'auto'; } 
            else { t.style.bottom = `${5 + (i * h)}px`; t.style.top = 'auto'; }
        });
    }

    updateFxColor(token) {
        const bound = token.dataset.boundColor || 'all';
        if (bound === 'all') {
            const fx = token.dataset.fx;
            if (fx === 'crush') token.style.borderColor = '#f66';
            if (fx === 'echo') token.style.borderColor = '#66f';
            if (fx === 'reverb') token.style.borderColor = '#aa4';
            if (fx === 'chorus') token.style.borderColor = '#4aa';
        } else { token.style.borderColor = this.solidColors[bound]; }
    }

    createBlockDOM(color, pitch, volume = 1.0, kit = null, speed = 1.0) {
        const block = document.createElement('div'); block.className = 'block'; 
        block.dataset.type = 'block'; block.dataset.color = color; 
        block.dataset.pitch = pitch; block.dataset.volume = volume; block.dataset.speed = speed; block.draggable = true;
        block.dataset.kit = kit || this.audio.KITS[this.audio.activeKitIndex]; block.title = block.dataset.kit; 
        
        block.innerHTML = `
            <div class="block-ui">
                <div class="val-container"><span class="pitch-val">${pitch}</span><span class="speed-val">${speed}x</span></div>
            </div>
            <div class="vol-bar"></div>
        `;
        this.updateBlockVisuals(block, volume);
        
        block.addEventListener('click', (e) => { 
            if (e.shiftKey) { const parent = block.parentElement; block.remove(); if (parent) this.layoutBlocks(parent); return; } 
        });
        
        block.addEventListener('contextmenu', (e) => { e.preventDefault(); });
        
        block.addEventListener('wheel', (e) => { 
            e.preventDefault(); 
            if (e.altKey) {
                let s = parseFloat(block.dataset.speed || 1.0);
                s = e.deltaY < 0 ? Math.min(4.0, s + 0.1) : Math.max(0.1, s - 0.1);
                block.dataset.speed = s.toFixed(1); block.querySelector('.speed-val').innerText = `${s.toFixed(1)}x`; return;
            }
            if (e.ctrlKey || e.metaKey) {
                let v = parseFloat(block.dataset.volume);
                v = e.deltaY < 0 ? Math.min(2.0, v + 0.1) : Math.max(0, v - 0.1);
                block.dataset.volume = v.toFixed(2); this.updateBlockVisuals(block, v); return;
            }
            let p = parseInt(block.dataset.pitch); 
            p = e.deltaY < 0 ? Math.min(12, p + 1) : Math.max(-12, p - 1); 
            block.dataset.pitch = p; block.querySelector('.pitch-val').innerText = p; 
        }, { passive: false });
        
        block.addEventListener('dragstart', e => { e.dataTransfer.setData('source', 'grid'); e.dataTransfer.setData('type', 'block'); setTimeout(() => block.classList.add('dragging'), 0); });
        block.addEventListener('dragend', () => block.classList.remove('dragging')); return block;
    }

    createVoiceBankToken(vId) {
        const token = document.createElement('div'); token.className = 'block voice-block'; token.dataset.type = 'voice'; token.dataset.vid = vId; token.draggable = true;
        token.innerHTML = `<span style="font-size: 14px; font-weight: bold;">V${vId}</span>`;
        token.addEventListener('click', (e) => { if (e.shiftKey || e.ctrlKey || e.metaKey) token.remove(); });
        token.addEventListener('dragstart', e => { e.dataTransfer.setData('source', 'voice-bank'); e.dataTransfer.setData('type', 'voice'); e.dataTransfer.setData('vid', vId); setTimeout(() => token.classList.add('dragging'), 0); });
        token.addEventListener('dragend', () => token.classList.remove('dragging'));
        document.getElementById('voice-bank').appendChild(token);
    }

    createVoiceBlockDOM(vId, pitch, volume = 1.0, speed = 1.0) {
        const block = document.createElement('div'); block.className = 'block voice-block'; 
        block.dataset.type = 'voice'; block.dataset.vid = vId; 
        block.dataset.pitch = pitch; block.dataset.volume = volume; block.dataset.speed = speed; block.draggable = true;
        
        block.innerHTML = `
            <div class="block-ui">
                <div class="val-container"><span class="pitch-val">${pitch}</span><span class="speed-val">${speed}x</span></div>
            </div>
            <div class="vol-bar"></div>
            <span class="voice-label">V${vId}</span>
        `;
        this.updateBlockVisuals(block, volume);
        
        block.addEventListener('click', (e) => { 
            if (e.shiftKey) { const parent = block.parentElement; block.remove(); if (parent) this.layoutBlocks(parent); return; } 
        });
        block.addEventListener('contextmenu', (e) => { e.preventDefault(); });
        
        block.addEventListener('wheel', (e) => { 
            e.preventDefault(); 
            if (e.altKey) {
                let s = parseFloat(block.dataset.speed || 1.0);
                s = e.deltaY < 0 ? Math.min(4.0, s + 0.1) : Math.max(0.1, s - 0.1);
                block.dataset.speed = s.toFixed(1); block.querySelector('.speed-val').innerText = `${s.toFixed(1)}x`; return;
            }
            if (e.ctrlKey || e.metaKey) {
                let v = parseFloat(block.dataset.volume);
                v = e.deltaY < 0 ? Math.min(2.0, v + 0.1) : Math.max(0, v - 0.1);
                block.dataset.volume = v.toFixed(2); this.updateBlockVisuals(block, v); return;
            }
            let p = parseInt(block.dataset.pitch); 
            p = e.deltaY < 0 ? Math.min(12, p + 1) : Math.max(-12, p - 1); 
            block.dataset.pitch = p; block.querySelector('.pitch-val').innerText = p; 
        }, { passive: false });
        
        block.addEventListener('dragstart', e => { e.dataTransfer.setData('source', 'grid'); e.dataTransfer.setData('type', 'voice'); setTimeout(() => block.classList.add('dragging'), 0); });
        block.addEventListener('dragend', () => block.classList.remove('dragging')); return block;
    }

    createFxDOM(fxType, amount = 1.0, boundColor = 'all') {
        const token = document.createElement('div'); token.className = 'fx-token'; token.dataset.type = 'fx'; token.dataset.fx = fxType; token.dataset.amount = amount; token.draggable = true; token.dataset.boundColor = boundColor;
        token.innerHTML = `<div class="fx-bar" style="height: ${amount * 100}%"></div><span class="fx-label">${fxType.toUpperCase()}</span>`; token.style.zIndex = '3'; this.updateFxColor(token);
        token.addEventListener('click', (e) => { 
            if (e.shiftKey) { const parent = token.parentElement; token.remove(); if (parent) this.layoutFxTokens(parent, fxType); return; } 
            if (e.ctrlKey || e.metaKey) { const colors = ['all', 'red', 'yellow', 'blue', 'green', 'purple', 'voice']; let cur = colors.indexOf(token.dataset.boundColor || 'all'); token.dataset.boundColor = colors[(cur + 1) % colors.length]; this.updateFxColor(token); return; }
            let a = parseFloat(token.dataset.amount); a = a - 0.25; if(a < 0) a = 1.0; token.dataset.amount = a.toFixed(2); token.querySelector('.fx-bar').style.height = `${a * 100}%`;
        });
        token.addEventListener('wheel', (e) => { e.preventDefault(); let a = parseFloat(token.dataset.amount); a = e.deltaY < 0 ? Math.min(1.0, a + 0.1) : Math.max(0, a - 0.1); token.dataset.amount = a.toFixed(2); token.querySelector('.fx-bar').style.height = `${a * 100}%`; }, { passive: false });
        token.addEventListener('dragstart', e => { e.dataTransfer.setData('source', 'grid'); e.dataTransfer.setData('type', 'fx'); setTimeout(() => token.classList.add('dragging'), 0); });
        token.addEventListener('dragend', () => token.classList.remove('dragging')); return token;
    }

    handleGridDrop(e, target) { 
        e.preventDefault(); e.stopPropagation();
        const source = e.dataTransfer.getData('source'); 
        const type = e.dataTransfer.getData('type');
        
        // Extract variables synchronously before the drop event terminates
        const transferredColor = e.dataTransfer.getData('color');
        const transferredFx = e.dataTransfer.getData('fx');
        const transferredVid = e.dataTransfer.getData('vid');

        const dragging = document.querySelector('.dragging');
        const isVoiceCell = target.classList.contains('voice-sub-cell') || target.classList.contains('voice-sub-fx');

        if (source === 'voice-bank') {
            if (target.classList.contains('voice-sub-cell')) {
                setTimeout(() => {
                    target.appendChild(this.createVoiceBlockDOM(transferredVid, 0, 1.0, 1.0)); 
                    this.layoutBlocks(target);
                }, 0);
            }
            return;
        }

        if (source === 'grid' && dragging) {
            if (type === 'voice' && !isVoiceCell) return;
            if (type === 'block' && isVoiceCell) return;
            const oldParent = dragging.parentElement;
            if (target.classList.contains('cell') || target.classList.contains('row-fx-slot')) {
                setTimeout(() => {
                    target.appendChild(dragging);
                    if (type === 'fx') { this.layoutFxTokens(target, dragging.dataset.fx); if (oldParent) this.layoutFxTokens(oldParent, dragging.dataset.fx); }
                    if (type === 'block' || type === 'voice') { this.layoutBlocks(target); if (oldParent) this.layoutBlocks(oldParent); }
                }, 0);
            } 
            return;
        }

        if (source === 'palette') {
            if (type === 'block' && target.classList.contains('cell') && !isVoiceCell) { 
                const activeKit = this.audio.KITS[this.audio.activeKitIndex];
                setTimeout(() => {
                    target.appendChild(this.createBlockDOM(transferredColor, 0, 1.0, activeKit, 1.0)); 
                    this.layoutBlocks(target);
                }, 0);
            } 
            else if (type === 'fx' && (target.classList.contains('cell') || target.classList.contains('row-fx-slot'))) {
                setTimeout(() => {
                    target.appendChild(this.createFxDOM(transferredFx, 1.0, 'all')); 
                    this.layoutFxTokens(target, transferredFx);
                }, 0);
            }
        }
    }

    getTimelineSequences() {
        const seqs = []; const timelineRows = document.querySelectorAll('.timeline-row');
        timelineRows.forEach(row => {
            const slots = row.querySelectorAll('.timeline-slot'); const seq = [];
            slots.forEach(slot => { seq.push(slot.firstChild ? parseInt(slot.firstChild.dataset.loopId) : -1); }); seqs.push(seq);
        }); return seqs;
    }

    schedule() {
        while (this.nextNoteTime < this.audio.currentTime + 0.1) {
            if (this.playbackMode === 'SONG' && this.currentStep === 0) {
                const sequences = this.getTimelineSequences();
                let maxLen = Math.max(...sequences.map(s => { let lastValid = -1; for(let i=0; i<s.length; i++) if(s[i] !== -1) lastValid = i; return lastValid + 1; }));

                if (maxLen > 0) {
                    if (this.currentMacroStep >= maxLen) this.currentMacroStep = 0; 
                    this.activeSongLoops = sequences.map(seq => seq[this.currentMacroStep] !== undefined ? seq[this.currentMacroStep] : -1);
                    const stepToHighlight = this.currentMacroStep;
                    requestAnimationFrame(() => { 
                        document.querySelectorAll('.timeline-slot').forEach(s => s.classList.remove('active-macro')); 
                        document.querySelectorAll('.timeline-row').forEach(row => { const slots = row.querySelectorAll('.timeline-slot'); if (slots[stepToHighlight]) slots[stepToHighlight].classList.add('active-macro'); });
                    });
                    this.currentMacroStep++;
                } else { this.playbackMode = 'GRID'; this.activeSongLoops = []; this.updateUIState(false); }
            }
            
            this.processStep(this.currentStep, this.nextNoteTime); 
            let stepDur = this.stepTime;
            
            if (this.activeRhythm === 'LIGHT_SHUFFLE') { stepDur = (this.currentStep % 2 === 0) ? this.stepTime * 1.08 : this.stepTime * 0.92; } 
            else if (this.activeRhythm === 'CLASSIC_MPC') { stepDur = (this.currentStep % 2 === 0) ? this.stepTime * 1.20 : this.stepTime * 0.80; } 
            else if (this.activeRhythm === 'SWING') { stepDur = (this.currentStep % 2 === 0) ? this.stepTime * 1.34 : this.stepTime * 0.66; } 
            else if (this.activeRhythm === 'HARD_SHUFFLE') { stepDur = (this.currentStep % 2 === 0) ? this.stepTime * 1.50 : this.stepTime * 0.50; } 
            else if (this.activeRhythm === 'RUSHED') { stepDur = (this.currentStep % 2 === 0) ? this.stepTime * 0.90 : this.stepTime * 1.10; }
            
            this.nextNoteTime += stepDur; this.currentStep = (this.currentStep + 1) % this.STEPS;
        } 
        if (this.playbackMode !== 'STOPPED') { this.timerID = requestAnimationFrame(() => this.schedule()); }
    }

    processStep(step, time) {
        requestAnimationFrame(() => {
            document.querySelectorAll('.cell').forEach(c => c.classList.remove('active')); let flashColor = null;
            for (let r = 0; r < this.rows.length; r++) { this.cells[r][step].classList.add('active'); this.voiceCells[r][step].classList.add('active'); }
            
            if (this.playbackMode === 'GRID') { 
                for (let r = 0; r < this.rows.length; r++) { 
                    const blocks = this.cells[r][step].querySelectorAll('.block'); if (blocks.length > 0 && !flashColor) flashColor = blocks[0].dataset.color;
                    const vBlocks = this.voiceCells[r][step].querySelectorAll('.block'); if (vBlocks.length > 0 && !flashColor) flashColor = 'voice';
                } 
            } else if (this.playbackMode === 'SONG') { 
                if (this.activeSongLoops && this.activeSongLoops.length > 0) {
                    this.activeSongLoops.forEach(loopId => {
                        if (loopId !== -1 && this.loopMemory[loopId]) {
                            const colData = this.loopMemory[loopId].steps[step];
                            for (let r = 0; r < this.rows.length; r++) { 
                                if (colData[r].blocks && colData[r].blocks.length > 0 && !flashColor) { flashColor = colData[r].blocks[0].color; } 
                                if (colData[r].voiceBlocks && colData[r].voiceBlocks.length > 0 && !flashColor) { flashColor = 'voice'; }
                            }
                        }
                    });
                }
            }
            if (flashColor) { this.gridEl.style.backgroundColor = flashColor === 'voice' ? 'rgba(255,255,255,0.2)' : this.colorMap[flashColor]; setTimeout(() => { this.gridEl.style.backgroundColor = 'transparent'; }, 150); }
        });
        
        if (this.playbackMode === 'GRID') { 
            for (let r = 0; r < this.rows.length; r++) { 
                const blocks = this.cells[r][step].querySelectorAll('.block'); 
                const rowTokens = document.querySelectorAll(`.row-fx-slot[data-row="${r}"]:not(.voice-sub-fx) .fx-token`);
                const cellTokens = this.cells[r][step].querySelectorAll('.fx-token');

                blocks.forEach(block => {
                    const bColor = block.dataset.color; let crush = 0, echo = 0, reverb = 0, chorus = 0;
                    const addFx = (el) => {
                        const bound = el.dataset.boundColor || 'all';
                        if (bound === 'all' || bound === bColor) {
                            const amt = parseFloat(el.dataset.amount);
                            if(el.dataset.fx === 'crush') crush += amt; if(el.dataset.fx === 'echo') echo += amt; if(el.dataset.fx === 'reverb') reverb += amt; if(el.dataset.fx === 'chorus') chorus += amt;
                        }
                    };
                    rowTokens.forEach(addFx); cellTokens.forEach(addFx);
                    const finalVol = this.rowVolumes[r] * parseFloat(block.dataset.volume);
                    const bSpeed = parseFloat(block.dataset.speed || 1.0);
                    this.audio.playNote(r, bColor, parseInt(block.dataset.pitch), finalVol, bSpeed, {crush, echo, reverb, chorus}, time, block.dataset.kit); 
                });

                const vBlocks = this.voiceCells[r][step].querySelectorAll('.block');
                const vRowTokens = document.querySelectorAll(`.voice-sub-fx[data-row="${r}"] .fx-token`);
                const vCellTokens = this.voiceCells[r][step].querySelectorAll('.fx-token');

                vBlocks.forEach(block => {
                    let crush = 0, echo = 0, reverb = 0, chorus = 0;
                    const addVFx = (el) => {
                        const bound = el.dataset.boundColor || 'all';
                        if (bound === 'all' || bound === 'voice') {
                            const amt = parseFloat(el.dataset.amount);
                            if(el.dataset.fx === 'crush') crush += amt; if(el.dataset.fx === 'echo') echo += amt; if(el.dataset.fx === 'reverb') reverb += amt; if(el.dataset.fx === 'chorus') chorus += amt;
                        }
                    };
                    vRowTokens.forEach(addVFx); vCellTokens.forEach(addVFx);
                    const finalVol = this.voiceVolumes[r] * parseFloat(block.dataset.volume);
                    const bSpeed = parseFloat(block.dataset.speed || 1.0);
                    this.audio.playVoice(parseInt(block.dataset.vid), finalVol, parseInt(block.dataset.pitch), bSpeed, {crush, echo, reverb, chorus}, time);
                });
            } 
        } else if (this.playbackMode === 'SONG') { 
            if (this.activeSongLoops && this.activeSongLoops.length > 0) {
                this.activeSongLoops.forEach(loopId => {
                    if (loopId !== -1 && this.loopMemory[loopId]) {
                        const loop = this.loopMemory[loopId];
                        const colData = loop.steps[step]; 
                        for (let r = 0; r < this.rows.length; r++) { 
                            const rowFx = loop.rowFx[r]; const vRowFx = loop.voiceRowFx ? loop.voiceRowFx[r] : null;

                            if (colData[r].blocks) {
                                colData[r].blocks.forEach(b => { 
                                    let crush = 0, echo = 0, reverb = 0, chorus = 0;
                                    const addMemFx = (fData) => {
                                        if (fData.boundColor === 'all' || fData.boundColor === b.color) {
                                            if(fData.fx === 'crush') crush += fData.amount; if(fData.fx === 'echo') echo += fData.amount; if(fData.fx === 'reverb') reverb += fData.amount; if(fData.fx === 'chorus') chorus += fData.amount;
                                        }
                                    };
                                    if (Array.isArray(rowFx)) rowFx.forEach(addMemFx); if (Array.isArray(colData[r].cellFx)) colData[r].cellFx.forEach(addMemFx);
                                    const fx = { crush, echo, reverb, chorus }; const bSpeed = b.speed || 1.0;
                                    this.audio.playNote(r, b.color, b.pitch, this.rowVolumes[r] * (b.volume || 1.0), bSpeed, fx, time, b.kit); 
                                }); 
                            }
                            if (colData[r].voiceBlocks) {
                                colData[r].voiceBlocks.forEach(b => { 
                                    let crush = 0, echo = 0, reverb = 0, chorus = 0;
                                    const addVMemFx = (fData) => {
                                        if (fData.boundColor === 'all' || fData.boundColor === 'voice') {
                                            if(fData.fx === 'crush') crush += fData.amount; if(fData.fx === 'echo') echo += fData.amount; if(fData.fx === 'reverb') reverb += fData.amount; if(fData.fx === 'chorus') chorus += fData.amount;
                                        }
                                    };
                                    if (Array.isArray(vRowFx)) vRowFx.forEach(addVMemFx); if (Array.isArray(colData[r].voiceCellFx)) colData[r].voiceCellFx.forEach(addVMemFx);
                                    const fx = { crush, echo, reverb, chorus }; const bSpeed = b.speed || 1.0;
                                    this.audio.playVoice(parseInt(b.vid), this.voiceVolumes[r] * (b.volume || 1.0), parseInt(b.pitch), bSpeed, fx, time);
                                }); 
                            }
                        }
                    }
                });
            } 
        }
    }

    stopEngine() { 
        const wasSongMode = this.playbackMode === 'SONG';
        this.playbackMode = 'STOPPED'; this.activeSongLoops = []; cancelAnimationFrame(this.timerID); this.updateUIState(false);
        document.querySelectorAll('.cell').forEach(c => c.classList.remove('active')); document.querySelectorAll('.timeline-slot').forEach(s => s.classList.remove('active-macro')); 
        if (wasSongMode) {
            if (this.editingLoopId !== null) { this.displayLoopVisualOnly(this.editingLoopId); } 
            else { document.querySelectorAll('.cell').forEach(c => c.innerHTML = ''); document.querySelectorAll('.row-fx-slot').forEach(s => s.innerHTML = ''); }
        }
    }
}

const app = new JamBoardCore();