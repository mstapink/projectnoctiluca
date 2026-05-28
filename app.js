class JamBoardCore {
    constructor() {
        this.audio = new AudioEngine();
        
        this.BPM = 110;
        this.stepTime = 60 / this.BPM / 2;
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
        this.activeRhythm = 'STRAIGHT';
        
        this.editingLoopId = null;
        
        this.colorMap = { 'red': 'rgba(255, 51, 102, 0.4)', 'yellow': 'rgba(255, 204, 0, 0.4)', 'blue': 'rgba(0, 204, 255, 0.4)', 'green': 'rgba(51, 255, 102, 0.4)', 'purple': 'rgba(204, 51, 255, 0.4)' };

        this.gridEl = document.getElementById('grid');
        this.cells = [];
        
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
        }

        this.buildTimelineRow();

        document.querySelectorAll('#palette > div[draggable="true"]').forEach(el => { 
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
                            clone.addEventListener('click', (ev) => { if(ev.shiftKey) clone.remove(); });
                            clone.addEventListener('dblclick', () => { this.loadLoopToGrid(clone.dataset.loopId); });
                            slot.innerHTML = '';
                            slot.appendChild(clone);
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
                b.dataset.kit = newKit;
                b.title = newKit;
            });
        });

        document.getElementById('btn-save').addEventListener('click', () => this.saveLoop());
        document.getElementById('btn-save-new').addEventListener('click', () => this.saveLoop(true));
        
        document.getElementById('btn-add-timeline').addEventListener('click', () => this.buildTimelineRow());
        document.getElementById('btn-remove-timeline').addEventListener('click', () => {
            const rows = document.querySelectorAll('.timeline-row');
            if (rows.length > 1) rows[rows.length - 1].remove();
        });

        document.getElementById('btn-save-song').addEventListener('click', () => this.saveSong());
        document.getElementById('btn-clear-song').addEventListener('click', () => {
            document.querySelectorAll('.timeline-slot').forEach(slot => slot.innerHTML = '');
        });

        document.body.addEventListener('dragover', e => e.preventDefault());
        
        document.body.addEventListener('drop', e => {
            e.preventDefault(); 
            e.stopPropagation();
            if (e.dataTransfer.getData('source') === 'grid' && !e.target.closest('.cell') && !e.target.closest('.row-fx-slot')) {
                const dragging = document.querySelector('.dragging'); 
                if (dragging) {
                    const parent = dragging.parentElement;
                    const type = dragging.dataset.type;
                    const fxType = dragging.dataset.fx;
                    setTimeout(() => {
                        dragging.remove();
                        if (parent) {
                            if (type === 'fx') this.layoutFxTokens(parent, fxType);
                            if (type === 'block') this.layoutBlocks(parent);
                        }
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
            steps: [],
            rowFx: []
        };
        
        for (let r = 0; r < this.rows.length; r++) {
            let crush = 0; let echo = 0; let reverb = 0; let chorus = 0;
            const rowFxEls = document.querySelectorAll(`.row-fx-slot[data-row="${r}"] .fx-token`);
            rowFxEls.forEach(el => { 
                if(el.dataset.fx === 'crush') crush += parseFloat(el.dataset.amount); 
                if(el.dataset.fx === 'echo') echo += parseFloat(el.dataset.amount); 
                if(el.dataset.fx === 'reverb') reverb += parseFloat(el.dataset.amount); 
                if(el.dataset.fx === 'chorus') chorus += parseFloat(el.dataset.amount); 
            });
            snapshot.rowFx.push({ crush, echo, reverb, chorus });
        }

        for (let step = 0; step < this.STEPS; step++) {
            const stepData = [];
            for (let r = 0; r < this.rows.length; r++) {
                const cell = this.cells[r][step];
                
                const blocks = Array.from(cell.querySelectorAll('.block')).map(b => ({
                    color: b.dataset.color,
                    pitch: parseInt(b.dataset.pitch),
                    volume: parseFloat(b.dataset.volume),
                    kit: b.dataset.kit || this.audio.KITS[this.audio.activeKitIndex]
                }));
                
                let crush = 0; let echo = 0; let reverb = 0; let chorus = 0;
                const blockFxEls = cell.querySelectorAll('.fx-token');
                blockFxEls.forEach(el => { 
                    if(el.dataset.fx === 'crush') crush += parseFloat(el.dataset.amount); 
                    if(el.dataset.fx === 'echo') echo += parseFloat(el.dataset.amount); 
                    if(el.dataset.fx === 'reverb') reverb += parseFloat(el.dataset.amount); 
                    if(el.dataset.fx === 'chorus') chorus += parseFloat(el.dataset.amount); 
                });

                stepData.push({ blocks, cellFx: { crush, echo, reverb, chorus } });
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
        const token = document.createElement('div'); 
        token.className = 'loop-token'; 
        token.dataset.loopId = loopId;
        token.draggable = true;
        
        const miniColContainer = document.createElement('div');
        miniColContainer.className = 'mini-container';
        miniColContainer.style.display = 'flex';
        miniColContainer.style.width = '100%';
        miniColContainer.style.height = '100%';
        miniColContainer.style.gap = '1px';
        
        this.generateTokenVisuals(snapshot, miniColContainer);
        token.appendChild(miniColContainer);

        token.addEventListener('dragstart', e => { 
            e.dataTransfer.setData('source', 'bank'); 
            e.dataTransfer.setData('loopId', loopId); 
            setTimeout(() => token.classList.add('dragging'), 0); 
        });
        token.addEventListener('dragend', () => token.classList.remove('dragging')); 
        token.addEventListener('dblclick', () => { this.loadLoopToGrid(loopId); });
        
        document.getElementById('loop-bank').appendChild(token);
    }

    updateAllLoopTokens(loopId, snapshot) {
        const tokens = document.querySelectorAll(`.loop-token[data-loop-id="${loopId}"]`);
        tokens.forEach(token => {
            const container = token.querySelector('.mini-container');
            this.generateTokenVisuals(snapshot, container);
        });
    }

    saveSong() {
        const seqs = this.getTimelineSequences();
        const songId = this.songMemory.length;
        this.songMemory.push(seqs);
        
        const token = document.createElement('div');
        token.className = 'song-token';
        token.innerText = 'S' + songId;
        token.dataset.songId = songId;
        token.addEventListener('dblclick', () => this.loadSong(songId));
        document.getElementById('song-bank').appendChild(token);
    }

    loadSong(songId) {
        if (!this.songMemory[songId]) return;
        const seqs = this.songMemory[songId];
        
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
                        clone.addEventListener('click', (ev) => { if(ev.shiftKey) clone.remove(); });
                        clone.addEventListener('dblclick', () => { this.loadLoopToGrid(clone.dataset.loopId); });
                        slots[i].appendChild(clone);
                    }
                }
            }
        });
    }

    displayLoopVisualOnly(loopId) {
        if (loopId === -1 || !this.loopMemory[loopId]) return;
        
        document.querySelectorAll('.cell').forEach(c => c.innerHTML = ''); 
        document.querySelectorAll('.row-fx-slot').forEach(s => s.innerHTML = '');

        const loop = this.loopMemory[loopId];

        const buildFx = (target, type, totalAmt) => {
            let amt = totalAmt;
            while(amt > 0) {
                let val = Math.min(1.0, amt);
                target.appendChild(this.createFxDOM(type, val));
                amt -= val;
            }
            if (totalAmt > 0) this.layoutFxTokens(target, type);
        };

        for (let r = 0; r < this.rows.length; r++) {
            const rFx = loop.rowFx[r];
            const slot = document.querySelector(`.row-fx-slot[data-row="${r}"]`);
            if (rFx.crush > 0) buildFx(slot, 'crush', rFx.crush);
            if (rFx.echo > 0) buildFx(slot, 'echo', rFx.echo);
            if (rFx.reverb > 0) buildFx(slot, 'reverb', rFx.reverb);
            if (rFx.chorus > 0) buildFx(slot, 'chorus', rFx.chorus);
        }

        for (let step = 0; step < this.STEPS; step++) {
            for (let r = 0; r < this.rows.length; r++) {
                const cellData = loop.steps[step][r];
                const cell = this.cells[r][step];
                
                cellData.blocks.forEach(b => {
                    cell.appendChild(this.createBlockDOM(b.color, b.pitch, b.volume, b.kit));
                });
                this.layoutBlocks(cell);
                
                if (cellData.cellFx.crush > 0) buildFx(cell, 'crush', cellData.cellFx.crush);
                if (cellData.cellFx.echo > 0) buildFx(cell, 'echo', cellData.cellFx.echo);
                if (cellData.cellFx.reverb > 0) buildFx(cell, 'reverb', cellData.cellFx.reverb);
                if (cellData.cellFx.chorus > 0) buildFx(cell, 'chorus', cellData.cellFx.chorus);
            }
        }
    }

    loadLoopToGrid(loopId) {
        this.editingLoopId = parseInt(loopId);
        
        const btnSave = document.getElementById('btn-save');
        btnSave.innerText = 'UPDATE LOOP';
        btnSave.style.backgroundColor = 'var(--yellow)';
        btnSave.style.color = '#000';
        
        document.getElementById('btn-save-new').style.display = 'inline-block';

        this.displayLoopVisualOnly(this.editingLoopId);
    }

    resetEditMode() {
        this.editingLoopId = null;
        const btnSave = document.getElementById('btn-save');
        btnSave.innerText = 'SAVE LOOP';
        btnSave.style.backgroundColor = '#444';
        btnSave.style.color = '#fff';
        
        document.getElementById('btn-save-new').style.display = 'none';
    }

    generateTokenVisuals(snapshot, container) {
        container.innerHTML = '';
        for(let c = 0; c < this.STEPS; c++) {
            const col = document.createElement('div');
            col.className = 'mini-col';
            for(let r = 0; r < this.rows.length; r++) {
                const blk = document.createElement('div');
                blk.className = 'mini-block';
                if (snapshot.steps[c][r].blocks && snapshot.steps[c][r].blocks.length > 0) {
                    blk.style.backgroundColor = this.colorMap[snapshot.steps[c][r].blocks[0].color];
                } else {
                    blk.style.backgroundColor = 'transparent';
                }
                col.appendChild(blk);
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
            block.style.borderColor = `rgb(255, ${g}, 0)`;
        } else { block.style.borderColor = 'transparent'; }
    }

    layoutBlocks(target) {
        if (!target.classList.contains('cell')) return;
        const blocks = target.querySelectorAll('.block');
        const count = blocks.length;
        if (count === 0) return;
        const h = 100 / count; 
        blocks.forEach((b, i) => {
            b.style.position = 'absolute';
            b.style.height = `calc(${h}% - 10px)`; 
            b.style.width = 'calc(100% - 36px)'; 
            b.style.left = '18px'; 
            b.style.bottom = `calc(${i * h}% + 5px)`;
        });
    }

    layoutFxTokens(target, fxData) {
        const tokens = target.querySelectorAll(`.fx-token[data-fx="${fxData}"]`);
        const count = tokens.length;
        if (count === 0) return;
        const h = 35 / count; 
        tokens.forEach((t, i) => {
            t.style.height = `${h}px`;
            t.style.zIndex = '3'; // Fixes the overlap issue by forcing FX above blocks
            if (fxData === 'crush' || fxData === 'reverb') {
                t.style.top = `${5 + (i * h)}px`;
                t.style.bottom = 'auto';
            } else {
                t.style.bottom = `${5 + (i * h)}px`;
                t.style.top = 'auto';
            }
        });
    }

    createBlockDOM(color, pitch, volume = 1.0, kit = null) {
        const block = document.createElement('div'); block.className = 'block'; 
        block.dataset.type = 'block'; block.dataset.color = color; 
        block.dataset.pitch = pitch; block.dataset.volume = volume; block.draggable = true;
        block.dataset.kit = kit || this.audio.KITS[this.audio.activeKitIndex];
        block.title = block.dataset.kit; 
        
        block.innerHTML = `<span class="pitch-val">${pitch}</span><div class="vol-bar"></div>`;
        this.updateBlockVisuals(block, volume);
        
        block.addEventListener('click', (e) => { 
            if (e.shiftKey) { 
                const parent = block.parentElement;
                block.remove(); 
                if (parent) this.layoutBlocks(parent);
                return; 
            } 
            if (e.ctrlKey || e.metaKey) {
                let v = parseFloat(block.dataset.volume); v = v - 0.25; if(v < 0) v = 2.0;
                block.dataset.volume = v.toFixed(2); this.updateBlockVisuals(block, v); return;
            }
            let p = parseInt(block.dataset.pitch); p = p === 4 ? -4 : p + 1; 
            block.dataset.pitch = p; block.querySelector('.pitch-val').innerText = p; 
        });
        
        block.addEventListener('contextmenu', (e) => { 
            e.preventDefault(); if (e.ctrlKey || e.metaKey) return; 
            let p = parseInt(block.dataset.pitch); p = p === -4 ? 4 : p - 1; 
            block.dataset.pitch = p; block.querySelector('.pitch-val').innerText = p; 
        });
        
        block.addEventListener('wheel', (e) => { 
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault(); let v = parseFloat(block.dataset.volume);
                v = e.deltaY < 0 ? Math.min(2.0, v + 0.1) : Math.max(0, v - 0.1);
                block.dataset.volume = v.toFixed(2); this.updateBlockVisuals(block, v); return;
            }
            e.preventDefault(); let p = parseInt(block.dataset.pitch); p = e.deltaY < 0 ? (p === 4 ? -4 : p + 1) : (p === -4 ? 4 : p - 1); 
            block.dataset.pitch = p; block.querySelector('.pitch-val').innerText = p; 
        }, { passive: false });
        
        block.addEventListener('dragstart', e => { e.dataTransfer.setData('source', 'grid'); e.dataTransfer.setData('type', 'block'); setTimeout(() => block.classList.add('dragging'), 0); });
        block.addEventListener('dragend', () => block.classList.remove('dragging')); return block;
    }

    createFxDOM(fxType, amount = 1.0) {
        const token = document.createElement('div'); token.className = 'fx-token'; token.dataset.type = 'fx'; token.dataset.fx = fxType; token.dataset.amount = amount; token.draggable = true;
        token.innerHTML = `<div class="fx-bar" style="height: ${amount * 100}%"></div><span class="fx-label">${fxType.toUpperCase()}</span>`;
        token.style.zIndex = '3';
        
        token.addEventListener('click', (e) => { 
            if (e.shiftKey) { 
                const parent = token.parentElement;
                token.remove(); 
                if (parent) this.layoutFxTokens(parent, fxType);
                return; 
            } 
            let a = parseFloat(token.dataset.amount); a = a - 0.25; if(a < 0) a = 1.0;
            token.dataset.amount = a.toFixed(2); token.querySelector('.fx-bar').style.height = `${a * 100}%`;
        });
        
        token.addEventListener('wheel', (e) => { 
            e.preventDefault(); let a = parseFloat(token.dataset.amount);
            a = e.deltaY < 0 ? Math.min(1.0, a + 0.1) : Math.max(0, a - 0.1);
            token.dataset.amount = a.toFixed(2); token.querySelector('.fx-bar').style.height = `${a * 100}%`;
        }, { passive: false });
        
        token.addEventListener('dragstart', e => { e.dataTransfer.setData('source', 'grid'); e.dataTransfer.setData('type', 'fx'); setTimeout(() => token.classList.add('dragging'), 0); });
        token.addEventListener('dragend', () => token.classList.remove('dragging')); return token;
    }

    handleGridDrop(e, target) { 
        e.preventDefault(); e.stopPropagation();
        const source = e.dataTransfer.getData('source'); const type = e.dataTransfer.getData('type');
        const dragging = document.querySelector('.dragging');
        
        if (source === 'grid' && dragging) {
            const oldParent = dragging.parentElement;
            if (target.classList.contains('cell') || target.classList.contains('row-fx-slot')) {
                // Defer DOM reparenting by 1 frame to prevent browser drag-state lockups
                setTimeout(() => {
                    target.appendChild(dragging);
                    if (type === 'fx') {
                        this.layoutFxTokens(target, dragging.dataset.fx);
                        if (oldParent) this.layoutFxTokens(oldParent, dragging.dataset.fx);
                    }
                    if (type === 'block') {
                        this.layoutBlocks(target);
                        if (oldParent) this.layoutBlocks(oldParent);
                    }
                }, 0);
            } 
            return;
        }

        if (source === 'palette') {
            if (target.classList.contains('cell')) {
                if (type === 'block') { 
                    const activeKit = this.audio.KITS[this.audio.activeKitIndex];
                    target.appendChild(this.createBlockDOM(e.dataTransfer.getData('color'), 0, 1.0, activeKit)); 
                    this.layoutBlocks(target);
                } 
                else if (type === 'fx') {
                    const fxData = e.dataTransfer.getData('fx'); 
                    target.appendChild(this.createFxDOM(fxData, 1.0));
                    this.layoutFxTokens(target, fxData);
                }
            } else if (target.classList.contains('row-fx-slot') && type === 'fx') { 
                const fxData = e.dataTransfer.getData('fx'); 
                target.appendChild(this.createFxDOM(fxData, 1.0)); 
                this.layoutFxTokens(target, fxData);
            }
        }
    }

    getTimelineSequences() {
        const seqs = [];
        const timelineRows = document.querySelectorAll('.timeline-row');
        timelineRows.forEach(row => {
            const slots = row.querySelectorAll('.timeline-slot');
            const seq = [];
            slots.forEach(slot => {
                seq.push(slot.firstChild ? parseInt(slot.firstChild.dataset.loopId) : -1);
            });
            seqs.push(seq);
        });
        return seqs;
    }

    schedule() {
        while (this.nextNoteTime < this.audio.currentTime + 0.1) {
            if (this.playbackMode === 'SONG' && this.currentStep === 0) {
                const sequences = this.getTimelineSequences();
                let maxLen = Math.max(...sequences.map(s => {
                    let lastValid = -1;
                    for(let i=0; i<s.length; i++) if(s[i] !== -1) lastValid = i;
                    return lastValid + 1;
                }));

                if (maxLen > 0) {
                    if (this.currentMacroStep >= maxLen) this.currentMacroStep = 0; 
                    
                    this.activeSongLoops = sequences.map(seq => seq[this.currentMacroStep] !== undefined ? seq[this.currentMacroStep] : -1);
                    
                    const stepToHighlight = this.currentMacroStep;
                    requestAnimationFrame(() => { 
                        document.querySelectorAll('.timeline-slot').forEach(s => s.classList.remove('active-macro')); 
                        document.querySelectorAll('.timeline-row').forEach(row => {
                            const slots = row.querySelectorAll('.timeline-slot');
                            if (slots[stepToHighlight]) slots[stepToHighlight].classList.add('active-macro');
                        });
                    });
                    this.currentMacroStep++;
                } else { 
                    this.playbackMode = 'GRID'; 
                    this.activeSongLoops = []; 
                    this.updateUIState(false);
                }
            }
            
            this.processStep(this.currentStep, this.nextNoteTime); 
            
            let stepDur = this.stepTime;
            
            if (this.activeRhythm === 'LIGHT_SHUFFLE') { 
                stepDur = (this.currentStep % 2 === 0) ? this.stepTime * 1.08 : this.stepTime * 0.92;
            } else if (this.activeRhythm === 'CLASSIC_MPC') { 
                stepDur = (this.currentStep % 2 === 0) ? this.stepTime * 1.20 : this.stepTime * 0.80;
            } else if (this.activeRhythm === 'SWING') { 
                stepDur = (this.currentStep % 2 === 0) ? this.stepTime * 1.34 : this.stepTime * 0.66;
            } else if (this.activeRhythm === 'HARD_SHUFFLE') { 
                stepDur = (this.currentStep % 2 === 0) ? this.stepTime * 1.50 : this.stepTime * 0.50;
            } else if (this.activeRhythm === 'RUSHED') { 
                stepDur = (this.currentStep % 2 === 0) ? this.stepTime * 0.90 : this.stepTime * 1.10;
            }
            
            this.nextNoteTime += stepDur; 
            this.currentStep = (this.currentStep + 1) % this.STEPS;
        } 
        if (this.playbackMode !== 'STOPPED') { this.timerID = requestAnimationFrame(() => this.schedule()); }
    }

    processStep(step, time) {
        requestAnimationFrame(() => {
            document.querySelectorAll('.cell').forEach(c => c.classList.remove('active')); let flashColor = null;
            for (let r = 0; r < this.rows.length; r++) { this.cells[r][step].classList.add('active'); }
            
            if (this.playbackMode === 'GRID') { 
                for (let r = 0; r < this.rows.length; r++) { const blocks = this.cells[r][step].querySelectorAll('.block'); if (blocks.length > 0 && !flashColor) flashColor = blocks[0].dataset.color; } 
            } else if (this.playbackMode === 'SONG') { 
                if (this.activeSongLoops && this.activeSongLoops.length > 0) {
                    this.activeSongLoops.forEach(loopId => {
                        if (loopId !== -1 && this.loopMemory[loopId]) {
                            const colData = this.loopMemory[loopId].steps[step];
                            for (let r = 0; r < this.rows.length; r++) { 
                                if (colData[r].blocks && colData[r].blocks.length > 0 && !flashColor) { flashColor = colData[r].blocks[0].color; } 
                            }
                        }
                    });
                }
            }
            if (flashColor) { this.gridEl.style.backgroundColor = this.colorMap[flashColor]; setTimeout(() => { this.gridEl.style.backgroundColor = 'transparent'; }, 150); }
        });
        
        if (this.playbackMode === 'GRID') { 
            for (let r = 0; r < this.rows.length; r++) { 
                const blocks = this.cells[r][step].querySelectorAll('.block'); 
                
                let crush = 0; let echo = 0; let reverb = 0; let chorus = 0;
                document.querySelectorAll(`.row-fx-slot[data-row="${r}"] .fx-token`).forEach(el => {
                    if(el.dataset.fx === 'crush') crush += parseFloat(el.dataset.amount);
                    if(el.dataset.fx === 'echo') echo += parseFloat(el.dataset.amount);
                    if(el.dataset.fx === 'reverb') reverb += parseFloat(el.dataset.amount);
                    if(el.dataset.fx === 'chorus') chorus += parseFloat(el.dataset.amount);
                });
                this.cells[r][step].querySelectorAll('.fx-token').forEach(el => {
                    if(el.dataset.fx === 'crush') crush += parseFloat(el.dataset.amount);
                    if(el.dataset.fx === 'echo') echo += parseFloat(el.dataset.amount);
                    if(el.dataset.fx === 'reverb') reverb += parseFloat(el.dataset.amount);
                    if(el.dataset.fx === 'chorus') chorus += parseFloat(el.dataset.amount);
                });

                blocks.forEach(block => {
                    const finalVol = this.rowVolumes[r] * parseFloat(block.dataset.volume);
                    this.audio.playNote(r, block.dataset.color, parseInt(block.dataset.pitch), finalVol, {crush, echo, reverb, chorus}, time, block.dataset.kit); 
                });
            } 
        } else if (this.playbackMode === 'SONG') { 
            if (this.activeSongLoops && this.activeSongLoops.length > 0) {
                this.activeSongLoops.forEach(loopId => {
                    if (loopId !== -1 && this.loopMemory[loopId]) {
                        const loop = this.loopMemory[loopId];
                        const colData = loop.steps[step]; 
                        for (let r = 0; r < this.rows.length; r++) { 
                            const rowFx = loop.rowFx[r];
                            if (colData[r].blocks) {
                                colData[r].blocks.forEach(b => { 
                                    const fx = { 
                                        crush: rowFx.crush + colData[r].cellFx.crush, 
                                        echo: rowFx.echo + colData[r].cellFx.echo,
                                        reverb: rowFx.reverb + colData[r].cellFx.reverb,
                                        chorus: rowFx.chorus + colData[r].cellFx.chorus
                                    };
                                    this.audio.playNote(r, b.color, b.pitch, this.rowVolumes[r] * (b.volume || 1.0), fx, time, b.kit); 
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
        this.playbackMode = 'STOPPED'; 
        this.activeSongLoops = []; 
        cancelAnimationFrame(this.timerID); 
        this.updateUIState(false);
        
        document.querySelectorAll('.cell').forEach(c => c.classList.remove('active')); 
        document.querySelectorAll('.timeline-slot').forEach(s => s.classList.remove('active-macro')); 
        
        if (wasSongMode) {
            if (this.editingLoopId !== null) {
                this.displayLoopVisualOnly(this.editingLoopId);
            } else {
                document.querySelectorAll('.cell').forEach(c => c.innerHTML = ''); 
                document.querySelectorAll('.row-fx-slot').forEach(s => s.innerHTML = '');
            }
        }
    }
}

const app = new JamBoardCore();