# Static build served by nginx. No build step — the app is plain HTML/CSS/JS.
FROM nginx:1.27-alpine

# App sources
COPY src/ /usr/share/nginx/html/

# Small nginx tweak: correct CSV mime + gzip
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s \
  CMD wget -qO- http://localhost/ >/dev/null 2>&1 || exit 1
