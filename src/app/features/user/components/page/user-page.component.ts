import { Component, inject, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { UserI } from '../../interfaces/user.interface';
import { UserService } from '../../services/user.service';
import { ActivatedRoute, Router } from '@angular/router';
import { catchError, EMPTY, switchMap, tap } from 'rxjs';
import { toast } from '@spartan-ng/brain/sonner';
import { UserStateService } from '../../services/user-state.service';
import { apiErrorMessage } from '../../../../shared/functions/api-error';

/**
 * Most of this screen used to be invented.
 *
 * Three hardcoded posts and six picsum.photos images were rendered under
 * whichever user was on screen, attributed to them by name and handle. Beside
 * them sat a Posts/Followers/Following counter trio hardcoded to 0, a "Roles"
 * card containing the badge "Breather", a location reading "Moon", a website
 * linking to a personal domain, and Follow / Edit Cover / overflow buttons with
 * no handlers behind any of them.
 *
 * None of those features exist in this app. What is left is what the API
 * actually returns for a user: their name, handle, bio, presence, join date,
 * and the two things you can do to them.
 */
@Component({
  selector: 'app-user-page',
  templateUrl: './user-page.component.html',
  imports: [DatePipe, HlmButtonImports, HlmCardImports],
})
export class UserPageComponent implements OnInit {
  private userService = inject(UserService);
  private userStateService = inject(UserStateService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  user = signal<UserI | null>(null);
  blocking = signal(false);

  ngOnInit(): void {
    this.route.params
      .pipe(
        switchMap((params) => {
          const userId = params['id'];
          return this.userService.getUserById(userId).pipe(
            tap((user) => this.user.set(user)),
            /*
             * Was `catchError(() => this.router.navigateByUrl(''))`, which sent
             * the user to the root redirect — i.e. to /auth, where the
             * unauthenticated guard bounces a signed-in user straight back.
             * It also fed the navigation's boolean into a stream typed as
             * UserI. /messages is where they actually belong, and the reason
             * is worth saying.
             */
            catchError((err) => {
              toast.error(apiErrorMessage(err, 'That profile is unavailable.'));
              this.router.navigateByUrl('/messages');
              return EMPTY;
            }),
          );
        }),
      )
      .subscribe();
  }

  goToChat(user: UserI) {
    this.router.navigate(['/messages/new'], {
      state: { preselectedUser: user },
    });
  }

  /** Your own profile has no block button. */
  isSelf(user: UserI): boolean {
    return this.userStateService.currentUser()?._id === user._id;
  }

  isBlocked(user: UserI): boolean {
    return this.userService.isBlocked(user._id);
  }

  toggleBlock(user: UserI): void {
    if (this.blocking()) return;
    this.blocking.set(true);

    const blocked = this.isBlocked(user);
    const request = blocked
      ? this.userService.unblockUser(user._id)
      : this.userService.blockUser(user._id);

    request.subscribe({
      next: () => {
        this.blocking.set(false);
        toast.success(
          blocked ? `Unblocked @${user.username}` : `Blocked @${user.username}`,
        );
        // A blocked user is no longer browsable, so staying on their profile
        // would show a page the next reload 404s.
        if (!blocked) this.router.navigateByUrl('/messages');
      },
      error: (err) => {
        this.blocking.set(false);
        toast.error(apiErrorMessage(err, 'Could not update that user'));
      },
    });
  }
}
