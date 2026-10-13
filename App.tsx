import { useEffect, useRef, useState } from "react";
import "./App.css";

type Message = {
  role: "user" | "assistant";
  content: string;
};

type StreamEvent = {
  type: "token" | "done" | "error";
  content?: string;
};

function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const sendingRef = useRef(false);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({
      behavior: "smooth",
    });
  }, [messages]);

  async function sendMessage() {
    const text = input.trim();

    if (!text || sendingRef.current) return;

    sendingRef.current = true;
    setLoading(true);

    const userMessage: Message = {
      role: "user",
      content: text,
    };

    const conversation = [...messages, userMessage];

    setMessages([
      ...conversation,
      { role: "assistant", content: "" },
    ]);

    setInput("");

    try {
      const response = await fetch("http://127.0.0.1:8000/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: conversation,
          model: "qwen2.5-coder:7b",
        }),
      });

      if (!response.ok || !response.body) {
        throw new Error("Failed to connect to backend.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      let buffer = "";
      let finished = false;

      while (!finished) {
        const { value, done } = await reader.read();

        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;

          const event: StreamEvent = JSON.parse(line);

          if (event.type === "token") {
            setMessages((previous) => {
              const updated = [...previous];
              const lastIndex = updated.length - 1;

              updated[lastIndex] = {
                ...updated[lastIndex],
                content:
                  updated[lastIndex].content +
                  (event.content || ""),
              };

              return updated;
            });
          }

          if (event.type === "error") {
            throw new Error(event.content || "AI error");
          }

          if (event.type === "done") {
            finished = true;
            break;
          }
        }
      }

    } catch (error) {
      console.error(error);

      setMessages((previous) => {
        const updated = [...previous];
        const lastIndex = updated.length - 1;

        updated[lastIndex] = {
          ...updated[lastIndex],
          content:
            updated[lastIndex].content ||
            "An error occurred while contacting the AI.",
        };

        return updated;
      });

    } finally {
      sendingRef.current = false;
      setLoading(false);
    }
  }

  return (
    <div className="app">

      <header className="header">
        <h1>ECO AI</h1>
        <span>{loading ? "Generating..." : "Ready"}</span>
      </header>

      <main className="chat">

        {messages.length === 0 && (
          <div className="welcome">
            <h2>How can I help you?</h2>
            <p>Ask me anything about programming or other topics.</p>
          </div>
        )}

        {messages.map((message, index) => (
          <div
            key={index}
            className={`message ${message.role}`}
          >
            <div className="bubble">
              {message.content ||
                (loading && index === messages.length - 1
                  ? "Thinking..."
                  : "")}
            </div>
          </div>
        ))}

        <div ref={chatEndRef} />

      </main>

      <footer className="input-area">
        <input
          type="text"
          value={input}
          placeholder="Message AI Assistant..."
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              sendMessage();
            }
          }}
        />

        <button
          onClick={sendMessage}
          disabled={loading || !input.trim()}
        >
          Send
        </button>
      </footer>

    </div>
  );
}

export default App;