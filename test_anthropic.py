import anthropic
import os
import sys

client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))
try:
    response = client.messages.create(
        model="claude-opus-4-8",
        max_tokens=1024,
        messages=[{"role": "user", "content": "hi"}]
    )
    print("Success:", response.content[0].text)
except Exception as e:
    print("Error:", e)
