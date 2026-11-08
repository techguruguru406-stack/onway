# OnWay — Delivered On Time. Every Time.
## Run (Termux)
pkg install nodejs git → cp .env.example .env (edit) → npm install → npm start → http://localhost:3000
## First steps
1. Log in at /login.html with ADMIN_EMAIL / ADMIN_PASSWORD, then /admin.html. Change the password.
2. Edit LOCS (drop-off points), SVC (rates) and FX (exchange rates) in server.js.
3. Put your WhatsApp number in public/app.js; replace YOURDOMAIN.com in public/sitemap.xml.
4. Set BASE_URL, SMTP_* (emails) and PAYSTACK_SECRET (cards). Paystack webhook URL: BASE_URL/api/paystack/webhook
5. Terms/Privacy are placeholders: get them reviewed.
## Notes
Data lives in data/db.json (back it up). Uploads in uploads/. Rate limiting, security headers, hashed passwords and hashed reset tokens are built in. Use HTTPS and a process manager (pm2) in production.
## Commit
git init && git add . && git commit -m "OnWay full build"
