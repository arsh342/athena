const openai = require('openai');
async function f(client) {
  const completion = await client.chat.completions.create({});
  const plan = JSON.parse(completion.choices[0].message.content);
  const m = [{ role: 'system', content: 'You are a helpful assistant.' }, { role: 'user', content: input }];
}
