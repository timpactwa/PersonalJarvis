/**
 * Cross-cutting prompt fragments shared by every provider.
 *
 * The base system prompts in claude.ts / groq.ts / ollama.ts stay
 * provider-specific (each is tuned for its model), but capability-level
 * guidance that should be identical everywhere lives here so it is written
 * and updated in exactly one place.
 */

/**
 * Tells the model about the always-on personalisation context: the user's
 * self-authored profile plus durable memories, both injected each turn via
 * the backend's `topMems` array. Appended to each provider's system prompt.
 */
export const PROFILE_AND_MEMORY_NOTE = `

ABOUT THE USER & MEMORY: A personal profile (what the user has told you about themselves) and durable memories are injected into your context every turn — look for an "About the user:" line and any recalled facts. Treat them as known background: use them naturally to personalise replies, and never announce that you are reading from a profile or memory. The user authors their own profile and can browse or delete stored memories from the app's Settings.`
