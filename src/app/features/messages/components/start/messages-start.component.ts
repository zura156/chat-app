import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { HlmButton } from '@spartan-ng/helm/button';
import { ThemeService } from '../../../../shared/services/theme.service';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { lucidePencil } from '@ng-icons/lucide';

@Component({
  selector: 'app-messages-start',
  imports: [RouterLink, HlmButton, NgIcon, HlmIcon],
  providers: [provideIcons({ lucidePencil })],
  templateUrl: './messages-start.component.html',
})
export class MessagesStartComponent {
  private readonly themeService = inject(ThemeService);
  isDarkMode = this.themeService.isDarkMode;
}
