import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  HlmAvatarComponent,
  HlmAvatarFallbackDirective,
  HlmAvatarImageDirective,
} from '@spartan-ng/ui-avatar-helm';
import { HlmCardDirective } from '@spartan-ng/ui-card-helm';
@Component({
  selector: 'app-message-card',
  imports: [
    HlmAvatarImageDirective,
    HlmAvatarComponent,
    HlmAvatarFallbackDirective,
    HlmCardDirective,
    // RouterLink
  ],
  templateUrl: './message-card.component.html',
})
export class MessageCardComponent {}
