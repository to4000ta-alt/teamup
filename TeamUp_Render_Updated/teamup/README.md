# Teamup — Student Project Team Finder

Teamup helps university students discover project teams based on their skills, request to join projects, coordinate tasks, chat with teammates, and share project files.

## Technology stack

- **Frontend:** HTML, CSS, vanilla JavaScript
- **Backend:** Node.js 20, Express
- **Database:** PostgreSQL 16
- **Authentication:** bcrypt password hashing + JWT
- **Real-time features:** Socket.IO
- **Object storage:** MinIO
- **Reverse proxy:** Nginx
- **Environment:** Docker Compose

## Requirements

Install Docker Desktop (Windows/macOS) or Docker Engine + Compose (Linux). On Windows, start Docker Desktop before running the commands below.

## First-time setup

1. Extract the ZIP file.
2. Open a terminal in the `teamup` folder.
3. Create your local environment file:

   **Windows PowerShell**
   ```powershell
   Copy-Item .env.example .env
   ```

   **macOS / Linux**
   ```bash
   cp .env.example .env
   ```

4. Open `.env` and replace all placeholder values:
   - `DB_PASSWORD`: long alphanumeric password (letters and numbers only).
   - `MINIO_USER`: MinIO administrator username.
   - `MINIO_PASSWORD`: long password, at least 8 characters.
   - `JWT_SECRET`: random secret with at least 32 characters.

   Do not share `.env` or commit it to Git.

5. Build and start the services:
   ```bash
   docker compose up --build -d
   ```

6. Open **http://localhost** in your browser and create an account.

Useful service addresses:
- Teamup: http://localhost
- MinIO Console: http://localhost:9001
- API health check (through Nginx): http://localhost/api/health

## Common commands

```bash
# View service status
docker compose ps

# Follow application logs
docker compose logs -f api

# Stop services (keeps database and uploaded files)
docker compose down

# Rebuild after code changes
docker compose up --build -d
```

## Database note

`db/init.sql` runs automatically only when the PostgreSQL data volume is created for the first time. If you already ran an older Teamup version, changing `init.sql` alone will not update the existing database. Back up important data before resetting volumes.

To create a backup:
```bash
docker compose exec -T postgres pg_dump -U teamup teamup > teamup-backup.sql
```

**Warning:** `docker compose down -v` permanently deletes the local PostgreSQL and MinIO volumes (database records and uploaded files). Only use it when you intentionally want a completely fresh local installation and have saved anything important.

## Main features

1. Account registration and sign-in.
2. Student profile with major, bio, and skills.
3. Project creation and project browsing.
4. Skill-based project matching.
5. Join requests with owner approval.
6. Team task assignment and progress tracking.
7. Real-time team chat and notifications.
8. Team file uploads and downloads.
9. Scheduled reminders for unfinished tasks due soon.

## Security and validation improvements in this edition

- JWT secret is required from `.env`; no weak built-in fallback.
- Passwords are hashed with bcrypt and new registrations require 8–72 characters.
- Project size, titles, task titles, task statuses, and upload size are validated.
- Only project members can access shared project files.
- Cover images are served inline only for supported image MIME types; other files are downloaded as attachments.
- Task assignees must belong to the same project.
- Join acceptance locks the project/request in a database transaction and checks capacity before adding a member.
- Database constraints protect team size and status fields.
- Socket events validate authentication and membership before joining a project room or sending chat messages.

## Project documentation

See:
- `docs/PROJECT_GUIDE_AR.md` — Arabic project explanation, architecture, database overview, and demonstration plan.
- `docs/DEFENSE_QA_AR.md` — suggested discussion questions and answers.
- `docs/TEST_CHECKLIST_AR.md` — manual acceptance test checklist.

## Academic integrity / deployment note

This repository is a student-project implementation and local demonstration setup. Before any public internet deployment, add HTTPS, production-grade secret management, backups, monitoring, rate limiting, and a formal security review. Verify the application on the target laptop before presenting it.

## Render deployment

A Render Blueprint is provided in `render.yaml`. Follow `docs/RENDER_DEPLOYMENT_AR.md` for deployment and environment configuration. Render deployment uses a Static Site for the frontend, a Docker Web Service for the API, and a managed PostgreSQL database. MinIO-compatible object storage must be configured separately; it is not created by the Blueprint.
