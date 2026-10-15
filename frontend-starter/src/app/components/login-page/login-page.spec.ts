import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { LoginPageComponent } from './login-page';
import { AuthService } from '../../shared/services/auth.service';

describe('LoginPageComponent', () => {
  let component: LoginPageComponent;
  let authServiceMock: any;
  let router: Router;

  beforeEach(async () => {
    authServiceMock = {
      login: vi.fn().mockReturnValue(of({})),
    };

    await TestBed.configureTestingModule({
      imports: [LoginPageComponent],
      providers: [
        { provide: AuthService, useValue: authServiceMock },
        provideRouter([]),
      ],
    }).compileComponents();

    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

    const fixture = TestBed.createComponent(LoginPageComponent);
    component = fixture.componentInstance;
  });

  it('should create the login page', () => {
    expect(component).toBeTruthy();
  });

  it('should initialize form with default values', () => {
    expect(component.form.value).toEqual({
      email: 'demo@example.com',
      password: 'Demo1234!',
    });
  });

  it('should submit valid form and navigate on success', () => {
    component.submit();
    expect(authServiceMock.login).toHaveBeenCalledWith('demo@example.com', 'Demo1234!');
    expect(router.navigateByUrl).toHaveBeenCalledWith('/tracks');
  });

  it('should handle login error', () => {
    authServiceMock.login.mockReturnValue(throwError(() => ({ error: { message: 'Invalid credentials' } })));
    component.submit();
    
    expect(authServiceMock.login).toHaveBeenCalled();
    expect(component.error()).toBe('Invalid credentials');
    expect(component.loading()).toBe(false);
  });

  it('should show a default message when the API gives none', () => {
    authServiceMock.login.mockReturnValue(throwError(() => ({})));
    component.submit();
    expect(component.error()).toBe('Erreur de connexion');
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  it('should set loading while the request is pending', () => {
    authServiceMock.login.mockReturnValue(new Subject());
    component.submit();
    expect(component.loading()).toBe(true);
  });
});
