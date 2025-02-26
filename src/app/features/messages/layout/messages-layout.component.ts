import { Component, inject, OnInit } from '@angular/core';
import { MessageService } from '../services/message.service';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';

@Component({
  selector: 'app-messages',
  imports: [ReactiveFormsModule],
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
    console.log('helo')
  }

  onSubmit(): void {
    this.messageService.sendMessage(this.form.getRawValue());
  }
}
