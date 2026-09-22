# AGENTS.md

- **Tech Stack**: NestJS (v10), TypeScript, Node.js, Jest.
- **Commands**:
  - Install: `npm install`
  - Build: `npm run build`
  - Dev Server: `npm run start:dev`
  - Lint: `npm run lint`
  - Test: `npm test`
  - Format: `npm run format`
- **Architecture**:
  - NestJS backend for UML 2 class diagram modeling web app.
  - Entrypoint: `src/main.ts` -> `src/app.module.ts`.
  - Database is PostgresDB running locally on a docker container called `postgres-db`
- **Environment**:
  - Uses `.env` for config (`PORT=3030`).
