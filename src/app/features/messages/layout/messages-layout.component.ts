import { Component, inject, OnInit } from '@angular/core';
import { MessageService } from '../services/message.service';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MessageListComponent } from '../list/messages-list.component';
import { ChatboxComponent } from '../chatbox/chatbox.component';
import { HlmSeparatorDirective } from '@spartan-ng/ui-separator-helm';
import { BrnSeparatorComponent } from '@spartan-ng/brain/separator';

@Component({
  selector: 'app-messages',
  imports: [
    ReactiveFormsModule,
    MessageListComponent,
    ChatboxComponent,
    HlmSeparatorDirective,
    BrnSeparatorComponent,
  ],
  templateUrl: './messages-layout.component.html',
})
export class MessagesLayoutComponent implements OnInit {
  messageService = inject(MessageService);

  messages = this.messageService.getMessages();

  form: FormGroup = new FormGroup({
    message: new FormControl(''),
  });

  ngOnInit(): void {
    this.messageService.getMessages().subscribe();
    console.log('helo');
  }

  onSubmit(): void {
    this.messageService.sendMessage(this.form.getRawValue());
  }
}
