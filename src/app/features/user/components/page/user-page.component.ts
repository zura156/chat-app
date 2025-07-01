import { Component, inject, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { UserService } from '../../services/user.service';
import { map, Observable, switchMap } from 'rxjs';
import { UserI } from '../../interfaces/user.interface';
import {
  HlmCardContentDirective,
  HlmCardDescriptionDirective,
  HlmCardDirective,
  HlmCardFooterDirective,
  HlmCardHeaderDirective,
  HlmCardTitleDirective,
} from '@spartan-ng/helm/card';
import {
  HlmAvatarImageDirective,
  HlmAvatarComponent,
  HlmAvatarFallbackDirective,
} from '@spartan-ng/helm/avatar';
import { BrnSeparatorComponent } from '@spartan-ng/brain/separator';
import { HlmSeparatorDirective } from '@spartan-ng/helm/separator';
import { environment } from '../../../../../environments/environment';

@Component({
  selector: 'app-user-page',
  templateUrl: './user-page.component.html',
  imports: [
    // HlmCardContentDirective,
    HlmCardDescriptionDirective,
    HlmCardDirective,
    // HlmCardFooterDirective,
    HlmCardHeaderDirective,
    HlmCardTitleDirective,
    HlmAvatarImageDirective,
    HlmAvatarComponent,
    // HlmAvatarFallbackDirective,
    // BrnSeparatorComponent,
    // HlmSeparatorDirective,
  ],
})
export class UserPageComponent implements OnInit {
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private userService = inject(UserService);

  readonly apiUrl = environment.apiUrl;

  selectedUser = this.userService.selectedUser;

  ngOnInit(): void {
    this.route.params
      .pipe(
        map((params) => params['id']),
        switchMap((id) => this.fetchUserById(id))
      )
      .subscribe();
  }

  fetchUserById(userId: string): Observable<UserI> {
    return this.userService.getUserById(userId);
  }
}
