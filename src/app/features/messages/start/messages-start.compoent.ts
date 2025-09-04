import { Component, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { HlmButton } from '@spartan-ng/helm/button';
import { ThemeService } from '../../../shared/services/theme.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { tap } from 'rxjs';

@Component({
  selector: 'app-messages-start',
  imports: [RouterLink, HlmButton],
  templateUrl: './messages-start.compoent.html',
})
export class MessagesStartComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);
  private readonly themeService = inject(ThemeService);
  isDarkMode = signal<boolean>(false);

  ngOnInit(): void {
    this.themeService.themeMode$
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        tap((mode) => this.isDarkMode.set(mode === 'dark'))
      )
      .subscribe();
  }
}
