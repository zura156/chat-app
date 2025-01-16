import { Component, OnInit, ChangeDetectionStrategy } from '@angular/core';
@Component({
  selector: 'app-chat-page',
  templateUrl: './chat-page.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChatPageComponent implements OnInit {
  constructor() {}
  ngOnInit(): void {}
}
