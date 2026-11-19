import openai
def f(client, role):
    m = [{"role": "system", "content": f"You are {role}"}]  # EXPECT llm-app-security.user-text-in-system-prompt
