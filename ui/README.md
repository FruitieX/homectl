# homectl-ui

Current Compact UI delivery and design references:
[completion record](../docs/settings-overhaul-2026-09/COMPLETION.md).
The images below are historical screenshots, not the current overhaul.

<div>
<img title="Dashboard" style="height: 420px" src="https://github.com/user-attachments/assets/5281e8bd-bf23-4b0d-9a02-e4dee423d2f5" />
<img title="Groups list" style="height: 420px" src="https://github.com/user-attachments/assets/e2400776-f778-4b25-a3a5-99a3e8f12c01" />
<img title="Scenes list" style="height: 420px" src="https://github.com/user-attachments/assets/d1066f45-8339-4b80-8271-48c3c4dc6917" />
<img title="Device color selector" style="height: 420px" src="https://github.com/user-attachments/assets/d1f29311-86a8-471e-a9e5-2319ea257f3b" />
<img title="Edit multiple devices" style="height: 420px" src="https://github.com/user-attachments/assets/5ae47486-82d7-4f9f-942c-616d8f571d22" />
<img title="Apply colors from image" style="height: 420px" src="https://github.com/user-attachments/assets/e9d25dea-690a-4ee0-83be-6fd2d546ffa4" />
</div>

## Setup

1. Install dependencies: `pnpm install`
2. Start the homectl server on port `45289`
3. Run `pnpm dev` for the Vite dev server, or `pnpm build` to produce a production bundle

### Running in development mode (immediately see your changes)

```
pnpm dev
```

The Vite dev server proxies `/api`, `/health`, and `/ws` to the Rust backend on `localhost:45289`.

### Running in production mode (app works much faster this way)

```
pnpm build
```

The production bundle is written to `ui/dist`. The new unified root Docker image copies that bundle into the same container as `homectl-server`, which then serves both the SPA and the backend API from port `45289`.

## Verification

```sh
pnpm tsc
pnpm lint
pnpm test
pnpm test:browser
```

`test:browser` builds the production bundle with same-origin API calls, starts
the marked in-memory fixture API and Vite preview on free loopback ports, and
launches an isolated Chromium profile. It runs desktop (1440 × 1000) and phone
(390 × 844) journeys through the existing CDP harness. Set `CHROME_BIN` if Chrome
or Chromium is not on PATH. On Nix:

```sh
nix shell nixpkgs#chromium --command nix develop --command pnpm --dir ui test:browser
```

Run the Nix command from the repository root. Node must support built-in
WebSocket and TypeScript stripping (the CI Node 24 and current Nix Node 22 do).
No additional browser automation dependency is needed.

CI runs the same suite after its production build with `SMOKE_SKIP_BUILD=1`.
Use that flag locally only with a freshly built, same-origin bundle. The suite
refuses an unmarked API and blocks unexpected external browser requests. All
configuration writes are fixture-only; worker preview responses and weather/
price data are synthetic. Real execution/no-dispatch and persistence semantics
have Rust tests. CI does not claim physical touch or overnight kiosk coverage.

Screenshots and service/driver logs go to ignored `ui/test-artifacts/browser/`.
CI uploads them as `ui-browser-smoke` even when the job fails. The runner stops
its own process groups and deletes its temporary browser profile on exit.
The focused drivers in `ui/dev/` remain available for more extensive manual
reviews; CI runs only the representative smoke driver.
