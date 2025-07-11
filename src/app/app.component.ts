import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { HeaderComponent } from './shared/layout/components/header.component';
import { HlmToasterComponent } from '@spartan-ng/helm/sonner';
import { ThemeService } from './shared/services/theme.service';
import { AsyncPipe } from '@angular/common';
import { IonApp, IonRouterOutlet } from '@ionic/angular/standalone';
import { CdkPortalOutlet, Portal } from '@angular/cdk/portal';
import { PortalRegistryService } from './shared/services/portal-registry.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { tap } from 'rxjs';

@Component({
  selector: 'app-root',
  imports: [
    AsyncPipe,
    HlmToasterComponent,
    HeaderComponent,
    IonRouterOutlet,
    IonApp,
    CdkPortalOutlet,
  ],
  templateUrl: './app.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppComponent implements OnInit {
  private themeService = inject(ThemeService);
  private portalRegistryService = inject(PortalRegistryService);
  private destroyRef = inject(DestroyRef);

  activeChildPortal = signal<Portal<any> | null>(null);

  theme$ = this.themeService.themeMode$;

  ngOnInit(): void {
    this.portalRegistryService.activePortal$
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        tap((portal) => this.activeChildPortal.set(portal))
      )
      .subscribe();
  }
}
