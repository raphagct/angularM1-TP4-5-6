import { Component, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../../shared/services/auth.service';
import { ZardSonnerComponent } from '@/shared/components/sonner';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideMusic, lucideUser, lucideLogOut } from '@ng-icons/lucide';

@Component({
  selector: 'app-root',
  imports: [RouterLink, RouterLinkActive, RouterOutlet, ZardSonnerComponent, NgIcon],
  templateUrl: './app.html',
  styleUrl: './app.css',
  viewProviders: [provideIcons({ lucideMusic, lucideUser, lucideLogOut })],
})
export class AppComponent {
  readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  constructor() {
    // After a page reload only the token survives: reload the user it belongs to.
    if (this.auth.token() && !this.auth.currentUser()) {
      this.auth.profile().subscribe({
        next: (user) => console.debug('[App] Utilisateur rechargé', user.id),
        error: (error) => console.error('[App] Rechargement du profil impossible', error),
      });
    }
  }

  logout(): void {
    this.auth.logout();
    void this.router.navigateByUrl('/login');
  }
}
