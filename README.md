# Streaming chat demo (Expo + Node)

- `server/`: Express API with a provider-agnostic layer. `POST /chat` streams SSE (`token`, `done`, `error`). Uses Claude if `ANTHROPIC_API_KEY` is set, otherwise a mock provider.
- `app/`: Expo SDK 58, Expo Router, TypeScript. Chat screen streams via `expo/fetch`.

## Run
```bash
cd server && npm run dev          # add ANTHROPIC_API_KEY=... for a real model (MODEL= to override)
cd app && npx expo start          # press i for the iOS simulator
```
On a physical device, set `EXPO_PUBLIC_API_URL=http://<your-LAN-IP>:3001`.

Note: Expo SDK 58 tooling asks for Node >= 22.13; this machine has Node 20.18, which works but warns.
