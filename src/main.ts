import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';

// iOS Safari ignores `user-scalable=no` in the viewport meta, so its pinch
// zoom has to be cancelled at the gesture level. These events are WebKit-only;
// every other engine is already covered by the meta tag and the `touch-action`
// rule in styles.css.
for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(type, (event) => event.preventDefault(), {
    passive: false,
  });
}

bootstrapApplication(AppComponent, appConfig).catch((err) =>
  console.error(err),
);
