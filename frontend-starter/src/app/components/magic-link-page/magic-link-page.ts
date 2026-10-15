import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../shared/services/auth.service';

@Component({
  imports: [RouterLink],
  templateUrl: './magic-link-page.html',
  styleUrl: './magic-link-page.css',
})
export class MagicLinkPageComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  readonly error = signal('');

  constructor() {
    const token = this.route.snapshot.queryParamMap.get('token');
    if (!token) { this.error.set('Lien de connexion invalide.'); return; }
    this.auth.magicVerify(token).subscribe({
      next: () => void this.router.navigateByUrl('/tracks', { replaceUrl: true }),
      error: () => {
        this.error.set('Lien de connexion expiré ou déjà utilisé.');
        void this.router.navigate([], { relativeTo: this.route, queryParams: {}, replaceUrl: true });
      },
    });
  }
}
