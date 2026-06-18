// Unified AI client.
//
// Supports any provider with an Anthropic or OpenAI-compatible API:
//   AI_PROVIDER=anthropic          # default — uses @anthropic-ai/sdk
//   AI_PROVIDER=openai             # uses OpenAI-compatible HTTP (axios)
//
//   AI_API_KEY=                    # master key (overrides provider-specific keys)
//   ANTHROPIC_API_KEY=             # used when AI_PROVIDER=anthropic and AI_API_KEY unset
//   OPENAI_API_KEY=                # used when AI_PROVIDER=openai and AI_API_KEY unset
//
//   AI_BASE_URL=                   # optional: override API base for compatible providers
//                                  #   Fireworks: https://api.fireworks.ai/inference/v1
//                                  #   Together:  https://api.together.xyz/v1
//                                  #   OpenRouter: https://openrouter.ai/api/v1
//                                  #   Local:     http://localhost:11434/v1
//
//   AI_MODEL=                      # optional: override model; see models.js for aliases

let _provider = null;

function getProvider() {
  if (!_provider) {
    _provider = (process.env.AI_PROVIDER || 'anthropic').toLowerCase();
  }
  return _provider;
}

function getApiKey() {
  const provider = getProvider();
  return (
    process.env.AI_API_KEY ||
    (provider === 'openai' ? process.env.OPENAI_API_KEY : null) ||
    process.env.ANTHROPIC_API_KEY
  );
}

function getBaseUrl() {
  const provider = getProvider();
  if (process.env.AI_BASE_URL) return process.env.AI_BASE_URL;
  if (provider === 'openai') return 'https://api.openai.com/v1';
  return null;
}

async function callAnthropic(prompt, modelId, apiKey) {
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic.default({ apiKey });
  const msg = await client.messages.create({
    model: modelId,
    max_tokens: 8096,
    messages: [{ role: 'user', content: prompt }],
  });
  const block = msg.content.find((b) => b.type === 'text');
  if (!block) throw new Error('Anthropic response contained no text block');
  return block.text;
}

async function callOpenAI(prompt, modelId, apiKey, baseUrl) {
  const axios = require('axios');
  const url = `${baseUrl || 'https://api.openai.com/v1'}/chat/completions`;
  const res = await axios.post(
    url,
    {
      model: modelId,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 8096,
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 600_000,
    },
  );
  const choice = res.data.choices?.[0];
  if (!choice) throw new Error('OpenAI-compatible API returned no choices');
  return choice.message.content;
}

// callAI(prompt, modelId) → Promise<string>
// modelId must be the full model ID (e.g. "claude-sonnet-4-6", "gpt-4o").
async function callAI(prompt, modelId) {
  const provider = getProvider();
  const apiKey = getApiKey();

  if (!apiKey) {
    const hint =
      provider === 'openai'
        ? 'Set OPENAI_API_KEY or AI_API_KEY in .env'
        : 'Set ANTHROPIC_API_KEY or AI_API_KEY in .env';
    throw new Error(`AI API key not configured. ${hint}`);
  }

  if (provider === 'anthropic') {
    return callAnthropic(prompt, modelId, apiKey);
  }

  return callOpenAI(prompt, modelId, apiKey, getBaseUrl());
}

module.exports = { callAI, getProvider, getBaseUrl };
