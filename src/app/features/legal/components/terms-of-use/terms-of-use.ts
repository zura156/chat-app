import { Component } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { LEGAL } from '../../legal.config';
import { LegalFactComponent } from '../legal-fact/legal-fact';

/**
 * Acceptable use lives here rather than on a page of its own: it is what the
 * enforcement section points at, and a user agreeing to the Terms should be
 * agreeing to the rules in the same breath.
 *
 * Nothing here promises a mechanism the app does not have. There is no
 * in-app report button, so reports go to the contact address; there is no
 * proactive scanning of message text, so the Terms do not claim any.
 */
@Component({
  imports: [RouterLink, DatePipe, LegalFactComponent],
  templateUrl: './terms-of-use.html',
  styleUrl: '../legal-document.css',
})
export class TermsOfUse {
  protected readonly legal = LEGAL;

  protected readonly sections = [
    { id: 'agreement', title: 'Agreeing to these terms' },
    { id: 'eligibility', title: 'Who can use the Service' },
    { id: 'account', title: 'Your account' },
    { id: 'content', title: 'Your content' },
    { id: 'acceptable-use', title: 'Acceptable use' },
    { id: 'enforcement', title: 'Reports and enforcement' },
    { id: 'copyright', title: 'Copyright complaints' },
    { id: 'service', title: 'The Service' },
    { id: 'disclaimers', title: 'Disclaimers' },
    { id: 'liability', title: 'Limitation of liability' },
    { id: 'ending', title: 'Ending your use' },
    { id: 'changes', title: 'Changes to these terms' },
    { id: 'law', title: 'Governing law' },
    { id: 'contact', title: 'Contact' },
  ] as const;
}
