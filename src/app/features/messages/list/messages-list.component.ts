import { Component } from '@angular/core';
import { MessageCardComponent } from '../card/message-card.component';
import { HlmSeparatorDirective } from '@spartan-ng/ui-separator-helm';
import { BrnSeparatorComponent } from '@spartan-ng/brain/separator';
import { HlmButtonDirective } from '@spartan-ng/ui-button-helm';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideMenu, lucidePencil } from '@ng-icons/lucide';
import { HlmIconDirective } from '@spartan-ng/ui-icon-helm';

@Component({
  selector: 'app-messages-list',
  imports: [
    MessageCardComponent,
    HlmSeparatorDirective,
    BrnSeparatorComponent,
    HlmButtonDirective,
    NgIcon,
    HlmIconDirective,
  ],
  providers: [provideIcons({ lucidePencil, lucideMenu })],
  templateUrl: './messages-list.component.html',
})
export class MessageListComponent {}
