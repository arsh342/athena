const express = require('express');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const app = express();
const BASE = '/data';

app.get('/user', (req, res) => {
  db.query('SELECT * FROM users WHERE id = $1', [req.query.id]);
  const id = parseInt(req.query.id, 10);
  db.query('SELECT * FROM users WHERE id = ' + id);
});

app.get('/ping', (req, res) => {
  execFile('ping', ['-c', '1', req.query.host]);
});

app.get('/file', (req, res) => {
  const p = path.resolve(BASE, req.query.name);
  if (!p.startsWith(BASE)) return res.sendStatus(400);
  fs.readFile(p, (e, d) => res.send('ok'));
});

app.get('/hi', (req, res) => {
  res.send('<h1>' + escapeHtml(req.query.name) + '</h1>');
  res.redirect('/home');
  res.json({ name: req.query.name });
});

app.post('/users', (req, res) => {
  User.create({ name: req.body.name });
  res.cookie('sid', 'abc', { httpOnly: true, secure: true, sameSite: 'strict' });
});

function checksum(buf) {
  return crypto.createHash('md5').update(buf).digest('hex');
}
const sessionToken = crypto.randomBytes(32).toString('hex');
const verified = jwt.verify(incoming, key, { algorithms: ['HS256'] });
const ok = crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const fast = /^[a-z0-9]+$/;
