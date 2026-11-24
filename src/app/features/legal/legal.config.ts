import { environment } from '../../../environments/environment';

/**
 * The facts the legal pages state about who runs this service.
 *
 * None of these can be read from the code, so none of them are guessed. An
 * empty value renders as a highlighted "[… not set]" marker in the text and
 * puts a draft banner on top of every legal page: a privacy policy that names
 * no operator and no contact address gives a user nobody to exercise a right
 * against, and should not look finished. Fill these in before linking anyone
 * to /legal.
 */
export const LEGAL = {
  serviceName: 'Chat App',

  /** Your full legal name, or your company's registered name. */
  operatorName: 'Zurab Gagnidze',

  /** A postal address where legal notices and data requests can be sent. */
  operatorAddress: 'Tbilisi, Georgia',

  /**
   * Read by a person, not a no-reply box: privacy requests, legal notices,
   * copyright complaints and abuse reports all arrive here, and there is no
   * in-app reporting flow to catch them instead.
   */
  contactEmail: environment.supportEmail,

  /** The country (or state) whose law governs the Terms, e.g. "<Country>". */
  governingLaw: 'Georgia',

  /** Where the servers holding user data are, e.g. "<Country A> and <Country B>". */
  dataLocation: 'Georgia',

  /**
   * Minimum age to hold an account. 16 is the highest age of digital consent
   * an EU member state can set and is above the US's 13, so at 16 neither
   * needs a parental-consent flow. Check it against any other country you
   * serve. Every page reads it from here, so this is the only place to change.
   */
  minimumAge: 16,

  /** ISO date. Bump it whenever the substance of any legal page changes. */
  lastUpdated: '2026-11-24',
};

/** The facts a reader cannot do without, named the way the banner says them. */
const REQUIRED_FACTS = {
  operatorName: 'operator name',
  operatorAddress: 'postal address',
  contactEmail: 'contact email',
  governingLaw: 'governing law',
  dataLocation: 'where data is stored',
} as const;

export type LegalFact = keyof typeof REQUIRED_FACTS;

export const legalFactLabel = (fact: LegalFact): string => REQUIRED_FACTS[fact];

/** Labels of every required fact still blank — empty once the pages are ready. */
export const MISSING_LEGAL_FACTS: readonly string[] = (
  Object.keys(REQUIRED_FACTS) as LegalFact[]
)
  .filter((fact) => !LEGAL[fact].trim())
  .map(legalFactLabel);
