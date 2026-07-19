import { Service, signal, inject, DestroyRef, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { NotificationI } from '../interfaces/notification.interface';
import { environment } from '../../../../environments/environment';

@Service()
export class NotificationService {
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);

  private _notifications = signal<NotificationI[]>([]);

  private readonly apiUrl = environment.apiUrl;

  totalUnread = signal<number>(0);
}
