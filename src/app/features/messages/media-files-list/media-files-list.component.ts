import { Component, inject, OnInit } from '@angular/core';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { HlmTabsImports } from '@spartan-ng/helm/tabs';
import { MessageService } from '../services/message.service';
import { environment } from '../../../../environments/environment';
import { NgStyle } from '@angular/common';
import {
  MediaItem,
  MediaViewerService,
} from '../../../shared/services/media-viewer.service';
import { MessageI } from '../interfaces/message.interface';

@Component({
  selector: 'app-media-files-list',
  templateUrl: './media-files-list.component.html',
  imports: [NgStyle, HlmTabsImports, HlmSpinner],
})
export class MediaFilesListComponent implements OnInit {
  private messageService = inject(MessageService);
  private mediaViewerService = inject(MediaViewerService);

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

  openMedia(message: MessageI, index: number) {
    // You can decide based on user preferences or context
    const enableGallery = this.shouldEnableGallery();

    const media: MediaItem = {
      _id: String(message._id),
      type: message.type as 'image' | 'video',
      url: String(message.file?.url),
      placeholder_url: message.file?.placeholder_url,
      thumbnail_url: message.file?.thumbnail_url,
      size: message.file?.size_in_bytes,
    };

    this.mediaViewerService.openMedia(media, index, {
      enableGallery,
      showThumbnails: enableGallery,
      allowDownload: true,
      autoPlay: false,
    });
  }

  private shouldEnableGallery(): boolean {
    return (
      this.mediaViewerService['messageService'].activeMediaMessages().length > 3
    );
  }
}
