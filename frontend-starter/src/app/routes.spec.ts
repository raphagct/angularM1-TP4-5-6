import { describe, it, expect } from 'vitest';
import { routes } from './routes';
import { authGuard } from './shared/guards/auth.guard';
import { TrackPlayerPageComponent } from './components/track-player-page/track-player-page';
import { TracksPageComponent } from './components/tracks-page/tracks-page';

describe('routes', () => {
  const find = (path: string) => routes.find((route) => route.path === path);

  it('redirige la racine et les URL inconnues vers /tracks', () => {
    expect(find('')?.redirectTo).toBe('tracks');
    expect(find('**')?.redirectTo).toBe('tracks');
  });

  it('protège la bibliothèque, le lecteur et le profil', () => {
    for (const path of ['tracks', 'tracks/:id', 'profile']) {
      expect(find(path)?.canActivate).toContain(authGuard);
    }
  });

  it('associe /tracks/:id à la page lecteur', () => {
    expect(find('tracks')?.component).toBe(TracksPageComponent);
    expect(find('tracks/:id')?.component).toBe(TrackPlayerPageComponent);
  });

  it('laisse login et register publics', () => {
    expect(find('login')?.canActivate).toBeUndefined();
    expect(find('register')?.canActivate).toBeUndefined();
  });
});
