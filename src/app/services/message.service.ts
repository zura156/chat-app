import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class MessageService {
  constructor(private http: HttpClient) {}

  create(data: any) {
    return this.http.post('http://localhost:8000/api/message', data);
  }
}
