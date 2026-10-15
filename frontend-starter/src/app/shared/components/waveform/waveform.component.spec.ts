import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WaveformComponent } from './waveform.component';

describe('WaveformComponent', () => {
  let fixture: ComponentFixture<WaveformComponent>;
  let component: WaveformComponent;
  let host: HTMLElement;
  let canvas: HTMLCanvasElement;
  const ctx = { clearRect: vi.fn(), fillRect: vi.fn(), setTransform: vi.fn(), fillStyle: '', globalAlpha: 1 };
  let resizeCallback: ResizeObserverCallback | undefined;
  const disconnect = vi.fn();

  beforeEach(() => {
    Object.values(ctx).forEach((value) => typeof value === 'function' && value.mockClear());
    disconnect.mockClear();
    // jsdom ne dessine pas : on remplace le contexte 2D et le ResizeObserver.
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          resizeCallback = callback;
        }
        observe = vi.fn();
        disconnect = disconnect;
      },
    );

    fixture = TestBed.createComponent(WaveformComponent);
    component = fixture.componentInstance;
    host = fixture.nativeElement;
    fixture.componentRef.setInput('peaks', [1, 0.5, 0.25, 1]);
    fixture.componentRef.setInput('duration', 200);
    fixture.detectChanges();
    canvas = host.querySelector('canvas')!;
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 400 } as DOMRect);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const resize = (width: number) => {
    resizeCallback?.([{ contentRect: { width } } as ResizeObserverEntry], {} as ResizeObserver);
    fixture.detectChanges();
  };

  it('ne dessine rien tant que la largeur est inconnue', () => {
    expect(ctx.fillRect).not.toHaveBeenCalled();
  });

  it('dessine les barres quand le ResizeObserver donne une largeur', () => {
    resize(400);
    expect(component.width()).toBe(400);
    expect(canvas.height).toBe(96);
    expect(ctx.setTransform).toHaveBeenCalled();
    expect(component.bars()).toHaveLength(100);
    expect(ctx.fillRect).toHaveBeenCalledTimes(200);
  });

  it('colore progressivement les barres jouées', () => {
    resize(400);
    expect(component.bars().filter((c) => c.includes('145)'))).toHaveLength(0);

    fixture.componentRef.setInput('progress', 0.25);
    fixture.detectChanges();
    expect(component.bars().filter((c) => c === 'oklch(0.75 0.2 145)')).toHaveLength(25);

    fixture.componentRef.setInput('progress', 1);
    fixture.detectChanges();
    expect(component.bars().every((c) => c === 'oklch(0.75 0.2 145)')).toBe(true);
  });

  it('émet la position cliquée', () => {
    const seek = vi.fn();
    component.seek.subscribe(seek);
    canvas.dispatchEvent(new MouseEvent('click', { clientX: 100 }));
    expect(seek).toHaveBeenCalledWith(0.25);
  });

  it('affiche le temps survolé et le retire en sortant', () => {
    canvas.dispatchEvent(new MouseEvent('pointermove', { clientX: 200 }));
    fixture.detectChanges();
    const tooltip = host.querySelector('.tooltip') as HTMLElement;
    expect(component.hover()).toBe(0.5);
    expect(tooltip.textContent).toBe('1:40');
    expect(tooltip.style.left).toBe('50%');

    canvas.dispatchEvent(new MouseEvent('pointerleave'));
    fixture.detectChanges();
    expect(host.querySelector('.tooltip')).toBeNull();
  });

  it('avance et recule de 5 % au clavier, sans sortir de 0..1', () => {
    const seek = vi.fn();
    component.seek.subscribe(seek);
    fixture.componentRef.setInput('progress', 0.98);
    fixture.detectChanges();

    host.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    expect(seek).toHaveBeenLastCalledWith(1);
    host.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    expect(seek.mock.lastCall?.[0]).toBeCloseTo(0.93);
  });

  it('expose un slider accessible', () => {
    fixture.componentRef.setInput('progress', 0.5);
    fixture.detectChanges();
    expect(host.getAttribute('role')).toBe('slider');
    expect(host.getAttribute('tabindex')).toBe('0');
    expect(host.getAttribute('aria-valuemax')).toBe('200');
    expect(host.getAttribute('aria-valuenow')).toBe('100');
    expect(host.getAttribute('aria-valuetext')).toBe('1:40');
  });

  it('applique la hauteur demandée', () => {
    fixture.componentRef.setInput('height', 64);
    fixture.detectChanges();
    expect(canvas.style.height).toBe('64px');
  });

  it('déconnecte le ResizeObserver à la destruction', () => {
    fixture.destroy();
    expect(disconnect).toHaveBeenCalled();
  });
});
