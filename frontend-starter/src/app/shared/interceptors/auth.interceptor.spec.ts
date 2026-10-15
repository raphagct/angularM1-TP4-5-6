import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient, HttpClient, HttpErrorResponse, withInterceptors } from '@angular/common/http';
import { Router, provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { authInterceptor } from './auth.interceptor';
import { AuthService } from '../services/auth.service';

describe('authInterceptor', () => {
  let httpTesting: HttpTestingController;
  let httpClient: HttpClient;
  let router: Router;
  const token = signal<string | null>('fake-token-123');
  const logout = vi.fn();

  beforeEach(() => {
    token.set('fake-token-123');
    logout.mockClear();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: AuthService, useValue: { token, logout } },
      ],
    });

    httpTesting = TestBed.inject(HttpTestingController);
    httpClient = TestBed.inject(HttpClient);
    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
  });

  afterEach(() => {
    httpTesting.verify();
  });

  it('should add Authorization header when token exists', () => {
    httpClient.get('/api/test').subscribe();
    const req = httpTesting.expectOne('/api/test');
    expect(req.request.headers.get('Authorization')).toEqual('Bearer fake-token-123');
    req.flush({});
  });

  it('should also authenticate blob requests (audio, cover)', () => {
    httpClient.get('/api/tracks/1/cover', { responseType: 'blob' }).subscribe();
    const req = httpTesting.expectOne('/api/tracks/1/cover');
    expect(req.request.headers.get('Authorization')).toEqual('Bearer fake-token-123');
    req.flush(new Blob());
  });

  it('should not add a header without token', () => {
    token.set(null);
    httpClient.get('/api/health').subscribe();
    const req = httpTesting.expectOne('/api/health');
    expect(req.request.headers.has('Authorization')).toBe(false);
    req.flush({});
  });

  it('should logout and redirect to /login on 401', () => {
    let error: HttpErrorResponse | undefined;
    httpClient.get('/api/users/me').subscribe({ error: (e) => (error = e) });
    httpTesting.expectOne('/api/users/me').flush({}, { status: 401, statusText: 'Unauthorized' });
    expect(logout).toHaveBeenCalled();
    expect(router.navigateByUrl).toHaveBeenCalledWith('/login');
    expect(error?.status).toBe(401);
  });

  it('should propagate other errors without logging out', () => {
    let error: HttpErrorResponse | undefined;
    httpClient.get('/api/tracks').subscribe({ error: (e) => (error = e) });
    httpTesting.expectOne('/api/tracks').flush({}, { status: 500, statusText: 'Error' });
    expect(logout).not.toHaveBeenCalled();
    expect(error?.status).toBe(500);
  });
});
