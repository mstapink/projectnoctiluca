class AudioEngine {
    constructor() {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        
        this.KITS = ['TECHNO', '8-BIT', 'AMBIENT', 'RETRO-WAVE', 'GLITCH-HOP', 'DEEP-DUB', 'STRINGS', 'BEAT-BOX'];
        this.activeKitIndex = 0;
        this.SCALES = {
            'PENTATONIC': [0, 2, 4, 7, 9], 'MINOR PENT': [0, 3, 5, 7, 10],
            'MAJOR': [0, 2, 4, 5, 7, 9, 11], 'MINOR': [0, 2, 3, 5, 7, 8, 10],
            'BLUES': [0, 3, 5, 6, 7, 10]
        };
        this.activeKey = 60;
        this.activeScale = 'MINOR PENT';

        this.voiceBuffers = [];

        this.masterCompressor = this.ctx.createDynamicsCompressor();
        this.masterCompressor.threshold.value = -3; 
        this.masterCompressor.knee.value = 20; 
        this.masterCompressor.ratio.value = 4; 
        this.masterCompressor.attack.value = 0.005; 
        this.masterCompressor.release.value = 0.15;
        this.masterGain = this.ctx.createGain(); 
        this.masterGain.gain.value = 0.9;
        this.masterCompressor.connect(this.masterGain); 
        this.masterGain.connect(this.ctx.destination);

        this.busDry = this.ctx.createGain(); 
        this.busDry.connect(this.masterCompressor);

        this.busCrush = this.ctx.createGain();
        this.bitcrusher = this.ctx.createWaveShaper(); this.bitcrusher.oversample = 'none';
        this.bitcrusher.curve = this._makeCrushCurve(4);
        this.busCrush.connect(this.bitcrusher); this.bitcrusher.connect(this.masterCompressor);

        this.busEcho = this.ctx.createGain();
        this.delay = this.ctx.createDelay(2.0); this.delay.delayTime.value = 0.409;
        this.delayFeedback = this.ctx.createGain(); this.delayFeedback.gain.value = 0.5;
        this.delay.connect(this.delayFeedback); this.delayFeedback.connect(this.delay);
        this.busEcho.connect(this.delay); this.delay.connect(this.masterCompressor);

        this.busReverb = this.ctx.createGain();
        this.convolver = this.ctx.createConvolver();
        this.convolver.buffer = this._generateReverbIR();
        this.busReverb.connect(this.convolver); this.convolver.connect(this.masterCompressor);

        this.busChorus = this.ctx.createGain();
        
        const chorusFilter = this.ctx.createBiquadFilter();
        chorusFilter.type = 'lowpass';
        chorusFilter.frequency.value = 6000; 
        
        this.chorusDelay1 = this.ctx.createDelay(); this.chorusDelay1.delayTime.value = 0.015;
        this.chorusDelay2 = this.ctx.createDelay(); this.chorusDelay2.delayTime.value = 0.025;
        this.chorusDelay3 = this.ctx.createDelay(); this.chorusDelay3.delayTime.value = 0.035; 
        
        this.chorusLFO1 = this.ctx.createOscillator(); this.chorusLFO1.type = 'sine'; this.chorusLFO1.frequency.value = 1.2; 
        this.chorusLFO2 = this.ctx.createOscillator(); this.chorusLFO2.type = 'sine'; this.chorusLFO2.frequency.value = 1.8; 
        this.chorusLFO3 = this.ctx.createOscillator(); this.chorusLFO3.type = 'sine'; this.chorusLFO3.frequency.value = 2.5; 
        
        this.chorusGain1 = this.ctx.createGain(); this.chorusGain1.gain.value = 0.006;
        this.chorusGain2 = this.ctx.createGain(); this.chorusGain2.gain.value = 0.008; 
        this.chorusGain3 = this.ctx.createGain(); this.chorusGain3.gain.value = 0.010; 
        
        this.chorusLFO1.connect(this.chorusGain1); this.chorusGain1.connect(this.chorusDelay1.delayTime);
        this.chorusLFO2.connect(this.chorusGain2); this.chorusGain2.connect(this.chorusDelay2.delayTime);
        this.chorusLFO3.connect(this.chorusGain3); this.chorusGain3.connect(this.chorusDelay3.delayTime);
        
        this.chorusLFO1.start(); this.chorusLFO2.start(); this.chorusLFO3.start();
        
        const chorusOut = this.ctx.createGain(); chorusOut.gain.value = 1.0; 
        
        this.busChorus.connect(chorusFilter);
        chorusFilter.connect(this.chorusDelay1);
        chorusFilter.connect(this.chorusDelay2);
        chorusFilter.connect(this.chorusDelay3);
        
        this.chorusDelay1.connect(chorusOut); 
        this.chorusDelay2.connect(chorusOut); 
        this.chorusDelay3.connect(chorusOut); 
        chorusOut.connect(this.masterCompressor);

        this.noiseBuffer = this.ctx.createBuffer(1, this.ctx.sampleRate * 2, this.ctx.sampleRate);
        const output = this.noiseBuffer.getChannelData(0); 
        for (let i = 0; i < this.noiseBuffer.length; i++) { output[i] = Math.random() * 2 - 1; }
        
        this.distortionCurve = this._makeDistortionCurve(400); 
    }

    _makeCrushCurve(bits) {
        const n_samples = 44100; const curve = new Float32Array(n_samples); const steps = Math.pow(2, bits);
        for (let i = 0; i < n_samples; ++i) { let x = i * 2 / n_samples - 1; curve[i] = Math.round(x * steps) / steps; } 
        return curve;
    }

    _makeDistortionCurve(k) {
        const n_samples = 44100; const curve = new Float32Array(n_samples); const deg = Math.PI / 180;
        for (let i = 0; i < n_samples; ++i) { let x = i * 2 / n_samples - 1; curve[i] = (3 + k) * x * 20 * deg / (Math.PI + k * Math.abs(x)); } return curve;
    }

    _generateReverbIR() {
        const length = this.ctx.sampleRate * 1.5; const impulse = this.ctx.createBuffer(2, length, this.ctx.sampleRate);
        for (let channel = 0; channel < 2; channel++) { const data = impulse.getChannelData(channel); for (let i = 0; i < length; i++) { data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 3); } } return impulse;
    }

    createNoise() { const n = this.ctx.createBufferSource(); n.buffer = this.noiseBuffer; return n; }
    resume() { if (this.ctx.state === 'suspended') this.ctx.resume(); }
    get currentTime() { return this.ctx.currentTime; }
    setDelayTime(timeInSeconds) { this.delay.delayTime.value = timeInSeconds; }
    cycleKit() { this.activeKitIndex = (this.activeKitIndex + 1) % this.KITS.length; return this.KITS[this.activeKitIndex]; }
    setTheory(key, scale) { this.activeKey = key; this.activeScale = scale; }

    _getFreq(pitchIdx) {
        const intervals = this.SCALES[this.activeScale]; let octaves = Math.floor(pitchIdx / intervals.length);
        let step = pitchIdx % intervals.length; if (step < 0) step += intervals.length; 
        let midiNote = this.activeKey + (octaves * 12) + intervals[step]; return 440 * Math.pow(2, (midiNote - 69) / 12);
    }

    trimVoiceBuffer(buffer) {
        const data = buffer.getChannelData(0); const sampleRate = buffer.sampleRate;
        let endIdx = Math.max(0, data.length - Math.floor(sampleRate * 0.2));
        let startIdx = 0; const threshold = 0.02;
        for (let i = 0; i < endIdx; i++) { if (Math.abs(data[i]) > threshold) { startIdx = Math.max(0, i - Math.floor(sampleRate * 0.05)); break; } }
        for (let i = endIdx; i > startIdx; i--) { if (Math.abs(data[i]) > threshold) { endIdx = Math.min(data.length, i + Math.floor(sampleRate * 0.05)); break; } }
        const trimmedLength = Math.max(1, endIdx - startIdx);
        const newBuffer = this.ctx.createBuffer(buffer.numberOfChannels, trimmedLength, sampleRate);
        for (let c = 0; c < buffer.numberOfChannels; c++) { newBuffer.copyToChannel(buffer.getChannelData(c).subarray(startIdx, startIdx + trimmedLength), c); }
        return newBuffer;
    }

    playVoice(vid, volume, pitchIdx, speed, fx, time) {
        if (!this.voiceBuffers || !this.voiceBuffers[vid]) return;
        const buffer = this.voiceBuffers[vid]; const outGain = this.ctx.createGain(); let masterLevel = volume;
        const preRouter = this.ctx.createGain(); preRouter.gain.value = 1; outGain.connect(preRouter); this._routeSignal(preRouter, fx);
        const pitchRatio = Math.pow(2, pitchIdx / 12);
        
        speed = Math.max(0.1, speed);

        // Standard playback bypass (no pitch or speed shift)
        if (speed === 1.0 && pitchIdx === 0) {
            const source = this.ctx.createBufferSource(); source.buffer = buffer;
            const env = this.ctx.createGain(); env.gain.setValueAtTime(0, time); env.gain.linearRampToValueAtTime(masterLevel, time + 0.005);
            const dur = buffer.duration; env.gain.setValueAtTime(masterLevel, time + dur - 0.015); env.gain.linearRampToValueAtTime(0, time + dur);
            source.connect(env); env.connect(outGain); source.start(time);
            setTimeout(() => { try { outGain.disconnect(); preRouter.disconnect(); } catch(e){} }, (dur * 1000) + 3000);
            return;
        }

        // Anti-Robotic DSP 1: Dynamic grain sizing
        const baseGrain = 0.09;
        const grainSize = Math.max(0.04, Math.min(0.12, baseGrain / pitchRatio)); 
        const overlap = 6; // Increased overlap to 6 for a much smoother, lush blur
        const grainInterval = grainSize / overlap; 
        
        const duration = buffer.duration; const totalPlayTime = duration / speed;
        const numGrains = Math.floor(totalPlayTime / grainInterval);

        // Anti-Grain Smoothing Filter
        const smoothFilter = this.ctx.createBiquadFilter();
        smoothFilter.type = 'lowpass';
        smoothFilter.frequency.value = Math.min(5000 * pitchRatio, 18000); 

        // Global Macro Envelope
        const grainMaster = this.ctx.createGain();
        grainMaster.gain.setValueAtTime(0, time);
        grainMaster.gain.linearRampToValueAtTime(masterLevel, time + 0.01);
        grainMaster.gain.setValueAtTime(masterLevel, Math.max(time + 0.01, time + totalPlayTime - 0.05));
        grainMaster.gain.linearRampToValueAtTime(0, time + totalPlayTime);
        
        grainMaster.connect(smoothFilter);
        smoothFilter.connect(outGain);

        for (let i = 0; i < numGrains; i++) {
            const baseGrainTime = time + (i * grainInterval); 
            const baseReadPos = (i * grainInterval) * speed;
            
            if (baseReadPos >= duration) break;

            // Anti-Robotic DSP 2: Grain Jitter (Spray)
            const timeJitter = (Math.random() - 0.5) * (grainInterval * 0.4);
            const posJitter = (Math.random() - 0.5) * 0.005; 
            
            const grainTime = baseGrainTime + timeJitter;
            const readPos = Math.max(0, baseReadPos + posJitter);
            
            const requiredBufferTime = grainSize * pitchRatio;
            if (readPos + requiredBufferTime > duration) {
                if (duration - readPos < 0.01) break; 
            }

            const source = this.ctx.createBufferSource(); 
            source.buffer = buffer; 
            source.playbackRate.value = pitchRatio;
            
            const env = this.ctx.createGain(); 
            env.gain.setValueAtTime(0, grainTime);
            
            // SILKY FIX: Smooth Triangle Window peaking at 0.3
            // 6 overlapping grains * 0.3 peak = 1.8 theoretical max sum, preventing hard clipping
            env.gain.linearRampToValueAtTime(0.3, grainTime + (grainSize * 0.4));
            env.gain.linearRampToValueAtTime(0, grainTime + grainSize);
            
            source.connect(env); 
            env.connect(grainMaster);
            
            source.start(grainTime, readPos, grainSize);
            source.stop(grainTime + grainSize);
        }

        setTimeout(() => { try { outGain.disconnect(); preRouter.disconnect(); } catch(e){} }, (totalPlayTime * 1000) + 3000);
    }

    _routeSignal(sourceNode, fx) {
        const c = fx.crush || 0; const e = fx.echo || 0; const r = fx.reverb || 0; const h = fx.chorus || 0;
        const dryLvl = Math.max(0, 1 - c);
        const dryG = this.ctx.createGain(); dryG.gain.value = dryLvl; sourceNode.connect(dryG); dryG.connect(this.busDry);
        const crushG = this.ctx.createGain(); crushG.gain.value = c; sourceNode.connect(crushG); crushG.connect(this.busCrush);
        const echoG = this.ctx.createGain(); echoG.gain.value = e; sourceNode.connect(echoG); echoG.connect(this.busEcho);
        const reverbG = this.ctx.createGain(); reverbG.gain.value = r; sourceNode.connect(reverbG); reverbG.connect(this.busReverb);
        const chorusG = this.ctx.createGain(); chorusG.gain.value = h; sourceNode.connect(chorusG); chorusG.connect(this.busChorus);
    }

    _playString(row, color, freq, volume, speed, fx, time) {
        const outGain = this.ctx.createGain(); let masterLevel = volume * 0.4;
        const preRouter = this.ctx.createGain(); preRouter.gain.value = 1; outGain.connect(preRouter); this._routeSignal(preRouter, fx);
        const durMult = 1.0 / Math.max(0.1, speed); const t = (offset) => time + (offset * durMult);

        if (row === 0) {
            let decay = color === 'green' ? 0.2 : (color === 'purple' ? 2.5 : 1.5);
            let bright = color === 'yellow' ? 6000 : (color === 'red' ? 2000 : 4000); let is12String = color === 'blue'; let isHarmonic = color === 'purple';
            let f = isHarmonic ? freq * 2 : freq;
            const osc = this.ctx.createOscillator(); osc.type = 'triangle'; osc.frequency.value = f; const osc2 = this.ctx.createOscillator(); osc2.type = 'sine'; osc2.frequency.value = f * 2;
            const filter = this.ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.setValueAtTime(bright, time); filter.frequency.exponentialRampToValueAtTime(400, t(decay * 0.3));
            const env = this.ctx.createGain(); env.gain.setValueAtTime(0, time); env.gain.linearRampToValueAtTime(1 * masterLevel, time + 0.01); env.gain.exponentialRampToValueAtTime(0.001, t(decay));
            osc.connect(filter); osc2.connect(filter); osc.start(time); osc2.start(time); osc.stop(t(decay)); osc2.stop(t(decay));
            if (is12String) { const osc3 = this.ctx.createOscillator(); osc3.type = 'triangle'; osc3.frequency.value = f * 1.005; osc3.connect(filter); osc3.start(time); osc3.stop(t(decay)); }
            if (color === 'yellow') { const noise = this.createNoise(); const nFilt = this.ctx.createBiquadFilter(); nFilt.type = 'highpass'; nFilt.frequency.value = 4000; const nEnv = this.ctx.createGain(); nEnv.gain.setValueAtTime(0.5 * masterLevel, time); nEnv.gain.exponentialRampToValueAtTime(0.01, t(0.05)); noise.connect(nFilt); nFilt.connect(nEnv); nEnv.connect(outGain); noise.start(time); noise.stop(t(0.05)); }
            filter.connect(env); env.connect(outGain);
        } else if (row === 1) {
            let decay = color === 'green' ? 0.3 : 2.0; let bright = color === 'yellow' ? 3000 : (color === 'red' ? 800 : 1500);
            const osc = this.ctx.createOscillator(); osc.type = color === 'yellow' ? 'sawtooth' : 'triangle'; osc.frequency.value = freq / 2; const sub = this.ctx.createOscillator(); sub.type = 'sine'; sub.frequency.value = freq / 4;
            if (color === 'purple') { osc.frequency.exponentialRampToValueAtTime((freq/2) * 0.9, t(decay)); sub.frequency.exponentialRampToValueAtTime((freq/4) * 0.9, t(decay)); }
            const filter = this.ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.setValueAtTime(bright, time); filter.frequency.exponentialRampToValueAtTime(150, t(decay * 0.3));
            const env = this.ctx.createGain(); env.gain.setValueAtTime(0, time); env.gain.linearRampToValueAtTime(1.2 * masterLevel, time + 0.02); env.gain.exponentialRampToValueAtTime(0.001, t(decay));
            osc.connect(filter); sub.connect(filter); filter.connect(env); env.connect(outGain); osc.start(time); sub.start(time); osc.stop(t(decay)); sub.stop(t(decay));
            if (color === 'blue') { const chorusOsc = this.ctx.createOscillator(); chorusOsc.type = 'triangle'; chorusOsc.frequency.value = (freq / 2) * 1.01; chorusOsc.connect(filter); chorusOsc.start(time); chorusOsc.stop(t(decay)); }
            if (color === 'green') { const noise = this.createNoise(); const nFilter = this.ctx.createBiquadFilter(); nFilter.type = 'bandpass'; nFilter.frequency.value = 2500; const nEnv = this.ctx.createGain(); nEnv.gain.setValueAtTime(0.3 * masterLevel, time); nEnv.gain.exponentialRampToValueAtTime(0.01, t(0.05)); noise.connect(nFilter); nFilter.connect(nEnv); nEnv.connect(outGain); noise.start(time); noise.stop(t(0.05)); }
        } else if (row === 2) {
            let decay = color === 'green' ? 0.15 : (color === 'purple' ? 2.5 : 1.5); let attack = color === 'purple' ? 0.3 : 0.01; let bright = color === 'yellow' ? 5000 : (color === 'red' ? 1500 : 3500);
            const osc = this.ctx.createOscillator(); osc.type = 'square'; osc.frequency.value = freq; const osc2 = this.ctx.createOscillator(); osc2.type = color==='red'?'triangle':'sine'; osc2.frequency.value = freq;
            if (color === 'blue') { const lfo = this.ctx.createOscillator(); lfo.frequency.value = 4; const lfoGain = this.ctx.createGain(); lfoGain.gain.value = freq * 0.02; lfo.connect(lfoGain); lfoGain.connect(osc.frequency); lfoGain.connect(osc2.frequency); lfo.start(time); lfo.stop(t(decay)); }
            const filter = this.ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.setValueAtTime(bright, time); filter.frequency.exponentialRampToValueAtTime(600, t(decay * 0.4));
            const env = this.ctx.createGain(); env.gain.setValueAtTime(0, time); env.gain.linearRampToValueAtTime(0.8 * masterLevel, t(attack)); env.gain.exponentialRampToValueAtTime(0.001, t(decay));
            osc.connect(filter); osc2.connect(filter); filter.connect(env); env.connect(outGain); osc.start(time); osc2.start(time); osc.stop(t(decay)); osc2.stop(t(decay));
        } else if (row === 3) {
            let decay = color === 'green' ? 0.15 : (color === 'purple' ? 2.5 : 1.2); let lpFreq = color === 'yellow' ? 6000 : (color === 'red' ? 3000 : 4500); 
            const root = this.ctx.createOscillator(); root.type = 'sawtooth'; root.frequency.value = freq; const fifth = this.ctx.createOscillator(); fifth.type = 'sawtooth'; fifth.frequency.value = freq * 1.4983; const sub = this.ctx.createOscillator(); sub.type = 'square'; sub.frequency.value = freq / 2; 
            const drive = this.ctx.createGain(); drive.gain.value = 10.0; const ws = this.ctx.createWaveShaper(); ws.curve = this.distortionCurve; ws.oversample = '4x';
            const cab = this.ctx.createBiquadFilter(); cab.type = 'lowpass'; cab.frequency.value = lpFreq; const cabHp = this.ctx.createBiquadFilter(); cabHp.type = 'highpass'; cabHp.frequency.value = 130;
            const env = this.ctx.createGain(); env.gain.setValueAtTime(0, time); const styleOut = this.ctx.createGain(); styleOut.gain.value = 1;
            if (color === 'green') { cab.frequency.setValueAtTime(2000, time); cab.frequency.exponentialRampToValueAtTime(300, t(0.1)); env.gain.linearRampToValueAtTime(1.0 * masterLevel, time + 0.01); env.gain.exponentialRampToValueAtTime(0.001, t(0.15)); } 
            else if (color === 'red') { root.frequency.setValueAtTime(freq * 1.1224, time); fifth.frequency.setValueAtTime((freq * 1.4983) * 1.1224, time); sub.frequency.setValueAtTime((freq / 2) * 1.1224, time); root.frequency.exponentialRampToValueAtTime(freq, t(0.1)); fifth.frequency.exponentialRampToValueAtTime(freq * 1.4983, t(0.1)); sub.frequency.exponentialRampToValueAtTime(freq / 2, t(0.1)); env.gain.linearRampToValueAtTime(0.8 * masterLevel, time + 0.02); env.gain.setTargetAtTime(0.5 * masterLevel, t(0.1), 0.2); env.gain.exponentialRampToValueAtTime(0.001, t(decay)); } 
            else if (color === 'purple') { root.frequency.value = freq * 2; fifth.frequency.value = freq * 2.9966; sub.frequency.value = freq; env.gain.linearRampToValueAtTime(0.7 * masterLevel, t(0.05)); env.gain.exponentialRampToValueAtTime(0.001, t(decay)); const trem = this.ctx.createOscillator(); trem.type = 'sine'; trem.frequency.value = 12; const tremGain = this.ctx.createGain(); tremGain.gain.value = freq * 0.05; trem.connect(tremGain); tremGain.connect(root.frequency); tremGain.connect(fifth.frequency); trem.start(time); trem.stop(t(decay)); } 
            else if (color === 'blue') { env.gain.linearRampToValueAtTime(0.8 * masterLevel, time + 0.02); env.gain.exponentialRampToValueAtTime(0.001, t(decay)); const tremolo = this.ctx.createOscillator(); tremolo.type = 'sine'; tremolo.frequency.value = 12; const tremGain = this.ctx.createGain(); tremGain.gain.value = 0.8; tremolo.connect(tremGain); tremGain.connect(styleOut.gain); tremolo.start(time); tremolo.stop(t(decay)); } 
            else { env.gain.linearRampToValueAtTime(0.8 * masterLevel, time + 0.02); env.gain.setTargetAtTime(0.5 * masterLevel, t(0.1), 0.4); env.gain.exponentialRampToValueAtTime(0.001, t(decay)); }
            root.connect(drive); fifth.connect(drive); sub.connect(drive); drive.connect(ws); ws.connect(cab); cab.connect(cabHp); if (color !== 'blue') cabHp.connect(env); env.connect(styleOut); styleOut.connect(outGain);
            root.start(time); fifth.start(time); sub.start(time); root.stop(t(decay)); fifth.stop(t(decay)); sub.stop(t(decay));
        } else if (row === 4) {
            let isPizzicato = color === 'green'; let isCello = color === 'red'; let attack = isPizzicato ? 0.01 : (color === 'purple' ? 0.8 : 0.3); let decay = isPizzicato ? 0.3 : (color === 'purple' ? 3.0 : 1.5); let f = isCello ? freq / 2 : freq;
            const sawOsc = this.ctx.createOscillator(); sawOsc.type = 'sawtooth'; sawOsc.frequency.value = f; const triOsc = this.ctx.createOscillator(); triOsc.type = 'triangle'; triOsc.frequency.value = f;
            const isEnsemble = (color === 'blue' || color === 'purple'); const sawOsc2 = this.ctx.createOscillator(); if (isEnsemble) { sawOsc2.type = 'sawtooth'; sawOsc2.frequency.value = f * 1.008; }
            if (!isPizzicato) { const lfo = this.ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 5.5; const lfoGain = this.ctx.createGain(); lfoGain.gain.setValueAtTime(0, time); lfoGain.gain.setTargetAtTime(f * 0.015, t(attack + 0.1), 0.3); lfo.connect(lfoGain); lfoGain.connect(sawOsc.frequency); lfoGain.connect(triOsc.frequency); if (isEnsemble) lfoGain.connect(sawOsc2.frequency); lfo.start(time); lfo.stop(t(attack + decay)); }
            const filter = this.ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = color === 'yellow' ? 4500 : (isCello ? 1500 : 3000); 
            const bodyResonance = this.ctx.createBiquadFilter(); bodyResonance.type = 'peaking'; bodyResonance.frequency.value = isCello ? 250 : 400; bodyResonance.Q.value = 2.0; bodyResonance.gain.value = 5;
            const env = this.ctx.createGain(); env.gain.setValueAtTime(0, time); env.gain.linearRampToValueAtTime(0.2 * masterLevel, t(attack)); if (!isPizzicato) env.gain.setTargetAtTime(0.15 * masterLevel, t(attack), 0.4); env.gain.exponentialRampToValueAtTime(0.001, t(attack + decay));
            sawOsc.connect(filter); triOsc.connect(filter); if (isEnsemble) sawOsc2.connect(filter); filter.connect(bodyResonance); bodyResonance.connect(env); env.connect(outGain);
            sawOsc.start(time); triOsc.start(time); sawOsc.stop(t(attack + decay)); triOsc.stop(t(attack + decay)); if (isEnsemble) { sawOsc2.start(time); sawOsc2.stop(t(attack + decay)); }
        }
        setTimeout(() => { try { outGain.disconnect(); preRouter.disconnect(); } catch(e){} }, 5000);
    }

    _playDrum(row, color, pitchIdx, volume, speed, fx, time) {
        const outGain = this.ctx.createGain(); let masterLevel = volume * 0.8;
        const preRouter = this.ctx.createGain(); preRouter.gain.value = 1; outGain.connect(preRouter); this._routeSignal(preRouter, fx);
        const durMult = 1.0 / Math.max(0.1, speed); const t = (offset) => time + (offset * durMult);
        const tune = Math.pow(2, pitchIdx / 12); const yMod = pitchIdx; 
        const dynDecay = Math.max(0.05, 0.8 - (yMod * 0.1)) * durMult;    
        const dynSnap  = Math.max(0.02, 0.15 + (yMod * 0.03)) * durMult;  
        const dynFreq  = Math.max(200, 1000 + (yMod * 150));    

        const makeNoise = (f, q, dur, vol, type='highpass') => {
            const n = this.createNoise(); const filt = this.ctx.createBiquadFilter(); filt.type = type; filt.frequency.value = Math.min(f, 22000); filt.Q.value = q;
            const env = this.ctx.createGain(); env.gain.setValueAtTime(0, time); env.gain.linearRampToValueAtTime(vol*masterLevel, time + 0.005); env.gain.exponentialRampToValueAtTime(0.001, t(dur));
            n.connect(filt); filt.connect(env); env.connect(outGain); n.start(time); n.stop(t(dur));
        };
        const makeMetallic = (baseFreq, dur, vol, type='highpass', filterFreq=7000) => {
            const filter = this.ctx.createBiquadFilter(); filter.type = type; filter.frequency.value = Math.min(filterFreq, 22000);
            const env = this.ctx.createGain(); env.gain.setValueAtTime(0, time); env.gain.linearRampToValueAtTime(vol * masterLevel, time + 0.005); env.gain.exponentialRampToValueAtTime(0.001, t(dur)); filter.connect(env); env.connect(outGain);
            const ratios = [1.0, 1.48, 1.93, 2.55, 3.17, 3.87]; ratios.forEach(r => { const osc = this.ctx.createOscillator(); osc.type = 'square'; osc.frequency.value = Math.min(baseFreq * r * tune, 22000); osc.connect(filter); osc.start(time); osc.stop(t(dur)); });
        };

        if (row === 0) { 
            const osc = this.ctx.createOscillator(); osc.type = 'sine'; const env = this.ctx.createGain();
            if (color === 'red') { osc.frequency.setValueAtTime(150 * tune, time); osc.frequency.exponentialRampToValueAtTime(45 * tune, t(0.05)); env.gain.setValueAtTime(masterLevel, time); env.gain.exponentialRampToValueAtTime(0.001, t(dynDecay * 2)); } 
            else if (color === 'yellow') { osc.frequency.setValueAtTime(300 * tune, time); osc.frequency.exponentialRampToValueAtTime(50 * tune, t(0.03)); env.gain.setValueAtTime(masterLevel, time); env.gain.exponentialRampToValueAtTime(0.001, t(dynDecay*0.5)); makeNoise(1000, 1, 0.03, 0.6, 'highpass'); } 
            else if (color === 'blue') { osc.type = 'triangle'; osc.frequency.setValueAtTime(200 * tune, time); osc.frequency.exponentialRampToValueAtTime(60 * tune, t(0.02)); env.gain.setValueAtTime(masterLevel, time); env.gain.exponentialRampToValueAtTime(0.001, t(dynDecay*0.3)); } 
            else if (color === 'green') { osc.type = 'triangle'; osc.frequency.setValueAtTime(400 * tune, time); osc.frequency.exponentialRampToValueAtTime(40 * tune, t(0.15)); env.gain.setValueAtTime(masterLevel, time); env.gain.exponentialRampToValueAtTime(0.001, t(dynDecay)); } 
            else { osc.frequency.setValueAtTime(50 * tune, time); const fm = this.ctx.createOscillator(); fm.type = 'square'; fm.frequency.setValueAtTime(300 * tune, time); fm.frequency.exponentialRampToValueAtTime(10 * tune, t(0.05)); const fmGain = this.ctx.createGain(); fmGain.gain.value = 500 + (yMod * 100); fm.connect(fmGain); fmGain.connect(osc.frequency); env.gain.setValueAtTime(masterLevel, time); env.gain.exponentialRampToValueAtTime(0.001, t(dynDecay)); fm.start(time); fm.stop(t(dynDecay)); }
            osc.connect(env); env.connect(outGain); osc.start(time); osc.stop(t(2.0));
        } else if (row === 1) { 
            const bodyOsc = this.ctx.createOscillator(); bodyOsc.type = 'triangle'; const bodyEnv = this.ctx.createGain(); bodyOsc.connect(bodyEnv); bodyEnv.connect(outGain);
            if (color === 'red') { bodyOsc.frequency.setValueAtTime(250 * tune, time); bodyOsc.frequency.exponentialRampToValueAtTime(150 * tune, t(0.05)); bodyEnv.gain.setValueAtTime(masterLevel * 0.6, time); bodyEnv.gain.exponentialRampToValueAtTime(0.001, t(0.1)); makeNoise(dynFreq, 1, dynSnap * 1.5, 0.8, 'highpass'); } 
            else if (color === 'yellow') { makeNoise(1000, 1, dynSnap*0.2, 0.7, 'bandpass'); setTimeout(() => makeNoise(1000, 1, dynSnap*0.2, 0.7, 'bandpass'), 10); setTimeout(() => makeNoise(1000, 1, dynSnap*0.3, 0.7, 'bandpass'), 20); setTimeout(() => makeNoise(1000, 1, dynSnap, 0.6, 'bandpass'), 30); bodyOsc.disconnect(); } 
            else if (color === 'blue') { bodyOsc.frequency.setValueAtTime(180 * tune, time); bodyOsc.frequency.exponentialRampToValueAtTime(100 * tune, t(0.05)); bodyEnv.gain.setValueAtTime(masterLevel * 0.8, time); bodyEnv.gain.exponentialRampToValueAtTime(0.001, t(0.1)); makeNoise(dynFreq*0.5, 1, dynSnap*1.2, 1.0, 'highpass'); } 
            else if (color === 'green') { bodyOsc.type = 'square'; bodyOsc.frequency.setValueAtTime(800 * tune, time); bodyOsc.frequency.exponentialRampToValueAtTime(350 * tune, t(0.02)); const filter = this.ctx.createBiquadFilter(); filter.type = 'bandpass'; filter.frequency.value = 600 * tune; bodyEnv.gain.setValueAtTime(masterLevel, time); bodyEnv.gain.exponentialRampToValueAtTime(0.001, t(0.05)); bodyOsc.disconnect(); bodyOsc.connect(filter); filter.connect(bodyEnv); } 
            else { bodyOsc.type = 'sawtooth'; bodyOsc.frequency.setValueAtTime(1500 * tune, time); bodyOsc.frequency.exponentialRampToValueAtTime(150 * tune, t(0.1)); bodyEnv.gain.setValueAtTime(masterLevel, time); bodyEnv.gain.exponentialRampToValueAtTime(0.001, t(0.15)); makeNoise(dynFreq*1.5, 1, dynSnap*0.8, 0.6, 'highpass'); }
            bodyOsc.start(time); bodyOsc.stop(t(0.5));
        } else if (row === 2) { 
            if (color === 'red') { makeMetallic(350, dynSnap*0.4, 0.7, 'highpass', dynFreq*3); } 
            else if (color === 'yellow') { makeMetallic(350, dynSnap*2.5, 0.7, 'highpass', dynFreq*2); } 
            else if (color === 'blue') { makeNoise(7000, 1, dynSnap*0.3, 0.6, 'highpass'); } 
            else if (color === 'green') { makeNoise(4000, 5, dynSnap, 0.6, 'bandpass'); } 
            else { makeMetallic(800, dynSnap*0.2, 0.8, 'highpass', 9000); } 
        } else if (row === 3) { 
            const osc = this.ctx.createOscillator(); osc.type = 'sine'; const env = this.ctx.createGain(); osc.connect(env); env.connect(outGain);
            const tf = 200 * tune; const bendTime = Math.max(0.05, 0.15 - (yMod * 0.02)) * durMult; 
            if (color === 'red') { osc.frequency.setValueAtTime(tf*0.5, time); osc.frequency.exponentialRampToValueAtTime(tf*0.25, time+bendTime); env.gain.setValueAtTime(masterLevel, time); env.gain.exponentialRampToValueAtTime(0.001, time+(bendTime*3)); } 
            else if (color === 'yellow') { osc.frequency.setValueAtTime(tf*1.5, time); osc.frequency.exponentialRampToValueAtTime(tf*0.75, time+bendTime); env.gain.setValueAtTime(masterLevel, time); env.gain.exponentialRampToValueAtTime(0.001, time+(bendTime*2)); } 
            else if (color === 'blue') { osc.type = 'triangle'; osc.frequency.setValueAtTime(tf*4, time); osc.frequency.exponentialRampToValueAtTime(tf*0.5, t(0.2)); env.gain.setValueAtTime(masterLevel, time); env.gain.exponentialRampToValueAtTime(0.001, t(0.3)); makeNoise(2000, 1, 0.05, 0.4, 'highpass'); } 
            else if (color === 'green') { osc.frequency.setValueAtTime(2500 * tune, time); env.gain.setValueAtTime(masterLevel, time); env.gain.exponentialRampToValueAtTime(0.001, t(0.05)); } 
            else { osc.type = 'square'; const osc2 = this.ctx.createOscillator(); osc2.type = 'square'; osc.frequency.value = 800 * tune; osc2.frequency.value = 540 * tune; const filt = this.ctx.createBiquadFilter(); filt.type = 'bandpass'; filt.frequency.value = 1000 * tune; osc.disconnect(); osc.connect(filt); osc2.connect(filt); filt.connect(env); env.gain.setValueAtTime(masterLevel*0.6, time); env.gain.exponentialRampToValueAtTime(0.001, t(0.3)); osc2.start(time); osc2.stop(t(0.4)); }
            osc.start(time); osc.stop(t(1.0));
        } else if (row === 4) { 
            if (color === 'red') { makeMetallic(250, (dynDecay/durMult)*2.5*durMult, 0.7, 'highpass', 4000); makeNoise(3000, 1, (dynDecay/durMult)*2.0*durMult, 0.3, 'highpass'); } 
            else if (color === 'yellow') { makeMetallic(350, (dynDecay/durMult)*1.5*durMult, 0.6, 'bandpass', 6000); } 
            else if (color === 'blue') { makeNoise(6000, 1, 0.05*durMult, 0.5, 'highpass'); setTimeout(() => makeNoise(6000, 1, 0.05*durMult, 0.3, 'highpass'), 30); } 
            else if (color === 'green') { const osc = this.ctx.createOscillator(); osc.type = 'square'; const lfo = this.ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = (5 + yMod) / durMult; const lfoGain = this.ctx.createGain(); lfoGain.gain.value = 400; lfo.connect(lfoGain); lfoGain.connect(osc.frequency); osc.frequency.setValueAtTime(800 * tune, time); const env = this.ctx.createGain(); env.gain.setValueAtTime(masterLevel*0.5, time); env.gain.linearRampToValueAtTime(0.001, t((dynDecay/durMult)*2)); osc.connect(env); env.connect(outGain); osc.start(time); lfo.start(time); osc.stop(t(2.0)); lfo.stop(t(2.0)); } 
            else if (color === 'purple') { const osc = this.ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.setValueAtTime(Math.min(4000 * tune, 22000), time); osc.frequency.exponentialRampToValueAtTime(50, t(0.1)); const env = this.ctx.createGain(); env.gain.setValueAtTime(masterLevel, time); env.gain.exponentialRampToValueAtTime(0.001, t(0.15)); osc.connect(env); env.connect(outGain); osc.start(time); osc.stop(t(0.2)); }
        }
        setTimeout(() => { try { outGain.disconnect(); preRouter.disconnect(); } catch(e){} }, 3000);
    }

    playNote(row, color, pitchIdx, volume, speed, fx, time, kitOverride) {
        if (volume <= 0) return;
        const kit = kitOverride || this.KITS[this.activeKitIndex]; 
        const baseFreq = this._getFreq(pitchIdx); 
        const durMult = 1.0 / Math.max(0.1, speed); const t = (offset) => time + (offset * durMult);

        if (kit === 'STRINGS') { this._playString(row, color, baseFreq, volume, speed, fx, time); return; }
        if (kit === 'BEAT-BOX') { this._playDrum(row, color, pitchIdx, volume, speed, fx, time); return; }

        const osc = this.ctx.createOscillator(); const filter = this.ctx.createBiquadFilter(); const gain = this.ctx.createGain();
        osc.frequency.value = baseFreq; 
        
        // FIXED: Force hardcoded kit frequencies to pitch shift based on block index
        osc.detune.setValueAtTime(pitchIdx * 100, time); 
        
        osc.connect(filter); filter.connect(gain);
        if (row !== 4) this._routeSignal(gain, fx);

        if (row === 0) { 
            if (color === 'red') { 
                if (kit === 'TECHNO') { osc.type = 'sine'; osc.frequency.setValueAtTime(150, time); osc.frequency.exponentialRampToValueAtTime(40, t(0.1)); gain.gain.setValueAtTime(1.5*volume, time); gain.gain.exponentialRampToValueAtTime(0.01, t(0.4)); osc.start(time); osc.stop(t(0.4)); }
                else if (kit === '8-BIT') { osc.type = 'square'; osc.frequency.setValueAtTime(80, time); osc.frequency.exponentialRampToValueAtTime(20, t(0.2)); gain.gain.setValueAtTime(1*volume, time); gain.gain.setValueAtTime(1*volume, t(0.1)); gain.gain.linearRampToValueAtTime(0, t(0.15)); osc.start(time); osc.stop(t(0.15)); }
                else if (kit === 'RETRO-WAVE') { osc.type = 'sine'; osc.frequency.setValueAtTime(150, time); osc.frequency.exponentialRampToValueAtTime(0.01, t(0.3)); gain.gain.setValueAtTime(1.2*volume, time); gain.gain.exponentialRampToValueAtTime(0.01, t(0.3)); osc.start(time); osc.stop(t(0.3)); }
                else if (kit === 'GLITCH-HOP') { osc.type = 'sawtooth'; filter.type = 'lowpass'; filter.frequency.setValueAtTime(1000, time); filter.frequency.exponentialRampToValueAtTime(50, t(0.2)); osc.frequency.setValueAtTime(120, time); osc.frequency.exponentialRampToValueAtTime(20, t(0.2)); gain.gain.setValueAtTime(1*volume, time); gain.gain.exponentialRampToValueAtTime(0.01, t(0.2)); osc.start(time); osc.stop(t(0.2)); }
                else if (kit === 'DEEP-DUB') { osc.type = 'sine'; osc.frequency.setValueAtTime(60 + (pitchIdx*5), time); osc.frequency.exponentialRampToValueAtTime(40, t(0.6)); gain.gain.setValueAtTime(1*volume, time); gain.gain.linearRampToValueAtTime(0, t(0.8)); osc.start(time); osc.stop(t(0.8)); }
                else { osc.type = 'sine'; osc.frequency.setValueAtTime(130, time); osc.frequency.exponentialRampToValueAtTime(0.01, t(0.4)); gain.gain.setValueAtTime(1*volume, time); gain.gain.exponentialRampToValueAtTime(0.01, t(0.4)); osc.start(time); osc.stop(t(0.4)); }
            }
            else if (color === 'yellow') { 
                const n = this.createNoise(); n.connect(filter); filter.connect(gain);
                if (kit === 'TECHNO') { filter.type = 'bandpass'; filter.frequency.value = 2500; gain.gain.setValueAtTime(1.2*volume, time); gain.gain.exponentialRampToValueAtTime(0.01, t(0.2)); n.start(time); n.stop(t(0.2)); }
                else if (kit === '8-BIT') { filter.type = 'lowpass'; filter.frequency.value = 4000; gain.gain.setValueAtTime(0.8*volume, time); gain.gain.setValueAtTime(0.8*volume, t(0.05)); gain.gain.linearRampToValueAtTime(0, t(0.1)); n.start(time); n.stop(t(0.1)); }
                else if (kit === 'RETRO-WAVE') { filter.type = 'lowpass'; filter.frequency.value = 5000; gain.gain.setValueAtTime(0.8*volume, time); gain.gain.setValueAtTime(0.8*volume, t(0.1)); gain.gain.exponentialRampToValueAtTime(0.01, t(0.15)); n.start(time); n.stop(t(0.15)); }
                else if (kit === 'GLITCH-HOP') { filter.type = 'highpass'; filter.frequency.value = 1000; osc.type='triangle'; osc.frequency.setValueAtTime(300, time); osc.frequency.exponentialRampToValueAtTime(100, t(0.1)); gain.gain.setValueAtTime(0.8*volume, time); gain.gain.exponentialRampToValueAtTime(0.01, t(0.2)); osc.start(time); osc.stop(t(0.2)); n.start(time); n.stop(t(0.1)); }
                else if (kit === 'DEEP-DUB') { filter.type = 'bandpass'; filter.frequency.value = 1200; filter.Q.value = 5; gain.gain.setValueAtTime(0.8*volume, time); gain.gain.exponentialRampToValueAtTime(0.01, t(0.1)); n.start(time); n.stop(t(0.1)); }
                else { filter.type = 'lowpass'; filter.frequency.value = kit==='AMBIENT'?1000:8000; gain.gain.setValueAtTime(0.5*volume, time); gain.gain.exponentialRampToValueAtTime(0.01, t(0.1)); osc.type = kit==='AMBIENT'?'sine':'square'; osc.frequency.setValueAtTime(600, time); osc.start(time); osc.stop(t(0.1)); }
            }
            else if (color === 'blue') { 
                const n = this.createNoise(); n.connect(filter); filter.connect(gain);
                if (kit === 'TECHNO') { filter.type = 'highpass'; filter.frequency.value = 6000; gain.gain.setValueAtTime(0.6*volume, time); gain.gain.exponentialRampToValueAtTime(0.01, t(0.05)); n.start(time); n.stop(t(0.05)); }
                else if (kit === '8-BIT') { filter.type = 'bandpass'; filter.frequency.value = 3000; filter.Q.value = 1; gain.gain.setValueAtTime(0.5*volume, time); gain.gain.setValueAtTime(0.5*volume, t(0.03)); gain.gain.linearRampToValueAtTime(0, t(0.05)); n.start(time); n.stop(t(0.05)); }
                else if (kit === 'RETRO-WAVE') { filter.type = 'highpass'; filter.frequency.value = 8000; gain.gain.setValueAtTime(0.4*volume, time); gain.gain.exponentialRampToValueAtTime(0.01, t(0.05)); n.start(time); n.stop(t(0.05)); }
                else if (kit === 'GLITCH-HOP') { const ws = this.ctx.createWaveShaper(); ws.curve = this.distortionCurve; n.disconnect(); n.connect(ws); ws.connect(filter); filter.type = 'highpass'; filter.frequency.value = 4000; gain.gain.setValueAtTime(0.5*volume, time); gain.gain.exponentialRampToValueAtTime(0.01, t(0.1)); n.start(time); n.stop(t(0.1)); }
                else if (kit === 'DEEP-DUB') { filter.type = 'bandpass'; filter.frequency.value = 6000; filter.Q.value = 1; gain.gain.setValueAtTime(0, time); gain.gain.linearRampToValueAtTime(0.4*volume, t(0.05)); gain.gain.linearRampToValueAtTime(0, t(0.15)); n.start(time); n.stop(t(0.15)); }
                else { osc.type = 'sawtooth'; osc.frequency.setValueAtTime(4000, time); filter.type='highpass'; filter.frequency.value=6000; gain.gain.setValueAtTime(0.3*volume, time); gain.gain.exponentialRampToValueAtTime(0.01, t(0.05)); osc.start(time); osc.stop(t(0.05)); }
            }
            else if (color === 'green') { 
                if (kit === 'TECHNO') { const nSource = this.ctx.createBufferSource(); nSource.buffer = this.noiseBuffer; const f = this.ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.setValueAtTime(5000, time); f.frequency.exponentialRampToValueAtTime(1000, t(0.2)); gain.gain.setValueAtTime(0.4*volume, time); gain.gain.exponentialRampToValueAtTime(0.01, t(0.2)); nSource.connect(f); f.connect(gain); nSource.start(time); nSource.stop(t(0.2)); }
                else if (kit === '8-BIT') { const nSource = this.ctx.createBufferSource(); nSource.buffer = this.noiseBuffer; const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2000+(pitchIdx*200); f.Q.value = 5; gain.gain.setValueAtTime(0.5*volume, time); gain.gain.setValueAtTime(0, t(0.05)); gain.gain.setValueAtTime(0.5*volume, t(0.1)); gain.gain.linearRampToValueAtTime(0, t(0.15)); nSource.connect(f); f.connect(gain); nSource.start(time); nSource.stop(t(0.15)); }
                else if (kit === 'AMBIENT') { osc.type = 'square'; osc.frequency.setValueAtTime(baseFreq*4, time); filter.type = 'lowpass'; filter.frequency.setValueAtTime(8000, time); filter.frequency.exponentialRampToValueAtTime(100, t(0.1)); gain.gain.setValueAtTime(0.6*volume, time); gain.gain.exponentialRampToValueAtTime(0.01, t(0.1)); osc.start(time); osc.stop(t(0.1)); }
                else if (kit === 'RETRO-WAVE') { osc.type = 'sine'; osc.frequency.setValueAtTime(150, time); osc.frequency.exponentialRampToValueAtTime(20, t(0.3)); gain.gain.setValueAtTime(0.8*volume, time); gain.gain.exponentialRampToValueAtTime(0.01, t(0.3)); osc.start(time); osc.stop(t(0.3)); }
                else if (kit === 'GLITCH-HOP') { osc.type = 'square'; osc.frequency.value = 8000; gain.gain.setValueAtTime(0.5*volume, time); gain.gain.setValueAtTime(0, t(0.05)); gain.gain.setValueAtTime(0.5*volume, t(0.1)); gain.gain.linearRampToValueAtTime(0, t(0.15)); osc.start(time); osc.stop(t(0.15)); }
                else if (kit === 'DEEP-DUB') { const nSource = this.ctx.createBufferSource(); nSource.buffer = this.noiseBuffer; const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 4000; nSource.connect(f); f.connect(gain); gain.gain.setValueAtTime(0.4*volume, time); gain.gain.exponentialRampToValueAtTime(0.01, t(0.2)); nSource.start(time); nSource.stop(t(0.2)); }
            }
            else if (color === 'purple') { 
                if (kit === 'TECHNO') { osc.type = 'sawtooth'; filter.type = 'lowpass'; filter.frequency.setValueAtTime(3000, time); filter.frequency.exponentialRampToValueAtTime(200, t(0.1)); osc.frequency.setValueAtTime(100, time); gain.gain.setValueAtTime(0.6*volume, time); gain.gain.exponentialRampToValueAtTime(0.01, t(0.2)); osc.start(time); osc.stop(t(0.2)); }
                else if (kit === '8-BIT') { osc.type = 'square'; osc.frequency.setValueAtTime(200, time); osc.frequency.setValueAtTime(150, t(0.05)); osc.frequency.setValueAtTime(100, t(0.1)); gain.gain.setValueAtTime(0.6*volume, time); gain.gain.linearRampToValueAtTime(0, t(0.15)); osc.start(time); osc.stop(t(0.15)); }
                else if (kit === 'RETRO-WAVE') { osc.type = 'square'; filter.type = 'lowpass'; filter.frequency.setValueAtTime(2000, time); filter.frequency.exponentialRampToValueAtTime(100, t(0.2)); osc.frequency.setValueAtTime(200, time); osc.frequency.exponentialRampToValueAtTime(50, t(0.2)); gain.gain.setValueAtTime(0.6*volume, time); gain.gain.exponentialRampToValueAtTime(0.01, t(0.2)); osc.start(time); osc.stop(t(0.2)); }
                else if (kit === 'GLITCH-HOP') { osc.type = 'sawtooth'; osc.frequency.setValueAtTime(800, time); osc.frequency.setValueAtTime(200, t(0.05)); osc.frequency.setValueAtTime(800, t(0.1)); gain.gain.setValueAtTime(0.5*volume, time); gain.gain.linearRampToValueAtTime(0, t(0.15)); osc.start(time); osc.stop(t(0.15)); }
                else if (kit === 'DEEP-DUB') { osc.type = 'sine'; osc.frequency.setValueAtTime(100, time); osc.frequency.linearRampToValueAtTime(30, t(1.0)); gain.gain.setValueAtTime(0.8*volume, time); gain.gain.linearRampToValueAtTime(0, t(1.0)); osc.start(time); osc.stop(t(1.0)); }
                else { osc.type = 'sine'; osc.frequency.setValueAtTime(100, time); osc.frequency.exponentialRampToValueAtTime(0.01, t(0.1)); gain.gain.setValueAtTime(0.8*volume, time); gain.gain.exponentialRampToValueAtTime(0.01, t(0.1)); osc.start(time); osc.stop(t(0.1)); }
            }
        } 
        else if (row === 1) { 
            const subFreq = baseFreq / 2; osc.frequency.value = subFreq; 
            if (color === 'red') { 
                if (kit === 'TECHNO') { osc.type = 'sawtooth'; filter.type = 'lowpass'; filter.frequency.setValueAtTime(2000, time); filter.frequency.exponentialRampToValueAtTime(80, t(0.2)); filter.Q.value=10; gain.gain.setValueAtTime(0.6*volume, time); gain.gain.exponentialRampToValueAtTime(0.01, t(0.3)); }
                else if (kit === '8-BIT') { osc.type = 'square'; gain.gain.setValueAtTime(0.6*volume, time); gain.gain.setValueAtTime(0.6*volume, t(0.2)); gain.gain.linearRampToValueAtTime(0, t(0.25)); }
                else if (kit === 'GLITCH-HOP') { osc.type = 'sine'; const ws = this.ctx.createWaveShaper(); ws.curve = this.distortionCurve; osc.disconnect(); osc.connect(ws); ws.connect(gain); gain.gain.setValueAtTime(0.4*volume, time); gain.gain.linearRampToValueAtTime(0, t(0.3)); }
                else { osc.type = 'sine'; gain.gain.setValueAtTime(0.6*volume, time); gain.gain.exponentialRampToValueAtTime(0.01, t(0.4)); }
                osc.start(time); osc.stop(t(0.4));
            }
            else if (color === 'yellow') {
                if (kit === 'TECHNO') { osc.type = 'sawtooth'; filter.type = 'lowpass'; filter.frequency.setValueAtTime(1000, time); filter.frequency.linearRampToValueAtTime(300, t(0.2)); gain.gain.setValueAtTime(0.5*volume, time); gain.gain.setTargetAtTime(0, t(0.15), 0.1); osc.start(time); osc.stop(t(0.3)); }
                else if (kit === '8-BIT') { osc.type = 'triangle'; gain.gain.setValueAtTime(0.6*volume, time); gain.gain.setValueAtTime(0.6*volume, t(0.1)); gain.gain.linearRampToValueAtTime(0, t(0.15)); osc.start(time); osc.stop(t(0.15)); }
                else if (kit === 'RETRO-WAVE') { osc.type = 'sawtooth'; filter.type = 'lowpass'; filter.frequency.setValueAtTime(3000, time); filter.frequency.exponentialRampToValueAtTime(200, t(0.2)); filter.Q.value = 5; gain.gain.setValueAtTime(0.5*volume, time); gain.gain.setTargetAtTime(0, t(0.1), 0.1); osc.start(time); osc.stop(t(0.3)); }
                else if (kit === 'GLITCH-HOP') { osc.type = 'sawtooth'; const lfo = this.ctx.createOscillator(); lfo.frequency.value = 8; const lfoGain = this.ctx.createGain(); lfoGain.gain.value = 1000; lfo.connect(lfoGain); lfoGain.connect(filter.frequency); filter.type = 'lowpass'; filter.frequency.value = 1000; filter.Q.value = 10; gain.gain.setValueAtTime(0.4*volume, time); gain.gain.linearRampToValueAtTime(0, t(0.4)); lfo.start(time); osc.start(time); lfo.stop(t(0.4)); osc.stop(t(0.4)); }
                else if (kit === 'DEEP-DUB') { osc.type = 'triangle'; filter.type = 'lowpass'; filter.frequency.value = 400; gain.gain.setValueAtTime(0, time); gain.gain.linearRampToValueAtTime(0.6*volume, t(0.1)); gain.gain.linearRampToValueAtTime(0, t(0.6)); osc.start(time); osc.stop(t(0.6)); }
                else { osc.type = 'sawtooth'; filter.type = 'lowpass'; filter.frequency.setValueAtTime(1500, time); filter.frequency.exponentialRampToValueAtTime(100, t(0.2)); gain.gain.setValueAtTime(0.4*volume, time); gain.gain.setTargetAtTime(0, t(0.1), 0.1); osc.start(time); osc.stop(t(0.3)); }
            }
            else if (color === 'blue') {
                osc.type = kit==='AMBIENT'||kit==='DEEP-DUB'||kit==='TECHNO'?'sine':(kit==='8-BIT'?'square':'square'); 
                gain.gain.setValueAtTime(0.5*volume, time); gain.gain.exponentialRampToValueAtTime(0.01, t(0.15)); osc.start(time); osc.stop(t(0.15));
            }
            else if (color === 'green') {
                if (kit === 'TECHNO') { osc.type = 'sawtooth'; filter.type = 'lowpass'; filter.frequency.setValueAtTime(50, time); filter.frequency.linearRampToValueAtTime(1000, t(0.2)); gain.gain.setValueAtTime(0.5*volume, time); gain.gain.linearRampToValueAtTime(0, t(0.2)); osc.start(time); osc.stop(t(0.2)); } 
                else if (kit === '8-BIT') { osc.type = 'square'; osc.frequency.setValueAtTime(subFreq, time); osc.frequency.setValueAtTime(subFreq*2, t(0.1)); gain.gain.setValueAtTime(0.6*volume, time); gain.gain.linearRampToValueAtTime(0, t(0.2)); osc.start(time); osc.stop(t(0.2)); } 
                else if (kit === 'AMBIENT') { osc.type = 'sine'; gain.gain.setValueAtTime(0, time); gain.gain.linearRampToValueAtTime(0.6*volume, t(0.2)); gain.gain.linearRampToValueAtTime(0, t(0.5)); osc.start(time); osc.stop(t(0.5)); } 
                else if (kit === 'RETRO-WAVE') { osc.type = 'square'; filter.type = 'lowpass'; filter.frequency.setValueAtTime(3000, time); filter.frequency.linearRampToValueAtTime(100, t(0.5)); gain.gain.setValueAtTime(0.5*volume, time); gain.gain.linearRampToValueAtTime(0, t(0.5)); osc.start(time); osc.stop(t(0.5)); } 
                else if (kit === 'GLITCH-HOP') { osc.type = 'triangle'; filter.type = 'lowpass'; const lfo = this.ctx.createOscillator(); lfo.frequency.value = 5; const lfoGain = this.ctx.createGain(); lfoGain.gain.value = 800; lfo.connect(lfoGain); lfoGain.connect(filter.frequency); filter.frequency.value = 1000; gain.gain.setValueAtTime(0.6*volume, time); gain.gain.linearRampToValueAtTime(0, t(0.5)); osc.start(time); lfo.start(time); osc.stop(t(0.5)); lfo.stop(t(0.5)); } 
                else if (kit === 'DEEP-DUB') { osc.type = 'sine'; osc.frequency.setValueAtTime(subFreq*2, time); osc.frequency.exponentialRampToValueAtTime(subFreq/2, t(0.5)); gain.gain.setValueAtTime(0.8*volume, time); gain.gain.linearRampToValueAtTime(0, t(0.6)); osc.start(time); osc.stop(t(0.6)); }
            }
            else if (color === 'purple') {
                if (kit === 'DEEP-DUB') {
                    osc.type = 'triangle'; filter.type = 'lowpass'; filter.frequency.value = 200;
                    const lfo = this.ctx.createOscillator(); lfo.frequency.value = 4; const lfoG = this.ctx.createGain(); lfoG.gain.value = 800; lfo.connect(lfoG); lfoG.connect(filter.frequency);
                    gain.gain.setValueAtTime(0.6*volume, time); gain.gain.linearRampToValueAtTime(0, t(0.8));
                    lfo.start(time); osc.start(time); lfo.stop(t(0.8)); osc.stop(t(0.8));
                } else {
                    osc.type = kit==='8-BIT'?'square':'sawtooth'; osc.frequency.setValueAtTime(subFreq/2, time); osc.frequency.linearRampToValueAtTime(subFreq, t(0.1));
                    gain.gain.setValueAtTime(0.4*volume, time); gain.gain.linearRampToValueAtTime(0, t(0.4)); osc.start(time); osc.stop(t(0.4));
                }
            }
        }
        else if (row === 2) {
            if (color === 'red') { 
                if (kit === 'TECHNO') { osc.type = 'sawtooth'; const o2 = this.ctx.createOscillator(); o2.type='sawtooth'; o2.frequency.value=baseFreq*1.02; o2.connect(filter); filter.type='lowpass'; filter.frequency.setValueAtTime(4000, time); filter.frequency.exponentialRampToValueAtTime(200, t(0.3)); gain.gain.setValueAtTime(0.4*volume, time); gain.gain.exponentialRampToValueAtTime(0.01, t(0.4)); osc.start(time); o2.start(time); osc.stop(t(0.4)); o2.stop(t(0.4)); }
                else if (kit === '8-BIT') { osc.type = 'square'; gain.gain.setValueAtTime(0.4*volume, time); gain.gain.setValueAtTime(0.4*volume, t(0.15)); gain.gain.linearRampToValueAtTime(0, t(0.2)); osc.start(time); osc.stop(t(0.2)); }
                else if (kit === 'RETRO-WAVE') { const o2 = this.ctx.createOscillator(); o2.type = 'sawtooth'; osc.type = 'sawtooth'; o2.frequency.value = baseFreq*1.01; o2.connect(filter); filter.type='lowpass'; filter.frequency.value=3000; gain.gain.setValueAtTime(0.3*volume, time); gain.gain.linearRampToValueAtTime(0, t(0.5)); osc.start(time); o2.start(time); osc.stop(t(0.5)); o2.stop(t(0.5)); }
                else if (kit === 'GLITCH-HOP') { osc.type = 'square'; osc.frequency.setValueAtTime(baseFreq, time); osc.frequency.setValueAtTime(baseFreq*2, t(0.1)); gain.gain.setValueAtTime(0.3*volume, time); gain.gain.linearRampToValueAtTime(0, t(0.2)); osc.start(time); osc.stop(t(0.2)); }
                else if (kit === 'DEEP-DUB') { osc.type = 'triangle'; filter.type='lowpass'; filter.frequency.setValueAtTime(2000, time); filter.frequency.exponentialRampToValueAtTime(500, t(0.3)); gain.gain.setValueAtTime(0.4*volume, time); gain.gain.linearRampToValueAtTime(0, t(0.4)); osc.start(time); osc.stop(t(0.4)); }
                else { osc.type = 'sawtooth'; gain.gain.setValueAtTime(0.3*volume, time); gain.gain.linearRampToValueAtTime(0, t(0.4)); osc.start(time); osc.stop(t(0.4)); }
            }
            else if (color === 'yellow') {
                osc.type = kit==='AMBIENT'||kit==='DEEP-DUB'?'sine':(kit==='8-BIT'?'square':'square'); 
                gain.gain.setValueAtTime(0.3*volume, time); gain.gain.setTargetAtTime(0, t(0.05), 0.01); osc.start(time); osc.stop(t(0.1));
            }
            else if (color === 'blue') {
                if (kit === 'GLITCH-HOP') { osc.type = 'sine'; const fm = this.ctx.createOscillator(); fm.type='sine'; fm.frequency.value = baseFreq*3.5; const fmg = this.ctx.createGain(); fmg.gain.value=1000; fm.connect(fmg); fmg.connect(osc.frequency); fm.start(time); fm.stop(t(0.3)); }
                else { osc.type = kit==='8-BIT'?'triangle':'sine'; }
                osc.frequency.value = baseFreq*2; gain.gain.setValueAtTime(0.4*volume, time); gain.gain.exponentialRampToValueAtTime(0.01, t(0.5)); osc.start(time); osc.stop(t(0.5));
            }
            else if (color === 'green') {
                if (kit === 'TECHNO') { osc.type = 'sawtooth'; filter.type = 'lowpass'; filter.frequency.setValueAtTime(50, time); filter.frequency.linearRampToValueAtTime(4000, t(0.3)); gain.gain.setValueAtTime(0.4*volume, time); gain.gain.linearRampToValueAtTime(0, t(0.3)); osc.start(time); osc.stop(t(0.3)); } 
                else if (kit === '8-BIT') { osc.type = 'square'; osc.frequency.setValueAtTime(baseFreq*2, time); osc.frequency.setValueAtTime(baseFreq*1.5, t(0.05)); osc.frequency.setValueAtTime(baseFreq, t(0.1)); osc.frequency.setValueAtTime(baseFreq*0.5, t(0.15)); gain.gain.setValueAtTime(0.5*volume, time); gain.gain.linearRampToValueAtTime(0, t(0.2)); osc.start(time); osc.stop(t(0.2)); } 
                else if (kit === 'AMBIENT') { osc.type = 'sine'; gain.gain.setValueAtTime(0, time); gain.gain.linearRampToValueAtTime(0.4*volume, t(1.0)); gain.gain.linearRampToValueAtTime(0, t(2.0)); osc.start(time); osc.stop(t(2.0)); } 
                else if (kit === 'RETRO-WAVE') { const osc2 = this.ctx.createOscillator(); osc2.type = 'sawtooth'; osc.type = 'sawtooth'; osc2.frequency.value = baseFreq * 1.015; osc2.connect(filter); filter.type = 'lowpass'; filter.frequency.setValueAtTime(5000, time); filter.frequency.linearRampToValueAtTime(500, t(0.5)); gain.gain.setValueAtTime(0.4*volume, time); gain.gain.linearRampToValueAtTime(0, t(0.5)); osc.start(time); osc2.start(time); osc.stop(t(0.5)); osc2.stop(t(0.5)); } 
                else if (kit === 'GLITCH-HOP') { osc.type = 'triangle'; filter.type = 'lowpass'; const lfo = this.ctx.createOscillator(); lfo.frequency.value = 15; const lfoGain = this.ctx.createGain(); lfoGain.gain.value = 1500; lfo.connect(lfoGain); lfoGain.connect(filter.frequency); filter.frequency.value = 2000; gain.gain.setValueAtTime(0.4*volume, time); gain.gain.linearRampToValueAtTime(0, t(0.3)); osc.start(time); lfo.start(time); osc.stop(t(0.3)); lfo.stop(t(0.3)); } 
                else if (kit === 'DEEP-DUB') { osc.type = 'sine'; osc.frequency.setValueAtTime(baseFreq, time); osc.frequency.exponentialRampToValueAtTime(baseFreq/4, t(0.4)); gain.gain.setValueAtTime(0.6*volume, time); gain.gain.linearRampToValueAtTime(0, t(0.5)); osc.start(time); osc.stop(t(0.5)); }
            }
            else if (color === 'purple') {
                osc.type = kit==='AMBIENT'||kit==='DEEP-DUB'?'triangle':'square'; osc.frequency.setValueAtTime(baseFreq, time); osc.frequency.setValueAtTime(baseFreq*1.5, t(0.1));
                gain.gain.setValueAtTime(0.2*volume, time); gain.gain.linearRampToValueAtTime(0, t(0.2)); osc.start(time); osc.stop(t(0.2));
            }
        }
        else if (row === 3) {
            if (color === 'red') {
                if (kit === 'TECHNO') { const n = this.createNoise(); const f = this.ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.setValueAtTime(500, time); f.frequency.exponentialRampToValueAtTime(8000, t(1.0)); gain.gain.setValueAtTime(0, time); gain.gain.linearRampToValueAtTime(0.5*volume, t(0.8)); gain.gain.linearRampToValueAtTime(0, t(1.0)); n.connect(f); f.connect(gain); n.start(time); n.stop(t(1.0)); }
                else if (kit === '8-BIT') { osc.type = 'square'; osc.frequency.setValueAtTime(baseFreq, time); osc.frequency.linearRampToValueAtTime(baseFreq*4, t(0.4)); gain.gain.setValueAtTime(0.2*volume, time); gain.gain.linearRampToValueAtTime(0, t(0.4)); osc.start(time); osc.stop(t(0.4)); }
                else if (kit === 'AMBIENT') { const n = this.createNoise(); const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 800; gain.gain.setValueAtTime(0, time); gain.gain.linearRampToValueAtTime(0.4*volume, t(1.0)); gain.gain.linearRampToValueAtTime(0, t(2.0)); n.connect(f); f.connect(gain); n.start(time); n.stop(t(2.0)); }
                else if (kit === 'RETRO-WAVE') { osc.type = 'sawtooth'; osc.frequency.setValueAtTime(3000, time); osc.frequency.exponentialRampToValueAtTime(100, t(0.3)); gain.gain.setValueAtTime(0.5*volume, time); gain.gain.exponentialRampToValueAtTime(0.01, t(0.3)); osc.start(time); osc.stop(t(0.3)); }
                else if (kit === 'GLITCH-HOP') { osc.type = 'sawtooth'; const ws = this.ctx.createWaveShaper(); ws.curve = this.distortionCurve; filter.type = 'lowpass'; filter.frequency.setValueAtTime(4000, time); filter.frequency.linearRampToValueAtTime(100, t(0.4)); osc.disconnect(); osc.connect(ws); ws.connect(filter); filter.connect(gain); gain.gain.setValueAtTime(0.6*volume, time); gain.gain.linearRampToValueAtTime(0, t(0.4)); osc.start(time); osc.stop(t(0.4)); }
                else if (kit === 'DEEP-DUB') { osc.type = 'square'; const lfo = this.ctx.createOscillator(); lfo.frequency.value = 6; const lfoG = this.ctx.createGain(); lfoG.gain.value = 200; lfo.connect(lfoG); lfoG.connect(osc.frequency); osc.frequency.value = 800; filter.type = 'lowpass'; filter.frequency.value = 2000; gain.gain.setValueAtTime(0.4*volume, time); gain.gain.linearRampToValueAtTime(0, t(1.0)); lfo.start(time); osc.start(time); lfo.stop(t(1.0)); osc.stop(t(1.0)); }
                else { osc.type = 'sawtooth'; osc.frequency.setValueAtTime(baseFreq, time); osc.frequency.linearRampToValueAtTime(baseFreq*4, t(0.4)); gain.gain.setValueAtTime(0.2*volume, time); gain.gain.linearRampToValueAtTime(0, t(0.4)); osc.start(time); osc.stop(t(0.4)); }
            }
            else if (color === 'yellow') {
                osc.type = kit==='AMBIENT'||kit==='DEEP-DUB'?'sine':'square'; osc.frequency.setValueAtTime(baseFreq*4, time); osc.frequency.exponentialRampToValueAtTime(10, t(0.1));
                gain.gain.setValueAtTime(0.3*volume, time); gain.gain.linearRampToValueAtTime(0, t(0.1)); osc.start(time); osc.stop(t(0.1));
            }
            else if (color === 'blue') {
                if (kit === 'RETRO-WAVE') { osc.type='square'; filter.type='lowpass'; filter.frequency.setValueAtTime(5000, time); filter.frequency.linearRampToValueAtTime(100, t(0.2)); gain.gain.setValueAtTime(0.4*volume, time); gain.gain.linearRampToValueAtTime(0, t(0.2)); osc.start(time); osc.stop(t(0.2)); }
                else if (kit === 'DEEP-DUB') { osc.type='sine'; osc.frequency.setValueAtTime(baseFreq*2, time); gain.gain.setValueAtTime(0.3*volume, time); gain.gain.linearRampToValueAtTime(0, t(0.2)); osc.start(time); osc.stop(t(0.2)); }
                else { osc.type = kit==='8-BIT'?'square':'sine'; osc.frequency.setValueAtTime(baseFreq*2, time); if(kit==='TECHNO'||kit==='GLITCH-HOP'){osc.frequency.exponentialRampToValueAtTime(10, t(0.6));}else{osc.frequency.linearRampToValueAtTime(baseFreq*1.8, t(0.6));} gain.gain.setValueAtTime(0.4*volume, time); gain.gain.linearRampToValueAtTime(0, t(0.6)); osc.start(time); osc.stop(t(0.6)); }
            }
            else if (color === 'green') {
                if (kit === 'TECHNO') { osc.type = 'sawtooth'; filter.type = 'lowpass'; filter.frequency.setValueAtTime(8000, time); filter.frequency.linearRampToValueAtTime(50, t(0.4)); gain.gain.setValueAtTime(0.3*volume, time); gain.gain.linearRampToValueAtTime(0, t(0.4)); osc.start(time); osc.stop(t(0.4)); } 
                else if (kit === '8-BIT') { osc.type = 'square'; osc.frequency.setValueAtTime(baseFreq*0.5, time); osc.frequency.setValueAtTime(baseFreq, t(0.05)); osc.frequency.setValueAtTime(baseFreq*1.5, t(0.1)); osc.frequency.setValueAtTime(baseFreq*2, t(0.15)); gain.gain.setValueAtTime(0.4*volume, time); gain.gain.linearRampToValueAtTime(0, t(0.2)); osc.start(time); osc.stop(t(0.2)); } 
                else if (kit === 'AMBIENT') { osc.type = 'sine'; gain.gain.setValueAtTime(0, time); gain.gain.linearRampToValueAtTime(0.3*volume, t(1.0)); gain.gain.linearRampToValueAtTime(0, t(2.0)); osc.start(time); osc.stop(t(2.0)); } 
                else if (kit === 'RETRO-WAVE') { const osc2 = this.ctx.createOscillator(); osc2.type = 'sawtooth'; osc.type = 'sawtooth'; osc2.frequency.value = baseFreq * 1.015; osc2.connect(filter); filter.type = 'lowpass'; filter.frequency.setValueAtTime(5000, time); filter.frequency.linearRampToValueAtTime(200, t(0.3)); gain.gain.setValueAtTime(0.3*volume, time); gain.gain.linearRampToValueAtTime(0, t(0.3)); osc.start(time); osc2.start(time); osc.stop(t(0.3)); osc2.stop(t(0.3)); } 
                else if (kit === 'GLITCH-HOP') { osc.type = 'triangle'; filter.type = 'lowpass'; const lfo = this.ctx.createOscillator(); lfo.frequency.value = 20; const lfoGain = this.ctx.createGain(); lfoGain.gain.value = 2000; lfo.connect(lfoGain); lfoGain.connect(filter.frequency); filter.frequency.value = 3000; gain.gain.setValueAtTime(0.4*volume, time); gain.gain.linearRampToValueAtTime(0, t(0.3)); osc.start(time); lfo.start(time); osc.stop(t(0.3)); lfo.stop(t(0.3)); } 
                else if (kit === 'DEEP-DUB') { osc.type = 'sine'; osc.frequency.setValueAtTime(baseFreq, time); osc.frequency.exponentialRampToValueAtTime(baseFreq*4, t(0.3)); gain.gain.setValueAtTime(0.5*volume, time); gain.gain.linearRampToValueAtTime(0, t(0.4)); osc.start(time); osc.stop(t(0.4)); }
            }
            else if (color === 'purple') {
                osc.type = kit==='AMBIENT'?'sine':'square'; const rp = baseFreq*(0.5+Math.random()*2); osc.frequency.setValueAtTime(rp, time);
                if(kit==='GLITCH-HOP'){osc.frequency.setValueAtTime(rp*2, t(0.05)); osc.frequency.setValueAtTime(rp*0.5, t(0.1));}
                filter.type = 'lowpass'; filter.frequency.setValueAtTime(5000, time); filter.frequency.linearRampToValueAtTime(100, t(0.2));
                gain.gain.setValueAtTime(0.3*volume, time); gain.gain.linearRampToValueAtTime(0, t(0.2)); osc.start(time); osc.stop(t(0.2));
            }
        }
        else if (row === 4) {
            osc.disconnect(); filter.disconnect(); gain.disconnect();
            const vGain = this.ctx.createGain(); 
            this._routeSignal(vGain, fx);

            if (color === 'red') { 
                if (kit === 'TECHNO' || kit === 'RETRO-WAVE') { 
                    const o1 = this.ctx.createOscillator(); const o2 = this.ctx.createOscillator(); const f1 = this.ctx.createBiquadFilter(); const f2 = this.ctx.createBiquadFilter();
                    o1.type = 'sawtooth'; o2.type = 'sawtooth'; o1.frequency.value = baseFreq; o2.frequency.value = baseFreq * 1.02;
                    f1.type = 'bandpass'; f1.frequency.value = 700; f1.Q.value = 5; f2.type = 'bandpass'; f2.frequency.value = 1100; f2.Q.value = 5;
                    o1.connect(f1); o2.connect(f2); f1.connect(vGain); f2.connect(vGain); f1.frequency.exponentialRampToValueAtTime(400, t(0.3));
                    vGain.gain.setValueAtTime(0.5*volume, time); vGain.gain.exponentialRampToValueAtTime(0.01, t(0.4)); o1.start(time); o2.start(time); o1.stop(t(0.4)); o2.stop(t(0.4));
                } else if (kit === '8-BIT') { 
                    const o = this.ctx.createOscillator(); o.type = 'square'; o.frequency.value = baseFreq/2;
                    vGain.gain.setValueAtTime(0.4*volume, time); vGain.gain.setValueAtTime(0, t(0.05)); vGain.gain.setValueAtTime(0.4*volume, t(0.1)); vGain.gain.setValueAtTime(0, t(0.15)); vGain.gain.setValueAtTime(0.4*volume, t(0.2)); vGain.gain.linearRampToValueAtTime(0, t(0.3));
                    o.connect(vGain); o.start(time); o.stop(t(0.3));
                } else if (kit === 'GLITCH-HOP') {
                    const o = this.ctx.createOscillator(); o.type = 'square'; o.frequency.setValueAtTime(baseFreq*2, time); o.frequency.exponentialRampToValueAtTime(baseFreq/2, t(0.2));
                    const ws = this.ctx.createWaveShaper(); ws.curve = this.distortionCurve; o.connect(ws); ws.connect(vGain);
                    vGain.gain.setValueAtTime(0.6*volume, time); vGain.gain.exponentialRampToValueAtTime(0.01, t(0.2)); o.start(time); o.stop(t(0.2));
                } else if (kit === 'DEEP-DUB') {
                    const o = this.ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = baseFreq; const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 800; f.Q.value = 5;
                    o.connect(f); f.connect(vGain); vGain.gain.setValueAtTime(0, time); vGain.gain.linearRampToValueAtTime(0.6*volume, t(0.05)); vGain.gain.linearRampToValueAtTime(0, t(0.4)); o.start(time); o.stop(t(0.4));
                } else { 
                    const o1 = this.ctx.createOscillator(); const o2 = this.ctx.createOscillator(); o1.type = 'sine'; o2.type = 'triangle'; o1.frequency.value = baseFreq/2; o2.frequency.value = baseFreq/2+1;
                    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 600; o1.connect(f); o2.connect(f); f.connect(vGain);
                    vGain.gain.setValueAtTime(0, time); vGain.gain.linearRampToValueAtTime(0.6*volume, t(0.5)); vGain.gain.linearRampToValueAtTime(0, t(1.5)); o1.start(time); o2.start(time); o1.stop(t(1.5)); o2.stop(t(1.5));
                }
            } else if (color === 'yellow') { 
                if (kit === 'GLITCH-HOP') {
                    const o = this.ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = baseFreq/2; const f = this.ctx.createBiquadFilter(); f.type='bandpass'; f.Q.value=10; f.frequency.setValueAtTime(400, time); f.frequency.exponentialRampToValueAtTime(2000, t(0.2)); f.frequency.exponentialRampToValueAtTime(400, t(0.4)); o.connect(f); f.connect(vGain); vGain.gain.setValueAtTime(0.5*volume, time); vGain.gain.linearRampToValueAtTime(0, t(0.4)); o.start(time); o.stop(t(0.4));
                } else if (kit === '8-BIT') { 
                    const o = this.ctx.createOscillator(); o.type = 'square'; o.frequency.setValueAtTime(baseFreq, time); o.frequency.setValueAtTime(baseFreq*2, t(0.05)); o.frequency.setValueAtTime(baseFreq, t(0.1)); o.frequency.setValueAtTime(baseFreq*2, t(0.15)); vGain.gain.setValueAtTime(0.3*volume, time); vGain.gain.linearRampToValueAtTime(0, t(0.2)); o.connect(vGain); o.start(time); o.stop(t(0.2));
                } else if (kit === 'DEEP-DUB') {
                    const o = this.ctx.createOscillator(); o.type = 'square'; o.frequency.value = baseFreq; const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1200; f.Q.value = 3;
                    o.connect(f); f.connect(vGain); vGain.gain.setValueAtTime(0, time); vGain.gain.linearRampToValueAtTime(0.5*volume, t(0.05)); vGain.gain.linearRampToValueAtTime(0, t(0.3)); o.start(time); o.stop(t(0.3));
                } else { 
                    const o = this.ctx.createOscillator(); o.type = 'sine'; const lfo = this.ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 5; const lfoGain = this.ctx.createGain(); lfoGain.gain.value = 10; lfo.connect(lfoGain); lfoGain.connect(o.frequency); o.frequency.value = baseFreq*2; vGain.gain.setValueAtTime(0, time); vGain.gain.linearRampToValueAtTime(0.4*volume, t(0.4)); vGain.gain.linearRampToValueAtTime(0, t(1.2)); o.connect(vGain); lfo.start(time); o.start(time); lfo.stop(t(1.2)); o.stop(t(1.2));
                }
            } else if (color === 'blue') { 
                if (kit === 'TECHNO' || kit === 'RETRO-WAVE') { 
                    const o = this.ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = baseFreq; const ws = this.ctx.createWaveShaper(); ws.curve = new Float32Array([-1, -0.8, 0, 0.8, 1]); o.connect(ws); ws.connect(vGain); vGain.gain.setValueAtTime(0.5*volume, time); vGain.gain.exponentialRampToValueAtTime(0.01, t(0.4)); o.start(time); o.stop(t(0.4));
                } else if (kit === '8-BIT') { 
                    const o = this.ctx.createOscillator(); o.type = 'square'; o.frequency.setValueAtTime(baseFreq*1.5, time); o.frequency.setValueAtTime(baseFreq*1.2, t(0.05)); o.frequency.setValueAtTime(baseFreq, t(0.1)); o.frequency.setValueAtTime(baseFreq*0.8, t(0.15)); vGain.gain.setValueAtTime(0.4*volume, time); vGain.gain.linearRampToValueAtTime(0, t(0.25)); o.connect(vGain); o.start(time); o.stop(t(0.25));
                } else if (kit === 'GLITCH-HOP') {
                    const o = this.ctx.createOscillator(); o.type = 'square'; o.frequency.value = baseFreq; const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1500; f.Q.value = 8;
                    const lfo = this.ctx.createOscillator(); lfo.type = 'square'; lfo.frequency.value = 16; const lfoG = this.ctx.createGain(); lfo.connect(lfoG); lfoG.connect(vGain.gain);
                    o.connect(f); f.connect(vGain); vGain.gain.setValueAtTime(0.5*volume, time); vGain.gain.linearRampToValueAtTime(0, t(0.4)); o.start(time); lfo.start(time); o.stop(t(0.4)); lfo.stop(t(0.4));
                } else if (kit === 'DEEP-DUB') {
                    const o = this.ctx.createOscillator(); o.type = 'sine'; o.frequency.value = baseFreq; const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 400; f.Q.value = 2;
                    o.connect(f); f.connect(vGain); vGain.gain.setValueAtTime(0, time); vGain.gain.linearRampToValueAtTime(0.6*volume, t(0.1)); vGain.gain.linearRampToValueAtTime(0, t(0.6)); o.start(time); o.stop(t(0.6));
                } else if (kit === 'AMBIENT') {
                    const o1 = this.ctx.createOscillator(); const o2 = this.ctx.createOscillator(); o1.type = 'sine'; o2.type = 'sine'; o1.frequency.value = baseFreq; o2.frequency.value = baseFreq/2; o1.connect(vGain); o2.connect(vGain); vGain.gain.setValueAtTime(0, time); vGain.gain.linearRampToValueAtTime(0.4*volume, t(0.5)); vGain.gain.linearRampToValueAtTime(0, t(1.2)); o1.start(time); o2.start(time); o1.stop(t(1.2)); o2.stop(t(1.2));
                } else { 
                    const o1 = this.ctx.createOscillator(); const o2 = this.ctx.createOscillator(); o1.type = 'sine'; o2.type = 'sine'; o1.frequency.value = baseFreq; o2.frequency.value = baseFreq/2; o1.connect(vGain); o2.connect(vGain); vGain.gain.setValueAtTime(0, time); vGain.gain.linearRampToValueAtTime(0.5*volume, t(0.8)); vGain.gain.linearRampToValueAtTime(0, t(2.0)); o1.start(time); o2.start(time); o1.stop(t(2.0)); o2.stop(t(2.0));
                }
            } else if (color === 'green') { 
                const nSource = this.ctx.createBufferSource(); nSource.buffer = this.noiseBuffer; const f = this.ctx.createBiquadFilter();
                if (kit === 'TECHNO' || kit === 'GLITCH-HOP') { 
                    f.type = 'highpass'; f.frequency.setValueAtTime(5000, time); f.frequency.exponentialRampToValueAtTime(1000, t(0.2)); vGain.gain.setValueAtTime(0.4*volume, time); vGain.gain.exponentialRampToValueAtTime(0.01, t(0.2)); nSource.connect(f); f.connect(vGain); nSource.start(time); nSource.stop(t(0.2));
                } else if (kit === '8-BIT') { 
                    f.type = 'bandpass'; f.frequency.value = 2000+(pitchIdx*200); f.Q.value = 5; vGain.gain.setValueAtTime(0.5*volume, time); vGain.gain.setValueAtTime(0, t(0.05)); vGain.gain.setValueAtTime(0.5*volume, t(0.1)); vGain.gain.linearRampToValueAtTime(0, t(0.15)); nSource.connect(f); f.connect(vGain); nSource.start(time); nSource.stop(t(0.15));
                } else if (kit === 'RETRO-WAVE') {
                    const o = this.ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = baseFreq; f.type = 'bandpass'; f.frequency.setValueAtTime(2000, time); f.frequency.exponentialRampToValueAtTime(800, t(0.4)); f.Q.value = 8; o.connect(f); f.connect(vGain); vGain.gain.setValueAtTime(0.5*volume, time); vGain.gain.exponentialRampToValueAtTime(0.01, t(0.4)); o.start(time); o.stop(t(0.4));
                } else if (kit === 'DEEP-DUB') {
                    const o = this.ctx.createOscillator(); o.type = 'square'; o.frequency.value = baseFreq; f.type = 'bandpass'; f.frequency.value = 1000; f.Q.value = 4; o.connect(f); f.connect(vGain); vGain.gain.setValueAtTime(0, time); vGain.gain.linearRampToValueAtTime(0.4*volume, t(0.02)); vGain.gain.linearRampToValueAtTime(0, t(0.2)); o.start(time); o.stop(t(0.2));
                } else if (kit === 'AMBIENT') {
                    const o = this.ctx.createOscillator(); o.type = 'sine'; o.frequency.value = baseFreq; f.type = 'bandpass'; f.frequency.value = 800; o.connect(f); f.connect(vGain); vGain.gain.setValueAtTime(0, time); vGain.gain.linearRampToValueAtTime(0.4*volume, t(0.4)); vGain.gain.linearRampToValueAtTime(0, t(0.8)); o.start(time); o.stop(t(0.8));
                } else { 
                    f.type = 'bandpass'; f.frequency.setValueAtTime(400, time); f.frequency.linearRampToValueAtTime(1500, t(1.0)); f.Q.value = 3; vGain.gain.setValueAtTime(0, time); vGain.gain.linearRampToValueAtTime(0.3*volume, t(0.5)); vGain.gain.linearRampToValueAtTime(0, t(1.5)); nSource.connect(f); f.connect(vGain); nSource.start(time); nSource.stop(t(1.5));
                }
            } else if (color === 'purple') { 
                if (kit === 'TECHNO' || kit === 'RETRO-WAVE') { 
                    const f0 = baseFreq; const f1 = baseFreq*1.25; const f2 = baseFreq*1.5; const f3 = baseFreq*1.875;
                    [f0, f1, f2, f3].forEach(f => { const o = this.ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.connect(vGain); o.start(time); o.stop(t(0.3)); });
                    vGain.gain.setValueAtTime(0.2*volume, time); vGain.gain.exponentialRampToValueAtTime(0.01, t(0.3));
                } else if (kit === '8-BIT') { 
                    const o = this.ctx.createOscillator(); o.type = 'square'; const f0 = baseFreq; const f1 = baseFreq*1.25; const f2 = baseFreq*1.5; const spd = 0.03;
                    o.frequency.setValueAtTime(f0, time); o.frequency.setValueAtTime(f1, t(spd)); o.frequency.setValueAtTime(f2, t(spd*2)); o.frequency.setValueAtTime(f0, t(spd*3)); o.frequency.setValueAtTime(f1, t(spd*4)); o.frequency.setValueAtTime(f2, t(spd*5));
                    vGain.gain.setValueAtTime(0.3*volume, time); vGain.gain.linearRampToValueAtTime(0, t(0.2)); o.connect(vGain); o.start(time); o.stop(t(0.2));
                } else if (kit === 'GLITCH-HOP') {
                    const o = this.ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(baseFreq, time); o.frequency.exponentialRampToValueAtTime(baseFreq/4, t(0.6));
                    const ws = this.ctx.createWaveShaper(); ws.curve = this.distortionCurve; o.connect(ws); ws.connect(vGain); vGain.gain.setValueAtTime(0.5*volume, time); vGain.gain.linearRampToValueAtTime(0, t(0.6)); o.start(time); o.stop(t(0.6));
                } else if (kit === 'DEEP-DUB') {
                    const o = this.ctx.createOscillator(); o.type = 'square'; o.frequency.value = baseFreq; const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.setValueAtTime(1500, time); f.frequency.exponentialRampToValueAtTime(500, t(1.2)); f.Q.value = 6;
                    o.connect(f); f.connect(vGain); vGain.gain.setValueAtTime(0, time); vGain.gain.linearRampToValueAtTime(0.5*volume, t(0.1)); vGain.gain.linearRampToValueAtTime(0, t(1.2)); o.start(time); o.stop(t(1.2));
                } else if (kit === 'AMBIENT') {
                    const o1 = this.ctx.createOscillator(); const o2 = this.ctx.createOscillator(); o1.type = 'sine'; o2.type = 'sine'; o1.frequency.value = baseFreq; o2.frequency.value = baseFreq*1.5; o1.connect(vGain); o2.connect(vGain); vGain.gain.setValueAtTime(0, time); vGain.gain.linearRampToValueAtTime(0.3*volume, t(0.8)); vGain.gain.linearRampToValueAtTime(0, t(1.5)); o1.start(time); o2.start(time); o1.stop(t(1.5)); o2.stop(t(1.5));
                } else { 
                    const o1 = this.ctx.createOscillator(); const o2 = this.ctx.createOscillator(); o1.type = 'sine'; o2.type = 'sine'; o1.frequency.value = baseFreq; o2.frequency.value = baseFreq*1.5; o1.connect(vGain); o2.connect(vGain);
                    vGain.gain.setValueAtTime(0, time); vGain.gain.linearRampToValueAtTime(0.4*volume, t(1.0)); vGain.gain.linearRampToValueAtTime(0, t(3.0)); o1.start(time); o2.start(time); o1.stop(t(3.0)); o2.stop(t(3.0));
                }
            }
        }
        
        setTimeout(() => { try { osc.disconnect(); filter.disconnect(); gain.disconnect(); } catch(e){} }, 3000);
    }
}