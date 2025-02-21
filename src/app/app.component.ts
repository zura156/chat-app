import { Component, inject } from '@angular/core';
import { ReactiveFormsModule, FormGroup, FormControl } from '@angular/forms';
import { MessageService } from './services/message.service';
@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  imports: [ReactiveFormsModule],
  styleUrl: './app.component.css',
})
export class AppComponent {
  messageService = inject(MessageService);

  form: FormGroup = new FormGroup({
    message: new FormControl(''),
  });

  onSubmit(): void {
    this.messageService.create(this.form.getRawValue()).subscribe({
      next: (res) => {
        console.log('Message sent: ', res);
        this.form.reset();
      },
      error: (err) => {
        console.error(err);
      },
    });
  }
}
