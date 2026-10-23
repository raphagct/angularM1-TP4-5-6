import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { Router, provideRouter } from '@angular/router';
import { ProfilePageComponent } from './profile-page';
import { AuthService } from '../../shared/services/auth.service';
import { TrackService } from '../../shared/services/track.service';
import { ZardSonnerService } from '@/shared/components/sonner';

describe('ProfilePageComponent', () => {
  let component: ProfilePageComponent;
  let authServiceMock: any;
  let sonnerMock: any;
  let tracksMock: any;
  let fixture: ReturnType<typeof TestBed.createComponent<ProfilePageComponent>>;

  beforeEach(async () => {
    authServiceMock = {
      profile: vi.fn().mockReturnValue(of({ id: '1', name: 'John Doe', email: 'john@example.com', createdAt: '2026-01-15' })),
      update: vi.fn().mockReturnValue(of({ id: '1', name: 'John Updated' })),
      currentUser: vi.fn().mockReturnValue({ email: 'john@example.com' }),
      logout: vi.fn(),
    };
    tracksMock = { list: vi.fn().mockReturnValue(of({ items: [], total: 7, page: 1, limit: 1, pages: 7 })) };

    sonnerMock = {
      success: vi.fn(),
      error: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [ProfilePageComponent],
      providers: [
        { provide: AuthService, useValue: authServiceMock },
        { provide: ZardSonnerService, useValue: sonnerMock },
        { provide: TrackService, useValue: tracksMock },
        provideRouter([]),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ProfilePageComponent);
    component = fixture.componentInstance;
  });

  it('should load profile on init', () => {
    expect(authServiceMock.profile).toHaveBeenCalled();
    expect(component.form.value.name).toBe('John Doe');
    expect(component.loading()).toBe(false);
  });

  it('should handle load error', () => {
    authServiceMock.profile.mockReturnValue(throwError(() => new Error('Error')));
    
    // Create new component instance to trigger constructor/load with error mock
    const fixture = TestBed.createComponent(ProfilePageComponent);
    const comp = fixture.componentInstance;

    expect(sonnerMock.error).toHaveBeenCalledWith('Impossible de charger le profil.');
    expect(comp.loading()).toBe(false);
    expect(comp.loadError()).toBe(true);
  });

  it('should save valid profile', () => {
    component.form.setValue({ name: 'John Updated' });
    component.save();

    expect(authServiceMock.update).toHaveBeenCalledWith('John Updated');
    expect(sonnerMock.success).toHaveBeenCalledWith('Profil mis à jour avec succès.');
    expect(component.saving()).toBe(false);
  });

  it('should handle save error', () => {
    authServiceMock.update.mockReturnValue(throwError(() => new Error('Save Error')));
    
    component.form.setValue({ name: 'John Updated' });
    component.save();

    expect(authServiceMock.update).toHaveBeenCalled();
    expect(sonnerMock.error).toHaveBeenCalledWith('Impossible de mettre à jour le profil.');
    expect(component.saving()).toBe(false);
  });

  it('should not save if form is invalid', () => {
    component.form.setValue({ name: '' }); // Invalid because of required validator
    component.save();

    expect(authServiceMock.update).not.toHaveBeenCalled();
  });

  it('trims the name before saving and keeps the form pristine afterwards', () => {
    component.form.controls.name.setValue('  John Updated  ');
    component.form.markAsDirty();
    component.save();
    expect(authServiceMock.update).toHaveBeenCalledWith('John Updated');
    expect(component.form.pristine).toBe(true);
    expect(component.user()?.name).toBe('John Updated');
  });

  it('refuses a name shorter than 2 characters once trimmed, like the API', () => {
    component.form.setValue({ name: ' J ' });
    component.save();
    expect(authServiceMock.update).not.toHaveBeenCalled();
  });

  it('cancel puts back the saved name', () => {
    component.form.controls.name.setValue('Draft');
    component.form.markAsDirty();
    component.cancel();
    expect(component.form.value.name).toBe('John Doe');
    expect(component.form.pristine).toBe(true);
  });

  it('shows initials, email, track count and member date', () => {
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(tracksMock.list).toHaveBeenCalledWith(1, 1);
    expect(el.querySelector('.avatar')?.textContent?.trim()).toBe('JD');
    expect(el.querySelector('.identity-email')?.textContent).toContain('john@example.com');
    expect(el.querySelector('.stats')?.textContent).toContain('7');
    expect(el.querySelector('.stats')?.textContent).toContain('Jan 2026');
    // Card titles go through zTitle, otherwise they are not rendered.
    expect(el.textContent).toContain('Personal information');
  });

  it('disables Save until the name changes', () => {
    fixture.detectChanges();
    const save = (fixture.nativeElement as HTMLElement).querySelector('button[type=submit]') as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    component.form.controls.name.setValue('Jane');
    component.form.markAsDirty();
    fixture.detectChanges();
    expect(save.disabled).toBe(false);
  });

  it('signs out and goes to the login page', () => {
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    component.logout();
    expect(authServiceMock.logout).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith('/login');
  });
});
