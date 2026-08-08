# Cascanics — site statique servi par Caddy (Railway fournit $PORT)
FROM caddy:2-alpine
COPY Caddyfile /etc/caddy/Caddyfile
COPY . /srv
