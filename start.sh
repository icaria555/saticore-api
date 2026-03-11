#!/bin/sh
# Create the saticore schema if it doesn't exist, then sync tables
npx prisma db push --skip-generate && node dist/index.js
