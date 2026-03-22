import { Component, signal } from '@angular/core';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmSeparatorImports } from '../../../../../../../libs/ui/separator/src/index';

@Component({
  templateUrl: './notifications-settings.html',
  imports: [HlmButtonImports, HlmSeparatorImports],
})
export class Notificationssettings {
  notificationGroups = signal([
    {
      label: 'Messages',
      items: [
        {
          key: 'new_message',
          label: 'New messages',
          description: 'When someone sends you a message',
          enabled: signal(true),
        },
        {
          key: 'group_message',
          label: 'Group messages',
          description: 'Messages in group conversations',
          enabled: signal(true),
        },
        {
          key: 'mentions',
          label: 'Mentions',
          description: 'When someone mentions you',
          enabled: signal(true),
        },
      ],
    },
    {
      label: 'System',
      items: [
        {
          key: 'friend_request',
          label: 'Friend requests',
          description: null,
          enabled: signal(true),
        },
        {
          key: 'updates',
          label: 'App updates',
          description: null,
          enabled: signal(false),
        },
      ],
    },
  ]);
}
