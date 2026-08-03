import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmBadgeImports } from '@spartan-ng/helm/badge';
import { BrnTabsImports } from '@spartan-ng/brain/tabs';
import { HlmTabsImports } from '@spartan-ng/helm/tabs';
import { UserI } from '../../interfaces/user.interface';
import { UserService } from '../../services/user.service';
import { ActivatedRoute, Router } from '@angular/router';
import { catchError, switchMap, tap } from 'rxjs';
import { toast } from '@spartan-ng/brain/sonner';
import { UserStateService } from '../../services/user-state.service';

interface Post {
  id: number;
  content: string;
  likes: number;
  replies: number;
  reposts: number;
  createdAt: Date;
}
@Component({
  selector: 'app-user-page',
  templateUrl: './user-page.component.html',
  imports: [
    CommonModule,
    DatePipe,
    HlmButtonImports,
    HlmCardImports,
    HlmBadgeImports,
    BrnTabsImports,
    HlmTabsImports,
  ],
})
export class UserPageComponent implements OnInit {
  private userService = inject(UserService);
  private userStateService = inject(UserStateService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  user = signal<UserI | null>(null);
  blocking = signal(false);

  //  {
  //   displayName: 'Jane Doe',
  //   username: 'janedoe',
  //   avatarUrl: 'https://i.pravatar.cc/150?img=47',
  //   bio: 'Full-stack developer building cool things. Open source enthusiast. Coffee addict. ☕',
  //   location: 'San Francisco, CA',
  //   website: 'https://janedoe.dev',
  //   joinedDate: new Date('2022-03-15'),
  //   roles: ['Admin', 'Moderator', 'Developer'],
  //   stats: {
  //     posts: 142,
  //     followers: '2.4K',
  //     following: 318,
  //   },
  // };

  posts: Post[] = [
    {
      id: 1,
      content:
        'Just shipped a new feature using Angular signals + spartan-ng. The DX is incredible! 🚀',
      likes: 48,
      replies: 7,
      reposts: 12,
      createdAt: new Date('2025-03-20'),
    },
    {
      id: 2,
      content:
        'Hot take: Tailwind CSS + spartan-ng is the best UI stack for Angular in 2026.',
      likes: 93,
      replies: 21,
      reposts: 34,
      createdAt: new Date('2025-03-18'),
    },
    {
      id: 3,
      content:
        'Working on an open-source chat app. Stay tuned for the repo drop this week! 👀',
      likes: 61,
      replies: 14,
      reposts: 9,
      createdAt: new Date('2025-03-15'),
    },
  ];

  mediaImages: string[] = [
    'https://picsum.photos/seed/a/300/300',
    'https://picsum.photos/seed/b/300/300',
    'https://picsum.photos/seed/c/300/300',
    'https://picsum.photos/seed/d/300/300',
    'https://picsum.photos/seed/e/300/300',
    'https://picsum.photos/seed/f/300/300',
  ];

  ngOnInit(): void {
    this.route.params
      .pipe(
        switchMap((params) => {
          const userId = params['id'];
          return this.userService.getUserById(userId).pipe(
            tap((user) => this.user.set(user)),
            catchError(() => this.router.navigateByUrl('')),
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
      error: () => {
        this.blocking.set(false);
        toast.error('Could not update that user');
      },
    });
  }
}
