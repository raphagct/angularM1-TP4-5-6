import { Component, DestroyRef, ElementRef, inject, input, viewChild } from '@angular/core';

@Component({
  selector: 'app-audio-spectrum',
  templateUrl: './audio-spectrum.html',
  styleUrl: './audio-spectrum.css',
})
export class AudioSpectrumComponent {
  readonly src = input.required<string>();
  readonly title = input.required<string>();
  private readonly audio = viewChild.required<ElementRef<HTMLAudioElement>>('audio');
  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly destroyRef = inject(DestroyRef);
  private context?: AudioContext;
  private analyser?: AnalyserNode;
  private frame = 0;

  constructor() {
    this.destroyRef.onDestroy(() => {
      cancelAnimationFrame(this.frame);
      void this.context?.close();
    });
  }

  async onPlay(): Promise<void> {
    if (!this.context) {
      this.context = new AudioContext();
      this.analyser = this.context.createAnalyser();
      this.analyser.fftSize = 256;
      const source = this.context.createMediaElementSource(this.audio().nativeElement);
      source.connect(this.analyser);
      this.analyser.connect(this.context.destination);
    }
    await this.context.resume();
    this.draw();
  }

  onPause(): void { cancelAnimationFrame(this.frame); }

  private draw(): void {
    const canvas = this.canvas().nativeElement;
    const context = canvas.getContext('2d');
    if (!context || !this.analyser) return;
    const values = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteFrequencyData(values);
    context.clearRect(0, 0, canvas.width, canvas.height);
    const bars = 48;
    const width = canvas.width / bars;
    for (let index = 0; index < bars; index++) {
      const level = values[index] / 255;
      const height = Math.max(2, level * canvas.height);
      context.fillStyle = '#65d4a8';
      context.fillRect(index * width + 1, canvas.height - height, width - 2, height);
    }
    this.frame = requestAnimationFrame(() => this.draw());
  }
}
