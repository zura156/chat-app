import { Component, inject, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { UserService } from '../../services/user.service';
import { map, Observable, Subject, switchMap, takeUntil } from 'rxjs';
import { UserI } from '../../interfaces/user.interface';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmAvatarImports } from '@spartan-ng/helm/avatar';
import { environment } from '../../../../../environments/environment';

@Component({
  selector: 'app-user-page',
  templateUrl: './user-page.component.html',
  imports: [HlmCardImports, HlmAvatarImports],
})
export class UserPageComponent implements OnInit, OnDestroy {
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private userService = inject(UserService);

  readonly apiUrl = environment.apiUrl;

  selectedUser = this.userService.selectedUser;

  private destroy$ = new Subject<void>();

  ngOnInit(): void {
    this.route.params
      .pipe(
        map((params) => params['id']),
        takeUntil(this.destroy$),
        switchMap((id) => this.fetchUserById(id))
      )
      .subscribe();
  }

  fetchUserById(userId: string): Observable<UserI> {
    return this.userService.getUserById(userId).pipe(takeUntil(this.destroy$));
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
