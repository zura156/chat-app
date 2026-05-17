import { Component, inject, OnInit } from '@angular/core';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { HlmTabsImports } from '@spartan-ng/helm/tabs';
import { MessageService } from '../../services/message.service';
import { environment } from '../../../../../environments/environment';
import {
  MediaItem,
  MediaViewerService,
} from '../../../../shared/services/media-viewer.service';
import { MessageI } from '../../interfaces/message.interface';
import { AudioPlayer } from '../../../../shared/components/audio-player/audio-player';
import { FileViewer } from '../../../../shared/components/file-viewer/file-viewer';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { lucideCirclePlay } from '@ng-icons/lucide';

@Component({
  selector: 'app-media-files-list',
  templateUrl: './media-files-list.component.html',
  imports: [
    HlmTabsImports,
    HlmSpinner,
    AudioPlayer,
    FileViewer,
    NgIcon,
    HlmIcon,
  ],
  providers: [provideIcons({ lucideCirclePlay })],
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
    const attachment = message.attachments?.[0];
    if (!attachment) return;

    const media: MediaItem = {
      _id: String(message._id),
      type: message.type as 'image' | 'video',
      url: String(attachment.variants?.original),
      thumbnail: attachment.variants?.thumbnail,
      thumb: attachment.variants?.thumb,
      size: attachment.fileSize,
    };

    this.mediaViewerService.openMedia(media, index, {
      enableGallery: this.shouldEnableGallery(),
      showThumbnails: this.shouldEnableGallery(),
      allowDownload: true,
      autoPlay: false,
    });
  }

  private shouldEnableGallery(): boolean {
    return this.mediaMessages().length > 3;
  }
}
