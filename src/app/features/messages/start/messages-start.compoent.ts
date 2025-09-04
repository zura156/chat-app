import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { HlmButton } from '@spartan-ng/helm/button';

@Component({
  selector: 'app-messages-start',
  imports: [RouterLink, HlmButton],
  templateUrl: './messages-start.compoent.html',
})
export class MessagesStartComponent {}
