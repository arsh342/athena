import openai
def f(client, text):
    m = [{"role": "system", "content": "You are helpful."}, {"role": "user", "content": text}]
