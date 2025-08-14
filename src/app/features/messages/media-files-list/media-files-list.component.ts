import { Component, inject, OnInit } from '@angular/core';
import { HlmSpinnerComponent } from '@spartan-ng/helm/spinner';
import { HlmTabsImports } from '@spartan-ng/helm/tabs';
import { MessageService } from '../services/message.service';
import { environment } from '../../../../environments/environment';
import { NgStyle } from '@angular/common';

@Component({
  selector: 'app-media-files-list',
  templateUrl: './media-files-list.component.html',
  imports: [NgStyle, HlmTabsImports, HlmSpinnerComponent],
})
export class MediaFilesListComponent implements OnInit {
  private messageService = inject(MessageService);

  apiUrl = environment.apiUrl;

  mediaMessages = this.messageService.activeMediaMessages;
  mediaMessagesResource = this.messageService.activeMediaMessagesResource;

  fileMessages = this.messageService.activeFileMessages;
  fileMessagesResource = this.messageService.activeFileMessagesResource;

  ngOnInit(): void {
    this.messageService.fetchMediaMessages();
  }

  fetchMedia(): void {
    this.messageService.fetchMediaMessages();
  }

  fetchFiles(): void {
    this.messageService.fetchFileMessages();
  }
}
