import { Component, inject, signal, AfterViewInit } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { AuthService } from '../../shared/services/auth.service';

@Component({
  imports: [ReactiveFormsModule],
  templateUrl: './profile-page.html',
  styleUrl: './profile-page.css',
})
export class ProfilePageComponent implements AfterViewInit {
  readonly googleMessage = signal('');
  readonly auth = inject(AuthService);
  readonly form = new FormGroup({
    name: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
  });

  constructor() {
    this.load();
  }

  ngAfterViewInit(): void {
    this.auth.googleConfig().subscribe({
      next: ({ clientId }) => {
        if (!clientId) return;
        const script = document.createElement('script');
        script.src = 'https://accounts.google.com/gsi/client';
        script.async = true;
        script.onload = () => {
          const target = document.getElementById('google-link');
          if (!target || !window.google) return;
          window.google.accounts.id.initialize({ client_id: clientId, callback: ({ credential }) => {
            this.auth.googleLink(credential).subscribe({
              next: () => this.googleMessage.set('Compte Google associé.'),
              error: (error: { error?: { message?: string } }) => this.googleMessage.set(error.error?.message ?? 'Association impossible'),
            });
          }});
          window.google.accounts.id.renderButton(target, { theme: 'outline', size: 'large' });
        };
        script.onerror = () => this.googleMessage.set('Connexion Google momentanément indisponible.');
        document.head.appendChild(script);
      },
      error: () => console.warn('[ProfilePage] Configuration Google indisponible'),
    });
  }

  load(): void {
    this.auth.profile().subscribe({
      next: (user) => {
        console.debug('[ProfilePage] Profil chargé', user.id);
        this.form.setValue({ name: user.name });
      },
      error: (error) => console.error('[ProfilePage] Chargement impossible', error),
    });
  }

  save(): void {
    this.auth.update(this.form.getRawValue().name).subscribe({
      next: (user) => console.debug('[ProfilePage] Profil enregistré', user.id),
      error: (error) => console.error('[ProfilePage] Enregistrement impossible', error),
    });
  }
}
