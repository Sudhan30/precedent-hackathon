import { defineAgent } from "eve";
import { groq } from "@ai-sdk/groq";

// Planner: Groq gpt-oss-120b (GROQ_API_KEY). No other model provider is used.
export default defineAgent({ model: groq("openai/gpt-oss-120b"), reasoning: "high" });
