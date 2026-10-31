# Believers Professional Network (BPN)

Church professional groups, chats and community. Stronger Together.

- Homepage: registered church cards, search, "Register your church".
- Registrar login: set/change a 4-character member PIN, view members.
- Members join with no login (name, profession, contact + PIN verified server-side).
- 14 professional groups, group chats, anonymous comments shown only as "member"
  with one of 7 colorful person icons.
- Member list links to a Google Sheet per church (stored in the database);
  churches, chats and comments live in Postgres.
- Admin area at `/addy` (password-only login; password set on first visit or
  via the `ADMIN_PASSWORD` env var, never hardcoded).

Run: `npm install && npm run build && npm start` (requires `DATABASE_URL`).
