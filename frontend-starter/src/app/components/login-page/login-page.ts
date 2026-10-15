import { Component, inject, signal, AfterViewInit } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../shared/services/auth.service';

interface GoogleCredentialResponse { credential: string; }
interface GoogleAccounts {
  id: {
    initialize(options: { client_id: string; callback: (response: GoogleCredentialResponse) => void }): void;
    renderButton(element: HTMLElement, options: { theme: string; size: string }): void;
  };
}
declare global { interface Window { google?: { accounts: GoogleAccounts }; } }

@Component({
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './login-page.html',
  styleUrl: './login-page.css',
})
export class LoginPageComponent implements AfterViewInit {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly error = signal('');
  readonly magicMessage = signal('');
  readonly magicLoading = signal(false);
  readonly form = new FormGroup({
    email: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.email],
    }),
    password: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required],
    }),
  });

  ngAfterViewInit(): void {
    this.auth.googleConfig().subscribe({
      next: ({ clientId }) => {
        if (!clientId) return;
        const script = document.createElement('script');
        script.src = 'https://accounts.google.com/gsi/client';
        script.async = true;
        script.onload = () => {
          const target = document.getElementById('google-signin');
          if (!target || !window.google) return;
          window.google.accounts.id.initialize({ client_id: clientId, callback: ({ credential }) => {
            this.auth.googleLogin(credential).subscribe({
              next: () => void this.router.navigateByUrl('/tracks'),
              error: (error: { error?: { message?: string } }) => this.error.set(error.error?.message ?? 'Connexion Google impossible'),
            });
          }});
          window.google.accounts.id.renderButton(target, { theme: 'outline', size: 'large' });
        };
        script.onerror = () => this.error.set('Connexion Google momentanément indisponible.');
        document.head.appendChild(script);
      },
      error: () => console.warn('[LoginPage] Configuration Google indisponible'),
    });
  }

  requestMagic(): void {
    const email = this.form.controls.email.value;
    if (this.form.controls.email.invalid || this.magicLoading()) return;
    this.magicLoading.set(true);
    this.magicMessage.set('');
    this.auth.magicRequest(email).subscribe({
      next: response => { this.magicMessage.set(response.message); this.magicLoading.set(false); },
      error: (error: { error?: { message?: string } }) => {
        this.error.set(error.error?.message ?? 'Envoi du lien impossible');
        this.magicLoading.set(false);
      },
    });
  }

  submit(): void {
    const values = this.form.getRawValue();
    this.auth.login(values.email, values.password).subscribe({
      next: () => {
        console.debug('[LoginPage] Connexion réussie');
        void this.router.navigateByUrl('/tracks');
      },
      error: (error: { error?: { message?: string } }) => {
        console.error('[LoginPage] Échec de connexion', error);
        this.error.set(error.error?.message ?? 'Erreur de connexion');
      },
    });
  }
}
