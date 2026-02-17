import { useCallback, useEffect, useMemo, useState } from "react";
import JSZip from "jszip";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  AreaChart,
  Area,
  Legend,
} from "recharts";
import type {
  User,
  Conversation,
  Project,
  UserStats,
  DailyActivity,
  ToolUsageEntry,
  ConversationDetail,
} from "./types";
import "./App.css";

const MSG_TRUNCATE_LIMIT = 2000;

type Theme = "dark" | "light";

function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    const stored = localStorage.getItem("claude-dash-theme");
    if (stored === "dark" || stored === "light") return stored;
    return window.matchMedia("(prefers-color-scheme: light)").matches
      ? "light"
      : "dark";
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("claude-dash-theme", theme);
  }, [theme]);

  const toggle = useCallback(() => {
    setTheme((t) => (t === "dark" ? "light" : "dark"));
  }, []);

  return { theme, toggle };
}

function ThemeToggle({ theme, onToggle }: { theme: Theme; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className="theme-toggle"
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
      title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
    >
      {theme === "dark" ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="5" />
          <line x1="12" y1="1" x2="12" y2="3" />
          <line x1="12" y1="21" x2="12" y2="23" />
          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
          <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
          <line x1="1" y1="12" x2="3" y2="12" />
          <line x1="21" y1="12" x2="23" y2="12" />
          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
          <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      )}
    </button>
  );
}

const COLORS = [
  "#818cf8", // indigo
  "#22d3ee", // cyan
  "#fbbf24", // amber
  "#fb7185", // rose
  "#a78bfa", // violet
  "#34d399", // emerald
  "#f97316", // orange
  "#ec4899", // pink
];

function getUserName(users: User[], uuid: string): string {
  return users.find((u) => u.uuid === uuid)?.full_name ?? "Unknown";
}

function calculateStats(users: User[], conversations: Conversation[]): UserStats[] {
  return users
    .map((user) => {
      const userConvs = conversations.filter((c) => c.account.uuid === user.uuid);
      const allMessages = userConvs.flatMap((c) => c.chat_messages);
      const humanMessages = allMessages.filter((m) => m.sender === "human");
      const assistantMessages = allMessages.filter((m) => m.sender === "assistant");

      const totalHumanChars = humanMessages.reduce(
        (sum, m) => sum + (m.text?.length || 0),
        0
      );
      const totalAssistantChars = assistantMessages.reduce(
        (sum, m) => sum + (m.text?.length || 0),
        0
      );

      let thinkingBlocks = 0;
      const toolUses: Record<string, number> = {};
      for (const msg of allMessages) {
        for (const c of msg.content ?? []) {
          if (c.type === "thinking") thinkingBlocks++;
          if (c.type === "tool_use" && c.name) {
            toolUses[c.name] = (toolUses[c.name] || 0) + 1;
          }
        }
      }

      const lastActive =
        userConvs.length > 0
          ? userConvs.reduce((latest, c) =>
              new Date(c.updated_at).getTime() > new Date(latest.updated_at).getTime() ? c : latest
            ).updated_at
          : "";

      return {
        user,
        conversationCount: userConvs.length,
        messageCount: allMessages.length,
        humanMessages: humanMessages.length,
        assistantMessages: assistantMessages.length,
        totalHumanChars,
        totalAssistantChars,
        avgPromptLength:
          humanMessages.length > 0
            ? Math.round(totalHumanChars / humanMessages.length)
            : 0,
        avgResponseLength:
          assistantMessages.length > 0
            ? Math.round(totalAssistantChars / assistantMessages.length)
            : 0,
        thinkingBlocks,
        toolUses,
        lastActive,
      };
    })
    .sort((a, b) => b.conversationCount - a.conversationCount);
}

function calculateDailyActivity(conversations: Conversation[]): DailyActivity[] {
  const dayMap: Record<string, { conversations: number; messages: number }> = {};
  for (const conv of conversations) {
    const day = conv.created_at.slice(0, 10);
    if (!dayMap[day]) dayMap[day] = { conversations: 0, messages: 0 };
    dayMap[day].conversations++;
    dayMap[day].messages += conv.chat_messages.length;
  }
  return Object.entries(dayMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, data]) => ({ date, ...data }));
}

