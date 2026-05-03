# Client Dashboard

React + Vite based local dashboard for the bookmark organizer.

## Scripts

- `npm run dev`: start the Vite development server
- `npm run dev:demo`: start the dashboard in sample-data mode
- `npm run lint`: run ESLint
- `npm run build`: create a production build

## Notes

- The dashboard expects the server API on `http://localhost:3001` (or the same hostname on port `3001`).
- In demo mode (`VITE_DEMO_MODE=true`), the UI loads local sample data and skips live server status/events.
- Save operations intentionally trigger browser shutdown/restart flows, so the dashboard reopens itself after the sequence completes.
