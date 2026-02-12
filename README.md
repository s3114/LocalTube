# LocalTube

## Run

```bash
npm start
```

Environment variables:

- `PORT`: server listen port (default: `3000`)
- `YTDL_CONFIG_PATH`: custom config file path
- `YTDL_PUBLIC_DIR`: custom public directory path (useful for tests)
- `LOG_LEVEL`: log verbosity (`info` / `warn` / `error`, default: `info`)

## Test

```bash
npm test
```

## Check

```bash
npm run check
```

`npm test` starts a temporary server on a random local port with a temporary
config file, so it does not overwrite your real `config.json`.

## CI

GitHub Actions runs syntax checks and tests on every push / pull request:

- `npm run check`
- `npm test`

## Server Structure

Server routes are split under `server/routes/`:

- `settings-wallpaper-routes.js`
- `local-media-routes.js`
- `network-routes.js`
- `schedule-routes.js`
- `info-routes.js`
- `download-routes.js`
- `live-chat-routes.js`

Server services are split under `server/services/`:

- `sse-bus.js`
- `http-utils.js`
- `process-utils.js`
- `fetch-utils.js`
- `job-queue-service.js`
- `download-job-service.js`
- `download-queue-service.js`
- `input-url-resolver.js`
- `local-video-service.js`
- `wallpaper-service.js`
- `local-path-service.js`
- `config-service.js`
- `startup-service.js`
- `logger-service.js`

Frontend scripts are split under `public/`:

- `app.js` (bootstrap/orchestration)
- `app-core.js` (shared helpers: API envelope parsing, job UI rendering, localStorage utils)
- `app-home-cards.js` (home video card DOM builders)
- `app-renderers.js` (chat/meta render helpers)
- `app-comments.js` (comment tree renderer)
- `app-home-browser.js` (home search/filter panel + browser state)
- `app-dashboard.js` (SSE dashboard updates/system info)
- `app-settings-ui.js` (settings UI logic)
- `app-player-ui.js` (player UI logic)
- `app-player-page.js` (player page composition/bootstrap)
- `app-local-video.js` (local video list + side data loading)
- `app-state.js` (shared app state)
- `app-actions.js` (download form actions)
- `app-routing.js` (header/hash routing)
