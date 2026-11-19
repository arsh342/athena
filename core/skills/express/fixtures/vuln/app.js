const express = require('express');
const session = require('express-session');
const app = express(); // EXPECT express.fingerprint-header-enabled
app.use(session({ secret: process.env.S, cookie: { secure: false } })); // EXPECT express.session-cookie-insecure
app.use(express.static('public', { dotfiles: 'allow' })); // EXPECT express.static-dotfiles-allowed
app.use(express.json({ limit: '500mb' })); // EXPECT express.body-limit-huge
