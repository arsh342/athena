const express = require('express');
const helmet = require('helmet');
const session = require('express-session');
const app = express();
app.use(helmet());
app.use(session({ secret: process.env.S, cookie: { secure: true, httpOnly: true } }));
app.use(express.static('public', { dotfiles: 'deny' }));
app.use(express.json({ limit: '100kb' }));
