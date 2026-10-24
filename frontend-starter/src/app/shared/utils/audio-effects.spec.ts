import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createImpulse, ReverbChain } from './audio-effects';

/** Minimal audio node: connect() returns its target so calls can be chained. */
const node = () => ({ connect: vi.fn((target: unknown) => target), gain: { value: 1 }, buffer: null as unknown });

/** jsdom ne fournit pas la Web Audio API : ce faux contexte garde la trace des nœuds créés. */
class FakeAudioContext {
  static last: FakeAudioContext;
  sampleRate = 100;
  state = 'suspended';
  destination = node();
  source = node();
  convolver = node();
  gains: ReturnType<typeof node>[] = [];
  resume = vi.fn(async () => undefined);
  close = vi.fn(async () => undefined);
  createMediaElementSource = vi.fn(() => this.source);
  createConvolver = vi.fn(() => this.convolver);
  createGain = vi.fn(() => {
    const gain = node();
    this.gains.push(gain);
    return gain;
  });
  createBuffer = (channels: number, length: number) => {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { numberOfChannels: channels, length, getChannelData: (i: number) => data[i] };
  };
  constructor() {
    FakeAudioContext.last = this;
  }
}

describe('createImpulse', () => {
  it('crée un bruit stéréo de la durée demandée qui décroît jusqu’au silence', () => {
    const buffer = createImpulse(new FakeAudioContext() as unknown as BaseAudioContext, 2, 3);
    expect(buffer.numberOfChannels).toBe(2);
    expect(buffer.length).toBe(200);
    const data = buffer.getChannelData(0);
    const energy = (from: number, to: number) => data.slice(from, to).reduce((sum, v) => sum + Math.abs(v), 0);
    expect(energy(0, 50)).toBeGreaterThan(energy(150, 200));
    expect(Math.max(...data.map(Math.abs))).toBeLessThanOrEqual(1);
  });
});

describe('ReverbChain', () => {
  beforeEach(() => vi.stubGlobal('AudioContext', FakeAudioContext));
  afterEach(() => vi.unstubAllGlobals());

  it('envoie l’élément vers un signal direct et un signal réverbéré', () => {
    const element = document.createElement('audio');
    const chain = new ReverbChain(element);
    const context = FakeAudioContext.last;
    const [dry, wet] = context.gains;

    expect(chain.element).toBe(element);
    expect(context.createMediaElementSource).toHaveBeenCalledWith(element);
    expect(context.source.connect).toHaveBeenCalledWith(dry);
    expect(context.source.connect).toHaveBeenCalledWith(context.convolver);
    expect(context.convolver.connect).toHaveBeenCalledWith(wet);
    expect(dry.connect).toHaveBeenCalledWith(context.destination);
    expect(wet.connect).toHaveBeenCalledWith(context.destination);
    expect(context.convolver.buffer).not.toBeNull();
    // Sans réglage, le son reste intact.
    expect(dry.gain.value).toBe(1);
    expect(wet.gain.value).toBe(0);
  });

  it('dose la reverb et relance un contexte suspendu', () => {
    const chain = new ReverbChain(document.createElement('audio'));
    const context = FakeAudioContext.last;
    const [dry, wet] = context.gains;
    context.resume.mockClear();

    chain.setMix(1);
    expect(dry.gain.value).toBe(0.5);
    expect(wet.gain.value).toBe(1);
    expect(context.resume).toHaveBeenCalled();

    context.state = 'running';
    context.resume.mockClear();
    chain.setMix(0.4);
    expect(wet.gain.value).toBe(0.4);
    expect(context.resume).not.toHaveBeenCalled();
  });

  it('ferme le contexte audio', () => {
    new ReverbChain(document.createElement('audio')).close();
    expect(FakeAudioContext.last.close).toHaveBeenCalled();
  });
});
