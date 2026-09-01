import { computed, inject, Injectable, signal } from '@angular/core';
import {
  HttpClient,
  HttpEventType,
  HttpHeaders,
  HttpRequest,
} from '@angular/common/http';
import {
  catchError,
  filter,
  map,
  switchMap,
  take,
  tap,
  throwError,
} from 'rxjs';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';
import {
  PresignResponse,
  UploadContext,
  UploadState,
} from '../interfaces/upload.interface';
import { apiErrorMessage } from '../../../shared/functions/api-error';

@Injectable({ providedIn: 'root' })
export class UploadService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = `${environment.apiUrl}/upload`;

  // map of uploadId → UploadState
  private readonly _uploads = signal<Map<string, UploadState>>(new Map());

  // public read-only view
  readonly uploads = this._uploads.asReadonly();

  readonly isUploading = computed(() => {
    const uploads = [...this._uploads().values()];
    return uploads.some(
      (u) => u.status === 'uploading' || u.status === 'confirming',
    );
  });

  /**
   * Averaged over the uploads still running, not over every entry ever made.
   *
   * Entries are only removed by an explicit `clearUpload`, so `done` and
   * `error` uploads from earlier in the session stayed in the denominator and
   * held the reported percentage down for the ones actually in flight.
   */
  readonly overallProgress = computed(() => {
    const live = [...this._uploads().values()].filter(
      (u) => u.status === 'uploading' || u.status === 'confirming',
    );
    if (!live.length) return 0;
    return Math.round(live.reduce((s, u) => s + u.progress, 0) / live.length);
  });

  // get state for a specific upload
  getUploadState(uploadId: string) {
    return computed(() => this._uploads().get(uploadId) ?? null);
  }

  // full flow: presign → PUT to S3 → confirm
  // emits progress (0-100) then completes with uploadId
  uploadFile(
    context: UploadContext,
    file: File,
    resourceId?: string,
  ): Observable<string> {
    // tracked so a failure can mark *this* upload as errored, not every
    // in-flight one
    let currentUploadId: string | null = null;

    return this.presign(context, file, resourceId).pipe(
      tap(({ uploadId }) => {
        currentUploadId = uploadId;
        this.setState(uploadId, { uploadId, progress: 0, status: 'uploading' });
      }),
      switchMap((presignRes) =>
        this.putToS3(presignRes.presignedUrl, file).pipe(
          tap((progress) =>
            this.setState(presignRes.uploadId, {
              uploadId: presignRes.uploadId,
              progress,
              status: 'uploading',
            }),
          ),
          filter((progress) => progress === 100),
          // both the final UploadProgress event and the Response event report
          // 100 — without take(1) confirm() fires twice and the second call
          // fails with "Upload already confirmed"
          take(1),
          switchMap(() => {
            this.setState(presignRes.uploadId, {
              uploadId: presignRes.uploadId,
              progress: 100,
              status: 'confirming',
            });
            return this.confirm(presignRes.uploadId);
          }),
          tap(() =>
            this.setState(presignRes.uploadId, {
              uploadId: presignRes.uploadId,
              progress: 100,
              status: 'done',
            }),
          ),
          map(() => presignRes.uploadId),
        ),
      ),
      catchError((err) => {
        // Settle this upload's state, otherwise `isUploading` stays true
        // forever and the composer refuses to send.
        if (currentUploadId) {
          this.setState(currentUploadId, {
            uploadId: currentUploadId,
            progress: 0,
            status: 'error',
            /*
             * `err.message` on an HttpErrorResponse is Angular's own
             * boilerplate — "Http failure response for
             * http://…/upload/presign: 400 Bad Request" — and that is the
             * string that reached the user, in place of the server's reason.
             * The two most common failures here are the two most fixable ones
             * ("over the 20MB limit", "that file type is not accepted"), and
             * neither was ever readable.
             */
            error: apiErrorMessage(err, 'Upload failed'),
          });
        }
        return throwError(() => err);
      }),
    );
  }

  clearUpload(uploadId: string): void {
    this._uploads.update((map) => {
      const next = new Map(map);
      next.delete(uploadId);
      return next;
    });
  }

  private presign(
    context: UploadContext,
    file: File,
    resourceId?: string,
  ): Observable<PresignResponse> {
    return this.http.post<PresignResponse>(`${this.apiUrl}/presign`, {
      context,
      mimeType: file.type,
      fileSize: file.size,
      resourceId: resourceId ?? undefined,
    });
  }

  // PUT directly to S3 presigned URL — emits progress 0-100
  private putToS3(presignedUrl: string, file: File): Observable<number> {
    const req = new HttpRequest('PUT', presignedUrl, file, {
      reportProgress: true, // enables UploadProgress events
      headers: new HttpHeaders({ 'Content-Type': file.type }),
    });

    return this.http.request(req).pipe(
      map((event) => {
        if (event.type === HttpEventType.UploadProgress) {
          return Math.round(
            (100 * event.loaded) / (event.total ?? event.loaded),
          );
        }
        if (event.type === HttpEventType.Response) {
          return 100;
        }
        return -1; // sentinel for non-progress events
      }),
      filter((progress) => progress >= 0),
    );
  }

  private confirm(uploadId: string): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(`${this.apiUrl}/confirm`, {
      uploadId,
    });
  }

  private setState(uploadId: string, state: UploadState): void {
    this._uploads.update((map) => {
      const next = new Map(map);
      next.set(uploadId, state);
      return next;
    });
  }
}
