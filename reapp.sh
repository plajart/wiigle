#!/bin/sh

#timedatectl set-timezone Asia/Seoul
ln -sf /usr/share/zoneinfo/Asia/Seoul /etc/localtime
dpkg-reconfigure -f noninteractive tzdata
#date

cd /app
npm install -g n
n lts
ln -sf /usr/local/bin/node /opt/bitnami/node/bin/node

npm run build
npm start &

tail -f /dev/null
