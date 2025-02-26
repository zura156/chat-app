import { Component, inject, OnInit } from '@angular/core';
import { ReactiveFormsModule, FormGroup, FormControl } from '@angular/forms';
import { MessageService } from './services/message.service';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  imports: [ReactiveFormsModule],
  styleUrl: './app.component.css',
})
export class AppComponent implements OnInit {
  messageService = inject(MessageService);

  messages = this.messageService.getMessages();

  form: FormGroup = new FormGroup({
    message: new FormControl(''),
  });

  ngOnInit(): void {
    this.messageService.getMessages().subscribe();
  }

  onSubmit(): void {
    this.messageService.sendMessage(this.form.getRawValue());
  }
}
