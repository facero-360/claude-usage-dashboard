export interface User {
  uuid: string;
  full_name: string;
  email_address: string;
  verified_phone_number: string;
}

export interface ContentItem {
  type: "text" | "thinking" | "tool_use" | "tool_result" | "token_budget";
  text?: string;
  name?: string; // tool name for tool_use
  id?: string;
  input?: Record<string, unknown>;
  start_timestamp?: string;
  stop_timestamp?: string;
}

export interface ChatMessage {
  uuid: string;
  text: string;
  sender: "human" | "assistant";
  created_at: string;
  updated_at: string;
  content: ContentItem[];
  attachments?: unknown[];
  files?: unknown[];
}

export interface Conversation {
  uuid: string;
  name: string;
  summary: string;
  created_at: string;
  updated_at: string;
  account: {
    uuid: string;
  };
  chat_messages: ChatMessage[];
}

export interface Project {
  uuid: string;
  name: string;
  description: string;
  is_private: boolean;
  is_starter_project: boolean;
  created_at: string;
  updated_at: string;
  creator: {
    uuid: string;
    full_name: string;
  };
  docs: {
    uuid: string;
    filename: string;
    content: string;
    created_at: string;
  }[];
}

export interface UserStats {
  user: User;
  conversationCount: number;
  messageCount: number;
  humanMessages: number;
  assistantMessages: number;
  avgPromptLength: number;
  avgResponseLength: number;
  totalHumanChars: number;
  totalAssistantChars: number;
  thinkingBlocks: number;
  toolUses: Record<string, number>;
  lastActive: string;
}

export interface DailyActivity {
  date: string;
  conversations: number;
  messages: number;
}

export interface ToolUsageEntry {
  name: string;
  count: number;
}

export interface ConversationDetail {
  uuid: string;
  name: string;
  userName: string;
  created_at: string;
  messageCount: number;
  humanMessages: number;
  assistantMessages: number;
  humanChars: number;
  assistantChars: number;
  thinkingBlocks: number;
  toolsUsed: Record<string, number>;
  hasThinking: boolean;
}
