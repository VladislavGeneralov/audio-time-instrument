let ctx;
let input;
let output;

document.getElementById("start").onclick = async () => {
  ctx = new (window.AudioContext || window.webkitAudioContext)();

  // ---------------------------
  // MIC INPUT
  // ---------------------------
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false
    }
  });

  input = ctx.createMediaStreamSource(stream);

  output = ctx.createGain();
  output.gain.value = 0.9;

  // ---------------------------
  // DRY/WET MIX
  // ---------------------------
  const dry = ctx.createGain();
  dry.gain.value = 0.6;

  const wet = ctx.createGain();
  wet.gain.value = 0.6;

  input.connect(dry);
  dry.connect(output);

  // ---------------------------
  // SIMPLE SCHROEDER REVERB
  // ---------------------------
  function comb(delayTime, feedbackGain) {
    const delay = ctx.createDelay();
    delay.delayTime.value = delayTime;

    const feedback = ctx.createGain();
    feedback.gain.value = feedbackGain;

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 3000;

    delay.connect(filter);
    filter.connect(feedback);
    feedback.connect(delay);

    return delay;
  }

  const comb1 = comb(0.0297, 0.805);
  const comb2 = comb(0.0371, 0.827);
  const comb3 = comb(0.0411, 0.783);
  const comb4 = comb(0.0437, 0.764);

  const mix = ctx.createGain();
  mix.gain.value = 0.5;

  input.connect(comb1);
  input.connect(comb2);
  input.connect(comb3);
  input.connect(comb4);

  comb1.connect(mix);
  comb2.connect(mix);
  comb3.connect(mix);
  comb4.connect(mix);

  // ---------------------------
  // ALLPASS (diffusion)
  // ---------------------------
  function allpass(time) {
    const delay = ctx.createDelay();
    delay.delayTime.value = time;

    const feedback = ctx.createGain();
    feedback.gain.value = 0.5;

    delay.connect(feedback);
    feedback.connect(delay);

    return delay;
  }

  const ap1 = allpass(0.005);
  const ap2 = allpass(0.0017);

  mix.connect(ap1);
  ap1.connect(ap2);

  ap2.connect(wet);
  wet.connect(output);

  // output to speakers
  output.connect(ctx.destination);

  console.log("Audio started");
};