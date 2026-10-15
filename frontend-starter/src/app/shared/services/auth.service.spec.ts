import { vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  let service: AuthService;
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    });
    TestBed.configureTestingModule({
      providers: [
        AuthService,
        provideHttpClient(),
        provideHttpClientTesting(),
      ]
    });
    service = TestBed.inject(AuthService);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpTesting.verify();
    service.logout();
    vi.unstubAllGlobals();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should login via POST /api/auth/login with the correct body', () => {
    const email = 'test@example.com';
    const password = 'password123';
    
    service.login(email, password).subscribe();
    
    const req = httpTesting.expectOne('/api/auth/login');
    expect(req.request.method).toEqual('POST');
    expect(req.request.body).toEqual({ email, password });
    
    const user = { id: '1', name: 'Test', email, createdAt: '2026-01-01' };
    req.flush({ token: 'fake-jwt-token', user });
    expect(service.token()).toBe('fake-jwt-token');
    expect(service.currentUser()).toEqual(user);
  });
  it('demande un Magic Link sans exposer de token', () => {
    let message = '';
    service.magicRequest('test@example.com').subscribe(result => message = result.message);
    const req = httpTesting.expectOne('/api/auth/magic/request');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ email: 'test@example.com' });
    req.flush({ message: 'Lien envoyé' });
    expect(message).toBe('Lien envoyé');
  });

  it('échange un Magic Link contre une session', () => {
    const user = { id: '1', name: 'Test', email: 'test@example.com', createdAt: '2026-01-01' };
    service.magicVerify('fake-link').subscribe();
    const req = httpTesting.expectOne('/api/auth/magic/verify');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ token: 'fake-link' });
    req.flush({ token: 'fake-jwt', user });
    expect(service.token()).toBe('fake-jwt');
    expect(service.currentUser()).toEqual(user);
  });

  it('envoie le jeton Google au backend et conserve la session vérifiée', () => {
    const user = { id: '2', name: 'Google', email: 'google@example.com', createdAt: '2026-01-01' };
    service.googleLogin('id-token').subscribe();
    const req = httpTesting.expectOne('/api/auth/google');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ credential: 'id-token' });
    req.flush({ token: 'app-jwt', user });
    expect(service.currentUser()).toEqual(user);
    expect(service.token()).toBe('app-jwt');
  });
});
