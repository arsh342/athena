const openai = require('openai');
async function f(client) {
  const completion = await client.chat.completions.create({});
  eval(completion.choices[0].message.content); // EXPECT llm-app-security.model-output-executed
  const m = [{ role: 'system', content: `You are ${userRole}` }]; // EXPECT llm-app-security.user-text-in-system-prompt
}
