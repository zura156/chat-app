# src/app/CLAUDE.md

Conventions for the Angular 22 client. The root `CLAUDE.md` covers commands, the zoneless rule, the
CSRF arrangement, the Spartan path mapping, and the environment file swap — this file is the layer
below: how components and services here are actually written.

**Before writing Angular code, call `mcp__angular__get_best_practices`** (the `angular` MCP server) or
invoke the `angular-developer` skill in `.claude/skills/`. v22 is ahead of most training data and both
sources are version-specific.

## Structure

`features/<name>/` holds `components/`, `services/`, `interfaces/`, and where relevant `guards/`,
`interceptors/` and `validators/`. `shared/` holds what more than one feature uses:
`components/`, `directives/`, `pipes/`, `services/`, `interfaces/`, `types/`, `utils/`, `validators/`.

Two file-naming conventions coexist. Newer files drop the suffix (`video-player.ts`,
`media-viewer.ts`, `profile-settings.ts`) per the current Angular style guide; older ones keep it
(`chatbox.component.ts`). Match the directory you are editing — do not rename files as a drive-by.

## Service scope is not uniform

Eleven services are `providedIn: 'root'` singletons. But `MessageService`, `ConversationService` and
`MessageActionsService` are bare `@Injectable()` and are provided **on the `/messages` route** in
`app.routes.ts`. They are therefore scoped to that subtree and destroyed when the user navigates away.

Two consequences: state in those services does not survive leaving `/messages`, and injecting one from
outside that subtree throws a null-injector error. Do not "fix" that by adding `providedIn: 'root'` —
the scoping is deliberate.

## Reactivity

State is signals: `signal()` and `computed()` throughout, `effect()` sparingly (8 uses today — prefer
`computed` and reach for `effect` only for genuine side effects). RxJS is used for HTTP and streams,
with `takeUntilDestroyed` for teardown — that is the convention, use it rather than a manual
`Subscription`.

Because the app is zoneless, anything a template reads must be a signal or written inside something
that already schedules change detection. The failure mode is silent: a plain property mutated in a
`setTimeout`, a promise callback or an `addEventListener` handler updates without the view noticing.

## Component API

- `inject()`, not constructor injection (169 vs 2 today).
- `input()` / `output()` signal functions, not `@Input` / `@Output`. Five `@Output` sites remain and
  are drift, not a pattern to copy.
- Native control flow (`@if`, `@for`, `@switch`) — the codebase has zero `*ngIf`/`*ngFor` left. One
  `ngClass` survives; use `class` bindings.
- **Do not write `changeDetection: ChangeDetectionStrategy.OnPush`** — it is the default in v22. Six
  files still set it explicitly; that is redundant, and safe to delete when you are already editing
  the file.
- **Do not write `standalone: true`** — the default since v20. Two files still do.
- Host bindings go in the `host` object of the decorator, not `@HostListener`. Six `@HostListener`
  sites remain; one of them, in `shared/directives/pan.directive.ts`, is a **deliberate exception**
  documented in a comment — `@HostListener` registers `touchmove` as non-passive. Read the comment
  before changing it.

## Forms

Reactive forms throughout (`@angular/forms`), with custom validators in
`features/auth/validators/` and `shared/validators/`. Signal Forms (`@angular/forms/signals`) are
stable in v22 and are what Angular now recommends for new forms, but nothing here uses them yet —
introducing them means a mixed codebase, so raise it rather than deciding unilaterally mid-feature.

`password.validator.ts` mirrors the server's `password-policy.ts`. See the root `CLAUDE.md`: changing
one without the other, and without the shared vector table, breaks a cross-suite invariant.

## HTTP

Two interceptors, registered in `app.config.ts` in order: `httpOptionsInterceptor` then
`authInterceptor`.

`httpOptionsInterceptor` attaches credentials and `X-CSRF-TOKEN` **only** to URLs starting with
`environment.apiUrl`. Presigned storage PUTs must go out untouched — an extra header breaks the S3
signature and credentials break CORS. It also centrally handles 429 (a "wait", not a sign-out) and
`403 EMAIL_NOT_VERIFIED`, so features do not each re-handle those.

Server errors arrive as `{ message, code?, errors?: [{ field, msg }] }`. `message` is already a
complete sentence naming the failed fields — render it directly; use `errors[]` to place reasons under
individual inputs.

Private media URLs are signed on read and must be fetched through `shared/services/signed-media.service.ts`
rather than composing a URL by hand.

## UI

Spartan components are imported as `@spartan-ng/helm/<name>` and live in `libs/ui/<name>/`. Adding one
requires both the generated directory and a `paths` entry in the root `tsconfig.json`. Call
`spartan_components_get` (the `spartan-ng` MCP) for a component's real API rather than assuming the
shadcn equivalent; `spartan_accessibility_check` is available too.

Styling is Tailwind v4 with `class-variance-authority` for variants and `tailwind-merge` via the local
`cn` helper. Icons come from `@ng-icons/lucide`.

## Tests

Vitest in jsdom via `ng test` (the `@angular/build:unit-test` builder), specs beside their source.
Run one with `npx ng test --include="**/login.component.spec.ts"`. Note that `tsconfig.app.json`
excludes specs, so type errors in them only surface under `npm run typecheck`.
