FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html /usr/share/nginx/html/index.html
COPY styles.css /usr/share/nginx/html/styles.css
COPY app.js /usr/share/nginx/html/app.js
COPY quality.mjs /usr/share/nginx/html/quality.mjs
COPY releases.mjs /usr/share/nginx/html/releases.mjs
EXPOSE 80
