# LocalTube

## Run

```bash
npm start
```

Environment variables:

- `PORT`: server listen port (default: `3000`)
- `YTDL_CONFIG_PATH`: custom config file path
- `YTDL_PUBLIC_DIR`: custom public directory path (useful for tests)

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

Server services are split under `server/services/`:

- `sse-bus.js`
- `http-utils.js`
- `process-utils.js`
- `fetch-utils.js`
- `job-queue-service.js`
- `download-job-service.js`
- `download-queue-service.js`

Frontend scripts are split under `public/`:

- `app.js` (bootstrap/orchestration)
- `app-renderers.js` (home/comment/chat renderers)
- `app-settings-ui.js` (settings UI logic)
- `app-player-ui.js` (player UI logic)
