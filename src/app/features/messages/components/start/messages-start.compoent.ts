import { Component, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { HlmButton } from '@spartan-ng/helm/button';
import { ThemeService } from '../../../../shared/services/theme.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { tap } from 'rxjs';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { lucidePencil } from '@ng-icons/lucide';

@Component({
  selector: 'app-messages-start',
  imports: [RouterLink, HlmButton, NgIcon, HlmIcon],
  providers: [provideIcons({ lucidePencil })],
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
        tap((mode) => this.isDarkMode.set(mode === 'dark')),
      )
      .subscribe();
  }
}
