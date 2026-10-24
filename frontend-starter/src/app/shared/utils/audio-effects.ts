/**
 * Builds the impulse response of a synthetic room: stereo white noise whose
 * amplitude decays to silence. Convolving a sound with it adds a reverb tail.
 */
export function createImpulse(context: BaseAudioContext, seconds = 2.5, decay = 3): AudioBuffer {
  const length = Math.max(1, Math.floor(context.sampleRate * seconds));
  const buffer = context.createBuffer(2, length, context.sampleRate);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
  }
  return buffer;
}

/**
 * Routes an <audio> element through a dry/wet reverb.
 * An element can only be connected once to the Web Audio API: a new chain is
 * needed for each element, and the element stays silent once its chain is closed.
 */
export class ReverbChain {
  private readonly context = new AudioContext();
  private readonly dry = this.context.createGain();
  private readonly wet = this.context.createGain();

  constructor(readonly element: HTMLMediaElement) {
    const source = this.context.createMediaElementSource(element);
    const convolver = this.context.createConvolver();
    convolver.buffer = createImpulse(this.context);
    source.connect(this.dry).connect(this.context.destination);
    source.connect(convolver).connect(this.wet).connect(this.context.destination);
    this.setMix(0);
  }

  /** 0 = original sound, 1 = maximum reverb (the dry signal is lowered to keep the level stable). */
  setMix(mix: number): void {
    this.dry.gain.value = 1 - mix * 0.5;
    this.wet.gain.value = mix;
    // The context starts suspended when it is created without a user gesture.
    if (this.context.state === 'suspended') void this.context.resume();
  }

  close(): void {
    void this.context.close();
  }
}
