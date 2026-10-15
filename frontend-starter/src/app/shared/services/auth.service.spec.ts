import { vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  let service: AuthService;
  let httpTesting: HttpTestingController;

  let storage: Map<string, string>;
  const user = { id: '1', name: 'Test', email: 'test@example.com', createdAt: '2026-01-01' };

  beforeEach(() => {
    storage = new Map<string, string>();
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

  it('should register via POST /api/auth/register and store the session', () => {
    service.register('Test', 'test@example.com', 'password123').subscribe();
    const req = httpTesting.expectOne('/api/auth/register');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ name: 'Test', email: 'test@example.com', password: 'password123' });
    req.flush({ token: 'jwt-register', user });
    expect(service.token()).toBe('jwt-register');
    expect(storage.get('gpc_token')).toBe('jwt-register');
    expect(service.currentUser()).toEqual(user);
  });

  it('should not store anything when login fails', () => {
    service.login('a@b.c', 'bad').subscribe({ error: () => undefined });
    httpTesting.expectOne('/api/auth/login').flush({ message: 'Identifiants incorrects' }, { status: 401, statusText: 'Unauthorized' });
    expect(service.token()).toBeNull();
    expect(storage.has('gpc_token')).toBe(false);
  });

  it('should load the profile and update the current user', () => {
    service.profile().subscribe();
    const req = httpTesting.expectOne('/api/users/me');
    expect(req.request.method).toBe('GET');
    req.flush(user);
    expect(service.currentUser()).toEqual(user);
  });

  it('should update the name via PUT /api/users/me', () => {
    service.update('New').subscribe();
    const req = httpTesting.expectOne('/api/users/me');
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ name: 'New' });
    req.flush({ ...user, name: 'New' });
    expect(service.currentUser()?.name).toBe('New');
  });

  it('should clear the token and the user on logout', () => {
    service.login('test@example.com', 'x').subscribe();
    httpTesting.expectOne('/api/auth/login').flush({ token: 't', user });
    service.logout();
    expect(service.token()).toBeNull();
    expect(service.currentUser()).toBeNull();
    expect(storage.has('gpc_token')).toBe(false);
  });

  it('should restore the token saved in localStorage', () => {
    storage.set('gpc_token', 'saved');
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [AuthService, provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(AuthService);
    httpTesting = TestBed.inject(HttpTestingController);
    expect(service.token()).toBe('saved');
  });
});
