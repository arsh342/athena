app.post('/webhooks/stripe', express.raw({ type: '*/*' }), (req, res) => {
  const event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], secret);
  handle(event);
  res.sendStatus(200);
});
