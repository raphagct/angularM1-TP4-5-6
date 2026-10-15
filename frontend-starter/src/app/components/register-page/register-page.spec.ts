import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { RegisterPageComponent } from './register-page';
import { AuthService } from '../../shared/services/auth.service';

describe('RegisterPageComponent', () => {
  let component: RegisterPageComponent;
  let authServiceMock: any;
  let router: Router;

  beforeEach(async () => {
    authServiceMock = {
      register: vi.fn().mockReturnValue(of({})),
    };

    await TestBed.configureTestingModule({
      imports: [RegisterPageComponent],
      providers: [
        { provide: AuthService, useValue: authServiceMock },
        provideRouter([]),
      ],
    }).compileComponents();

    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

    const fixture = TestBed.createComponent(RegisterPageComponent);
    component = fixture.componentInstance;
  });

  it('should create the register page', () => {
    expect(component).toBeTruthy();
  });

  it('should have an invalid form initially', () => {
    expect(component.form.invalid).toBe(true);
  });

  it('should submit valid form and navigate on success', () => {
    component.form.setValue({
      name: 'John Doe',
      email: 'john@example.com',
      password: 'password123',
    });

    component.submit();
    
    expect(authServiceMock.register).toHaveBeenCalledWith('John Doe', 'john@example.com', 'password123');
    expect(router.navigateByUrl).toHaveBeenCalledWith('/profile');
  });

  it('should handle registration error', () => {
    authServiceMock.register.mockReturnValue(throwError(() => ({ error: { message: 'Email already exists' } })));
    
    component.form.setValue({
      name: 'John Doe',
      email: 'john@example.com',
      password: 'password123',
    });

    component.submit();
    
    expect(authServiceMock.register).toHaveBeenCalled();
    expect(component.error()).toBe('Email already exists');
    expect(component.loading()).toBe(false);
  });

  it('should show a default message when the API gives none', () => {
    authServiceMock.register.mockReturnValue(throwError(() => ({})));
    component.submit();
    expect(component.error()).toBe('Erreur d’inscription');
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  it('should set loading while the request is pending', () => {
    authServiceMock.register.mockReturnValue(new Subject());
    component.submit();
    expect(component.loading()).toBe(true);
  });
});
