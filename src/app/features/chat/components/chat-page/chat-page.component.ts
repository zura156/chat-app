import { Component, OnInit, ChangeDetectionStrategy } from '@angular/core';

import Talk from 'talkjs';

@Component({
  selector: 'app-chat-page',
  templateUrl: './chat-page.component.html',
  standalone: true,
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChatPageComponent {
  constructor() {
    Talk.ready.then((): void => {
      const me = new Talk.User('sample_user_alice');
      const session = new Talk.Session({
        appId: 'tqQzukjd',
        me: me,
      });

      const conversation = session.getOrCreateConversation(
        'sample_conversation'
      );
      conversation.setParticipant(me);

      const chatbox = session.createChatbox();
      chatbox.select(conversation);
      chatbox.mount(document.getElementById('talkjs-container'));
    });
  }
}
