import { Component, DestroyRef, effect, inject, input, signal, untracked } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideMusic } from '@ng-icons/lucide';
import { TrackService } from '@/shared/services/track.service';

/**
 * Displays a track cover. The image is downloaded through HttpClient (so the
 * interceptor adds the JWT) and shown from a temporary blob: URL.
 * Without a cover, or if loading fails, a music icon placeholder is shown.
 */
@Component({
  selector: 'app-track-cover',
  imports: [NgIcon],
  viewProviders: [provideIcons({ lucideMusic })],
  template: `
    @if (url()) {
      <img [src]="url()" [alt]="alt()" />
    } @else {
      <div class="placeholder" role="img" [attr.aria-label]="alt()">
        <ng-icon name="lucideMusic" />
      </div>
    }
  `,
  styles: `
    :host {
      display: block;
      flex-shrink: 0;
      overflow: hidden;
      aspect-ratio: 1;
      border-radius: var(--cover-radius, 8px);
      background: var(--secondary);
    }
    img { display: block; width: 100%; height: 100%; object-fit: cover; }
    .placeholder {
      display: grid;
      place-items: center;
      width: 100%;
      height: 100%;
      background: linear-gradient(135deg, oklch(0.75 0.2 145 / 25%), oklch(0.2 0 0));
      color: oklch(0.75 0.2 145);
      font-size: calc(var(--cover-icon, 1.25rem));
    }
  `,
})
export class TrackCoverComponent {
  private readonly service = inject(TrackService);

  readonly trackId = input.required<string>();
  readonly hasCover = input(false);
  readonly alt = input('Pochette');

  readonly url = signal<string | null>(null);

  constructor() {
    effect((onCleanup) => {
      const id = this.trackId();
      if (!this.hasCover()) return;

      const subscription = this.service.cover(id).subscribe({
        next: (blob) => this.setUrl(URL.createObjectURL(blob)),
        error: () => {
          console.error('[TrackCover] Pochette indisponible', id);
          this.setUrl(null);
        },
      });
      onCleanup(() => {
        subscription.unsubscribe();
        this.setUrl(null);
      });
    });

    inject(DestroyRef).onDestroy(() => this.setUrl(null));
  }

  /** Replaces the current blob URL and releases the previous one. */
  private setUrl(next: string | null): void {
    const previous = untracked(this.url);
    if (previous) URL.revokeObjectURL(previous);
    this.url.set(next);
  }
}
