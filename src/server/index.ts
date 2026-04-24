// Server process entry point: boots the HTTP + WebSocket host defined in server/app.ts.
// Depends on: ./app.js. Consumed by: npm start:server.

import { bootstrap } from "./app.js";

void bootstrap();