function calculateToolUsage(conversations: Conversation[]): ToolUsageEntry[] {
  const counts: Record<string, number> = {};
  for (const conv of conversations) {
    for (const msg of conv.chat_messages) {
      for (const c of msg.content ?? []) {
        if (c.type === "tool_use" && c.name) {
          counts[c.name] = (counts[c.name] || 0) + 1;
        }
      }
    }
  }
  return Object.entries(counts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
}

function calculateConversationDetails(
  conversations: Conversation[],
  users: User[]
): ConversationDetail[] {
  return conversations
    .map((conv) => {
      const humanMsgs = conv.chat_messages.filter((m) => m.sender === "human");
      const assistantMsgs = conv.chat_messages.filter((m) => m.sender === "assistant");
      let thinkingBlocks = 0;
      const toolsUsed: Record<string, number> = {};

      for (const msg of conv.chat_messages) {
        for (const c of msg.content ?? []) {
          if (c.type === "thinking") thinkingBlocks++;
          if (c.type === "tool_use" && c.name) {
            toolsUsed[c.name] = (toolsUsed[c.name] || 0) + 1;
          }
        }
      }

      return {
        uuid: conv.uuid,
        name: conv.name || "Untitled",
        userName: getUserName(users, conv.account.uuid),
        created_at: conv.created_at,
        messageCount: conv.chat_messages.length,
        humanMessages: humanMsgs.length,
        assistantMessages: assistantMsgs.length,
        humanChars: humanMsgs.reduce((s, m) => s + (m.text?.length || 0), 0),
        assistantChars: assistantMsgs.reduce(
          (s, m) => s + (m.text?.length || 0),
          0
        ),
        thinkingBlocks,
        toolsUsed,
        hasThinking: thinkingBlocks > 0,
      };
    })
    .sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
}

/* ---- Custom Tooltip ---- */
function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="custom-tooltip">
      {label && <div className="tooltip-label">{label}</div>}
      {payload.map((entry, i) => (
        <div key={i} className="tooltip-row">
          <span
            className="tooltip-dot"
            style={{ background: entry.color }}
          />
          <span className="tooltip-name">{entry.name}</span>
          <span className="tooltip-value">{entry.value.toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}

/* ---- Components ---- */

function SummaryCards({
  users,
  conversations,
  totalMessages,
  thinkingTotal,
  toolTotal,
}: {
  users: User[];
  conversations: Conversation[];
  totalMessages: number;
  thinkingTotal: number;
  toolTotal: number;
}) {
  const cards = [
    { label: "Users", value: users.length },
    { label: "Conversations", value: conversations.length },
    { label: "Messages", value: totalMessages },
    { label: "Thinking Blocks", value: thinkingTotal },
    { label: "Tool Calls", value: toolTotal },
  ];
  return (
    <div className="summary-cards">
      {cards.map((c) => (
        <div className="card" key={c.label}>
          <h3>{c.label}</h3>
          <p className="big-number">{c.value.toLocaleString()}</p>
        </div>
      ))}
    </div>
  );
}

function ActivityTimeline({ data }: { data: DailyActivity[] }) {
  if (data.length === 0) return null;
  return (
    <div className="chart-container full-width">
      <h2>Activity Timeline</h2>
      <ResponsiveContainer width="100%" height={260}>
        <AreaChart data={data}>
          <defs>
            <linearGradient id="gradConv" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#818cf8" stopOpacity={0.3} />
              <stop offset="100%" stopColor="#818cf8" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="gradMsg" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#22d3ee" stopOpacity={0.2} />
              <stop offset="100%" stopColor="#22d3ee" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="var(--chart-grid)"
            vertical={false}
          />
          <XAxis
            dataKey="date"
            stroke="var(--chart-grid)"
            tick={{ fill: "var(--chart-text)", fontSize: 11 }}
            tickLine={false}
          />
          <YAxis
            stroke="var(--chart-grid)"
            tick={{ fill: "var(--chart-text)", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip content={<ChartTooltip />} />
          <Legend
            wrapperStyle={{ fontSize: 12, color: "var(--text-secondary)" }}
          />
          <Area
            type="monotone"
            dataKey="conversations"
            stroke="#818cf8"
            strokeWidth={2}
            fill="url(#gradConv)"
            name="Conversations"
          />
          <Area
            type="monotone"
            dataKey="messages"
            stroke="#22d3ee"
            strokeWidth={2}
            fill="url(#gradMsg)"
            name="Messages"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function UsageByUser({ stats }: { stats: UserStats[] }) {
  const chartData = stats.map((s) => ({
    name: s.user.full_name,
    conversations: s.conversationCount,
    messages: s.humanMessages,
  }));
  return (
    <div className="chart-container">
      <h2>Usage by User</h2>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={chartData} barGap={2}>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="var(--chart-grid)"
            vertical={false}
          />
          <XAxis
            dataKey="name"
            stroke="var(--chart-grid)"
            tick={{ fill: "var(--chart-text)", fontSize: 11 }}
            tickLine={false}
          />
          <YAxis
            stroke="var(--chart-grid)"
            tick={{ fill: "var(--chart-text)", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip content={<ChartTooltip />} />
          <Legend
            wrapperStyle={{ fontSize: 12, color: "var(--text-secondary)" }}
          />
          <Bar
            dataKey="conversations"
            fill="#818cf8"
            name="Conversations"
            radius={[4, 4, 0, 0]}
          />
          <Bar
            dataKey="messages"
            fill="#22d3ee"
            name="User Messages"
            radius={[4, 4, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function ConversationDistribution({ stats }: { stats: UserStats[] }) {
  const pieData = stats
    .filter((s) => s.conversationCount > 0)
    .map((s) => ({ name: s.user.full_name, value: s.conversationCount }));
  return (
    <div className="chart-container">
      <h2>Conversation Distribution</h2>
      <ResponsiveContainer width="100%" height={300}>
        <PieChart>
          <Pie
            data={pieData}
            cx="50%"
            cy="50%"
            labelLine={false}
            label={({ name, percent }) =>
              `${name} ${((percent ?? 0) * 100).toFixed(0)}%`
            }
            outerRadius={100}
            innerRadius={40}
            paddingAngle={3}
            dataKey="value"
            stroke="none"
          >
            {pieData.map((_, i) => (
              <Cell key={`cell-${i}`} fill={COLORS[i % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip content={<ChartTooltip />} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

function ToolUsageChart({ data }: { data: ToolUsageEntry[] }) {
  if (data.length === 0) return null;
  return (
    <div className="chart-container">
      <h2>Tool Usage Breakdown</h2>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data} layout="vertical" barSize={20}>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="var(--chart-grid)"
            horizontal={false}
          />
          <XAxis
            type="number"
            stroke="var(--chart-grid)"
            tick={{ fill: "var(--chart-text)", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            dataKey="name"
            type="category"
            width={120}
            stroke="var(--chart-grid)"
            tick={{ fill: "var(--text-secondary)", fontSize: 12 }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip content={<ChartTooltip />} />
          <Bar
            dataKey="count"
            fill="#a78bfa"
            name="Uses"
            radius={[0, 6, 6, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function ThinkingVsDirect({
  conversations,
}: {
  conversations: ConversationDetail[];
}) {
  const withThinking = conversations.filter((c) => c.hasThinking).length;
  const withoutThinking = conversations.length - withThinking;
  const data = [
    { name: "Extended Thinking", value: withThinking },
    { name: "Direct Response", value: withoutThinking },
  ];
  return (
    <div className="chart-container">
      <h2>Thinking vs Direct Responses</h2>
      <ResponsiveContainer width="100%" height={300}>
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={65}
            outerRadius={100}
            paddingAngle={6}
            dataKey="value"
            label={({ name, value }) => `${name}: ${value}`}
            stroke="none"
          >
            <Cell fill="#fbbf24" />
            <Cell fill="#34d399" />
          </Pie>
          <Tooltip content={<ChartTooltip />} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

function MessageLengthChart({ stats }: { stats: UserStats[] }) {
  const data = stats
    .filter((s) => s.humanMessages > 0)
    .map((s) => ({
      name: s.user.full_name,
      avgPrompt: s.avgPromptLength,
      avgResponse: s.avgResponseLength,
    }));
  if (data.length === 0) return null;
  return (
    <div className="chart-container">
      <h2>Avg Message Length (chars)</h2>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data} barGap={2}>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="var(--chart-grid)"
            vertical={false}
          />
          <XAxis
            dataKey="name"
            stroke="var(--chart-grid)"
            tick={{ fill: "var(--chart-text)", fontSize: 11 }}
            tickLine={false}
          />
          <YAxis
            stroke="var(--chart-grid)"
            tick={{ fill: "var(--chart-text)", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip content={<ChartTooltip />} />
          <Legend
            wrapperStyle={{ fontSize: 12, color: "var(--text-secondary)" }}
          />
          <Bar
            dataKey="avgPrompt"
            fill="#fb7185"
            name="Avg Prompt"
            radius={[4, 4, 0, 0]}
          />
          <Bar
            dataKey="avgResponse"
            fill="#818cf8"
            name="Avg Response"
            radius={[4, 4, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function ResponseRatioChart({ stats }: { stats: UserStats[] }) {
  const data = stats
    .filter((s) => s.totalHumanChars > 0)
    .map((s) => ({
      name: s.user.full_name,
      ratio: parseFloat(
        (s.totalAssistantChars / s.totalHumanChars).toFixed(1)
      ),
    }));
  if (data.length === 0) return null;
  return (
    <div className="chart-container">
      <h2>Response Ratio (assistant / human chars)</h2>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data}>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="var(--chart-grid)"
            vertical={false}
          />
          <XAxis
            dataKey="name"
            stroke="var(--chart-grid)"
            tick={{ fill: "var(--chart-text)", fontSize: 11 }}
            tickLine={false}
          />
          <YAxis
            stroke="var(--chart-grid)"
            tick={{ fill: "var(--chart-text)", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip
            content={<ChartTooltip />}
          />
          <Bar
            dataKey="ratio"
            fill="#22d3ee"
            name="Ratio"
            radius={[4, 4, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function ProjectsSection({ projects }: { projects: Project[] }) {
  if (projects.length === 0) return null;
  return (
    <div className="table-container">
      <h2>Projects</h2>
      <div className="projects-grid">
        {projects.map((p) => (
          <div key={p.uuid} className="project-card">
            <div className="project-header">
              <h3>{p.name}</h3>
              {p.is_starter_project && (
                <span className="badge badge-starter">Starter</span>
              )}
              {p.is_private && (
                <span className="badge badge-private">Private</span>
              )}
            </div>
            <p className="project-desc">
              {p.description
                ? p.description.slice(0, 150) +
                  (p.description.length > 150 ? "..." : "")
                : "No description"}
            </p>
            <div className="project-meta">
              <span>By {p.creator.full_name}</span>
              <span>
                {p.docs.length} doc{p.docs.length !== 1 ? "s" : ""}
              </span>
              <span>{new Date(p.created_at).toLocaleDateString()}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ConversationTopics({
  details,
  onSelect,
}: {
  details: ConversationDetail[];
  onSelect: (uuid: string) => void;
}) {
  return (
    <div className="table-container">
      <h2>Conversation Topics</h2>
      <div className="topics-list">
        {details.map((d) => (
          <div
            key={d.uuid}
            className="topic-row"
            role="button"
            tabIndex={0}
            onClick={() => onSelect(d.uuid)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect(d.uuid);
              }
            }}
          >
            <div className="topic-name">{d.name}</div>
            <div className="topic-meta">
              <span className="topic-user">{d.userName}</span>
              <span>{d.messageCount} msgs</span>
              {d.hasThinking && (
                <span className="badge badge-thinking">Thinking</span>
              )}
              {(() => {
                const toolCount = Object.keys(d.toolsUsed).length;
                return toolCount > 0 ? (
                  <span className="badge badge-tools">
                    {toolCount} tool{toolCount > 1 ? "s" : ""}
                  </span>
                ) : null;
              })()}
              <span className="topic-date">
                {new Date(d.created_at).toLocaleDateString()}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ConversationDetailView({
  detail,
  conversation,
  onBack,
}: {
  detail: ConversationDetail;
  conversation: Conversation;
  onBack: () => void;
}) {
  return (
    <div className="detail-view">
      <button onClick={onBack} className="back-btn">
        Back to Dashboard
      </button>
      <h2>{detail.name}</h2>
      <div className="detail-meta">
        <span>By {detail.userName}</span>
        <span>{new Date(detail.created_at).toLocaleString()}</span>
        <span>
          {detail.humanMessages} prompts / {detail.assistantMessages} responses
        </span>
      </div>

      <div className="detail-stats">
        <div className="mini-card">
          <h4>Human Chars</h4>
          <p>{detail.humanChars.toLocaleString()}</p>
        </div>
        <div className="mini-card">
          <h4>Assistant Chars</h4>
          <p>{detail.assistantChars.toLocaleString()}</p>
        </div>
        <div className="mini-card">
          <h4>Thinking Blocks</h4>
          <p>{detail.thinkingBlocks}</p>
        </div>
        <div className="mini-card">
          <h4>Tools Used</h4>
          <p>{Object.keys(detail.toolsUsed).length}</p>
        </div>
      </div>

      {Object.keys(detail.toolsUsed).length > 0 && (
        <div className="detail-tools">
          <h3>Tools Used</h3>
          <div className="tool-tags">
            {Object.entries(detail.toolsUsed).map(([name, count]) => (
              <span key={name} className="tool-tag">
                {name} <strong>{count}</strong>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="messages-list">
        <h3>Messages</h3>
        {conversation.chat_messages.map((msg) => (
          <div
            key={msg.uuid}
            className={`message ${msg.sender === "human" ? "msg-human" : "msg-assistant"}`}
          >
            <div className="msg-header">
              <span className="msg-sender">
                {msg.sender === "human" ? detail.userName : "Claude"}
              </span>
              <span className="msg-time">
                {new Date(msg.created_at).toLocaleTimeString()}
              </span>
            </div>
            <div className="msg-body">
              {msg.text
                ? msg.text.length > MSG_TRUNCATE_LIMIT
                  ? msg.text.slice(0, MSG_TRUNCATE_LIMIT) + "..."
                  : msg.text
                : "(no text content)"}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function UserTable({ stats }: { stats: UserStats[] }) {
  return (
    <div className="table-container">
      <h2>User Details</h2>
      <table>
        <thead>
          <tr>
            <th>User</th>
            <th>Email</th>
            <th>Convs</th>
            <th>Prompts</th>
            <th>Avg Prompt</th>
            <th>Avg Response</th>
            <th>Ratio</th>
            <th>Thinking</th>
            <th>Last Active</th>
          </tr>
        </thead>
        <tbody>
          {stats.map((s) => (
            <tr key={s.user.uuid}>
              <td>{s.user.full_name}</td>
              <td>{s.user.email_address}</td>
              <td>{s.conversationCount}</td>
              <td>{s.humanMessages}</td>
              <td>{s.avgPromptLength.toLocaleString()}</td>
              <td>{s.avgResponseLength.toLocaleString()}</td>
              <td>
                {s.totalHumanChars > 0
                  ? (s.totalAssistantChars / s.totalHumanChars).toFixed(1) +
                    "x"
                  : "N/A"}
              </td>
              <td>{s.thinkingBlocks}</td>
              <td>
                {s.lastActive
                  ? new Date(s.lastActive).toLocaleDateString()
                  : "N/A"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---- Main App ---- */

function App() {
  const [users, setUsers] = useState<User[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);
  const { theme, toggle: toggleTheme } = useTheme();

  const processZipFile = useCallback(async (file: File) => {
    setLoading(true);
    setError(null);

    try {
      const zip = await JSZip.loadAsync(file);

      let usersData: User[] | null = null;
      let conversationsData: Conversation[] | null = null;
      let projectsData: Project[] = [];

      for (const [path, zipEntry] of Object.entries(zip.files)) {
        if (zipEntry.dir) continue;
        const fileName = path.split("/").pop()?.toLowerCase();

        if (fileName === "users.json") {
          usersData = JSON.parse(await zipEntry.async("string"));
        } else if (fileName === "conversations.json") {
          conversationsData = JSON.parse(await zipEntry.async("string"));
        } else if (fileName === "projects.json") {
          projectsData = JSON.parse(await zipEntry.async("string"));
        }
      }

      if (!usersData || !conversationsData) {
        throw new Error("Zip must contain users.json and conversations.json");
      }

      if (!Array.isArray(usersData) || !Array.isArray(conversationsData)) {
        throw new Error("users.json and conversations.json must be arrays");
      }

      if (!Array.isArray(projectsData)) {
        projectsData = [];
      }

      setUsers(usersData);
      setConversations(conversationsData);
      setProjects(projectsData);
      setDataLoaded(true);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to process zip file"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processZipFile(file);
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") setDragActive(true);
    else if (e.type === "dragleave") setDragActive(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.name.endsWith(".zip")) {
      processZipFile(file);
    } else {
      setError("Please drop a .zip file");
    }
  };

  const handleReset = () => {
    setUsers([]);
    setConversations([]);
    setProjects([]);
    setDataLoaded(false);
    setError(null);
    setSelectedConvId(null);
  };

  const stats = useMemo(
    () => calculateStats(users, conversations),
    [users, conversations]
  );
  const dailyActivity = useMemo(
    () => calculateDailyActivity(conversations),
    [conversations]
  );
  const toolUsage = useMemo(
    () => calculateToolUsage(conversations),
    [conversations]
  );
  const convDetails = useMemo(
    () => calculateConversationDetails(conversations, users),
    [conversations, users]
  );
  const totalMessages = useMemo(
    () => stats.reduce((s, u) => s + u.messageCount, 0),
    [stats]
  );
  const thinkingTotal = useMemo(
    () => stats.reduce((s, u) => s + u.thinkingBlocks, 0),
    [stats]
  );
  const toolTotal = useMemo(
    () => toolUsage.reduce((s, t) => s + t.count, 0),
    [toolUsage]
  );

  if (!dataLoaded) {
    return (
      <div className="upload-screen">
        <div className="upload-top-bar">
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
        </div>
        <h1>Claude Usage Dashboard</h1>
        <p className="subtitle">
          Analyze your team's Claude usage from an export zip
        </p>
        <div
          className={`drop-zone ${dragActive ? "active" : ""}`}
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
        >
          {loading ? (
            <p>Processing...</p>
          ) : (
            <>
              <p>Drag & drop your Claude export zip file here</p>
              <p className="or">or</p>
              <label className="file-input-label">
                Browse files
                <input
                  type="file"
                  accept=".zip"
                  onChange={handleFileChange}
                  hidden
                />
              </label>
            </>
          )}
        </div>
        {error && <p className="error">{error}</p>}
        <p className="hint">
          Export should contain users.json, conversations.json, and optionally
          projects.json
        </p>
      </div>
    );
  }

  if (selectedConvId) {
    const detail = convDetails.find((d) => d.uuid === selectedConvId);
    const conv = conversations.find((c) => c.uuid === selectedConvId);
    if (detail && conv) {
      return (
        <div className="dashboard">
          <ConversationDetailView
            detail={detail}
            conversation={conv}
            onBack={() => setSelectedConvId(null)}
          />
        </div>
      );
    }
  }

  return (
    <div className="dashboard">
      <div className="header">
        <h1>Claude Usage Dashboard</h1>
        <div className="header-actions">
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
          <button onClick={handleReset} className="reset-btn">
            Import New Data
          </button>
        </div>
      </div>

      <SummaryCards
        users={users}
        conversations={conversations}
        totalMessages={totalMessages}
        thinkingTotal={thinkingTotal}
        toolTotal={toolTotal}
      />

      <ActivityTimeline data={dailyActivity} />

      <div className="charts-row">
        <UsageByUser stats={stats} />
        <ConversationDistribution stats={stats} />
      </div>

      <div className="charts-row">
        <ToolUsageChart data={toolUsage} />
        <ThinkingVsDirect conversations={convDetails} />
      </div>

      <div className="charts-row">
        <MessageLengthChart stats={stats} />
        <ResponseRatioChart stats={stats} />
      </div>

      <ProjectsSection projects={projects} />
      <ConversationTopics details={convDetails} onSelect={setSelectedConvId} />
      <UserTable stats={stats} />
    </div>
  );
}

export default App;
