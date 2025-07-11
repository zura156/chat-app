import { Injectable, inject } from '@angular/core';
import { Portal } from '@angular/cdk/portal';
import { BehaviorSubject, Observable } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class PortalRegistryService {
  private activePortalSubject = new BehaviorSubject<Portal<any> | null>(null);

  readonly activePortal$: Observable<Portal<any> | null> =
    this.activePortalSubject.asObservable();

  /**
   * Registers a portal. Typically called by a child component.
   * @param portal The Portal instance to register.
   */
  setPortal(portal: Portal<any> | null): void {
    this.activePortalSubject.next(portal);
  }

  /**
   * Clears the currently registered portal.
   */
  clearPortal(): void {
    this.activePortalSubject.next(null);
  }
}
