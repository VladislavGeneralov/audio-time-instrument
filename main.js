let ctx;
let micStream;

let shuffleEnabled = false;

let mediaRecorder;
let chunks = [];
let bufferGains = [];

let outputGain;

let Ramp=0;

let speedall=1;
let speedslow=0.5;

let revprob=0.5;
let recordingTimeout = null;

let buffers = [];
let buffersRev = [];

let activeSources = [];

let bufferOrder = [0, 1, 2, 3];

let isPlaying = false;

let index = 0;

let step16 = 0;
let macroCounter = 0;
let nextTick = 0;

const MAX_DURATION = 10;


// -------------------------
// INIT AUDIO
// -------------------------
async function initAudio() {
  if (ctx) return;

  ctx = new (window.AudioContext || window.webkitAudioContext)();

  micStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false
    } 
  }
);

outputGain = ctx.createGain();
outputGain.gain.value = 1;
outputGain.connect(ctx.destination);

bufferGains = [];

for (let i = 0; i < 4; i++) {
  const g = ctx.createGain();
  g.gain.value = 1;
  g.connect(outputGain);
  bufferGains.push(g);
}

  loop();
}

// -------------------------
// RECORD STOP ALL
// -------------------------
function hardStopAll() {

  activeSources.forEach(src => {
    try {
      src.stop();
    } catch (e) {
      // ignore already stopped sources
    }
  });

  activeSources = [];
  isPlaying = false;
  index = 0;
  macroCounter = 0;
  nextTick = 0;
}

// -------------------------
// RECORD
// -------------------------
function startRecording() {
  if (!micStream || !ctx) return;

  hardStopAll();

  chunks = [];
  buffers = [];

  mediaRecorder = new MediaRecorder(micStream);

  mediaRecorder.ondataavailable = (e) => {
    chunks.push(e.data);
  };

  mediaRecorder.onstop = async () => {
    const blob = new Blob(chunks, { type: "audio/webm" });
    const arrayBuffer = await blob.arrayBuffer();

    const recordedBuffer = await ctx.decodeAudioData(arrayBuffer);

    const res = splitInto4Buffers(recordedBuffer);

    buffers = res.buffers;

    buffersRev = buffers.map(buf => {
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


    step16 = res.stride / 4;
    Ramp=step16*4;

    startPlayback();
  };

  mediaRecorder.start();

  recordingTimeout = setTimeout(() => {
    if (mediaRecorder?.state === "recording") {
      mediaRecorder.stop();
    }
  }, MAX_DURATION * 1000);
}

// -------------------------
// STOP RECORD
// -------------------------
function stopRecording() {
  if (recordingTimeout) {
    clearTimeout(recordingTimeout);
    recordingTimeout = null;
  }

  if (mediaRecorder?.state === "recording") {
    mediaRecorder.stop();
  }
}

// -------------------------
// SPLIT 4 BUFFERS (50% overlap)
// -------------------------
function splitInto4Buffers(audioBuffer) {
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
// START PLAYBACK
// -------------------------
function startPlayback() {
  if (!buffers.length) return;

  isPlaying = true;

  index = 0;
  macroCounter = 15;

  if (shuffleEnabled) {
    shuffleOrder();
  }

  nextTick = ctx.currentTime;
}

// -------------------------
// STOP PLAYBACK
// -------------------------
function stopPlayback() {
  isPlaying = false;
}

// -------------------------
// CLOCK LOOP (step16 engine)
// -------------------------
function loop() {
  const now = ctx.currentTime;

  if (isPlaying) {
    while (now >= nextTick) {

      nextTick += step16;
      macroCounter++;
      if (macroCounter>=16) {macroCounter=0};

if (macroCounter === 0) {

  if (shuffleEnabled) {
    shuffleOrder();
  } else {
    bufferOrder = [0,1,2,3];
  }

}

if (macroCounter === 0) {
  const g = bufferGains[0];
  playIndex(bufferOrder[0], nextTick);
  playIndexSlow(bufferOrder[0], nextTick);
  g.gain.linearRampToValueAtTime(1, nextTick + Ramp);
}

if (macroCounter === 2) {
  const g = bufferGains[3];
  g.gain.linearRampToValueAtTime(0, nextTick + Ramp);
}

if (macroCounter === 4) {
  const g = bufferGains[1];
   playIndex(bufferOrder[1], nextTick);
   playIndexSlow(bufferOrder[1], nextTick);
  g.gain.linearRampToValueAtTime(1, nextTick + Ramp);
}

if (macroCounter === 6) {
  const g = bufferGains[0];
  g.gain.linearRampToValueAtTime(0, nextTick + Ramp);
}

if (macroCounter === 8) {
  const g = bufferGains[2];
  playIndex(bufferOrder[2], nextTick);
  playIndexSlow(bufferOrder[2], nextTick);
  g.gain.linearRampToValueAtTime(1, nextTick + Ramp);
}

if (macroCounter === 10) {
  const g = bufferGains[1];
  g.gain.linearRampToValueAtTime(0, nextTick + Ramp);
}

if (macroCounter === 12) {
  const g = bufferGains[3];
  playIndex(bufferOrder[3], nextTick);
  playIndexSlow(bufferOrder[3], nextTick);
  g.gain.linearRampToValueAtTime(1, nextTick + Ramp);
}

if (macroCounter === 14) {
  const g = bufferGains[2];
  g.gain.linearRampToValueAtTime(0, nextTick + Ramp);
}
  }
}

  requestAnimationFrame(loop);
}

// -------------------------
// PLAY BUFFER
// -------------------------
function playIndex(i, time) {
  if (!buffers[i]) return;

  const isReverse = Math.random() < revprob;

  const src = ctx.createBufferSource();

  activeSources.push(src); // 
src.onended = () => {
  activeSources = activeSources.filter(s => s !== src);
}; 

  src.buffer = isReverse ? buffersRev[i] : buffers[i];

  src.playbackRate.value = speedall;

  src.connect(bufferGains[i]);

  src.start(time);
}

function playIndexSlow(i, time) {
  if (!buffers[i]) return;

  const isReverse = Math.random() < revprob;

  const src = ctx.createBufferSource();

  activeSources.push(src); // 
src.onended = () => {
  activeSources = activeSources.filter(s => s !== src);
}; 

  src.buffer = isReverse ? buffersRev[i] : buffers[i];

  src.playbackRate.value = speedslow;

  src.connect(bufferGains[i]);

  src.start(time);
}

// -------------------------
// UI
// -------------------------

document.getElementById("shuffle").onchange = (e) => {
  shuffleEnabled = e.target.checked;
};

document.getElementById("start").onclick = async () => {
  await initAudio();
  startRecording();
};

document.getElementById("stop").onclick = () => {
  stopRecording();
};

document.getElementById("volume").oninput = (e) => {
  const v = parseFloat(e.target.value);
  if (outputGain) outputGain.gain.value = v;
};

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {

    index = 0;
    macroCounter = 0;

    nextTick = ctx.currentTime;
  }
});

function shuffleOrder() {
  for (let i = bufferOrder.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [bufferOrder[i], bufferOrder[j]] = [bufferOrder[j], bufferOrder[i]];
  }
}