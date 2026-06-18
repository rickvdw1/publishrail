// Model registry.
//
// Short aliases ("opus", "sonnet") are resolved to full model IDs per provider.
// AI_MODEL env var overrides the resolved ID for every call.
// AI_PROVIDER defaults to "anthropic".

const CLAUDE_MODELS = {
  opus:   'claude-opus-4-8',
  sonnet: 'claude-sonnet-4-6',
};

const OPENAI_MODELS = {
  opus:   'gpt-4o',
  sonnet: 'gpt-4o-mini',
};

function getProvider() {
  return (process.env.AI_PROVIDER || 'anthropic').toLowerCase();
}

function resolveModel(name) {
  // AI_MODEL env var always wins
  if (process.env.AI_MODEL) return process.env.AI_MODEL;

  const alias = (name || '').toLowerCase();
  const provider = getProvider();
  const registry = provider === 'openai' ? OPENAI_MODELS : CLAUDE_MODELS;

  // Return alias directly if it's already a full model ID (contains a slash or hyphen+digit)
  if (!registry[alias]) {
    if (alias.includes('/') || /\w-\d/.test(alias)) return alias; // pass-through
    throw new Error(`Unknown model alias "${name}". Use opus, sonnet, or a full model ID.`);
  }

  return registry[alias];
}

// Short label for logging ("claude-opus-4-8" → "opus").
function modelLabel(modelId) {
  const registry = getProvider() === 'openai' ? OPENAI_MODELS : CLAUDE_MODELS;
  return Object.entries(registry).find(([, id]) => id === modelId)?.[0] ?? modelId;
}

// The full model map for the current provider
const MODELS = new Proxy({}, {
  get(_, key) {
    return getProvider() === 'openai' ? OPENAI_MODELS[key] : CLAUDE_MODELS[key];
  },
});

module.exports = { MODELS, CLAUDE_MODELS, OPENAI_MODELS, resolveModel, modelLabel, getProvider };
