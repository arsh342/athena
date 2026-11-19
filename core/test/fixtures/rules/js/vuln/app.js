const express = require('express');
const { exec } = require('child_process');
const fs = require('fs');
const crypto = require('crypto');
const https = require('https');
const app = express();

app.get('/user', (req, res) => {
  const id = req.query.id;
  db.query("SELECT * FROM users WHERE id = " + id); // EXPECT taint.sql-injection
});

app.get('/ping', (req, res) => {
  exec('ping ' + req.query.host); // EXPECT taint.command-injection
});

app.get('/file', (req, res) => {
  const name = req.query.name;
  fs.readFile('/data/' + name, (e, d) => res.send('ok')); // EXPECT taint.path-traversal
});

app.post('/eval', (req, res) => {
  eval(req.body.code); // EXPECT taint.code-injection
});

app.get('/go', (req, res) => {
  res.redirect(req.query.next); // EXPECT taint.open-redirect
});

app.get('/hi', (req, res) => {
  res.send('<h1>' + req.query.name + '</h1>'); // EXPECT taint.xss
});

app.get('/proxy', async (req, res) => {
  const r = await fetch(req.query.url); // EXPECT taint.ssrf
  res.sendStatus(200);
});

function buildQuery(name) {
  return "SELECT * FROM t WHERE n = '" + name + "'";
}
app.get('/search', (req, res) => {
  db.query(buildQuery(req.query.q)); // EXPECT taint.sql-injection
});

function runCmd(c) {
  exec(c);
}
app.post('/run', (req, res) => {
  runCmd(req.body.cmd); // EXPECT taint.command-injection
});

app.post('/users', (req, res) => {
  User.create(req.body); // EXPECT authz.mass-assignment
  User.findOne(req.query); // EXPECT injection.nosql-object
  res.cookie('sid', 'abc'); // EXPECT cookie.insecure-flags
});

app.use((err, req, res, next) => {
  res.status(500).send(err.stack); // EXPECT error.stack-leak
});

function hashPassword(password) {
  return crypto.createHash('md5').update(password).digest('hex'); // EXPECT crypto.weak-hash
}
const resetToken = Math.random().toString(36); // EXPECT crypto.insecure-random
const agent = new https.Agent({ rejectUnauthorized: false }); // EXPECT tls.verification-disabled
const claims = jwt.decode(someValue); // EXPECT jwt.unverified-or-none
const slow = /(a+)+$/; // EXPECT regex.redos
function same(token, providedToken) {
  return token === providedToken; // EXPECT auth.timing-unsafe-compare
}
