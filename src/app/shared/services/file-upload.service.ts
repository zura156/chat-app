import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { MessageResponseI } from '../interfaces/message-response.interface';

@Injectable({ providedIn: 'root' })
export class FileUploadService {
  private http = inject(HttpClient);

  uploadFile(url: string, file: ArrayBuffer): Observable<MessageResponseI> {
    return this.http.put<MessageResponseI>(url, file);
  }
}
