# homectl-ui

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
