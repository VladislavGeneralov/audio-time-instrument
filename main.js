let ctx;
let micStream;
let source;

let recorderNode;
let recordedBuffer = null;

let outputGain;
let inputGain;

let mediaRecorder;
let chunks = [];

const MAX_DURATION = 10; // seconds
let recordingTimeout = null;

// -------------------------
// INIT AUDIO
// -------------------------
async function initAudio() {
  if (ctx) return;

  ctx = new (window.AudioContext || window.webkitAudioContext)();

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false
    }
  });

  micStream = stream;

  source = ctx.createMediaStreamSource(stream);

  inputGain = ctx.createGain();
  inputGain.gain.value = 1.0;

  outputGain = ctx.createGain();
  outputGain.gain.value = 0.8;

  source.connect(inputGain);
  inputGain.connect(outputGain);
  outputGain.connect(ctx.destination);
}

// -------------------------
// RECORD USING MEDIARECORDER
// -------------------------
function startRecording() {
  chunks = [];
  recordedBuffer = null;

  const stream = micStream;

  mediaRecorder = new MediaRecorder(stream);

  mediaRecorder.ondataavailable = (e) => {
    chunks.push(e.data);
  };

  mediaRecorder.onstop = async () => {
    const blob = new Blob(chunks, { type: "audio/webm" });
    const arrayBuffer = await blob.arrayBuffer();

    recordedBuffer = await ctx.decodeAudioData(arrayBuffer);

    playBuffer();
  };

  mediaRecorder.start();

  // safety stop
  recordingTimeout = setTimeout(() => {
    if (mediaRecorder && mediaRecorder.state === "recording") {
      mediaRecorder.stop();
    }
  }, MAX_DURATION * 1000);
}

// -------------------------
// STOP RECORDING
// -------------------------
function stopRecording() {
  if (recordingTimeout) {
    clearTimeout(recordingTimeout);
    recordingTimeout = null;
  }

  if (mediaRecorder && mediaRecorder.state === "recording") {
    mediaRecorder.stop();
  }
}

// -------------------------
// PLAYBACK
// -------------------------
function playBuffer() {
  if (!recordedBuffer) return;

  const src = ctx.createBufferSource();
  src.buffer = recordedBuffer;

  const gain = ctx.createGain();
  gain.gain.value = outputGain.gain.value;

  src.connect(gain);
  gain.connect(ctx.destination);

  src.start();
}

// -------------------------
// UI
// -------------------------
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