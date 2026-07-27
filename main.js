const MAX_DURATION = 10;
const SCHEDULER_LOOKAHEAD = 0.05;
const MIN_SCHEDULING_GAP = 0.01;

// -------------------------
// SHARED AUDIO CONTEXT + MIX BUS
// -------------------------
let sharedCtx = null;
let masterMix = null;

function getSharedContext() {
  if (!sharedCtx) {
    sharedCtx = new (window.AudioContext || window.webkitAudioContext)();
    masterMix = sharedCtx.createGain();
    masterMix.gain.value = 1;
    masterMix.connect(sharedCtx.destination);
  }
  return sharedCtx;
}

// -------------------------
// PLAYER
// -------------------------
class Player {
  constructor(root, index) {
    this.root = root;
    this.index = index;

    this.micStream = null;
    this.mediaRecorder = null;
    this.chunks = [];
    this.recordingTimeout = null;

    this.bufferGains = [];
    this.outputGain = null;

    this.Ramp = 0;
    this.speedall = 1;
    this.speedslow = 0.5;

    this.buffers = [];
    this.buffersRev = [];

    this.activeSources = [];
    this.bufferOrder = [0, 1, 2, 3];

    this.isPlaying = false;
    this.step16 = 0;
    this.macroCounter = 0;
    this.nextTick = 0;

    this.shuffleEnabled = false;
    this.octaveDownEnabled = false;
    this.octaveDownGain = 0.5;
    this.reverseProbability = 0.5;

    this.bindControls();
  }

  bindControls() {
    const q = (role) => this.root.querySelector(`[data-role="${role}"]`);

    this.els = {
      start: q("start"),
      stop: q("stop"),
      volume: q("volume"),
      shuffle: q("shuffle"),
      octaveDownToggle: q("octaveDownToggle"),
      octaveDownFader: q("octaveDownFader"),
      reverseProbabilityFader: q("reverseProbabilityFader"),
      title: q("player-title")
    };

    if (this.els.title) {
      this.els.title.textContent = `Player ${this.index + 1}`;
    }

    this.els.start.onclick = async () => {
      await this.initAudio();
      this.startRecording();
    };

    this.els.stop.onclick = () => {
      this.stopRecording();
    };

    this.els.volume.oninput = (e) => {
      const v = parseFloat(e.target.value);
      if (this.outputGain) this.outputGain.gain.value = v;
    };

    this.els.shuffle.onchange = (e) => {
      this.shuffleEnabled = e.target.checked;
    };

    this.els.octaveDownToggle.onchange = (e) => {
      this.octaveDownEnabled = e.target.checked;
    };

    this.els.octaveDownFader.oninput = (e) => {
      this.octaveDownGain = parseFloat(e.target.value);
    };

    this.els.reverseProbabilityFader.oninput = (e) => {
      this.reverseProbability = parseFloat(e.target.value);
    };
  }

