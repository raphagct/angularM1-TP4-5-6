import { Component, inject } from '@angular/core';
import { Router, RouterLink, RouterOutlet } from '@angular/router';
import { AuthService } from '../../shared/services/auth.service';

@Component({
  selector: 'app-root',
  imports: [RouterLink, RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class AppComponent {
  readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  constructor() {
    if (this.auth.token()) {
      this.auth.profile().subscribe({
        next: (user) => console.debug('[App] Profil restauré', user.id),
        error: (error: { status?: number }) => {
          if (error.status === 401) this.auth.logout();
        },
      });
    }
  }

  logout(): void {
    this.auth.logout();
    void this.router.navigateByUrl('/login');
  }
}
