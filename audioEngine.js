class AudioEngine {
    constructor() {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        
        this.KITS = ['TECHNO', '8-BIT', 'AMBIENT', 'RETRO-WAVE', 'GLITCH-HOP', 'DEEP-DUB', 'STRINGS'];
        this.activeKitIndex = 0;
        this.SCALES = {
            'PENTATONIC': [0, 2, 4, 7, 9], 'MINOR PENT': [0, 3, 5, 7, 10],
            'MAJOR': [0, 2, 4, 5, 7, 9, 11], 'MINOR': [0, 2, 3, 5, 7, 8, 10],
            'BLUES': [0, 3, 5, 6, 7, 10]
        };
        this.activeKey = 60;
        this.activeScale = 'MINOR PENT';

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
        this.bitcrusher.curve = this._makeCrushCurve(200);
        this.busCrush.connect(this.bitcrusher); this.bitcrusher.connect(this.masterCompressor);

        this.busEcho = this.ctx.createGain();
        this.delay = this.ctx.createDelay(); 
        this.delayFeedback = this.ctx.createGain(); this.delayFeedback.gain.value = 0.5;
        this.delay.connect(this.delayFeedback); this.delayFeedback.connect(this.delay);
        this.busEcho.connect(this.delay); this.delay.connect(this.masterCompressor);

        this.busReverb = this.ctx.createGain();
        this.convolver = this.ctx.createConvolver();
        this.convolver.buffer = this._generateReverbIR();
        this.busReverb.connect(this.convolver); this.convolver.connect(this.masterCompressor);

        this.busChorus = this.ctx.createGain();
        this.chorusDelay = this.ctx.createDelay(); this.chorusDelay.delayTime.value = 0.03;
        this.chorusLFO = this.ctx.createOscillator(); this.chorusLFO.type = 'sine'; this.chorusLFO.frequency.value = 1.5;
        this.chorusGain = this.ctx.createGain(); this.chorusGain.gain.value = 0.005;
        this.chorusLFO.connect(this.chorusGain); this.chorusGain.connect(this.chorusDelay.delayTime);
        this.chorusLFO.start();
        this.busChorus.connect(this.chorusDelay); this.chorusDelay.connect(this.masterCompressor);

        this.noiseBuffer = this.ctx.createBuffer(1, this.ctx.sampleRate * 2, this.ctx.sampleRate);
        const output = this.noiseBuffer.getChannelData(0); 
        for (let i = 0; i < this.noiseBuffer.length; i++) { output[i] = Math.random() * 2 - 1; }
        
        this.distortionCurve = this._makeDistortionCurve(400); 
    }

    _makeCrushCurve(amount) {
        const n_samples = 44100; const curve = new Float32Array(n_samples); const deg = Math.PI / 180;
        for (let i = 0; i < n_samples; ++i) { let x = i * 2 / n_samples - 1; curve[i] = (3 + amount) * x * 20 * deg / (Math.PI + amount * Math.abs(x)); } return curve;
    }

    _makeDistortionCurve(k) {
        const n_samples = 44100; const curve = new Float32Array(n_samples); const deg = Math.PI / 180;
        for (let i = 0; i < n_samples; ++i) { let x = i * 2 / n_samples - 1; curve[i] = (3 + k) * x * 20 * deg / (Math.PI + k * Math.abs(x)); } return curve;
    }

    _generateReverbIR() {
        const length = this.ctx.sampleRate * 1.5; 
        const impulse = this.ctx.createBuffer(2, length, this.ctx.sampleRate);
        for (let channel = 0; channel < 2; channel++) {
            const data = impulse.getChannelData(channel);
            for (let i = 0; i < length; i++) { data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 3); }
        }
        return impulse;
    }

    createNoise() { const n = this.ctx.createBufferSource(); n.buffer = this.noiseBuffer; return n; }
    resume() { if (this.ctx.state === 'suspended') this.ctx.resume(); }
    get currentTime() { return this.ctx.currentTime; }

    setDelayTime(timeInSeconds) { this.delay.delayTime.value = timeInSeconds; }

    cycleKit() {
        this.activeKitIndex = (this.activeKitIndex + 1) % this.KITS.length;
        return this.KITS[this.activeKitIndex];
    }

    setTheory(key, scale) {
        this.activeKey = key;
        this.activeScale = scale;
    }

    _getFreq(pitchIdx) {
        const intervals = this.SCALES[this.activeScale];
        let octaves = Math.floor(pitchIdx / intervals.length);
        let step = pitchIdx % intervals.length;
        if (step < 0) step += intervals.length; 
        let midiNote = this.activeKey + (octaves * 12) + intervals[step];
        return 440 * Math.pow(2, (midiNote - 69) / 12);
    }

    _playString(row, color, freq, volume, fx, time) {
        const outGain = this.ctx.createGain();
        let masterLevel = volume * 0.4;
        
        const preRouter = this.ctx.createGain(); preRouter.gain.value = 1;
        outGain.connect(preRouter);
        this._routeSignal(preRouter, fx);

        if (row === 0) {
            let decay = color === 'green' ? 0.2 : (color === 'purple' ? 2.5 : 1.5);
            let bright = color === 'yellow' ? 6000 : (color === 'red' ? 2000 : 4000);
            let is12String = color === 'blue';
            let isHarmonic = color === 'purple';
            
            let f = isHarmonic ? freq * 2 : freq;
            
            const osc = this.ctx.createOscillator(); osc.type = 'triangle'; osc.frequency.value = f;
            const osc2 = this.ctx.createOscillator(); osc2.type = 'sine'; osc2.frequency.value = f * 2;
            
            const filter = this.ctx.createBiquadFilter(); filter.type = 'lowpass';
            filter.frequency.setValueAtTime(bright, time);
            filter.frequency.exponentialRampToValueAtTime(400, time + (decay * 0.3));
            
            const env = this.ctx.createGain(); env.gain.setValueAtTime(0, time);
            env.gain.linearRampToValueAtTime(1 * masterLevel, time + 0.01);
            env.gain.exponentialRampToValueAtTime(0.001, time + decay);
            
            osc.connect(filter); osc2.connect(filter);
            osc.start(time); osc2.start(time); osc.stop(time + decay); osc2.stop(time + decay);
            
            if (is12String) {
                const osc3 = this.ctx.createOscillator(); osc3.type = 'triangle'; osc3.frequency.value = f * 1.005;
                osc3.connect(filter); osc3.start(time); osc3.stop(time + decay);
            }
            if (color === 'yellow') { 
                const noise = this.createNoise(); const nFilt = this.ctx.createBiquadFilter(); nFilt.type = 'highpass'; nFilt.frequency.value = 4000;
                const nEnv = this.ctx.createGain(); nEnv.gain.setValueAtTime(0.5 * masterLevel, time); nEnv.gain.exponentialRampToValueAtTime(0.01, time + 0.05);
                noise.connect(nFilt); nFilt.connect(nEnv); nEnv.connect(outGain); noise.start(time); noise.stop(time + 0.05);
            }
            filter.connect(env); env.connect(outGain);

        } else if (row === 1) {
            let decay = color === 'green' ? 0.3 : 2.0;
            let bright = color === 'yellow' ? 3000 : (color === 'red' ? 800 : 1500);
            
            const osc = this.ctx.createOscillator(); osc.type = color === 'yellow' ? 'sawtooth' : 'triangle'; osc.frequency.value = freq / 2;
            const sub = this.ctx.createOscillator(); sub.type = 'sine'; sub.frequency.value = freq / 4;
            if (color === 'purple') { 
                osc.frequency.exponentialRampToValueAtTime((freq/2) * 0.9, time + decay);
                sub.frequency.exponentialRampToValueAtTime((freq/4) * 0.9, time + decay);
            }
            
            const filter = this.ctx.createBiquadFilter(); filter.type = 'lowpass';
            filter.frequency.setValueAtTime(bright, time);
            filter.frequency.exponentialRampToValueAtTime(150, time + (decay * 0.3));
            
            const env = this.ctx.createGain(); env.gain.setValueAtTime(0, time);
            env.gain.linearRampToValueAtTime(1.2 * masterLevel, time + 0.02);
            env.gain.exponentialRampToValueAtTime(0.001, time + decay);
            
            osc.connect(filter); sub.connect(filter); filter.connect(env); env.connect(outGain);
            osc.start(time); sub.start(time); osc.stop(time + decay); sub.stop(time + decay);
            
            if (color === 'blue') { 
                const chorusOsc = this.ctx.createOscillator(); chorusOsc.type = 'triangle'; chorusOsc.frequency.value = (freq / 2) * 1.01;
                chorusOsc.connect(filter); chorusOsc.start(time); chorusOsc.stop(time + decay);
            }
            if (color === 'green') { 
                const noise = this.createNoise(); const nFilter = this.ctx.createBiquadFilter(); nFilter.type = 'bandpass'; nFilter.frequency.value = 2500;
                const nEnv = this.ctx.createGain(); nEnv.gain.setValueAtTime(0.3 * masterLevel, time); nEnv.gain.exponentialRampToValueAtTime(0.01, time + 0.05);
                noise.connect(nFilter); nFilter.connect(nEnv); nEnv.connect(outGain); noise.start(time); noise.stop(time + 0.05);
            }

        } else if (row === 2) {
            let decay = color === 'green' ? 0.15 : (color === 'purple' ? 2.5 : 1.5);
            let attack = color === 'purple' ? 0.3 : 0.01; 
            let bright = color === 'yellow' ? 5000 : (color === 'red' ? 1500 : 3500);
            
            const osc = this.ctx.createOscillator(); osc.type = 'square'; osc.frequency.value = freq;
            const osc2 = this.ctx.createOscillator(); osc2.type = color==='red'?'triangle':'sine'; osc2.frequency.value = freq;
            
            if (color === 'blue') { 
                const lfo = this.ctx.createOscillator(); lfo.frequency.value = 4;
                const lfoGain = this.ctx.createGain(); lfoGain.gain.value = freq * 0.02;
                lfo.connect(lfoGain); lfoGain.connect(osc.frequency); lfoGain.connect(osc2.frequency);
                lfo.start(time); lfo.stop(time + decay);
            }
            
            const filter = this.ctx.createBiquadFilter(); filter.type = 'lowpass';
            filter.frequency.setValueAtTime(bright, time);
            filter.frequency.exponentialRampToValueAtTime(600, time + (decay * 0.4));
            
            const env = this.ctx.createGain(); env.gain.setValueAtTime(0, time);
            env.gain.linearRampToValueAtTime(0.8 * masterLevel, time + attack);
            env.gain.exponentialRampToValueAtTime(0.001, time + decay);
            
            osc.connect(filter); osc2.connect(filter); filter.connect(env); env.connect(outGain);
            osc.start(time); osc2.start(time); osc.stop(time + decay); osc2.stop(time + decay);

        } else if (row === 3) {
            let decay = color === 'green' ? 0.15 : (color === 'purple' ? 2.5 : 1.2);
            let lpFreq = color === 'yellow' ? 6000 : (color === 'red' ? 3000 : 4500); 
            
            const root = this.ctx.createOscillator(); root.type = 'sawtooth'; root.frequency.value = freq;
            const fifth = this.ctx.createOscillator(); fifth.type = 'sawtooth'; fifth.frequency.value = freq * 1.4983; 
            const sub = this.ctx.createOscillator(); sub.type = 'square'; sub.frequency.value = freq / 2; 
            
            const drive = this.ctx.createGain(); drive.gain.value = 10.0; 
            const ws = this.ctx.createWaveShaper(); ws.curve = this.distortionCurve; ws.oversample = '4x';
            
            const cab = this.ctx.createBiquadFilter(); cab.type = 'lowpass'; cab.frequency.value = lpFreq;
            const cabHp = this.ctx.createBiquadFilter(); cabHp.type = 'highpass'; cabHp.frequency.value = 130;
            
            const env = this.ctx.createGain(); env.gain.setValueAtTime(0, time);
            const styleOut = this.ctx.createGain(); styleOut.gain.value = 1;
            
            if (color === 'green') { 
                cab.frequency.setValueAtTime(2000, time);
                cab.frequency.exponentialRampToValueAtTime(300, time + 0.1);
                env.gain.linearRampToValueAtTime(1.0 * masterLevel, time + 0.01);
                env.gain.exponentialRampToValueAtTime(0.001, time + 0.15);
            } else if (color === 'red') { 
                root.frequency.setValueAtTime(freq * 1.1224, time); 
                fifth.frequency.setValueAtTime((freq * 1.4983) * 1.1224, time);
                sub.frequency.setValueAtTime((freq / 2) * 1.1224, time);
                
                root.frequency.exponentialRampToValueAtTime(freq, time + 0.1);
                fifth.frequency.exponentialRampToValueAtTime(freq * 1.4983, time + 0.1);
                sub.frequency.exponentialRampToValueAtTime(freq / 2, time + 0.1);
                
                env.gain.linearRampToValueAtTime(0.8 * masterLevel, time + 0.02);
                env.gain.setTargetAtTime(0.5 * masterLevel, time + 0.1, 0.2);
                env.gain.exponentialRampToValueAtTime(0.001, time + decay);
            } else if (color === 'purple') { 
                root.frequency.value = freq * 2; 
                fifth.frequency.value = freq * 2.9966; 
                sub.frequency.value = freq; 
                
                env.gain.linearRampToValueAtTime(0.7 * masterLevel, time + 0.05);
                env.gain.exponentialRampToValueAtTime(0.001, time + decay);
                
                const trem = this.ctx.createOscillator(); trem.type = 'sine'; trem.frequency.value = 12;
                const tremGain = this.ctx.createGain(); tremGain.gain.value = freq * 0.05;
                trem.connect(tremGain); tremGain.connect(root.frequency); tremGain.connect(fifth.frequency);
                trem.start(time); trem.stop(time + decay);
            } else if (color === 'blue') {
                env.gain.linearRampToValueAtTime(0.8 * masterLevel, time + 0.02);
                env.gain.exponentialRampToValueAtTime(0.001, time + decay);
                
                const tremolo = this.ctx.createOscillator(); tremolo.type = 'sine'; tremolo.frequency.value = 12; 
                const tremGain = this.ctx.createGain(); tremGain.gain.value = 0.8; 
                tremolo.connect(tremGain);
                tremGain.connect(styleOut.gain); 
                tremolo.start(time); tremolo.stop(time + decay);
            } else { 
                env.gain.linearRampToValueAtTime(0.8 * masterLevel, time + 0.02);
                env.gain.setTargetAtTime(0.5 * masterLevel, time + 0.1, 0.4);
                env.gain.exponentialRampToValueAtTime(0.001, time + decay);
            }

            root.connect(drive); fifth.connect(drive); sub.connect(drive);
            drive.connect(ws); ws.connect(cab); cab.connect(cabHp); 
            if (color !== 'blue') cabHp.connect(env); 
            env.connect(styleOut); styleOut.connect(outGain);
            
            root.start(time); fifth.start(time); sub.start(time);
            root.stop(time + decay); fifth.stop(time + decay); sub.stop(time + decay);

        } else if (row === 4) {
            let isPizzicato = color === 'green';
            let isCello = color === 'red';
            let attack = isPizzicato ? 0.01 : (color === 'purple' ? 0.8 : 0.3);
            let decay = isPizzicato ? 0.3 : (color === 'purple' ? 3.0 : 1.5);
            let f = isCello ? freq / 2 : freq;
            
            const sawOsc = this.ctx.createOscillator(); sawOsc.type = 'sawtooth'; sawOsc.frequency.value = f;
            const triOsc = this.ctx.createOscillator(); triOsc.type = 'triangle'; triOsc.frequency.value = f;
            
            const isEnsemble = (color === 'blue' || color === 'purple');
            const sawOsc2 = this.ctx.createOscillator();
            if (isEnsemble) {
                sawOsc2.type = 'sawtooth'; sawOsc2.frequency.value = f * 1.008;
            }
            
            if (!isPizzicato) {
                const lfo = this.ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 5.5; 
                const lfoGain = this.ctx.createGain(); 
                lfoGain.gain.setValueAtTime(0, time);
                lfoGain.gain.setTargetAtTime(f * 0.015, time + attack + 0.1, 0.3); 
                
                lfo.connect(lfoGain); 
                lfoGain.connect(sawOsc.frequency);
                lfoGain.connect(triOsc.frequency);
                if (isEnsemble) lfoGain.connect(sawOsc2.frequency);
                
                lfo.start(time); lfo.stop(time + attack + decay);
            }
            
            const filter = this.ctx.createBiquadFilter(); filter.type = 'lowpass'; 
            filter.frequency.value = color === 'yellow' ? 4500 : (isCello ? 1500 : 3000); 
            
            const bodyResonance = this.ctx.createBiquadFilter(); bodyResonance.type = 'peaking';
            bodyResonance.frequency.value = isCello ? 250 : 400; 
            bodyResonance.Q.value = 2.0;
            bodyResonance.gain.value = 5;
            
            const env = this.ctx.createGain(); env.gain.setValueAtTime(0, time);
            env.gain.linearRampToValueAtTime(0.2 * masterLevel, time + attack);
            if (!isPizzicato) env.gain.setTargetAtTime(0.15 * masterLevel, time + attack, 0.4); 
            env.gain.exponentialRampToValueAtTime(0.001, time + attack + decay);
            
            sawOsc.connect(filter); triOsc.connect(filter);
            if (isEnsemble) sawOsc2.connect(filter);
            
            filter.connect(bodyResonance); bodyResonance.connect(env); env.connect(outGain);
            
            sawOsc.start(time); triOsc.start(time); 
            sawOsc.stop(time + attack + decay); triOsc.stop(time + attack + decay);
            if (isEnsemble) {
                sawOsc2.start(time); sawOsc2.stop(time + attack + decay);
            }
        }

        setTimeout(() => { try { outGain.disconnect(); preRouter.disconnect(); } catch(e){} }, 5000);
    }

    _routeSignal(sourceNode, fx) {
        const c = fx.crush || 0; const e = fx.echo || 0; const r = fx.reverb || 0; const h = fx.chorus || 0;
        const dryLvl = Math.max(0, 1 - (c + e + r + h));

        const dryG = this.ctx.createGain(); dryG.gain.value = dryLvl; sourceNode.connect(dryG); dryG.connect(this.busDry);
        const crushG = this.ctx.createGain(); crushG.gain.value = c; sourceNode.connect(crushG); crushG.connect(this.busCrush);
        const echoG = this.ctx.createGain(); echoG.gain.value = e; sourceNode.connect(echoG); echoG.connect(this.busEcho);
        const reverbG = this.ctx.createGain(); reverbG.gain.value = r; sourceNode.connect(reverbG); reverbG.connect(this.busReverb);
        const chorusG = this.ctx.createGain(); chorusG.gain.value = h; sourceNode.connect(chorusG); chorusG.connect(this.busChorus);
    }

    playNote(row, color, pitchIdx, volume, fx, time, kitOverride) {
        if (volume <= 0) return;
        const kit = kitOverride || this.KITS[this.activeKitIndex]; 
        const baseFreq = this._getFreq(pitchIdx); 

        if (kit === 'STRINGS') {
            this._playString(row, color, baseFreq, volume, fx, time);
            return;
        }

        const osc = this.ctx.createOscillator(); const filter = this.ctx.createBiquadFilter(); const gain = this.ctx.createGain();
        osc.frequency.value = baseFreq; 
        osc.detune.value = (Math.random() * 10) - 5; 
        osc.connect(filter); filter.connect(gain);
        
        this._routeSignal(gain, fx);

        if (row === 0) { 
            if (color === 'red') { 
                if (kit === 'TECHNO') { osc.type = 'sine'; osc.frequency.setValueAtTime(150, time); osc.frequency.exponentialRampToValueAtTime(40, time+0.1); gain.gain.setValueAtTime(1.5*volume, time); gain.gain.exponentialRampToValueAtTime(0.01, time+0.4); osc.start(time); osc.stop(time+0.4); }
                else if (kit === '8-BIT') { osc.type = 'square'; osc.frequency.setValueAtTime(80, time); osc.frequency.exponentialRampToValueAtTime(20, time+0.2); gain.gain.setValueAtTime(1*volume, time); gain.gain.setValueAtTime(1*volume, time+0.1); gain.gain.linearRampToValueAtTime(0, time+0.15); osc.start(time); osc.stop(time+0.15); }
                else if (kit === 'RETRO-WAVE') { osc.type = 'sine'; osc.frequency.setValueAtTime(150, time); osc.frequency.exponentialRampToValueAtTime(0.01, time+0.3); gain.gain.setValueAtTime(1.2*volume, time); gain.gain.exponentialRampToValueAtTime(0.01, time+0.3); osc.start(time); osc.stop(time+0.3); }
                else if (kit === 'GLITCH-HOP') { osc.type = 'sawtooth'; filter.type = 'lowpass'; filter.frequency.setValueAtTime(1000, time); filter.frequency.exponentialRampToValueAtTime(50, time+0.2); osc.frequency.setValueAtTime(120, time); osc.frequency.exponentialRampToValueAtTime(20, time+0.2); gain.gain.setValueAtTime(1*volume, time); gain.gain.exponentialRampToValueAtTime(0.01, time+0.2); osc.start(time); osc.stop(time+0.2); }
                else if (kit === 'DEEP-DUB') { osc.type = 'sine'; osc.frequency.setValueAtTime(60 + (pitchIdx*5), time); osc.frequency.exponentialRampToValueAtTime(40, time+0.6); gain.gain.setValueAtTime(1*volume, time); gain.gain.linearRampToValueAtTime(0, time+0.8); osc.start(time); osc.stop(time+0.8); }
                else { osc.type = 'sine'; osc.frequency.setValueAtTime(130, time); osc.frequency.exponentialRampToValueAtTime(0.01, time+0.4); gain.gain.setValueAtTime(1*volume, time); gain.gain.exponentialRampToValueAtTime(0.01, time+0.4); osc.start(time); osc.stop(time+0.4); }
            }
            else if (color === 'yellow') { 
                const n = this.createNoise(); n.connect(filter); filter.connect(gain);
                if (kit === 'TECHNO') { filter.type = 'bandpass'; filter.frequency.value = 2500; gain.gain.setValueAtTime(1.2*volume, time); gain.gain.exponentialRampToValueAtTime(0.01, time+0.2); n.start(time); n.stop(time+0.2); }
                else if (kit === '8-BIT') { filter.type = 'lowpass'; filter.frequency.value = 4000; gain.gain.setValueAtTime(0.8*volume, time); gain.gain.setValueAtTime(0.8*volume, time+0.05); gain.gain.linearRampToValueAtTime(0, time+0.1); n.start(time); n.stop(time+0.1); }
                else if (kit === 'RETRO-WAVE') { filter.type = 'lowpass'; filter.frequency.value = 5000; gain.gain.setValueAtTime(0.8*volume, time); gain.gain.setValueAtTime(0.8*volume, time+0.1); gain.gain.exponentialRampToValueAtTime(0.01, time+0.15); n.start(time); n.stop(time+0.15); }
                else if (kit === 'GLITCH-HOP') { filter.type = 'highpass'; filter.frequency.value = 1000; osc.type='triangle'; osc.frequency.setValueAtTime(300, time); osc.frequency.exponentialRampToValueAtTime(100, time+0.1); gain.gain.setValueAtTime(0.8*volume, time); gain.gain.exponentialRampToValueAtTime(0.01, time+0.2); osc.start(time); osc.stop(time+0.2); n.start(time); n.stop(time+0.1); }
                else if (kit === 'DEEP-DUB') { filter.type = 'bandpass'; filter.frequency.value = 1200; filter.Q.value = 5; gain.gain.setValueAtTime(0.8*volume, time); gain.gain.exponentialRampToValueAtTime(0.01, time+0.1); n.start(time); n.stop(time+0.1); }
                else { filter.type = 'lowpass'; filter.frequency.value = kit==='AMBIENT'?1000:8000; gain.gain.setValueAtTime(0.5*volume, time); gain.gain.exponentialRampToValueAtTime(0.01, time+0.1); osc.type = kit==='AMBIENT'?'sine':'square'; osc.frequency.setValueAtTime(600, time); osc.start(time); osc.stop(time+0.1); }
            }
            else if (color === 'blue') { 
                const n = this.createNoise(); n.connect(filter); filter.connect(gain);
                if (kit === 'TECHNO') { filter.type = 'highpass'; filter.frequency.value = 6000; gain.gain.setValueAtTime(0.6*volume, time); gain.gain.exponentialRampToValueAtTime(0.01, time+0.05); n.start(time); n.stop(time+0.05); }
                else if (kit === '8-BIT') { filter.type = 'bandpass'; filter.frequency.value = 3000; filter.Q.value = 1; gain.gain.setValueAtTime(0.5*volume, time); gain.gain.setValueAtTime(0.5*volume, time+0.03); gain.gain.linearRampToValueAtTime(0, time+0.05); n.start(time); n.stop(time+0.05); }
                else if (kit === 'RETRO-WAVE') { filter.type = 'highpass'; filter.frequency.value = 8000; gain.gain.setValueAtTime(0.4*volume, time); gain.gain.exponentialRampToValueAtTime(0.01, time+0.05); n.start(time); n.stop(time+0.05); }
                else if (kit === 'GLITCH-HOP') { const ws = this.ctx.createWaveShaper(); ws.curve = this.distortionCurve; n.disconnect(); n.connect(ws); ws.connect(filter); filter.type = 'highpass'; filter.frequency.value = 4000; gain.gain.setValueAtTime(0.5*volume, time); gain.gain.exponentialRampToValueAtTime(0.01, time+0.1); n.start(time); n.stop(time+0.1); }
                else if (kit === 'DEEP-DUB') { filter.type = 'bandpass'; filter.frequency.value = 6000; filter.Q.value = 1; gain.gain.setValueAtTime(0, time); gain.gain.linearRampToValueAtTime(0.4*volume, time+0.05); gain.gain.linearRampToValueAtTime(0, time+0.15); n.start(time); n.stop(time+0.15); }
                else { osc.type = 'sawtooth'; osc.frequency.setValueAtTime(4000, time); filter.type='highpass'; filter.frequency.value=6000; gain.gain.setValueAtTime(0.3*volume, time); gain.gain.exponentialRampToValueAtTime(0.01, time+0.05); osc.start(time); osc.stop(time+0.05); }
            }
            else if (color === 'green') { 
                if (kit === 'TECHNO') { const nSource = this.ctx.createBufferSource(); nSource.buffer = this.noiseBuffer; const f = this.ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.setValueAtTime(5000, time); f.frequency.exponentialRampToValueAtTime(1000, time+0.2); gain.gain.setValueAtTime(0.4*volume, time); gain.gain.exponentialRampToValueAtTime(0.01, time+0.2); nSource.connect(f); f.connect(gain); nSource.start(time); nSource.stop(time+0.2); }
                else if (kit === '8-BIT') { const nSource = this.ctx.createBufferSource(); nSource.buffer = this.noiseBuffer; const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2000+(pitchIdx*200); f.Q.value = 5; gain.gain.setValueAtTime(0.5*volume, time); gain.gain.setValueAtTime(0, time+0.05); gain.gain.setValueAtTime(0.5*volume, time+0.1); gain.gain.linearRampToValueAtTime(0, time+0.15); nSource.connect(f); f.connect(gain); nSource.start(time); nSource.stop(time+0.15); }
                else if (kit === 'AMBIENT') { osc.type = 'square'; osc.frequency.setValueAtTime(baseFreq*4, time); filter.type = 'lowpass'; filter.frequency.setValueAtTime(8000, time); filter.frequency.exponentialRampToValueAtTime(100, time+0.1); gain.gain.setValueAtTime(0.6*volume, time); gain.gain.exponentialRampToValueAtTime(0.01, time+0.1); osc.start(time); osc.stop(time+0.1); }
                else if (kit === 'RETRO-WAVE') { osc.type = 'sine'; osc.frequency.setValueAtTime(150, time); osc.frequency.exponentialRampToValueAtTime(20, time+0.3); gain.gain.setValueAtTime(0.8*volume, time); gain.gain.exponentialRampToValueAtTime(0.01, time+0.3); osc.start(time); osc.stop(time+0.3); }
                else if (kit === 'GLITCH-HOP') { osc.type = 'square'; osc.frequency.value = 8000; gain.gain.setValueAtTime(0.5*volume, time); gain.gain.setValueAtTime(0, time+0.05); gain.gain.setValueAtTime(0.5*volume, time+0.1); gain.gain.linearRampToValueAtTime(0, time+0.15); osc.start(time); osc.stop(time+0.15); }
                else if (kit === 'DEEP-DUB') { const nSource = this.ctx.createBufferSource(); nSource.buffer = this.noiseBuffer; const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 4000; nSource.connect(f); f.connect(gain); gain.gain.setValueAtTime(0.4*volume, time); gain.gain.exponentialRampToValueAtTime(0.01, time+0.2); nSource.start(time); nSource.stop(time+0.2); }
            }
            else if (color === 'purple') { 
                if (kit === 'TECHNO') { osc.type = 'sawtooth'; filter.type = 'lowpass'; filter.frequency.setValueAtTime(3000, time); filter.frequency.exponentialRampToValueAtTime(200, time+0.1); osc.frequency.setValueAtTime(100, time); gain.gain.setValueAtTime(0.6*volume, time); gain.gain.exponentialRampToValueAtTime(0.01, time+0.2); osc.start(time); osc.stop(time+0.2); }
                else if (kit === '8-BIT') { osc.type = 'square'; osc.frequency.setValueAtTime(200, time); osc.frequency.setValueAtTime(150, time+0.05); osc.frequency.setValueAtTime(100, time+0.1); gain.gain.setValueAtTime(0.6*volume, time); gain.gain.linearRampToValueAtTime(0, time+0.15); osc.start(time); osc.stop(time+0.15); }
                else if (kit === 'RETRO-WAVE') { osc.type = 'square'; filter.type = 'lowpass'; filter.frequency.setValueAtTime(2000, time); filter.frequency.exponentialRampToValueAtTime(100, time+0.2); osc.frequency.setValueAtTime(200, time); osc.frequency.exponentialRampToValueAtTime(50, time+0.2); gain.gain.setValueAtTime(0.6*volume, time); gain.gain.exponentialRampToValueAtTime(0.01, time+0.2); osc.start(time); osc.stop(time+0.2); }
                else if (kit === 'GLITCH-HOP') { osc.type = 'sawtooth'; osc.frequency.setValueAtTime(800, time); osc.frequency.setValueAtTime(200, time+0.05); osc.frequency.setValueAtTime(800, time+0.1); gain.gain.setValueAtTime(0.5*volume, time); gain.gain.linearRampToValueAtTime(0, time+0.15); osc.start(time); osc.stop(time+0.15); }
                else if (kit === 'DEEP-DUB') { osc.type = 'sine'; osc.frequency.setValueAtTime(100, time); osc.frequency.linearRampToValueAtTime(30, time+1.0); gain.gain.setValueAtTime(0.8*volume, time); gain.gain.linearRampToValueAtTime(0, time+1.0); osc.start(time); osc.stop(time+1.0); }
                else { osc.type = 'sine'; osc.frequency.setValueAtTime(100, time); osc.frequency.exponentialRampToValueAtTime(0.01, time+0.1); gain.gain.setValueAtTime(0.8*volume, time); gain.gain.exponentialRampToValueAtTime(0.01, time+0.1); osc.start(time); osc.stop(time+0.1); }
            }
        } 
        else if (row === 1) { 
            const subFreq = baseFreq / 2;
            osc.frequency.value = subFreq; 
            if (color === 'red') { 
                if (kit === 'TECHNO') { osc.type = 'sawtooth'; filter.type = 'lowpass'; filter.frequency.setValueAtTime(2000, time); filter.frequency.exponentialRampToValueAtTime(80, time+0.2); filter.Q.value=10; gain.gain.setValueAtTime(0.6*volume, time); gain.gain.exponentialRampToValueAtTime(0.01, time+0.3); }
                else if (kit === '8-BIT') { osc.type = 'square'; gain.gain.setValueAtTime(0.6*volume, time); gain.gain.setValueAtTime(0.6*volume, time+0.2); gain.gain.linearRampToValueAtTime(0, time+0.25); }
                else if (kit === 'GLITCH-HOP') { osc.type = 'sine'; const ws = this.ctx.createWaveShaper(); ws.curve = this.distortionCurve; osc.disconnect(); osc.connect(ws); ws.connect(gain); gain.gain.setValueAtTime(0.4*volume, time); gain.gain.linearRampToValueAtTime(0, time+0.3); }
                else { osc.type = 'sine'; gain.gain.setValueAtTime(0.6*volume, time); gain.gain.exponentialRampToValueAtTime(0.01, time+0.4); }
                osc.start(time); osc.stop(time+0.4);
            }
            else if (color === 'yellow') {
                if (kit === 'TECHNO') { osc.type = 'sawtooth'; filter.type = 'lowpass'; filter.frequency.setValueAtTime(1000, time); filter.frequency.linearRampToValueAtTime(300, time+0.2); gain.gain.setValueAtTime(0.5*volume, time); gain.gain.setTargetAtTime(0, time+0.15, 0.1); osc.start(time); osc.stop(time+0.3); }
                else if (kit === '8-BIT') { osc.type = 'triangle'; gain.gain.setValueAtTime(0.6*volume, time); gain.gain.setValueAtTime(0.6*volume, time+0.1); gain.gain.linearRampToValueAtTime(0, time+0.15); osc.start(time); osc.stop(time+0.15); }
                else if (kit === 'RETRO-WAVE') { osc.type = 'sawtooth'; filter.type = 'lowpass'; filter.frequency.setValueAtTime(3000, time); filter.frequency.exponentialRampToValueAtTime(200, time+0.2); filter.Q.value = 5; gain.gain.setValueAtTime(0.5*volume, time); gain.gain.setTargetAtTime(0, time+0.1, 0.1); osc.start(time); osc.stop(time+0.3); }
                else if (kit === 'GLITCH-HOP') { osc.type = 'sawtooth'; const lfo = this.ctx.createOscillator(); lfo.frequency.value = 8; const lfoGain = this.ctx.createGain(); lfoGain.gain.value = 1000; lfo.connect(lfoGain); lfoGain.connect(filter.frequency); filter.type = 'lowpass'; filter.frequency.value = 1000; filter.Q.value = 10; gain.gain.setValueAtTime(0.4*volume, time); gain.gain.linearRampToValueAtTime(0, time+0.4); lfo.start(time); osc.start(time); lfo.stop(time+0.4); osc.stop(time+0.4); }
                else if (kit === 'DEEP-DUB') { osc.type = 'triangle'; filter.type = 'lowpass'; filter.frequency.value = 400; gain.gain.setValueAtTime(0, time); gain.gain.linearRampToValueAtTime(0.6*volume, time+0.1); gain.gain.linearRampToValueAtTime(0, time+0.6); osc.start(time); osc.stop(time+0.6); }
                else { osc.type = 'sawtooth'; filter.type = 'lowpass'; filter.frequency.setValueAtTime(1500, time); filter.frequency.exponentialRampToValueAtTime(100, time+0.2); gain.gain.setValueAtTime(0.4*volume, time); gain.gain.setTargetAtTime(0, time+0.1, 0.1); osc.start(time); osc.stop(time+0.3); }
            }
            else if (color === 'blue') {
                osc.type = kit==='AMBIENT'||kit==='DEEP-DUB'||kit==='TECHNO'?'sine':(kit==='8-BIT'?'square':'square'); 
                gain.gain.setValueAtTime(0.5*volume, time); gain.gain.exponentialRampToValueAtTime(0.01, time+0.15); osc.start(time); osc.stop(time+0.15);
            }
            else if (color === 'green') {
                if (kit === 'TECHNO') { osc.type = 'sawtooth'; filter.type = 'lowpass'; filter.frequency.setValueAtTime(50, time); filter.frequency.linearRampToValueAtTime(1000, time+0.2); gain.gain.setValueAtTime(0.5*volume, time); gain.gain.linearRampToValueAtTime(0, time+0.2); osc.start(time); osc.stop(time+0.2); } 
                else if (kit === '8-BIT') { osc.type = 'square'; osc.frequency.setValueAtTime(subFreq, time); osc.frequency.setValueAtTime(subFreq*2, time+0.1); gain.gain.setValueAtTime(0.6*volume, time); gain.gain.linearRampToValueAtTime(0, time+0.2); osc.start(time); osc.stop(time+0.2); } 
                else if (kit === 'AMBIENT') { osc.type = 'sine'; gain.gain.setValueAtTime(0, time); gain.gain.linearRampToValueAtTime(0.6*volume, time+0.2); gain.gain.linearRampToValueAtTime(0, time+0.5); osc.start(time); osc.stop(time+0.5); } 
                else if (kit === 'RETRO-WAVE') { osc.type = 'square'; filter.type = 'lowpass'; filter.frequency.setValueAtTime(3000, time); filter.frequency.linearRampToValueAtTime(100, time+0.5); gain.gain.setValueAtTime(0.5*volume, time); gain.gain.linearRampToValueAtTime(0, time+0.5); osc.start(time); osc.stop(time+0.5); } 
                else if (kit === 'GLITCH-HOP') { osc.type = 'triangle'; filter.type = 'lowpass'; const lfo = this.ctx.createOscillator(); lfo.frequency.value = 5; const lfoGain = this.ctx.createGain(); lfoGain.gain.value = 800; lfo.connect(lfoGain); lfoGain.connect(filter.frequency); filter.frequency.value = 1000; gain.gain.setValueAtTime(0.6*volume, time); gain.gain.linearRampToValueAtTime(0, time+0.5); osc.start(time); lfo.start(time); osc.stop(time+0.5); lfo.stop(time+0.5); } 
                else if (kit === 'DEEP-DUB') { osc.type = 'sine'; osc.frequency.setValueAtTime(subFreq*2, time); osc.frequency.exponentialRampToValueAtTime(subFreq/2, time+0.5); gain.gain.setValueAtTime(0.8*volume, time); gain.gain.linearRampToValueAtTime(0, time+0.6); osc.start(time); osc.stop(time+0.6); }
            }
            else if (color === 'purple') {
                if (kit === 'DEEP-DUB') {
                    osc.type = 'triangle'; filter.type = 'lowpass'; filter.frequency.value = 200;
                    const lfo = this.ctx.createOscillator(); lfo.frequency.value = 4; const lfoG = this.ctx.createGain(); lfoG.gain.value = 800; lfo.connect(lfoG); lfoG.connect(filter.frequency);
                    gain.gain.setValueAtTime(0.6*volume, time); gain.gain.linearRampToValueAtTime(0, time+0.8);
                    lfo.start(time); osc.start(time); lfo.stop(time+0.8); osc.stop(time+0.8);
                } else {
                    osc.type = kit==='8-BIT'?'square':'sawtooth'; osc.frequency.setValueAtTime(subFreq/2, time); osc.frequency.linearRampToValueAtTime(subFreq, time+0.1);
                    gain.gain.setValueAtTime(0.4*volume, time); gain.gain.linearRampToValueAtTime(0, time+0.4); osc.start(time); osc.stop(time+0.4);
                }
            }
        }
        else if (row === 2) {
            if (color === 'red') { 
                if (kit === 'TECHNO') { osc.type = 'sawtooth'; const o2 = this.ctx.createOscillator(); o2.type='sawtooth'; o2.frequency.value=baseFreq*1.02; o2.connect(filter); filter.type='lowpass'; filter.frequency.setValueAtTime(4000, time); filter.frequency.exponentialRampToValueAtTime(200, time+0.3); gain.gain.setValueAtTime(0.4*volume, time); gain.gain.exponentialRampToValueAtTime(0.01, time+0.4); osc.start(time); o2.start(time); osc.stop(time+0.4); o2.stop(time+0.4); }
                else if (kit === '8-BIT') { osc.type = 'square'; gain.gain.setValueAtTime(0.4*volume, time); gain.gain.setValueAtTime(0.4*volume, time+0.15); gain.gain.linearRampToValueAtTime(0, time+0.2); osc.start(time); osc.stop(time+0.2); }
                else if (kit === 'RETRO-WAVE') { const o2 = this.ctx.createOscillator(); o2.type = 'sawtooth'; osc.type = 'sawtooth'; o2.frequency.value = baseFreq*1.01; o2.connect(filter); filter.type='lowpass'; filter.frequency.value=3000; gain.gain.setValueAtTime(0.3*volume, time); gain.gain.linearRampToValueAtTime(0, time+0.5); osc.start(time); o2.start(time); osc.stop(time+0.5); o2.stop(time+0.5); }
                else if (kit === 'GLITCH-HOP') { osc.type = 'square'; osc.frequency.setValueAtTime(baseFreq, time); osc.frequency.setValueAtTime(baseFreq*2, time+0.1); gain.gain.setValueAtTime(0.3*volume, time); gain.gain.linearRampToValueAtTime(0, time+0.2); osc.start(time); osc.stop(time+0.2); }
                else if (kit === 'DEEP-DUB') { osc.type = 'triangle'; filter.type='lowpass'; filter.frequency.setValueAtTime(2000, time); filter.frequency.exponentialRampToValueAtTime(500, time+0.3); gain.gain.setValueAtTime(0.4*volume, time); gain.gain.linearRampToValueAtTime(0, time+0.4); osc.start(time); osc.stop(time+0.4); }
                else { osc.type = 'sawtooth'; gain.gain.setValueAtTime(0.3*volume, time); gain.gain.linearRampToValueAtTime(0, time+0.4); osc.start(time); osc.stop(time+0.4); }
            }
            else if (color === 'yellow') {
                osc.type = kit==='AMBIENT'||kit==='DEEP-DUB'?'sine':(kit==='8-BIT'?'square':'square'); 
                gain.gain.setValueAtTime(0.3*volume, time); gain.gain.setTargetAtTime(0, time+0.05, 0.01); osc.start(time); osc.stop(time+0.1);
            }
            else if (color === 'blue') {
                if (kit === 'GLITCH-HOP') { osc.type = 'sine'; const fm = this.ctx.createOscillator(); fm.type='sine'; fm.frequency.value = baseFreq*3.5; const fmg = this.ctx.createGain(); fmg.gain.value=1000; fm.connect(fmg); fmg.connect(osc.frequency); fm.start(time); fm.stop(time+0.3); }
                else { osc.type = kit==='8-BIT'?'triangle':'sine'; }
                osc.frequency.value = baseFreq*2; gain.gain.setValueAtTime(0.4*volume, time); gain.gain.exponentialRampToValueAtTime(0.01, time+0.5); osc.start(time); osc.stop(time+0.5);
            }
            else if (color === 'green') {
                if (kit === 'TECHNO') { osc.type = 'sawtooth'; filter.type = 'lowpass'; filter.frequency.setValueAtTime(50, time); filter.frequency.linearRampToValueAtTime(4000, time+0.3); gain.gain.setValueAtTime(0.4*volume, time); gain.gain.linearRampToValueAtTime(0, time+0.3); osc.start(time); osc.stop(time+0.3); } 
                else if (kit === '8-BIT') { osc.type = 'square'; osc.frequency.setValueAtTime(baseFreq*2, time); osc.frequency.setValueAtTime(baseFreq*1.5, time+0.05); osc.frequency.setValueAtTime(baseFreq, time+0.1); osc.frequency.setValueAtTime(baseFreq*0.5, time+0.15); gain.gain.setValueAtTime(0.5*volume, time); gain.gain.linearRampToValueAtTime(0, time+0.2); osc.start(time); osc.stop(time+0.2); } 
                else if (kit === 'AMBIENT') { osc.type = 'sine'; gain.gain.setValueAtTime(0, time); gain.gain.linearRampToValueAtTime(0.4*volume, time+1.0); gain.gain.linearRampToValueAtTime(0, time+2.0); osc.start(time); osc.stop(time+2.0); } 
                else if (kit === 'RETRO-WAVE') { const osc2 = this.ctx.createOscillator(); osc2.type = 'sawtooth'; osc.type = 'sawtooth'; osc2.frequency.value = baseFreq * 1.015; osc2.connect(filter); filter.type = 'lowpass'; filter.frequency.setValueAtTime(5000, time); filter.frequency.linearRampToValueAtTime(500, time+0.5); gain.gain.setValueAtTime(0.4*volume, time); gain.gain.linearRampToValueAtTime(0, time+0.5); osc.start(time); osc2.start(time); osc.stop(time+0.5); osc2.stop(time+0.5); } 
                else if (kit === 'GLITCH-HOP') { osc.type = 'triangle'; filter.type = 'lowpass'; const lfo = this.ctx.createOscillator(); lfo.frequency.value = 15; const lfoGain = this.ctx.createGain(); lfoGain.gain.value = 1500; lfo.connect(lfoGain); lfoGain.connect(filter.frequency); filter.frequency.value = 2000; gain.gain.setValueAtTime(0.4*volume, time); gain.gain.linearRampToValueAtTime(0, time+0.3); osc.start(time); lfo.start(time); osc.stop(time+0.3); lfo.stop(time+0.3); } 
                else if (kit === 'DEEP-DUB') { osc.type = 'sine'; osc.frequency.setValueAtTime(baseFreq, time); osc.frequency.exponentialRampToValueAtTime(baseFreq/4, time+0.4); gain.gain.setValueAtTime(0.6*volume, time); gain.gain.linearRampToValueAtTime(0, time+0.5); osc.start(time); osc.stop(time+0.5); }
            }
            else if (color === 'purple') {
                osc.type = kit==='AMBIENT'||kit==='DEEP-DUB'?'triangle':'square'; osc.frequency.setValueAtTime(baseFreq, time); osc.frequency.setValueAtTime(baseFreq*1.5, time+0.1);
                gain.gain.setValueAtTime(0.2*volume, time); gain.gain.linearRampToValueAtTime(0, time+0.2); osc.start(time); osc.stop(time+0.2);
            }
        }
        else if (row === 3) {
            if (color === 'red') {
                if (kit === 'TECHNO') { const n = this.createNoise(); const f = this.ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.setValueAtTime(500, time); f.frequency.exponentialRampToValueAtTime(8000, time+1.0); gain.gain.setValueAtTime(0, time); gain.gain.linearRampToValueAtTime(0.5*volume, time+0.8); gain.gain.linearRampToValueAtTime(0, time+1.0); n.connect(f); f.connect(gain); n.start(time); n.stop(time+1.0); }
                else if (kit === '8-BIT') { osc.type = 'square'; osc.frequency.setValueAtTime(baseFreq, time); osc.frequency.linearRampToValueAtTime(baseFreq*4, time+0.4); gain.gain.setValueAtTime(0.2*volume, time); gain.gain.linearRampToValueAtTime(0, time+0.4); osc.start(time); osc.stop(time+0.4); }
                else if (kit === 'AMBIENT') { const n = this.createNoise(); const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 800; gain.gain.setValueAtTime(0, time); gain.gain.linearRampToValueAtTime(0.4*volume, time+1.0); gain.gain.linearRampToValueAtTime(0, time+2.0); n.connect(f); f.connect(gain); n.start(time); n.stop(time+2.0); }
                else if (kit === 'RETRO-WAVE') { osc.type = 'sawtooth'; osc.frequency.setValueAtTime(3000, time); osc.frequency.exponentialRampToValueAtTime(100, time+0.3); gain.gain.setValueAtTime(0.5*volume, time); gain.gain.exponentialRampToValueAtTime(0.01, time+0.3); osc.start(time); osc.stop(time+0.3); }
                else if (kit === 'GLITCH-HOP') { osc.type = 'sawtooth'; const ws = this.ctx.createWaveShaper(); ws.curve = this.distortionCurve; filter.type = 'lowpass'; filter.frequency.setValueAtTime(4000, time); filter.frequency.linearRampToValueAtTime(100, time+0.4); osc.disconnect(); osc.connect(ws); ws.connect(filter); filter.connect(gain); gain.gain.setValueAtTime(0.6*volume, time); gain.gain.linearRampToValueAtTime(0, time+0.4); osc.start(time); osc.stop(time+0.4); }
                else if (kit === 'DEEP-DUB') { osc.type = 'square'; const lfo = this.ctx.createOscillator(); lfo.frequency.value = 6; const lfoG = this.ctx.createGain(); lfoG.gain.value = 200; lfo.connect(lfoG); lfoG.connect(osc.frequency); osc.frequency.value = 800; filter.type = 'lowpass'; filter.frequency.value = 2000; gain.gain.setValueAtTime(0.4*volume, time); gain.gain.linearRampToValueAtTime(0, time+1.0); lfo.start(time); osc.start(time); lfo.stop(time+1.0); osc.stop(time+1.0); }
                else { osc.type = 'sawtooth'; osc.frequency.setValueAtTime(baseFreq, time); osc.frequency.linearRampToValueAtTime(baseFreq*4, time+0.4); gain.gain.setValueAtTime(0.2*volume, time); gain.gain.linearRampToValueAtTime(0, time+0.4); osc.start(time); osc.stop(time+0.4); }
            }
            else if (color === 'yellow') {
                osc.type = kit==='AMBIENT'||kit==='DEEP-DUB'?'sine':'square'; osc.frequency.setValueAtTime(baseFreq*4, time); osc.frequency.exponentialRampToValueAtTime(10, time+0.1);
                gain.gain.setValueAtTime(0.3*volume, time); gain.gain.linearRampToValueAtTime(0, time+0.1); osc.start(time); osc.stop(time+0.1);
            }
            else if (color === 'blue') {
                if (kit === 'RETRO-WAVE') { osc.type='square'; filter.type='lowpass'; filter.frequency.setValueAtTime(5000, time); filter.frequency.linearRampToValueAtTime(100, time+0.2); gain.gain.setValueAtTime(0.4*volume, time); gain.gain.linearRampToValueAtTime(0, time+0.2); osc.start(time); osc.stop(time+0.2); }
                else if (kit === 'DEEP-DUB') { osc.type='sine'; osc.frequency.setValueAtTime(baseFreq*2, time); gain.gain.setValueAtTime(0.3*volume, time); gain.gain.linearRampToValueAtTime(0, time+0.2); osc.start(time); osc.stop(time+0.2); }
                else { osc.type = kit==='8-BIT'?'square':'sine'; osc.frequency.setValueAtTime(baseFreq*2, time); if(kit==='TECHNO'||kit==='GLITCH-HOP'){osc.frequency.exponentialRampToValueAtTime(10, time+0.6);}else{osc.frequency.linearRampToValueAtTime(baseFreq*1.8, time+0.6);} gain.gain.setValueAtTime(0.4*volume, time); gain.gain.linearRampToValueAtTime(0, time+0.6); osc.start(time); osc.stop(time+0.6); }
            }
            else if (color === 'green') {
                if (kit === 'TECHNO') { osc.type = 'sawtooth'; filter.type = 'lowpass'; filter.frequency.setValueAtTime(8000, time); filter.frequency.linearRampToValueAtTime(50, time+0.4); gain.gain.setValueAtTime(0.3*volume, time); gain.gain.linearRampToValueAtTime(0, time+0.4); osc.start(time); osc.stop(time+0.4); } 
                else if (kit === '8-BIT') { osc.type = 'square'; osc.frequency.setValueAtTime(baseFreq*0.5, time); osc.frequency.setValueAtTime(baseFreq, time+0.05); osc.frequency.setValueAtTime(baseFreq*1.5, time+0.1); osc.frequency.setValueAtTime(baseFreq*2, time+0.15); gain.gain.setValueAtTime(0.4*volume, time); gain.gain.linearRampToValueAtTime(0, time+0.2); osc.start(time); osc.stop(time+0.2); } 
                else if (kit === 'AMBIENT') { osc.type = 'sine'; gain.gain.setValueAtTime(0, time); gain.gain.linearRampToValueAtTime(0.3*volume, time+1.0); gain.gain.linearRampToValueAtTime(0, time+2.0); osc.start(time); osc.stop(time+2.0); } 
                else if (kit === 'RETRO-WAVE') { const osc2 = this.ctx.createOscillator(); osc2.type = 'sawtooth'; osc.type = 'sawtooth'; osc2.frequency.value = baseFreq * 1.015; osc2.connect(filter); filter.type = 'lowpass'; filter.frequency.setValueAtTime(5000, time); filter.frequency.linearRampToValueAtTime(200, time+0.3); gain.gain.setValueAtTime(0.3*volume, time); gain.gain.linearRampToValueAtTime(0, time+0.3); osc.start(time); osc2.start(time); osc.stop(time+0.3); osc2.stop(time+0.3); } 
                else if (kit === 'GLITCH-HOP') { osc.type = 'triangle'; filter.type = 'lowpass'; const lfo = this.ctx.createOscillator(); lfo.frequency.value = 20; const lfoGain = this.ctx.createGain(); lfoGain.gain.value = 2000; lfo.connect(lfoGain); lfoGain.connect(filter.frequency); filter.frequency.value = 3000; gain.gain.setValueAtTime(0.4*volume, time); gain.gain.linearRampToValueAtTime(0, time+0.3); osc.start(time); lfo.start(time); osc.stop(time+0.3); lfo.stop(time+0.3); } 
                else if (kit === 'DEEP-DUB') { osc.type = 'sine'; osc.frequency.setValueAtTime(baseFreq, time); osc.frequency.exponentialRampToValueAtTime(baseFreq*4, time+0.3); gain.gain.setValueAtTime(0.5*volume, time); gain.gain.linearRampToValueAtTime(0, time+0.4); osc.start(time); osc.stop(time+0.4); }
            }
            else if (color === 'purple') {
                osc.type = kit==='AMBIENT'?'sine':'square'; const rp = baseFreq*(0.5+Math.random()*2); osc.frequency.setValueAtTime(rp, time);
                if(kit==='GLITCH-HOP'){osc.frequency.setValueAtTime(rp*2, time+0.05); osc.frequency.setValueAtTime(rp*0.5, time+0.1);}
                filter.type = 'lowpass'; filter.frequency.setValueAtTime(5000, time); filter.frequency.linearRampToValueAtTime(100, time+0.2);
                gain.gain.setValueAtTime(0.3*volume, time); gain.gain.linearRampToValueAtTime(0, time+0.2); osc.start(time); osc.stop(time+0.2);
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
                    o1.connect(f1); o2.connect(f2); f1.connect(vGain); f2.connect(vGain); f1.frequency.exponentialRampToValueAtTime(400, time+0.3);
                    vGain.gain.setValueAtTime(0.5*volume, time); vGain.gain.exponentialRampToValueAtTime(0.01, time+0.4); o1.start(time); o2.start(time); o1.stop(time+0.4); o2.stop(time+0.4);
                } else if (kit === '8-BIT') { 
                    const o = this.ctx.createOscillator(); o.type = 'square'; o.frequency.value = baseFreq/2;
                    vGain.gain.setValueAtTime(0.4*volume, time); vGain.gain.setValueAtTime(0, time+0.05); vGain.gain.setValueAtTime(0.4*volume, time+0.1); vGain.gain.setValueAtTime(0, time+0.15); vGain.gain.setValueAtTime(0.4*volume, time+0.2); vGain.gain.linearRampToValueAtTime(0, time+0.3);
                    o.connect(vGain); o.start(time); o.stop(time+0.3);
                } else if (kit === 'GLITCH-HOP') {
                    const o = this.ctx.createOscillator(); o.type = 'square'; o.frequency.setValueAtTime(baseFreq*2, time); o.frequency.exponentialRampToValueAtTime(baseFreq/2, time+0.2);
                    const ws = this.ctx.createWaveShaper(); ws.curve = this.distortionCurve; o.connect(ws); ws.connect(vGain);
                    vGain.gain.setValueAtTime(0.6*volume, time); vGain.gain.exponentialRampToValueAtTime(0.01, time+0.2); o.start(time); o.stop(time+0.2);
                } else if (kit === 'DEEP-DUB') {
                    const o = this.ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = baseFreq; const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 800; f.Q.value = 5;
                    o.connect(f); f.connect(vGain); vGain.gain.setValueAtTime(0, time); vGain.gain.linearRampToValueAtTime(0.6*volume, time+0.05); vGain.gain.linearRampToValueAtTime(0, time+0.4); o.start(time); o.stop(time+0.4);
                } else { 
                    const o1 = this.ctx.createOscillator(); const o2 = this.ctx.createOscillator(); o1.type = 'sine'; o2.type = 'triangle'; o1.frequency.value = baseFreq/2; o2.frequency.value = baseFreq/2+1;
                    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 600; o1.connect(f); o2.connect(f); f.connect(vGain);
                    vGain.gain.setValueAtTime(0, time); vGain.gain.linearRampToValueAtTime(0.6*volume, time+0.5); vGain.gain.linearRampToValueAtTime(0, time+1.5); o1.start(time); o2.start(time); o1.stop(time+1.5); o2.stop(time+1.5);
                }
            } else if (color === 'yellow') { 
                if (kit === 'GLITCH-HOP') {
                    const o = this.ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = baseFreq/2; const f = this.ctx.createBiquadFilter(); f.type='bandpass'; f.Q.value=10; f.frequency.setValueAtTime(400, time); f.frequency.exponentialRampToValueAtTime(2000, time+0.2); f.frequency.exponentialRampToValueAtTime(400, time+0.4); o.connect(f); f.connect(vGain); vGain.gain.setValueAtTime(0.5*volume, time); vGain.gain.linearRampToValueAtTime(0, time+0.4); o.start(time); o.stop(time+0.4);
                } else if (kit === '8-BIT') { 
                    const o = this.ctx.createOscillator(); o.type = 'square'; o.frequency.setValueAtTime(baseFreq, time); o.frequency.setValueAtTime(baseFreq*2, time+0.05); o.frequency.setValueAtTime(baseFreq, time+0.1); o.frequency.setValueAtTime(baseFreq*2, time+0.15); vGain.gain.setValueAtTime(0.3*volume, time); vGain.gain.linearRampToValueAtTime(0, time+0.2); o.connect(vGain); o.start(time); o.stop(time+0.2);
                } else if (kit === 'DEEP-DUB') {
                    const o = this.ctx.createOscillator(); o.type = 'square'; o.frequency.value = baseFreq; const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1200; f.Q.value = 3;
                    o.connect(f); f.connect(vGain); vGain.gain.setValueAtTime(0, time); vGain.gain.linearRampToValueAtTime(0.5*volume, time+0.05); vGain.gain.linearRampToValueAtTime(0, time+0.3); o.start(time); o.stop(time+0.3);
                } else { 
                    const o = this.ctx.createOscillator(); o.type = 'sine'; const lfo = this.ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 5; const lfoGain = this.ctx.createGain(); lfoGain.gain.value = 10; lfo.connect(lfoGain); lfoGain.connect(o.frequency); o.frequency.value = baseFreq*2; vGain.gain.setValueAtTime(0, time); vGain.gain.linearRampToValueAtTime(0.4*volume, time+0.4); vGain.gain.linearRampToValueAtTime(0, time+1.2); o.connect(vGain); lfo.start(time); o.start(time); lfo.stop(time+1.2); o.stop(time+1.2);
                }
            } else if (color === 'blue') { 
                if (kit === 'TECHNO' || kit === 'RETRO-WAVE') { 
                    const o = this.ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = baseFreq; const ws = this.ctx.createWaveShaper(); ws.curve = new Float32Array([-1, -0.8, 0, 0.8, 1]); o.connect(ws); ws.connect(vGain); vGain.gain.setValueAtTime(0.5*volume, time); vGain.gain.exponentialRampToValueAtTime(0.01, time+0.4); o.start(time); o.stop(time+0.4);
                } else if (kit === '8-BIT') { 
                    const o = this.ctx.createOscillator(); o.type = 'square'; o.frequency.setValueAtTime(baseFreq*1.5, time); o.frequency.setValueAtTime(baseFreq*1.2, time+0.05); o.frequency.setValueAtTime(baseFreq, time+0.1); o.frequency.setValueAtTime(baseFreq*0.8, time+0.15); vGain.gain.setValueAtTime(0.4*volume, time); vGain.gain.linearRampToValueAtTime(0, time+0.25); o.connect(vGain); o.start(time); o.stop(time+0.25);
                } else if (kit === 'GLITCH-HOP') {
                    const o = this.ctx.createOscillator(); o.type = 'square'; o.frequency.value = baseFreq; const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1500; f.Q.value = 8;
                    const lfo = this.ctx.createOscillator(); lfo.type = 'square'; lfo.frequency.value = 16; const lfoG = this.ctx.createGain(); lfo.connect(lfoG); lfoG.connect(vGain.gain);
                    o.connect(f); f.connect(vGain); vGain.gain.setValueAtTime(0.5*volume, time); vGain.gain.linearRampToValueAtTime(0, time+0.4); o.start(time); lfo.start(time); o.stop(time+0.4); lfo.stop(time+0.4);
                } else if (kit === 'DEEP-DUB') {
                    const o = this.ctx.createOscillator(); o.type = 'sine'; o.frequency.value = baseFreq; const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 400; f.Q.value = 2;
                    o.connect(f); f.connect(vGain); vGain.gain.setValueAtTime(0, time); vGain.gain.linearRampToValueAtTime(0.6*volume, time+0.1); vGain.gain.linearRampToValueAtTime(0, time+0.6); o.start(time); o.stop(time+0.6);
                } else if (kit === 'AMBIENT') {
                    const o1 = this.ctx.createOscillator(); const o2 = this.ctx.createOscillator(); o1.type = 'sine'; o2.type = 'sine'; o1.frequency.value = baseFreq; o2.frequency.value = baseFreq/2; o1.connect(vGain); o2.connect(vGain); vGain.gain.setValueAtTime(0, time); vGain.gain.linearRampToValueAtTime(0.4*volume, time+0.5); vGain.gain.linearRampToValueAtTime(0, time+1.2); o1.start(time); o2.start(time); o1.stop(time+1.2); o2.stop(time+1.2);
                } else { 
                    const o1 = this.ctx.createOscillator(); const o2 = this.ctx.createOscillator(); o1.type = 'sine'; o2.type = 'sine'; o1.frequency.value = baseFreq; o2.frequency.value = baseFreq/2; o1.connect(vGain); o2.connect(vGain); vGain.gain.setValueAtTime(0, time); vGain.gain.linearRampToValueAtTime(0.5*volume, time+0.8); vGain.gain.linearRampToValueAtTime(0, time+2.0); o1.start(time); o2.start(time); o1.stop(time+2.0); o2.stop(time+2.0);
                }
            } else if (color === 'green') { 
                const nSource = this.ctx.createBufferSource(); nSource.buffer = this.noiseBuffer; const f = this.ctx.createBiquadFilter();
                if (kit === 'TECHNO' || kit === 'GLITCH-HOP') { 
                    f.type = 'highpass'; f.frequency.setValueAtTime(5000, time); f.frequency.exponentialRampToValueAtTime(1000, time+0.2); vGain.gain.setValueAtTime(0.4*volume, time); vGain.gain.exponentialRampToValueAtTime(0.01, time+0.2); nSource.connect(f); f.connect(vGain); nSource.start(time); nSource.stop(time+0.2);
                } else if (kit === '8-BIT') { 
                    f.type = 'bandpass'; f.frequency.value = 2000+(pitchIdx*200); f.Q.value = 5; vGain.gain.setValueAtTime(0.5*volume, time); vGain.gain.setValueAtTime(0, time+0.05); vGain.gain.setValueAtTime(0.5*volume, time+0.1); vGain.gain.linearRampToValueAtTime(0, time+0.15); nSource.connect(f); f.connect(vGain); nSource.start(time); nSource.stop(time+0.15);
                } else if (kit === 'RETRO-WAVE') {
                    const o = this.ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = baseFreq; f.type = 'bandpass'; f.frequency.setValueAtTime(2000, time); f.frequency.exponentialRampToValueAtTime(800, time+0.4); f.Q.value = 8; o.connect(f); f.connect(vGain); vGain.gain.setValueAtTime(0.5*volume, time); vGain.gain.exponentialRampToValueAtTime(0.01, time+0.4); o.start(time); o.stop(time+0.4);
                } else if (kit === 'DEEP-DUB') {
                    const o = this.ctx.createOscillator(); o.type = 'square'; o.frequency.value = baseFreq; f.type = 'bandpass'; f.frequency.value = 1000; f.Q.value = 4; o.connect(f); f.connect(vGain); vGain.gain.setValueAtTime(0, time); vGain.gain.linearRampToValueAtTime(0.4*volume, time+0.02); vGain.gain.linearRampToValueAtTime(0, time+0.2); o.start(time); o.stop(time+0.2);
                } else if (kit === 'AMBIENT') {
                    const o = this.ctx.createOscillator(); o.type = 'sine'; o.frequency.value = baseFreq; f.type = 'bandpass'; f.frequency.value = 800; o.connect(f); f.connect(vGain); vGain.gain.setValueAtTime(0, time); vGain.gain.linearRampToValueAtTime(0.4*volume, time+0.4); vGain.gain.linearRampToValueAtTime(0, time+0.8); o.start(time); o.stop(time+0.8);
                } else { 
                    f.type = 'bandpass'; f.frequency.setValueAtTime(400, time); f.frequency.linearRampToValueAtTime(1500, time+1.0); f.Q.value = 3; vGain.gain.setValueAtTime(0, time); vGain.gain.linearRampToValueAtTime(0.3*volume, time+0.5); vGain.gain.linearRampToValueAtTime(0, time+1.5); nSource.connect(f); f.connect(vGain); nSource.start(time); nSource.stop(time+1.5);
                }
            } else if (color === 'purple') { 
                if (kit === 'TECHNO' || kit === 'RETRO-WAVE') { 
                    const f0 = baseFreq; const f1 = baseFreq*1.25; const f2 = baseFreq*1.5; const f3 = baseFreq*1.875;
                    [f0, f1, f2, f3].forEach(f => { const o = this.ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.connect(vGain); o.start(time); o.stop(time+0.3); });
                    vGain.gain.setValueAtTime(0.2*volume, time); vGain.gain.exponentialRampToValueAtTime(0.01, time+0.3);
                } else if (kit === '8-BIT') { 
                    const o = this.ctx.createOscillator(); o.type = 'square'; const f0 = baseFreq; const f1 = baseFreq*1.25; const f2 = baseFreq*1.5; const spd = 0.03;
                    o.frequency.setValueAtTime(f0, time); o.frequency.setValueAtTime(f1, time+spd); o.frequency.setValueAtTime(f2, time+spd*2); o.frequency.setValueAtTime(f0, time+spd*3); o.frequency.setValueAtTime(f1, time+spd*4); o.frequency.setValueAtTime(f2, time+spd*5);
                    vGain.gain.setValueAtTime(0.3*volume, time); vGain.gain.linearRampToValueAtTime(0, time+0.2); o.connect(vGain); o.start(time); o.stop(time+0.2);
                } else if (kit === 'GLITCH-HOP') {
                    const o = this.ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(baseFreq, time); o.frequency.exponentialRampToValueAtTime(baseFreq/4, time+0.6);
                    const ws = this.ctx.createWaveShaper(); ws.curve = this.distortionCurve; o.connect(ws); ws.connect(vGain); vGain.gain.setValueAtTime(0.5*volume, time); vGain.gain.linearRampToValueAtTime(0, time+0.6); o.start(time); o.stop(time+0.6);
                } else if (kit === 'DEEP-DUB') {
                    const o = this.ctx.createOscillator(); o.type = 'square'; o.frequency.value = baseFreq; const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.setValueAtTime(1500, time); f.frequency.exponentialRampToValueAtTime(500, time+1.2); f.Q.value = 6;
                    o.connect(f); f.connect(vGain); vGain.gain.setValueAtTime(0, time); vGain.gain.linearRampToValueAtTime(0.5*volume, time+0.1); vGain.gain.linearRampToValueAtTime(0, time+1.2); o.start(time); o.stop(time+1.2);
                } else if (kit === 'AMBIENT') {
                    const o1 = this.ctx.createOscillator(); const o2 = this.ctx.createOscillator(); o1.type = 'sine'; o2.type = 'sine'; o1.frequency.value = baseFreq; o2.frequency.value = baseFreq*1.5; o1.connect(vGain); o2.connect(vGain); vGain.gain.setValueAtTime(0, time); vGain.gain.linearRampToValueAtTime(0.3*volume, time+0.8); vGain.gain.linearRampToValueAtTime(0, time+1.5); o1.start(time); o2.start(time); o1.stop(time+1.5); o2.stop(time+1.5);
                } else { 
                    const o1 = this.ctx.createOscillator(); const o2 = this.ctx.createOscillator(); o1.type = 'sine'; o2.type = 'sine'; o1.frequency.value = baseFreq; o2.frequency.value = baseFreq*1.5; o1.connect(vGain); o2.connect(vGain);
                    vGain.gain.setValueAtTime(0, time); vGain.gain.linearRampToValueAtTime(0.4*volume, time+1.0); vGain.gain.linearRampToValueAtTime(0, time+3.0); o1.start(time); o2.start(time); o1.stop(time+3.0); o2.stop(time+3.0);
                }
            }
        }
        
        setTimeout(() => { try { osc.disconnect(); filter.disconnect(); gain.disconnect(); } catch(e){} }, 3000);
    }
}