  // -------------------------
  // INIT AUDIO
  // -------------------------
  async initAudio() {
    if (this.outputGain) return;

    const ctx = getSharedContext();

    this.micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      }
    });

    this.outputGain = ctx.createGain();
    this.outputGain.gain.value = 1;
    this.outputGain.connect(masterMix);

    this.bufferGains = [];

    for (let i = 0; i < 4; i++) {
      const g = ctx.createGain();
      g.gain.value = 1;
      g.connect(this.outputGain);
      this.bufferGains.push(g);
    }
  }

  // -------------------------
  // STOP ALL
  // -------------------------
  hardStopAll() {
    this.activeSources.forEach((src) => {
      try {
        src.onended = null;
        src.stop();
      } catch (e) {
        // ignore already stopped sources
      }
    });

    this.activeSources = [];
    this.isPlaying = false;
    this.macroCounter = 0;
    this.nextTick = 0;
  }

  createSourceNode() {
    const ctx = sharedCtx;
    if (!ctx) return null;

    const source = ctx.createBufferSource();
    this.activeSources.push(source);

    source.onended = () => {
      this.activeSources = this.activeSources.filter((node) => node !== source);
      source.disconnect();
    };

    return source;
  }

  // -------------------------
  // RECORD
  // -------------------------
  startRecording() {
    if (!this.micStream || !sharedCtx) return;

    this.hardStopAll();

    this.chunks = [];
    this.buffers = [];

    this.mediaRecorder = new MediaRecorder(this.micStream);

    this.mediaRecorder.ondataavailable = (e) => {
      this.chunks.push(e.data);
    };

    this.mediaRecorder.onstop = async () => {
      const blob = new Blob(this.chunks, { type: "audio/webm" });
      const arrayBuffer = await blob.arrayBuffer();

      const ctx = sharedCtx;
      const recordedBuffer = await ctx.decodeAudioData(arrayBuffer);

      const res = this.splitInto4Buffers(recordedBuffer);

      this.buffers = res.buffers;

      this.buffersRev = this.buffers.map((buf) => {
        const reversed = ctx.createBuffer(
          buf.numberOfChannels,
          buf.length,
          buf.sampleRate
        );

        for (let ch = 0; ch < buf.numberOfChannels; ch++) {
          const data = buf.getChannelData(ch);
          const rev = new Float32Array(data.length);

          for (let i = 0; i < data.length; i++) {
            rev[i] = data[data.length - 1 - i];
          }

          reversed.copyToChannel(rev, ch, 0);
        }

        return reversed;
      });

      this.step16 = res.stride / 4;
      this.Ramp = this.step16 * 4;

      this.startPlayback();
    };

    this.mediaRecorder.start();

    this.recordingTimeout = setTimeout(() => {
      if (this.mediaRecorder?.state === "recording") {
        this.mediaRecorder.stop();
      }
    }, MAX_DURATION * 1000);
  }

  // -------------------------
  // STOP RECORD
  // -------------------------
  stopRecording() {
    if (this.recordingTimeout) {
      clearTimeout(this.recordingTimeout);
      this.recordingTimeout = null;
    }

    if (this.mediaRecorder?.state === "recording") {
      this.mediaRecorder.stop();
    }
  }

  // -------------------------
  // SPLIT 4 BUFFERS (50% overlap)
  // -------------------------
  splitInto4Buffers(audioBuffer) {
    const ctx = sharedCtx;
    const T = audioBuffer.length;
    const N = 4;

    const L = Math.floor((2 * T) / (N + 1));
    const S = Math.floor(L / 2);

    const result = [];

    for (let i = 0; i < N; i++) {
      const start = i * S;
      const end = start + L;

      const s = Math.max(0, start);
      const e = Math.min(T, end);

      const len = e - s;

      const buf = ctx.createBuffer(
        audioBuffer.numberOfChannels,
        len,
        audioBuffer.sampleRate
      );

      for (let ch = 0; ch < audioBuffer.numberOfChannels; ch++) {
        const data = audioBuffer.getChannelData(ch).subarray(s, e);
        buf.copyToChannel(data, ch, 0);
      }

      result.push(buf);
    }

    return {
      buffers: result,
      stride: S / audioBuffer.sampleRate
    };
  }

  // -------------------------
  // START / STOP PLAYBACK
  // -------------------------
  startPlayback() {
    if (!this.buffers.length) return;

    this.isPlaying = true;
    this.macroCounter = 15;

    if (this.shuffleEnabled) {
      this.shuffleOrder();
    }

    this.nextTick = sharedCtx.currentTime + MIN_SCHEDULING_GAP;
  }

  stopPlayback() {
    this.isPlaying = false;
  }

  // -------------------------
  // CLOCK TICK (step16 engine)
  // -------------------------
  tick(now) {
    if (!this.isPlaying || !this.step16) return;

    while (this.nextTick < now + SCHEDULER_LOOKAHEAD) {
      const scheduledTime = this.nextTick;
      this.nextTick += this.step16;

      if (scheduledTime < now) {
        this.nextTick = Math.max(this.nextTick, now + this.step16);
      }

      this.macroCounter++;
      if (this.macroCounter >= 16) {
        this.macroCounter = 0;
      }

      if (this.macroCounter === 0) {
        if (this.shuffleEnabled) {
          this.shuffleOrder();
        } else {
          this.bufferOrder = [0, 1, 2, 3];
        }
      }

      const triggerTime = Math.max(scheduledTime, now + MIN_SCHEDULING_GAP);

      if (this.macroCounter === 0) {
        const g = this.bufferGains[0];
        this.playIndex(this.bufferOrder[0], triggerTime);
        if (this.octaveDownEnabled) {
          this.playIndexSlow(this.bufferOrder[0], triggerTime, this.octaveDownGain);
        }
        g.gain.linearRampToValueAtTime(1, triggerTime + this.Ramp);
      }

      if (this.macroCounter === 2) {
        const g = this.bufferGains[3];
        g.gain.linearRampToValueAtTime(0, triggerTime + this.Ramp);
      }

      if (this.macroCounter === 4) {
        const g = this.bufferGains[1];
        this.playIndex(this.bufferOrder[1], triggerTime);
        if (this.octaveDownEnabled) {
          this.playIndexSlow(this.bufferOrder[1], triggerTime, this.octaveDownGain);
        }
        g.gain.linearRampToValueAtTime(1, triggerTime + this.Ramp);
      }

      if (this.macroCounter === 6) {
        const g = this.bufferGains[0];
        g.gain.linearRampToValueAtTime(0, triggerTime + this.Ramp);
      }

      if (this.macroCounter === 8) {
        const g = this.bufferGains[2];
        this.playIndex(this.bufferOrder[2], triggerTime);
        if (this.octaveDownEnabled) {
          this.playIndexSlow(this.bufferOrder[2], triggerTime, this.octaveDownGain);
        }
        g.gain.linearRampToValueAtTime(1, triggerTime + this.Ramp);
      }

      if (this.macroCounter === 10) {
        const g = this.bufferGains[1];
        g.gain.linearRampToValueAtTime(0, triggerTime + this.Ramp);
      }

      if (this.macroCounter === 12) {
        const g = this.bufferGains[3];
        this.playIndex(this.bufferOrder[3], triggerTime);
        if (this.octaveDownEnabled) {
          this.playIndexSlow(this.bufferOrder[3], triggerTime, this.octaveDownGain);
        }
        g.gain.linearRampToValueAtTime(1, triggerTime + this.Ramp);
      }

      if (this.macroCounter === 14) {
        const g = this.bufferGains[2];
        g.gain.linearRampToValueAtTime(0, triggerTime + this.Ramp);
      }
    }
  }

  // -------------------------
  // PLAY BUFFER
  // -------------------------
  playIndex(i, time) {
    if (!this.buffers[i]) return;

    const isReverse = Math.random() < this.reverseProbability;
    const src = this.createSourceNode();

    if (!src) return;

    src.buffer = isReverse ? this.buffersRev[i] : this.buffers[i];

    src.playbackRate.value = this.speedall;

    src.connect(this.bufferGains[i]);

    src.start(time);
  }

  playIndexSlow(i, time, gainValue = 1) {
    if (!this.buffers[i]) return;

    const isReverse = Math.random() < this.reverseProbability;
    const src = this.createSourceNode();

    if (!src) return;

    src.buffer = isReverse ? this.buffersRev[i] : this.buffers[i];

    src.playbackRate.value = this.speedslow;

    const octaveGainNode = sharedCtx.createGain();
    octaveGainNode.gain.value = gainValue;
    octaveGainNode.connect(this.bufferGains[i]);
    src.connect(octaveGainNode);

    src.start(time);
  }

  shuffleOrder() {
    for (let i = this.bufferOrder.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.bufferOrder[i], this.bufferOrder[j]] = [this.bufferOrder[j], this.bufferOrder[i]];
    }
  }
}

// -------------------------
// BOOTSTRAP: 4 independent players
// -------------------------
const PLAYER_COUNT = 4;
const players = [];

const template = document.getElementById("player-template");
const container = document.getElementById("players");

for (let i = 0; i < PLAYER_COUNT; i++) {
  const node = template.content.firstElementChild.cloneNode(true);
  container.appendChild(node);
  players.push(new Player(node, i));
}

// -------------------------
// SHARED CLOCK DRIVER
// -------------------------
function rafLoop() {
  if (sharedCtx) {
    const now = sharedCtx.currentTime;
    players.forEach((p) => p.tick(now));
  }
  requestAnimationFrame(rafLoop);
}

requestAnimationFrame(rafLoop);

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && sharedCtx) {
    players.forEach((p) => {
      p.macroCounter = 0;
      p.nextTick = sharedCtx.currentTime + MIN_SCHEDULING_GAP;
    });
  }
});
