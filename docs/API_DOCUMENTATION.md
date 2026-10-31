# API Documentation: AI-Powered Social Media Platform

REST API built with Node.js, Express 5, PostgreSQL (Sequelize), JWT, Socket.IO and Google Gemini.

- **Base URL (local):** `http://localhost:5000`
- **Format:** JSON request and response bodies (`Content-Type: application/json`)
- **Authentication:** `Authorization: Bearer <JWT>` (token returned by register/login, valid 7 days)
- **Postman:** `postman/Social_Media_API.postman_collection.json` + `postman/Social_Media_API.postman_environment.json`

## Contents

1. [Getting started](#1-getting-started)
2. [Conventions](#2-conventions)
3. [System](#3-system)
4. [Authentication](#4-authentication)
5. [Email verification](#5-email-verification)
6. [Password recovery](#6-password-recovery)
7. [User profiles](#7-user-profiles)
8. [Posts](#8-posts)
9. [Likes](#9-likes)
10. [Comments](#10-comments)
11. [Feed](#11-feed)
12. [Notifications](#12-notifications)
13. [Real-time notifications (Socket.IO)](#13-real-time-notifications-socketio)
14. [Admin: user management](#14-admin-user-management)
15. [Admin: dashboard and announcements](#15-admin-dashboard-and-announcements)
16. [AI features](#16-ai-features)
    - [16a. Content moderation (local model, posts and comments)](#16a-content-moderation-local-model-posts-and-comments)
17. [Rate limits](#17-rate-limits)
18. [Endpoint index](#18-endpoint-index)

---

## 1. Getting started

### Requirements

- Node.js 18+ (developed on Node 22)
- PostgreSQL 13+ (uses `gen_random_uuid()`), developed on PostgreSQL 18

### Setup

```bash
npm install
cp .env.example .env          # then fill in the values
# create the database "social_media_db" in pgAdmin (or: createdb social_media_db)
npm run migrate               # creates/updates all tables
npm run dev                   # http://localhost:5000 (auto-restart)
```

| Command | Purpose |
|---|---|
| `npm run dev` | Start with nodemon (development) |
| `npm start` | Start with node (production) |
| `npm run migrate` | Apply pending migrations |
| `npm run migrate:status` | List applied and pending migrations |
| `npm run migrate:undo` | Revert the last migration |
| `npm test` | Run the Jest + Supertest suite against the separate test database |

The server refuses to start while migrations are pending.

### Environment variables

| Variable | Required | Description |
|---|---|---|
| `PORT` | no | HTTP port (default `5000`) |
| `NODE_ENV` | yes | `development`, `production` or `test` |
| `DATABASE_URL` | yes | PostgreSQL connection string |
| `TEST_DATABASE_URL` | for tests | Separate database for `npm test`; its name must contain `test` |
| `JWT_SECRET` | yes | Long random secret for signing tokens |
| `JWT_EXPIRES_IN` | no | Token lifetime (default `7d`) |
| `FRONTEND_URL` | yes | Allowed CORS origin(s), comma-separated |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | for email | SMTP server. Port 465 uses TLS, others use STARTTLS |
| `EMAIL_FROM` | for email | Sender, e.g. `"AI Social <no-reply@example.com>"` |
| `APP_NAME` | no | Brand name in emails (default `AI Social`) |
| `OTP_SECRET` | no | Secret for hashing one-time codes (defaults to `JWT_SECRET`) |
| `GEMINI_API_KEY` | for AI | Google AI Studio API key |
| `GEMINI_MODEL` | no | Gemini model (default `gemini-flash-latest`) |
| `MODERATION_SERVICE_URL` | no | Local moderation service (default `http://127.0.0.1:8001`). Posts and comments are refused (503) while it is unreachable |
| `MODERATION_TIMEOUT_MS` | no | Timeout per moderation request (default `5000`) |
| `MODERATION_SERVICE_KEY` | no | Shared secret sent as `X-Moderation-Key`; set the same value for the Python service |

**Gmail:** `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587` (STARTTLS is required), `SMTP_USER` = the full Gmail address, `SMTP_PASS` = a 16-character [App Password](https://myaccount.google.com/apppasswords) (needs 2-Step Verification; the normal account password is rejected with `535`). Spaces in the App Password are ignored.

**Delivery is always real.** There is no development fallback: codes are never printed to the server log or returned by the API.
Before a code is issued, the server checks the SMTP connection and login with `transporter.verify()` (a success is cached for 5 minutes, a failure for 30 seconds), so no code exists unless it can be emailed.
An email counts as delivered only when the SMTP server accepts the recipient.

- SMTP not configured (`SMTP_HOST` or `EMAIL_FROM` missing): code-sending endpoints return `503`.
- SMTP login or connection failure (e.g. Gmail `535`): `502` `"Could not send email. Please try again later."` In development the message adds a hint about `SMTP_USER`/`SMTP_PASS`.
- The server log shows `SMTP connection successful`, `Verification email delivered successfully to pr***@example.com`, or the SMTP error code. It never shows codes or credentials.

`.env` is loaded from the `Backend/` folder by absolute path (`src/config/env.js`), whichever directory the server is started from. Restart the server after editing it.
**Without Gemini:** AI endpoints respond with `503 AI service is not configured`.

### Development accounts

| Account | Email | Password | Role |
|---|---|---|---|
| Admin | `admin@example.com` | `Admin@12345` | admin |

Admins cannot be created through the API (roles never come from requests). To promote an account in pgAdmin:

```sql
UPDATE users SET role = 'admin' WHERE email = 'someone@example.com';
```

---

## 2. Conventions

### Success responses

Every response has `success`. Lists include `pagination`:

```json
{
  "success": true,
  "posts": [],
  "pagination": { "page": 1, "limit": 10, "total": 42, "total_pages": 5 }
}
```

Pagination query parameters: `page` (default 1) and `limit` (default 10, max 50).

### Error responses

```json
{ "success": false, "message": "Validation failed", "errors": [{ "field": "content", "message": "Content must be between 1 and 5000 characters" }] }
```

`errors` is present only for field-level validation problems. Stack traces are never returned in production.

| Status | Meaning |
|---|---|
| 200 / 201 | OK / created |
| 400 | Invalid input, unknown fields, malformed JSON or ID |
| 401 | Missing, invalid or expired token, or password changed since the token was issued |
| 403 | Authenticated but not allowed (wrong role, not the owner, deactivated account, restricted field) |
| 404 | Resource does not exist (or is hidden, e.g. a post by a deactivated user) |
| 409 | Conflict: duplicate email/username/like, last active admin |
| 413 | Body larger than 100 KB |
| 429 | Rate limit or cooldown hit (see the `Retry-After` header) |
| 502 / 503 / 504 | Email or AI provider failure / not configured / timeout |

### Sample IDs used below

| Entity | ID |
|---|---|
| User "priya_sharma" | `3f6c2a9e-8b1d-4c5e-9a7f-1e2d3c4b5a60` |
| User "rahul_verma" | `7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d` |
| Admin | `b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e` |
| Post | `5d9e8f7a-6b5c-4d3e-a2f1-0e9d8c7b6a51` |
| Comment | `c1d2e3f4-a5b6-4c7d-8e9f-0a1b2c3d4e5f` |
| Notification | `e4f5a6b7-c8d9-4e0f-a1b2-c3d4e5f6a7b8` |

In cURL examples, `$TOKEN` is a user JWT and `$ADMIN_TOKEN` an admin JWT.

---

## 3. System

### GET /api/health

| | |
|---|---|
| Purpose | Liveness check |
| Auth / Role | None |
| Status | `200` |

```json
{ "success": true, "status": "ok", "environment": "development", "uptime": 152.31, "timestamp": "2026-10-31T09:15:02.114Z" }
```

```bash
curl http://localhost:5000/api/health
```

### GET /api/db-status

| | |
|---|---|
| Purpose | Checks PostgreSQL connectivity |
| Auth / Role | None |
| Status | `200`, or `503` if the database is unreachable |

```json
{ "success": true, "database": "social_media_db", "status": "connected" }
```

Error `503`:

```json
{ "success": false, "status": "disconnected", "message": "Database is unreachable" }
```

```bash
curl http://localhost:5000/api/db-status
```

---

## 4. Authentication

### POST /api/auth/register

| | |
|---|---|
| Purpose | Create an account and receive a JWT |
| Auth / Role | None |
| Headers | `Content-Type: application/json` |
| Rules | username 3–50 chars, valid email, password 8–72 chars. Username and email are unique (case-insensitive). Any `role` in the body is ignored |
| Status | `201`; `400` validation; `409` duplicate |

Request:

```json
{ "username": "priya_sharma", "email": "priya@example.com", "password": "Password123!" }
```

Response `201`:

```json
{
  "success": true,
  "message": "Registration successful",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "3f6c2a9e-8b1d-4c5e-9a7f-1e2d3c4b5a60",
    "username": "priya_sharma",
    "email": "priya@example.com",
    "role": "user",
    "is_email_verified": false,
    "is_active": true,
    "created_at": "2026-10-31T09:20:11.482Z",
    "updated_at": "2026-10-31T09:20:11.482Z"
  }
}
```

Error `409`:

```json
{ "success": false, "message": "Email is already registered" }
```

Error `400`:

```json
{
  "success": false,
  "message": "Validation failed",
  "errors": [
    { "field": "username", "message": "Username must be between 3 and 50 characters" },
    { "field": "email", "message": "Email must be a valid email address" },
    { "field": "password", "message": "Password must be between 8 and 72 characters" }
  ]
}
```

```bash
curl -X POST http://localhost:5000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"priya_sharma","email":"priya@example.com","password":"Password123!"}'
```

### POST /api/auth/login

| | |
|---|---|
| Purpose | Log in and receive a JWT. Records `last_login_at` and notifies admins (in the database and live over Socket.IO) |
| Auth / Role | None |
| Headers | `Content-Type: application/json` |
| Status | `200`; `400` missing fields; `401` wrong credentials; `403` deactivated; `429` too many failed attempts |

Request:

```json
{ "email": "priya@example.com", "password": "Password123!" }
```

Response `200`:

```json
{
  "success": true,
  "message": "Login successful",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "3f6c2a9e-8b1d-4c5e-9a7f-1e2d3c4b5a60",
    "username": "priya_sharma",
    "email": "priya@example.com",
    "role": "user",
    "is_email_verified": false,
    "is_active": true,
    "password_changed_at": null,
    "last_login_at": "2026-10-31T09:21:40.007Z",
    "created_at": "2026-10-31T09:20:11.482Z",
    "updated_at": "2026-10-31T09:21:40.008Z"
  }
}
```

Error `401` (identical for an unknown email and a wrong password):

```json
{ "success": false, "message": "Invalid email or password" }
```

```bash
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"priya@example.com","password":"Password123!"}'
```

### GET /api/auth/me

| | |
|---|---|
| Purpose | Return the authenticated account |
| Auth / Role | JWT / any |
| Headers | `Authorization: Bearer <token>` |
| Status | `200`; `401` missing/invalid/expired token; `403` deactivated |

Response `200`:

```json
{ "success": true, "user": { "id": "3f6c2a9e-8b1d-4c5e-9a7f-1e2d3c4b5a60", "username": "priya_sharma", "email": "priya@example.com", "role": "user", "is_email_verified": false, "is_active": true, "last_login_at": "2026-10-31T09:21:40.007Z", "created_at": "2026-10-31T09:20:11.482Z", "updated_at": "2026-10-31T09:21:40.008Z" } }
```

Errors `401`:

```json
{ "success": false, "message": "Authentication required. Provide a Bearer token." }
{ "success": false, "message": "Invalid token" }
{ "success": false, "message": "Token has expired" }
{ "success": false, "message": "Password was changed recently. Please log in again." }
```

```bash
curl http://localhost:5000/api/auth/me -H "Authorization: Bearer $TOKEN"
```

---

## 5. Email verification

Verification uses a **6-digit one-time code (OTP)** sent by email:

- Generated with `crypto.randomInt` and stored only as an HMAC-SHA256 hash (keyed with `OTP_SECRET`, or `JWT_SECRET` if unset) bound to its record. The raw code is never stored, returned by the API or logged in production.
- Valid for **10 minutes**, usable **once**. Requesting a new code invalidates the previous one.
- **5 incorrect attempts** invalidate the code, after which a new code must be requested.
- One email per user every **60 seconds** (`429` + `Retry-After`), plus the rate limits in [section 17](#17-rate-limits).
- Codes are always tied to the **logged-in user** (JWT): nobody can verify another person's email.

Email subject: **"Verify Your AI Social Account"** (the brand comes from `APP_NAME`).

### POST /api/auth/send-verification

| | |
|---|---|
| Purpose | Email a verification code to the **logged-in** user's own address |
| Auth / Role | JWT / any |
| Headers | `Authorization: Bearer <token>` |
| Body | none |
| Status | `200`; `400` already verified; `429` cooldown (with `Retry-After`); `502` SMTP delivery failed (the code is discarded so you can retry immediately); `503` SMTP not configured (production) |

Response `200` (SMTP configured):

```json
{
  "success": true,
  "message": "A verification code has been sent to your email address.",
  "email_delivered": true,
  "email": "pr***@example.com",
  "expires_in_seconds": 600,
  "resend_after_seconds": 60
}
```

`200` is only returned after the SMTP server accepted the email (`email_delivered` is always `true`). On `502`/`503` no code is issued.

Error `429`:

```json
{ "success": false, "message": "Please wait 52 seconds before requesting another code." }
```

```bash
curl -X POST http://localhost:5000/api/auth/send-verification -H "Authorization: Bearer $TOKEN"
```

### POST /api/auth/verify-email

| | |
|---|---|
| Purpose | Confirm the logged-in user's email with the emailed code. Sets `is_email_verified = true` |
| Auth / Role | JWT / any (the code is checked against **your own** latest code only) |
| Body | `{ "otp": "123456" }` (exactly 6 digits; any other field is rejected) |
| Status | `200`; `400` invalid format, incorrect, expired or already verified; `401`; `429` too many attempts |

Request:

```json
{ "otp": "482913" }
```

Response `200`:

```json
{ "success": true, "message": "Email verified successfully" }
```

Error `400` (incorrect code):

```json
{ "success": false, "message": "Incorrect verification code. 4 attempts left.", "errors": [{ "field": "otp", "message": "Incorrect verification code" }] }
```

Error `400` (expired, used, or locked after 5 wrong attempts):

```json
{ "success": false, "message": "This verification code has expired or is no longer valid. Request a new code." }
```

```bash
curl -X POST http://localhost:5000/api/auth/verify-email \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"otp":"482913"}'
```

### POST /api/auth/resend-verification

| | |
|---|---|
| Purpose | Public resend by email address: emails a new code to an unverified account. The code is entered after logging in (`verify-email` requires the JWT) |
| Auth / Role | None |
| Status | `200` for a valid email (does not reveal whether the account exists); `400` invalid email; `429` rate limit; `502`/`503` email service unavailable (returned for every address alike) |

Request: `{ "email": "priya@example.com" }`

Response `200`:

```json
{ "success": true, "message": "If an unverified account exists for this email, a verification code has been sent." }
```

```bash
curl -X POST http://localhost:5000/api/auth/resend-verification \
  -H "Content-Type: application/json" -d '{"email":"priya@example.com"}'
```

---

## 6. Password recovery

Three steps: **email → 6-digit code → single-use reset token → new password**.

- Codes follow the same rules as verification codes (HMAC-hashed, 10 minutes, single use, 5 attempts, 60-second resend cooldown; a new code invalidates the previous code and any reset token).
- A correct code is exchanged for a 256-bit `reset_token` (SHA-256 hashed in the database, valid 10 minutes, single use). The password can only be changed with that token.
- Responses never reveal whether an email is registered: unknown emails, wrong codes and expired codes get identical answers. The SMTP check runs before the account lookup, so an email outage returns the same `502`/`503` for every address.
- A successful reset bcrypt-hashes the new password, sets `password_changed_at` (which **invalidates every JWT issued before it**, so all sessions are logged out), marks the email as verified, and invalidates every outstanding code and reset token.

Email subject: **"Reset Your AI Social Password"**.

### POST /api/auth/forgot-password

| | |
|---|---|
| Purpose | Email a password reset code |
| Auth / Role | None |
| Body | `{ "email": "priya@example.com" }` |
| Status | `200` for a valid email (identical for registered and unregistered addresses); `400`; `429`; `502`/`503` email service unavailable (identical for every address; no code is issued) |

Response `200`:

```json
{
  "success": true,
  "message": "If an account exists for this email, a password reset code has been sent.",
  "expires_in_seconds": 600,
  "resend_after_seconds": 60
}
```

```bash
curl -X POST http://localhost:5000/api/auth/forgot-password \
  -H "Content-Type: application/json" -d '{"email":"priya@example.com"}'
```

### POST /api/auth/verify-reset-otp

| | |
|---|---|
| Purpose | Verify the emailed code and receive a single-use reset token |
| Auth / Role | None |
| Body | `{ "email": "...", "otp": "123456" }` (no other fields) |
| Status | `200`; `400` invalid/expired code or unknown email (same message); `429` |

Request:

```json
{ "email": "priya@example.com", "otp": "739102" }
```

Response `200`:

```json
{ "success": true, "message": "Code verified", "reset_token": "4c2e1f0a9b8d7c6e5a4f3b2d1c0e9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c3d2e", "expires_at": "2026-10-31T09:45:00.000Z" }
```

Error `400`:

```json
{ "success": false, "message": "Invalid or expired code. Check the code or request a new one." }
```

```bash
curl -X POST http://localhost:5000/api/auth/verify-reset-otp \
  -H "Content-Type: application/json" -d '{"email":"priya@example.com","otp":"739102"}'
```

### POST /api/auth/verify-reset-token

| | |
|---|---|
| Purpose | Check that a `reset_token` is still valid (e.g. before showing the password form) |
| Auth / Role | None |
| Body | `{ "token": "<reset_token>" }` |
| Status | `200` valid; `400` invalid, expired or used |

Response `200`:

```json
{ "success": true, "valid": true, "expires_at": "2026-10-31T09:45:00.000Z" }
```

Error `400`:

```json
{ "success": false, "message": "Invalid or expired password reset session. Please request a new code." }
```

### POST /api/auth/reset-password

| | |
|---|---|
| Purpose | Set a new password using the `reset_token` from `verify-reset-otp` |
| Auth / Role | None |
| Body | `{ "token": "<reset_token>", "password": "NewSecurePass456!" }` (password 8–72 chars) |
| Status | `200`; `400` invalid token or password |

Response `200`:

```json
{ "success": true, "message": "Password reset successfully. Please log in with your new password." }
```

```bash
curl -X POST http://localhost:5000/api/auth/reset-password \
  -H "Content-Type: application/json" \
  -d '{"token":"<reset_token>","password":"NewSecurePass456!"}'
```

---

## 7. User profiles

### GET /api/users/profile

| | |
|---|---|
| Purpose | The logged-in user's account and profile |
| Auth / Role | JWT / any |
| Status | `200`; `401` |

Response `200`:

```json
{
  "success": true,
  "user": {
    "id": "3f6c2a9e-8b1d-4c5e-9a7f-1e2d3c4b5a60",
    "username": "priya_sharma",
    "email": "priya@example.com",
    "role": "user",
    "is_email_verified": true,
    "created_at": "2026-10-31T09:20:11.482Z",
    "updated_at": "2026-10-31T09:21:40.008Z",
    "profile": { "full_name": "Priya Sharma", "bio": "Full-stack developer exploring AI.", "avatar_url": null, "location": "Ahmedabad, India", "website": "https://example.com" }
  }
}
```

```bash
curl http://localhost:5000/api/users/profile -H "Authorization: Bearer $TOKEN"
```

### PUT /api/users/profile

| | |
|---|---|
| Purpose | Update your own username and profile fields (partial update) |
| Auth / Role | JWT / any (always the token's user) |
| Allowed fields | `username`, `full_name` (≤100), `bio` (≤500), `avatar_url` (http/https), `location` (≤100), `website` (http/https). `null` clears an optional field |
| Status | `200`; `400` invalid or unknown field; `403` restricted field (`role`, `email`, `password`, `is_active`, `is_email_verified`, `id`, ...); `409` username taken |

Request:

```json
{ "full_name": "Priya Sharma", "bio": "Full-stack developer exploring AI.", "location": "Ahmedabad, India", "website": "https://example.com" }
```

Response `200`: same shape as GET, with `"message": "Profile updated successfully"`.

Error `403`:

```json
{ "success": false, "message": "These fields cannot be updated here: role" }
```

```bash
curl -X PUT http://localhost:5000/api/users/profile \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"bio":"Full-stack developer exploring AI."}'
```

### GET /api/users/:id

| | |
|---|---|
| Purpose | Another user's public profile (no email, role or account flags) |
| Auth / Role | None |
| Status | `200`; `400` malformed ID; `404` not found or deactivated |

Response `200`:

```json
{
  "success": true,
  "user": {
    "id": "3f6c2a9e-8b1d-4c5e-9a7f-1e2d3c4b5a60",
    "username": "priya_sharma",
    "joined_at": "2026-10-31T09:20:11.482Z",
    "profile": { "full_name": "Priya Sharma", "bio": "Full-stack developer exploring AI.", "avatar_url": null, "location": "Ahmedabad, India", "website": "https://example.com" }
  }
}
```

```bash
curl http://localhost:5000/api/users/3f6c2a9e-8b1d-4c5e-9a7f-1e2d3c4b5a60
```

---

## 8. Posts

A post object:

```json
{
  "id": "5d9e8f7a-6b5c-4d3e-a2f1-0e9d8c7b6a51",
  "content": "Just shipped the backend for my AI-powered social platform! #buildinpublic",
  "image_url": "https://picsum.photos/seed/launch/800/600",
  "author": { "id": "3f6c2a9e-8b1d-4c5e-9a7f-1e2d3c4b5a60", "username": "priya_sharma", "full_name": "Priya Sharma", "avatar_url": null },
  "likes_count": 12,
  "comments_count": 3,
  "liked_by_me": true,
  "created_at": "2026-10-31T09:30:00.000Z",
  "updated_at": "2026-10-31T09:30:00.000Z"
}
```

`liked_by_me` is `false` for anonymous requests. Posts by deactivated users are hidden from everyone except admins.

### POST /api/posts

| | |
|---|---|
| Purpose | Create a post owned by the authenticated user |
| Auth / Role | JWT / any |
| Body | `content` (required, 1–5000 chars, trimmed), `image_url` (optional http/https URL ≤500). Any other field (e.g. `user_id`) is rejected |
| Moderation | Checked by the local model before saving ([section 16a](#16a-content-moderation-local-model-posts-and-comments)): `422 CONTENT_MODERATION_FAILED` if not clean, `503 MODERATION_UNAVAILABLE` if the model service is down |
| Status | `201`; `400`; `401`; `422`; `503` |

Request:

```json
{ "content": "Just shipped the backend for my AI-powered social platform! #buildinpublic", "image_url": "https://picsum.photos/seed/launch/800/600" }
```

Response `201`:

```json
{ "success": true, "message": "Post created successfully", "post": { "id": "5d9e8f7a-6b5c-4d3e-a2f1-0e9d8c7b6a51", "content": "Just shipped the backend for my AI-powered social platform! #buildinpublic", "image_url": "https://picsum.photos/seed/launch/800/600", "author": { "id": "3f6c2a9e-8b1d-4c5e-9a7f-1e2d3c4b5a60", "username": "priya_sharma", "full_name": "Priya Sharma", "avatar_url": null }, "likes_count": 0, "comments_count": 0, "liked_by_me": false, "created_at": "2026-10-31T09:30:00.000Z", "updated_at": "2026-10-31T09:30:00.000Z" } }
```

Error `400` (ownership in the body):

```json
{ "success": false, "message": "Unknown fields: user_id. Allowed: content, image_url" }
```

```bash
curl -X POST http://localhost:5000/api/posts \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"content":"Hello world!","image_url":"https://picsum.photos/seed/a/800/600"}'
```

### GET /api/posts

| | |
|---|---|
| Purpose | List posts |
| Auth / Role | Optional JWT (adds `liked_by_me`) |
| Query | `page`, `limit`, `sort=latest\|oldest\|popular`, `user_id=<uuid>` |
| Status | `200`; `400` invalid query |

Response `200`:

```json
{ "success": true, "posts": [{ "id": "5d9e8f7a-6b5c-4d3e-a2f1-0e9d8c7b6a51", "content": "...", "image_url": null, "author": { "id": "...", "username": "priya_sharma", "full_name": "Priya Sharma", "avatar_url": null }, "likes_count": 12, "comments_count": 3, "liked_by_me": false, "created_at": "...", "updated_at": "..." }], "pagination": { "page": 1, "limit": 10, "total": 1, "total_pages": 1 } }
```

```bash
curl "http://localhost:5000/api/posts?page=1&limit=10&sort=latest"
```

### GET /api/posts/:id

| | |
|---|---|
| Purpose | One post with author and counts |
| Auth / Role | Optional JWT |
| Status | `200`; `400` malformed ID; `404` |

Error `404`:

```json
{ "success": false, "message": "Post not found" }
```

```bash
curl http://localhost:5000/api/posts/5d9e8f7a-6b5c-4d3e-a2f1-0e9d8c7b6a51
```

### PUT /api/posts/:id

| | |
|---|---|
| Purpose | Edit your own post (partial: `content` and/or `image_url`; `image_url: null` removes the image) |
| Auth / Role | JWT / owner only (admins moderate by deleting, not editing) |
| Status | `200`; `400`; `401`; `403` not the owner; `404` |

Request:

```json
{ "content": "Updated: now with real-time notifications via Socket.IO!" }
```

Response `200`: `{ "success": true, "message": "Post updated successfully", "post": { ... } }`

Error `403`:

```json
{ "success": false, "message": "You can only edit your own posts" }
```

```bash
curl -X PUT http://localhost:5000/api/posts/5d9e8f7a-6b5c-4d3e-a2f1-0e9d8c7b6a51 \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"content":"Updated content"}'
```

### DELETE /api/posts/:id

| | |
|---|---|
| Purpose | Delete your own post, or (admin) remove an inappropriate post. Likes, comments and related notifications are removed by cascade |
| Auth / Role | JWT / owner or admin |
| Status | `200`; `403`; `404` |

Response `200` (owner): `{ "success": true, "message": "Post deleted successfully" }`
Response `200` (admin moderation): `{ "success": true, "message": "Post removed by moderator" }`

Error `403`:

```json
{ "success": false, "message": "You can only delete your own posts" }
```

```bash
curl -X DELETE http://localhost:5000/api/posts/5d9e8f7a-6b5c-4d3e-a2f1-0e9d8c7b6a51 -H "Authorization: Bearer $TOKEN"
```

---

## 9. Likes

A unique constraint on `(user_id, post_id)` guarantees one like per user per post, even under concurrent requests.

### POST /api/posts/:id/like

| | |
|---|---|
| Purpose | Like a post. Notifies the post owner (once per user and post, never for self-likes) |
| Auth / Role | JWT / any |
| Status | `201`; `401`; `404` post; `409` already liked |

Response `201`:

```json
{ "success": true, "message": "Post liked", "liked": true, "likes_count": 13 }
```

Error `409`:

```json
{ "success": false, "message": "You have already liked this post" }
```

```bash
curl -X POST http://localhost:5000/api/posts/5d9e8f7a-6b5c-4d3e-a2f1-0e9d8c7b6a51/like -H "Authorization: Bearer $TOKEN"
```

### DELETE /api/posts/:id/like

| | |
|---|---|
| Purpose | Remove your like |
| Auth / Role | JWT / any |
| Status | `200`; `404` post not found or not liked |

Response `200`:

```json
{ "success": true, "message": "Post unliked", "liked": false, "likes_count": 12 }
```

Error `404`:

```json
{ "success": false, "message": "You have not liked this post" }
```

```bash
curl -X DELETE http://localhost:5000/api/posts/5d9e8f7a-6b5c-4d3e-a2f1-0e9d8c7b6a51/like -H "Authorization: Bearer $TOKEN"
```

### GET /api/posts/:id/likes

| | |
|---|---|
| Purpose | Users who liked a post (newest first, paginated) |
| Auth / Role | Optional JWT |
| Status | `200`; `404` |

Response `200`:

```json
{ "success": true, "likes": [{ "user": { "id": "7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d", "username": "rahul_verma", "full_name": null, "avatar_url": null }, "liked_at": "2026-10-31T09:35:12.000Z" }], "pagination": { "page": 1, "limit": 10, "total": 1, "total_pages": 1 } }
```

```bash
curl http://localhost:5000/api/posts/5d9e8f7a-6b5c-4d3e-a2f1-0e9d8c7b6a51/likes
```

---

## 10. Comments

### POST /api/posts/:id/comments

| | |
|---|---|
| Purpose | Comment on a post. Notifies the post owner (not for your own post) |
| Auth / Role | JWT / any |
| Body | `content` (1–1000 chars) |
| Moderation | Checked by the local model before saving ([section 16a](#16a-content-moderation-local-model-posts-and-comments)) |
| Status | `201`; `400`; `401`; `404`; `422`; `503` |

Request:

```json
{ "content": "Congrats! How did you handle real-time notifications?" }
```

Response `201`:

```json
{ "success": true, "message": "Comment added", "comment": { "id": "c1d2e3f4-a5b6-4c7d-8e9f-0a1b2c3d4e5f", "post_id": "5d9e8f7a-6b5c-4d3e-a2f1-0e9d8c7b6a51", "content": "Congrats! How did you handle real-time notifications?", "author": { "id": "7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d", "username": "rahul_verma", "full_name": null, "avatar_url": null }, "created_at": "2026-10-31T09:36:00.000Z", "updated_at": "2026-10-31T09:36:00.000Z" } }
```

```bash
curl -X POST http://localhost:5000/api/posts/5d9e8f7a-6b5c-4d3e-a2f1-0e9d8c7b6a51/comments \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"content":"Congrats!"}'
```

### GET /api/posts/:id/comments

| | |
|---|---|
| Purpose | Comments on a post, oldest first (conversation order), paginated |
| Auth / Role | Optional JWT |
| Status | `200`; `404` |

Response `200`: `{ "success": true, "comments": [ { ...comment } ], "pagination": { ... } }`

```bash
curl "http://localhost:5000/api/posts/5d9e8f7a-6b5c-4d3e-a2f1-0e9d8c7b6a51/comments?page=1&limit=20"
```

### PUT /api/comments/:id

| | |
|---|---|
| Purpose | Edit your own comment |
| Auth / Role | JWT / comment author only |
| Status | `200`; `400`; `403`; `404` |

Request: `{ "content": "Congrats! How did you handle real-time notifications with Socket.IO?" }`

Error `403`:

```json
{ "success": false, "message": "You can only edit your own comments" }
```

```bash
curl -X PUT http://localhost:5000/api/comments/c1d2e3f4-a5b6-4c7d-8e9f-0a1b2c3d4e5f \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"content":"Edited"}'
```

### DELETE /api/comments/:id

| | |
|---|---|
| Purpose | Delete your own comment, or (admin) moderate any comment |
| Auth / Role | JWT / author or admin |
| Status | `200`; `403`; `404` |

Response `200`: `{ "success": true, "message": "Comment deleted" }` (admin: `"Comment removed by moderator"`)

```bash
curl -X DELETE http://localhost:5000/api/comments/c1d2e3f4-a5b6-4c7d-8e9f-0a1b2c3d4e5f -H "Authorization: Bearer $TOKEN"
```

---

## 11. Feed

### GET /api/feed

| | |
|---|---|
| Purpose | Personalized feed: posts from all active users with author, `likes_count`, `comments_count` and `liked_by_me` |
| Auth / Role | JWT / any |
| Query | `page`, `limit`, `sort=latest` (default) or `popular` |
| Performance | One SQL query per page: JOINs for author and profile, indexed correlated subqueries for counts and `liked_by_me` (no N+1 queries) |
| Status | `200`; `400` invalid sort; `401` |

Response `200`:

```json
{
  "success": true,
  "sort": "latest",
  "posts": [
    {
      "id": "5d9e8f7a-6b5c-4d3e-a2f1-0e9d8c7b6a51",
      "content": "Just shipped the backend for my AI-powered social platform! #buildinpublic",
      "image_url": null,
      "author": { "id": "3f6c2a9e-8b1d-4c5e-9a7f-1e2d3c4b5a60", "username": "priya_sharma", "full_name": "Priya Sharma", "avatar_url": null },
      "likes_count": 1,
      "comments_count": 2,
      "liked_by_me": true,
      "created_at": "2026-10-31T09:30:00.000Z",
      "updated_at": "2026-10-31T09:31:00.000Z"
    }
  ],
  "pagination": { "page": 1, "limit": 10, "total": 1, "total_pages": 1 }
}
```

```bash
curl "http://localhost:5000/api/feed?page=1&limit=10&sort=latest" -H "Authorization: Bearer $TOKEN"
```

---

## 12. Notifications

Types: `login` (sent to admins), `like`, `comment`, `announcement`. Messages never contain passwords or tokens. Every endpoint only sees the caller's own notifications; another user's ID returns `404`.

A notification object:

```json
{ "id": "e4f5a6b7-c8d9-4e0f-a1b2-c3d4e5f6a7b8", "type": "like", "message": "rahul_verma liked your post", "post_id": "5d9e8f7a-6b5c-4d3e-a2f1-0e9d8c7b6a51", "related_user": { "id": "7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d", "username": "rahul_verma" }, "is_read": false, "created_at": "2026-10-31T09:35:12.000Z" }
```

**Duplicate avoidance:** like → unlike → like produces one notification (unliking keeps the existing notification). Repeated logins by the same user within 5 minutes produce one admin notification.

**Self-actions:** liking or commenting on your own post never creates a notification. The actor is always the JWT's user; notifications are stored even when the recipient is offline and are delivered live over Socket.IO when they are connected.

### GET /api/notifications

| | |
|---|---|
| Purpose | Your notifications, newest first |
| Auth / Role | JWT / any |
| Query | `page`, `limit`, `unread=true` |
| Status | `200`; `401` |

Response `200`:

```json
{ "success": true, "notifications": [{ "id": "e4f5a6b7-c8d9-4e0f-a1b2-c3d4e5f6a7b8", "type": "comment", "message": "rahul_verma commented on your post: \"Congrats!\"", "post_id": "5d9e8f7a-6b5c-4d3e-a2f1-0e9d8c7b6a51", "related_user": { "id": "7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d", "username": "rahul_verma" }, "is_read": false, "created_at": "2026-10-31T09:36:00.000Z" }], "unread_count": 2, "pagination": { "page": 1, "limit": 10, "total": 2, "total_pages": 1 } }
```

```bash
curl "http://localhost:5000/api/notifications?unread=true" -H "Authorization: Bearer $TOKEN"
```

### GET /api/notifications/unread-count

Response `200`: `{ "success": true, "unread_count": 2 }`

```bash
curl http://localhost:5000/api/notifications/unread-count -H "Authorization: Bearer $TOKEN"
```

### PATCH /api/notifications/:id/read

| | |
|---|---|
| Status | `200`; `404` not found or not yours |

Response `200`: `{ "success": true, "message": "Notification marked as read", "unread_count": 1 }`

Error `404`: `{ "success": false, "message": "Notification not found" }`

```bash
curl -X PATCH http://localhost:5000/api/notifications/e4f5a6b7-c8d9-4e0f-a1b2-c3d4e5f6a7b8/read -H "Authorization: Bearer $TOKEN"
```

### PATCH /api/notifications/read-all

Response `200`: `{ "success": true, "message": "All notifications marked as read", "updated": 2, "unread_count": 0 }`

```bash
curl -X PATCH http://localhost:5000/api/notifications/read-all -H "Authorization: Bearer $TOKEN"
```

### DELETE /api/notifications/:id

Response `200`: `{ "success": true, "message": "Notification deleted" }`. Error `404` as above.

```bash
curl -X DELETE http://localhost:5000/api/notifications/e4f5a6b7-c8d9-4e0f-a1b2-c3d4e5f6a7b8 -H "Authorization: Bearer $TOKEN"
```

---

## 13. Real-time notifications (Socket.IO)

Socket.IO runs on the same port as the REST API.

```js
import { io } from 'socket.io-client';

const socket = io('http://localhost:5000', { auth: { token: accessToken } });

socket.on('connected', ({ user_id, rooms }) => console.log('joined', rooms));
socket.on('notification', (n) => showToast(n.message));          // like, comment, login (admins)
socket.on('announcement', (a) => showBanner(a.message));          // admin announcements
socket.on('admin:user-login', (e) => refreshDashboard(e));       // admins only
socket.on('connect_error', (err) => console.error(err.message)); // e.g. "Token has expired"

// After (re)connecting, fetch anything missed while offline:
// GET /api/notifications?unread=true
```

| Event | Room | Payload |
|---|---|---|
| `connected` | the connecting socket | `{ user_id, rooms }` |
| `notification` | `user:<id>` | notification object (same shape as REST) |
| `announcement` | everyone connected | `{ type, message, related_user, created_at }` |
| `admin:user-login` | `admins` | `{ user: { id, username, role }, logged_in_at }` |

**Security:**

- The handshake JWT is verified with the same logic as HTTP requests (expiry, deactivation, password changes).
- The server assigns rooms. There is no client "join" event, so nobody can subscribe to another user's room.
- Deactivated or deleted users are disconnected immediately.
- The database remains the source of truth; sockets only deliver events.

---

## 14. Admin: user management

All `/api/admin/*` endpoints require a JWT **and** the `admin` role: `401` without a token, `403` for non-admins.

### GET /api/admin/test

Response `200`: `{ "success": true, "message": "Admin access granted", "admin": { "id": "...", "username": "admin", "email": "admin@example.com", "role": "admin" } }`

### GET /api/admin/users

| | |
|---|---|
| Purpose | List, search and filter users |
| Query | `page`, `limit`, `search` (username or email, case-insensitive), `role=user\|admin`, `status=active\|inactive`, `verified=true\|false`, `sort=newest\|oldest\|username\|last_login` |
| Status | `200`; `400` invalid filter; `401`; `403` |

Response `200`:

```json
{
  "success": true,
  "users": [{ "id": "3f6c2a9e-8b1d-4c5e-9a7f-1e2d3c4b5a60", "username": "priya_sharma", "email": "priya@example.com", "role": "user", "is_email_verified": false, "is_active": true, "last_login_at": "2026-10-31T09:21:40.007Z", "created_at": "2026-10-31T09:20:11.482Z", "updated_at": "2026-10-31T09:21:40.008Z" }],
  "filters": { "search": "priya", "role": "user", "status": "active", "verified": null, "sort": "newest" },
  "pagination": { "page": 1, "limit": 10, "total": 1, "total_pages": 1 }
}
```

```bash
curl "http://localhost:5000/api/admin/users?search=priya&role=user&status=active" -H "Authorization: Bearer $ADMIN_TOKEN"
```

### GET /api/admin/users/:id

Purpose: full account details, profile and activity counts. Status: `200`; `404`.

```json
{ "success": true, "user": { "id": "3f6c2a9e-8b1d-4c5e-9a7f-1e2d3c4b5a60", "username": "priya_sharma", "email": "priya@example.com", "role": "user", "is_email_verified": false, "is_active": true, "last_login_at": "2026-10-31T09:21:40.007Z", "password_changed_at": null, "created_at": "...", "updated_at": "...", "posts_count": 4, "comments_count": 9, "likes_given_count": 15, "profile": { "full_name": "Priya Sharma", "bio": "...", "avatar_url": null, "location": "Ahmedabad, India", "website": "https://example.com" } } }
```

```bash
curl http://localhost:5000/api/admin/users/3f6c2a9e-8b1d-4c5e-9a7f-1e2d3c4b5a60 -H "Authorization: Bearer $ADMIN_TOKEN"
```

### PATCH /api/admin/users/:id/status

| | |
|---|---|
| Purpose | Activate or deactivate an account. Deactivation blocks the user's JWTs and disconnects their sockets immediately |
| Body | `{ "is_active": false }`. Only `is_active` is accepted, so roles cannot be changed through the API |
| Safeguards | Cannot change your own status (`400`). Cannot deactivate the last active admin (`409`, enforced with row locks inside a transaction) |
| Status | `200`; `400`; `404`; `409` |

Response `200`:

```json
{ "success": true, "message": "User account deactivated", "user": { "id": "7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d", "username": "rahul_verma", "is_active": false, "...": "..." } }
```

Errors:

```json
{ "success": false, "message": "You cannot change the status of your own account" }
{ "success": false, "message": "Unknown fields: role. Allowed: is_active" }
{ "success": false, "message": "Cannot deactivate the last active admin" }
```

```bash
curl -X PATCH http://localhost:5000/api/admin/users/7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d/status \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -d '{"is_active":false}'
```

### DELETE /api/admin/users/:id

| | |
|---|---|
| Purpose | Permanently delete a user. Their profile, posts, likes, comments, tokens and notifications are removed by cascade |
| Safeguards | Not yourself (`400`); not the last active admin (`409`) |
| Status | `200`; `400`; `404`; `409` |

Response `200`: `{ "success": true, "message": "User rahul_verma deleted" }`

```bash
curl -X DELETE http://localhost:5000/api/admin/users/7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d -H "Authorization: Bearer $ADMIN_TOKEN"
```

---

## 15. Admin: dashboard and announcements

### GET /api/admin/dashboard/stats

All counters come from one PostgreSQL query (scalar subqueries).

```json
{
  "success": true,
  "stats": {
    "users": { "total": 128, "active": 121, "inactive": 7, "verified": 96, "admins": 2, "new_last_7_days": 14, "logins_last_24_hours": 37 },
    "content": { "posts": 412, "comments": 1290, "likes": 3875, "new_posts_last_7_days": 58 },
    "recent_logins": [{ "id": "3f6c2a9e-8b1d-4c5e-9a7f-1e2d3c4b5a60", "username": "priya_sharma", "role": "user", "last_login_at": "2026-10-31T09:21:40.007Z" }]
  }
}
```

```bash
curl http://localhost:5000/api/admin/dashboard/stats -H "Authorization: Bearer $ADMIN_TOKEN"
```

### GET /api/admin/dashboard/recent-activity

Timeline of registrations, logins (latest per user), posts, comments and likes. Query: `page`, `limit`, `type=registration|login|post|comment|like`.

```json
{
  "success": true,
  "activities": [
    { "type": "like", "user_id": "7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d", "username": "rahul_verma", "post_id": "5d9e8f7a-6b5c-4d3e-a2f1-0e9d8c7b6a51", "occurred_at": "2026-10-31T09:35:12.000Z" },
    { "type": "post", "user_id": "3f6c2a9e-8b1d-4c5e-9a7f-1e2d3c4b5a60", "username": "priya_sharma", "post_id": "5d9e8f7a-6b5c-4d3e-a2f1-0e9d8c7b6a51", "occurred_at": "2026-10-31T09:30:00.000Z" },
    { "type": "login", "user_id": "3f6c2a9e-8b1d-4c5e-9a7f-1e2d3c4b5a60", "username": "priya_sharma", "post_id": null, "occurred_at": "2026-10-31T09:21:40.007Z" }
  ],
  "pagination": { "page": 1, "limit": 10, "total": 3, "total_pages": 1 }
}
```

```bash
curl "http://localhost:5000/api/admin/dashboard/recent-activity?type=login" -H "Authorization: Bearer $ADMIN_TOKEN"
```

### GET /api/admin/dashboard/recent-users

Query: `page`, `limit`, `sort=registered|last_login`. Returns `users` (no passwords) + `pagination`.

```bash
curl "http://localhost:5000/api/admin/dashboard/recent-users?sort=last_login&limit=5" -H "Authorization: Bearer $ADMIN_TOKEN"
```

### GET /api/admin/dashboard/recent-posts

Latest posts (including those of deactivated users, for moderation) in the standard post format + `pagination`.

```bash
curl "http://localhost:5000/api/admin/dashboard/recent-posts?limit=5" -H "Authorization: Bearer $ADMIN_TOKEN"
```

### POST /api/admin/announcements

| | |
|---|---|
| Purpose | Notify every active user (one `INSERT ... SELECT` statement) and broadcast over Socket.IO |
| Body | `{ "message": "..." }` (1–500 chars) |
| Status | `201`; `400`; `403` |

Request: `{ "message": "Scheduled maintenance tonight from 11 PM to 11:30 PM IST." }`

Response `201`: `{ "success": true, "message": "Announcement sent", "recipients": 121 }`

```bash
curl -X POST http://localhost:5000/api/admin/announcements \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"message":"Scheduled maintenance tonight."}'
```

---

## 16. AI features

Powered by Google Gemini through the official `@google/genai` SDK. All endpoints:

- require a JWT and are rate limited to 20 requests per 15 minutes per user
- never publish anything (`meta.published: false`); the user reviews the text and calls `POST /api/posts`
- wrap user text in `<user_input>` tags with instructions to treat it as data (prompt-injection guard)
- return safe errors: `429` provider quota (with `Retry-After`), `503` not configured or unavailable, `504` timeout, `502` empty response. Provider details are logged server-side only

### POST /api/ai/generate-post

| | |
|---|---|
| Body | `topic` (1–200 chars, required), `tone` (optional: `professional` (default), `casual`, `friendly`, `humorous`, `inspirational`, `informative`) |
| Status | `200`; `400`; `401`; `429`; `503` |

Request:

```json
{ "topic": "Importance of learning programming", "tone": "professional" }
```

Response `200`:

```json
{
  "success": true,
  "data": {
    "content": "Learning to program is no longer just for software engineers. It sharpens problem-solving, helps you automate repetitive work, and lets you turn ideas into working products.\n\nStart small, stay consistent, and build things you care about. #Programming #LifelongLearning #Tech",
    "topic": "Importance of learning programming",
    "tone": "professional"
  },
  "meta": { "provider": "gemini", "model": "gemini-flash-latest", "published": false, "note": "Generated content is not published. Review it, then create a post with POST /api/posts." }
}
```

Error `503` (no API key):

```json
{ "success": false, "message": "AI service is not configured. Set GEMINI_API_KEY on the server." }
```

```bash
curl -X POST http://localhost:5000/api/ai/generate-post \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"topic":"Importance of learning programming","tone":"professional"}'
```

### POST /api/ai/improve-post

| | |
|---|---|
| Body | `content` (1–2000 chars) |
| Behavior | Fixes grammar and readability while preserving meaning and length |

Request:

```json
{ "content": "i am learning node js and it is very good" }
```

Response `200`:

```json
{
  "success": true,
  "data": { "original": "i am learning node js and it is very good", "improved": "I'm learning Node.js, and I'm really enjoying it." },
  "meta": { "provider": "gemini", "model": "gemini-flash-latest", "published": false, "note": "Generated content is not published. Review it, then create a post with POST /api/posts." }
}
```

```bash
curl -X POST http://localhost:5000/api/ai/improve-post \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"content":"i am learning node js and it is very good"}'
```

### POST /api/ai/summarize

| | |
|---|---|
| Body | `postId` (UUID) |
| Access | Same visibility as the rest of the API: posts by deactivated users return `404` |
| Limits | At most the 50 most recent comments, 500 chars per comment, 2000 chars of post, about 12,000 chars in total |
| No comments | Answers directly without calling the AI (`meta.ai_generated: false`) |
| Status | `200`; `400`; `404`; `429`; `503` |

Request:

```json
{ "postId": "5d9e8f7a-6b5c-4d3e-a2f1-0e9d8c7b6a51" }
```

Response `200`:

```json
{
  "success": true,
  "data": {
    "post_id": "5d9e8f7a-6b5c-4d3e-a2f1-0e9d8c7b6a51",
    "summary": "Priya announced the launch of her AI-powered social platform backend. Commenters congratulated her and asked how real-time notifications work; she explained the Socket.IO setup with per-user rooms secured by JWT.",
    "comments_total": 2,
    "comments_included": 2
  },
  "meta": { "ai_generated": true, "provider": "gemini", "model": "gemini-flash-latest" }
}
```

Response `200` (no comments):

```json
{ "success": true, "data": { "post_id": "5d9e8f7a-6b5c-4d3e-a2f1-0e9d8c7b6a51", "summary": "This post has no comments yet, so there is no discussion to summarize.", "comments_total": 0, "comments_included": 0 }, "meta": { "ai_generated": false } }
```

```bash
curl -X POST http://localhost:5000/api/ai/summarize \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"postId":"5d9e8f7a-6b5c-4d3e-a2f1-0e9d8c7b6a51"}'
```

---

### POST /api/ai/summarize: text mode

The same endpoint also summarizes **text** (e.g. a long draft): send `content` instead of `postId`.

| | |
|---|---|
| Body | `{ "content": "...", "length": "short" \| "medium" \| "detailed" }` (`length` defaults to `medium`; content 1–5000 chars). Send either `postId` **or** `content`, not both |
| Status | `200`; `400`; `401`; `429`; `503` (AI not configured); `504` |

Response `200`:

```json
{
  "success": true,
  "data": { "summary": "Our robotics club placed second at the state competition.", "length": "short", "original_length": 402, "summary_length": 58 },
  "meta": { "ai_generated": true, "provider": "gemini", "model": "gemini-flash-latest", "published": false, "note": "Generated content is not published. Review it, then create a post with POST /api/posts." }
}
```

---

## 16a. Content moderation (local model, posts and comments)

Every post and comment is checked by **our own locally running model** before it is saved. No Gemini, OpenAI,
Claude or other external AI API is used for moderation.

- **Service:** `Backend/ai-moderation` (Python, FastAPI) on `127.0.0.1:8001`, started with `npm run moderation`.
  Node calls it over an internal HTTP request (`MODERATION_SERVICE_URL`, timeout `MODERATION_TIMEOUT_MS`,
  optional shared key `MODERATION_SERVICE_KEY` sent as `X-Moderation-Key`).
- **Model:** a word/phrase list plus a 7-label classifier: a locally **fine-tuned** DistilBERT-multilingual, or the
  TF-IDF + logistic regression baseline, whichever validated better (`ai-moderation/models/deployment.json`).
  Measured performance and limits: `ai-moderation/evaluation/report.md`. The training data is synthetic, so the
  model **can be wrong**.
- **Languages:** English, Hindi (Devanagari), Gujarati (script), Hinglish, romanized Hindi/Gujarati and mixed text,
  including obfuscation (`f*ck`, `b1tch`, `f u c k`, `fuuuck`).
- **Privacy:** user text is never logged or stored by the service or by the moderation client.

**Labels and publishing policy** (this project blocks every non-clean label):

| Label | Severity | Publishing |
|---|---|---|
| `CLEAN` | none | allowed |
| `MILD_PROFANITY` | low | blocked: edit and resubmit |
| `VULGAR` | medium | blocked |
| `PERSONAL_ABUSE` | medium (high for severe slurs) | blocked |
| `HARASSMENT` | high | blocked |
| `HATE_SPEECH` | high | blocked |
| `THREAT` | high | blocked |

When the model leans toward toxic but is below the block threshold and no listed word was found, the decision is
`uncertain`. It is **also refused**, with a "please rephrase" message, so questionable content is never silently
approved. Texts under 3 words are judged by the word list only. Ordinary criticism, disagreement and negative
feedback are not blocked unless they contain abusive language. Context-dependent words such as *kutta* ("dog")
only count when aimed at someone.

### Routes that are moderated

| Route | When |
|---|---|
| `POST /api/posts` | always |
| `PUT /api/posts/:id` | when `content` is sent (after the 403 ownership check) |
| `POST /api/posts/:id/comments` | always (after the 404 post check); no notification is created for refused comments |
| `PUT /api/comments/:id` | always (after the 403 author check) |

The check runs on the server before saving, so calling the API directly cannot bypass it. Fields such as
`moderation` in the request body are rejected (`400 Unknown fields`), and results sent by a client are never trusted.

**Refused (`422`):** nothing is saved.

```json
{
  "success": false,
  "message": "Please remove inappropriate words from your content before publishing.",
  "code": "CONTENT_MODERATION_FAILED",
  "blocked": true,
  "moderation": {
    "decision": "block",
    "blocked": true,
    "is_toxic": true,
    "category": "VULGAR",
    "category_label": "Vulgar language",
    "severity": "medium",
    "confidence": 0.96,
    "detected_language": "English",
    "flagged_terms": [{ "text": "fucking", "start": 5, "end": 12, "category": "VULGAR" }],
    "explanation": "The text contains vulgar or sexual language. Flagged: \"fucking\"."
  }
}
```

- `decision`: `block`, or `uncertain` (then `is_toxic` is `null` and the message is
  "We couldn't verify that this content is appropriate. Please rephrase it and try again.").
- `flagged_terms[].start/end`: UTF-16 positions in the submitted text (JavaScript string indices), for highlighting.
  Empty when only the classifier fired.
- `confidence`: the model's probability that the text is not clean.
- Model names, versions, probabilities and timings are not exposed.

**Moderation service unavailable (`503`):** fail closed, so nothing is saved.

```json
{ "success": false, "message": "Content checking is temporarily unavailable. Please try again.", "code": "MODERATION_UNAVAILABLE" }
```

This covers the service being down, timing out (`MODERATION_TIMEOUT_MS`, default 5000 ms), or returning a malformed
response. The backend logs a safe technical line (`[moderation] Service unavailable at …`), never the content.

### POST /api/ai/moderate-content

Optional pre-check (the composer's "Check" button). Same model and policy as saving, but nothing is saved.

| | |
|---|---|
| Auth | JWT / any |
| Body | `{ "content": "..." }` (1–5000 chars; no other fields) |
| Status | `200`; `400`; `401`; `429` (120 / 15 min / user); `503` service unavailable |

Response `200`: `{ "success": true, "data": { ...moderation object above, "message": "Your content looks good." | "Please remove …" | "We couldn't verify …" } }`

### GET /api/moderation/status

Public. `200 { "success": true, "status": "available" }` or `503 { "success": false, "status": "unavailable" }`.

---

## 17. Rate limits

| Scope | Limit | Key |
|---|---|---|
| All `/api` routes | 1000 / 15 min | IP |
| `register`, `login` | 10 **failed** attempts / 15 min | IP |
| Verification, resend, forgot-password emails | 5 / 15 min | IP + user/email |
| Code email cooldown | 1 / 60 s | user (stored in the database) |
| verify-email, verify-reset-otp (code checks) | 10 / 15 min | IP + user/email |
| Wrong guesses per code | 5, then the code is invalidated | code |
| verify-reset-token, reset-password | 20 / 15 min | IP |
| AI endpoints (generate, improve, summarize) | 20 / 15 min | user |
| moderate-content (local moderation model) | 120 / 15 min | user |

Limited responses: `429` with `RateLimit` and `Retry-After` headers. Limits are disabled in `NODE_ENV=test`.

---

## 18. Endpoint index

| Method | Endpoint | Auth | Role |
|---|---|---|---|
| GET | `/api/health` | – | – |
| GET | `/api/db-status` | – | – |
| POST | `/api/auth/register` | – | – |
| POST | `/api/auth/login` | – | – |
| GET | `/api/auth/me` | JWT | any |
| POST | `/api/auth/send-verification` | JWT | any |
| POST | `/api/auth/resend-verification` | – | – |
| POST | `/api/auth/verify-email` | JWT | any |
| POST | `/api/auth/forgot-password` | – | – |
| POST | `/api/auth/verify-reset-otp` | – | – |
| POST | `/api/auth/verify-reset-token` | – | – |
| POST | `/api/auth/reset-password` | – | – |
| GET | `/api/users/profile` | JWT | any |
| PUT | `/api/users/profile` | JWT | any |
| GET | `/api/users/:id` | – | – |
| POST | `/api/posts` | JWT | any |
| GET | `/api/posts` | optional | – |
| GET | `/api/posts/:id` | optional | – |
| PUT | `/api/posts/:id` | JWT | owner |
| DELETE | `/api/posts/:id` | JWT | owner / admin |
| POST | `/api/posts/:id/like` | JWT | any |
| DELETE | `/api/posts/:id/like` | JWT | any |
| GET | `/api/posts/:id/likes` | optional | – |
| POST | `/api/posts/:id/comments` | JWT | any |
| GET | `/api/posts/:id/comments` | optional | – |
| PUT | `/api/comments/:id` | JWT | author |
| DELETE | `/api/comments/:id` | JWT | author / admin |
| GET | `/api/feed` | JWT | any |
| GET | `/api/notifications` | JWT | any |
| GET | `/api/notifications/unread-count` | JWT | any |
| PATCH | `/api/notifications/:id/read` | JWT | recipient |
| PATCH | `/api/notifications/read-all` | JWT | any |
| DELETE | `/api/notifications/:id` | JWT | recipient |
| GET | `/api/admin/test` | JWT | admin |
| GET | `/api/admin/users` | JWT | admin |
| GET | `/api/admin/users/:id` | JWT | admin |
| PATCH | `/api/admin/users/:id/status` | JWT | admin |
| DELETE | `/api/admin/users/:id` | JWT | admin |
| GET | `/api/admin/dashboard/stats` | JWT | admin |
| GET | `/api/admin/dashboard/recent-activity` | JWT | admin |
| GET | `/api/admin/dashboard/recent-users` | JWT | admin |
| GET | `/api/admin/dashboard/recent-posts` | JWT | admin |
| POST | `/api/admin/announcements` | JWT | admin |
| POST | `/api/ai/generate-post` | JWT | any |
| POST | `/api/ai/improve-post` | JWT | any |
| POST | `/api/ai/summarize` | JWT | any |
| POST | `/api/ai/moderate-content` | JWT | any |
| GET | `/api/moderation/status` | – | – |

**Postman:** import both files from `postman/`, select the **Social Media API - Local** environment and run the collection. It registers two fresh users, exercises every endpoint above (90 requests, 142 assertions; the moderation requests need `npm run moderation`) and deletes its test data at the end. Note that the announcement step notifies every active user in the database.
