import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { AppComponent } from './app';
import { AuthService } from '../../shared/services/auth.service';

describe('AppComponent', () => {
  let component: AppComponent;
  let authServiceMock: any;
  let router: Router;
  let fixture: ReturnType<typeof TestBed.createComponent<AppComponent>>;

  beforeEach(async () => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation(query => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });

    authServiceMock = {
      logout: vi.fn(),
      currentUser: vi.fn().mockReturnValue(null),
      token: vi.fn().mockReturnValue(null),
      profile: vi.fn().mockReturnValue(of({ id: '1', name: 'A', email: 'a@b.c', createdAt: '' })),
    };

    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [
        { provide: AuthService, useValue: authServiceMock },
        provideRouter([]),
      ],
    }).compileComponents();

    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

    fixture = TestBed.createComponent(AppComponent);
    component = fixture.componentInstance;
  });

  it('should create the app', () => {
    expect(component).toBeTruthy();
  });

  it('should logout and navigate to login', () => {
    component.logout();
    expect(authServiceMock.logout).toHaveBeenCalled();
    expect(router.navigateByUrl).toHaveBeenCalledWith('/login');
  });

  it('should show only the login link when logged out', () => {
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Connexion');
    expect(text).not.toContain('Library');
  });

  it('should not reload the profile without a token', () => {
    expect(authServiceMock.profile).not.toHaveBeenCalled();
  });

  it('should reload the user after a page refresh, when only the token is known', () => {
    authServiceMock.token.mockReturnValue('jwt');
    TestBed.createComponent(AppComponent);
    expect(authServiceMock.profile).toHaveBeenCalledTimes(1);
  });

  it('should show the navigation as soon as a token exists', () => {
    authServiceMock.token.mockReturnValue('jwt');
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Library');
    expect(text).toContain('Profile');
    expect(text).toContain('Logout');
    expect(text).not.toContain('Connexion');
  });
});
