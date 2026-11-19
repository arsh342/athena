app.post('/webhooks/stripe', express.raw({ type: '*/*' }), (req, res) => { // EXPECT payments-webhooks.webhook-unauthenticated
  handle(JSON.parse(req.body));
  res.sendStatus(200);
});
