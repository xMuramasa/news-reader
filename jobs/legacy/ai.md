<!-- legacy Markdown prompt, kept for rollback. job meta: {"id": "7e15c4016256", "name": "Weekly AI news feed", "schedule": {"kind": "cron", "expr": "0 9 * * 1", "display": "0 9 * * 1"}, "script": null, "enabled_toolsets": ["web"], "continuity": null, "attach_to_session": true, "deliver": "origin"} -->

Produce a weekly AI news digest covering the past 7 days (up to today). Use web_search and web_extract to find and verify real, dated news from reputable sources (official lab blogs, arXiv, The Verge, Ars Technica, TechCrunch, Reuters, The Information, Hugging Face, GitHub trending, etc.). Only include items published in the last 7 days; verify dates. Never invent items or links.

Sections (skip empty ones):
1. Top stories (3-5 most important, 1-2 sentence why-it-matters each)
2. Model & product releases (frontier labs: OpenAI, Anthropic, Google, Meta, xAI, Mistral, DeepSeek, Qwen, etc.)
3. Open-source & local AI (open-weight models, llama.cpp, MLX, Ollama, Whisper, agent frameworks — reader favors self-hosted/local AI on Apple Silicon)
4. Research highlights (2-4 notable papers)
5. Industry, funding & policy (brief)

Format for Telegram: short bullets, **bold** headline, one-line summary, source link in [text](url) form. No tables. Keep the whole digest under ~500 words. If your previous output is available, avoid repeating stories already covered unless there is a significant update.
