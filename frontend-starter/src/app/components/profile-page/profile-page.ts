import { Component, computed, inject, signal } from '@angular/core';
import { AbstractControl, FormControl, FormGroup, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { DatePipe } from '@angular/common';
import { AuthService } from '../../shared/services/auth.service';
import { TrackService } from '../../shared/services/track.service';
import { User } from '../../shared/models/user.model';
import { ZardButtonComponent } from '@/shared/components/button';
import { ZardSonnerService } from '@/shared/components/sonner';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideUser, lucideSave, lucideMail, lucideLock, lucideLogOut, lucideMusic, lucideCalendar, lucideRefreshCw } from '@ng-icons/lucide';
import { ZardCardImports } from '@/shared/components/card/card.imports';

/** Same rule as the API: at least 2 characters once trimmed. */
function trimmedMinLength(control: AbstractControl<string>): ValidationErrors | null {
  return control.value.trim().length >= 2 ? null : { minTrimmed: true };
}

@Component({
  imports: [
    ReactiveFormsModule,
    RouterLink,
    DatePipe,
    ZardButtonComponent,
    ...ZardCardImports,
    NgIcon
  ],
  templateUrl: './profile-page.html',
  styleUrl: './profile-page.css',
  viewProviders: [
    provideIcons({ lucideUser, lucideSave, lucideMail, lucideLock, lucideLogOut, lucideMusic, lucideCalendar, lucideRefreshCw }),
  ],
})
export class ProfilePageComponent {
  readonly auth = inject(AuthService);
  private readonly tracks = inject(TrackService);
  private readonly router = inject(Router);
  private readonly sonner = inject(ZardSonnerService);

  readonly form = new FormGroup({
    name: new FormControl('', { nonNullable: true, validators: [Validators.required, trimmedMinLength] }),
  });

  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly loadError = signal(false);
  /** Last profile returned by the API; the form can be reset to it. */
  readonly user = signal<User | null>(null);
  /** Number of tracks in the library, or null while unknown. */
  readonly trackCount = signal<number | null>(null);

  /** Initials shown in the avatar, e.g. "Jane Doe" -> "JD". */
  readonly initials = computed(() => {
    const words = (this.user()?.name ?? '').trim().split(/\s+/).filter(Boolean);
    return words.slice(0, 2).map((word) => word[0].toUpperCase()).join('') || '?';
  });

  constructor() {
    this.load();
    this.loadTrackCount();
  }

  load(): void {
    this.loading.set(true);
    this.loadError.set(false);
    this.auth.profile().subscribe({
      next: (user) => {
        console.debug('[ProfilePage] Profil chargé', user.id);
        this.user.set(user);
        this.form.reset({ name: user.name });
        this.loading.set(false);
      },
      error: (error) => {
        console.error('[ProfilePage] Chargement impossible', error);
        this.sonner.error('Impossible de charger le profil.');
        this.loadError.set(true);
        this.loading.set(false);
      },
    });
  }

  /** Only the total is needed: a page of one track is enough. */
  private loadTrackCount(): void {
    this.tracks.list(1, 1).subscribe({
      next: (page) => this.trackCount.set(page.total),
      error: (error) => console.error('[ProfilePage] Nombre de pistes indisponible', error),
    });
  }

  save(): void {
    if (this.form.invalid || this.saving()) return;
    this.saving.set(true);
    this.auth.update(this.form.getRawValue().name.trim()).subscribe({
      next: (user) => {
        console.debug('[ProfilePage] Profil enregistré', user.id);
        this.sonner.success('Profil mis à jour avec succès.');
        this.user.set(user);
        this.form.reset({ name: user.name });
        this.saving.set(false);
      },
      error: (error) => {
        console.error('[ProfilePage] Enregistrement impossible', error);
        this.sonner.error('Impossible de mettre à jour le profil.');
        this.saving.set(false);
      },
    });
  }

  /** Puts back the name currently saved on the server. */
  cancel(): void {
    this.form.reset({ name: this.user()?.name ?? '' });
  }

  logout(): void {
    this.auth.logout();
    void this.router.navigateByUrl('/login');
  }
}
