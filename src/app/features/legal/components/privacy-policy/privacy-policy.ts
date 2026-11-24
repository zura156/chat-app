import { Component } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { LEGAL } from '../../legal.config';
import { LegalFactComponent } from '../legal-fact/legal-fact';

/**
 * Every statement here was checked against the code when it was written —
 * the user model's fields, `PUBLIC_USER_FIELDS`, the session metadata in
 * `token.service.ts`, `deleteAccount`, `deleteMessage`, the cookies the API
 * sets. A policy that describes the app you meant to build rather than the
 * one that runs is the most common way a small service ends up misleading its
 * users. When behaviour changes, change the sentence that describes it.
 */
@Component({
  imports: [RouterLink, DatePipe, LegalFactComponent],
  templateUrl: './privacy-policy.html',
  styleUrl: '../legal-document.css',
})
export class PrivacyPolicy {
  protected readonly legal = LEGAL;

  protected readonly sections = [
    { id: 'who-we-are', title: 'Who we are' },
    { id: 'what-we-collect', title: 'What we collect' },
    { id: 'how-we-use-it', title: 'How we use it, and why' },
    { id: 'who-can-see-it', title: 'Who can see it' },
    { id: 'security', title: 'Security and encryption' },
    { id: 'retention', title: 'How long we keep it' },
    { id: 'your-rights', title: 'Your choices and rights' },
    { id: 'transfers', title: 'Where it is stored' },
    { id: 'children', title: 'Children' },
    { id: 'changes', title: 'Changes to this policy' },
    { id: 'contact', title: 'Contact' },
  ] as const;
}
