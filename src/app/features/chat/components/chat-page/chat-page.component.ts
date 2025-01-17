import { Component, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { User } from 'stream-chat';
import {
  ChannelService,
  ChatClientService,
  StreamAutocompleteTextareaModule,
  StreamChatModule,
  StreamI18nService,
} from 'stream-chat-angular';
import { environment } from '../../../../../environments/environment';
import { AuthService } from '../../../auth/services/auth.service';

@Component({
  selector: 'app-chat-page',
  templateUrl: './chat-page.component.html',
  imports: [
    TranslateModule,
    StreamAutocompleteTextareaModule,
    StreamChatModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChatPageComponent implements OnInit {
  constructor(
    private chatService: ChatClientService,
    private channelService: ChannelService,
    private streamI18nService: StreamI18nService,
    private authService: AuthService
  ) {
    const apiKey = environment.streamAPIKey;
    const userId = this.authService.user.value?.id;
    const userToken = this.authService.user.value?.token;
    const userName = this.authService.user.value?.email;

    if (!userId || !userToken || !userName) {
      throw new Error('User data is incomplete. Ensure the user is logged in.');
    }

    const user: User = {
      id: userId,
      name: userName,
      image: `https://getstream.io/random_png/?name=${userName}`,
    };

    this.chatService.init(apiKey, user, userToken);
    this.streamI18nService.setTranslation();
  }

  async ngOnInit() {
    const channel = this.chatService.chatClient.channel(
      'messaging',
      'talking-about-angular',
      {
        // add as many custom fields as you'd like
        image:
          'https://upload.wikimedia.org/wikipedia/commons/thumb/c/cf/Angular_full_color_logo.svg/2048px-Angular_full_color_logo.svg.png',
        name: 'Talking about Angular',
      }
    );
    await channel.create();
    this.channelService.init({
      type: 'messaging',
      id: { $eq: 'talking-about-angular' },
    });
  }
}
