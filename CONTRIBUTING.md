# Contributing

Thanks for helping. Small, focused pull requests are the easiest to review.

1. `npm install`
2. Make your change. Shared logic goes in `src/`, then `npm run core` copies it to `docs/app/core/`.
3. Run the checks:

```bash
npm run lint
npm run rules
npm test
npm run core:check
npm run sw        # refresh the offline file list after changing the app
npm run e2e       # needs a Chromium based browser and internet access for the public relays
```

House rules, checked by `npm run rules`: plain English, no emoji, no long dash characters, and no names of other products. Keep claims honest; if the browser limits something, say so in the README and in the app.

By contributing you agree that your work is released under the MIT license.
