from __future__ import annotations

import subprocess
from typing import Protocol


class LLMClient(Protocol):
    def complete(self, prompt: str) -> str: ...


class ClaudeCodeLLM:
    """Shells out to the `claude -p` CLI. Uses the user's Claude Code session
    (Max subscription) rather than billed API calls. Higher per-call latency
    than the API due to subprocess startup."""

    def __init__(self, command: str = "claude", timeout: int = 600):
        self._command = command
        self._timeout = timeout

    def complete(self, prompt: str) -> str:
        try:
            result = subprocess.run(
                [self._command, "-p", prompt],
                capture_output=True,
                text=True,
                timeout=self._timeout,
            )
        except subprocess.TimeoutExpired:
            raise RuntimeError(f"claude CLI timed out after {self._timeout}s")
        if result.returncode != 0:
            raise RuntimeError(f"claude CLI failed (exit {result.returncode}): {result.stderr.strip()}")
        return result.stdout.strip()


class AnthropicLLM:
    """Direct Anthropic API client. Faster than ClaudeCodeLLM but bills the
    account associated with ANTHROPIC_API_KEY. Kept available for production."""

    def __init__(self, model: str = "claude-sonnet-4-6", max_tokens: int = 400):
        from anthropic import Anthropic
        self._client = Anthropic()
        self._model = model
        self._max_tokens = max_tokens

    def complete(self, prompt: str) -> str:
        response = self._client.messages.create(
            model=self._model,
            max_tokens=self._max_tokens,
            messages=[{"role": "user", "content": prompt}],
        )
        for block in response.content:
            if getattr(block, "type", None) == "text":
                return block.text.strip()
        return ""
