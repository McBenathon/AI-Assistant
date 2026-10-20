import { useEffect, useRef, useState } from "react";
import "./App.css";

type Message = {
  role: "user" | "assistant";
  content: string;
  attachments?: string[];
};

type Conversation = {
  id: number;
  title: string;
};

type StreamEvent = {
  type: "token" | "done" | "error";
  content?: string;
};

type Memory = {
  id: number;
  content: string;
  created_at: string;
};

type View = "chat" | "memory";

type MemorySuggestion = {
  conversationId: number;
  content: string;
};

const API = "http://127.0.0.1:8000";

function App() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeChat, setActiveChat] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  const [view, setView] = useState<View>("chat");

  const [memories, setMemories] = useState<Memory[]>([]);

  const [memoryInput, setMemoryInput] = useState("");

  const [memoryEnabled, setMemoryEnabled] = useState(true);

  const [editingMemory, setEditingMemory] = useState<number | null>(null);

  const [editingContent, setEditingContent] = useState("");

  const [memoryBusy, setMemoryBusy] = useState(false);

  const [memoryError, setMemoryError] = useState("");

  const chatEndRef = useRef<HTMLDivElement>(null);
  const sendingRef = useRef(false);

  const [suggestedMemory, setSuggestedMemory] =
    useState<MemorySuggestion | null>(null);

  const [savingSuggestion, setSavingSuggestion] =
    useState(false);

  const [attachmentFile, setAttachmentFile] =
    useState<File | null>(null);

  const [chatError, setChatError] =
    useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);

  async function loadConversations() {
    const response = await fetch(`${API}/conversations`);

    if (!response.ok) {
      throw new Error("Failed to load conversations");
    }

    const data: Conversation[] = await response.json();
    setConversations(data);
  }

  async function loadMessages(id: number) {
    const response = await fetch(
      `${API}/conversations/${id}/messages`
    );

    if (!response.ok) {
      throw new Error("Failed to load messages");
    }

    const data: Message[] = await response.json();

    setMessages(data);
    setActiveChat(id);
  }

  async function createChat(): Promise<number> {
    const response = await fetch(`${API}/conversations`, {
      method: "POST",
    });

    if (!response.ok) {
      throw new Error("Failed to create conversation");
    }

    const data: Conversation = await response.json();

    await loadConversations();
    setActiveChat(data.id);
    setMessages([]);

    return data.id;
  }

  async function deleteChat(id: number) {
    if (sendingRef.current) return;

    if (!window.confirm("Delete this conversation?")) {
      return;
    }

    const response = await fetch(`${API}/conversations/${id}`, {
      method: "DELETE",
    });

    if (!response.ok) {
      alert("Failed to delete conversation.");
      return;
    }

    await loadConversations();

    if (activeChat === id) {
      setActiveChat(null);
      setMessages([]);
    }
  }

  useEffect(() => {
    loadConversations().catch(console.error);
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({
      behavior: "smooth",
    });
  }, [messages]);

  async function requestMemorySuggestion(
    message: string,
    conversationId: number
  ) {
    try {
      const response = await fetch(
        `${API}/memories/suggest`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            message
          })
        }
      );

      if (!response.ok) {
        return;
      }

      const data: {
        suggestion: string | null;
      } = await response.json();

      if (data.suggestion) {
        setSuggestedMemory({
          conversationId,
          content: data.suggestion
        });
      }

    } catch (error) {
      console.error(
        "Memory suggestion failed:",
        error
      );
    }
  }


  function selectAttachment(
    event: React.ChangeEvent<HTMLInputElement>
  ) {
    const file = event.target.files?.[0];

    if (!file) return;

    const MAX_SIZE = 2 * 1024 * 1024;

    if (file.size > MAX_SIZE) {
      setChatError(
        "The selected file exceeds the 2 MB limit."
      );

      event.target.value = "";
      return;
    }

    setAttachmentFile(file);
    setChatError("");

    // Allow the same file to be selected again.
    event.target.value = "";
  }

  async function sendMessage() {

    const selectedFile = attachmentFile;

    const text =
      input.trim() ||
      (selectedFile
        ? "Please analyse and explain the attached file."
        : "");

    if (!text || sendingRef.current) {
      return;
    }

    sendingRef.current = true;

    setLoading(true);
    setChatError("");

    let placeholderAdded = false;

    try {

      // Create a conversation if necessary.
      let conversationId = activeChat;

      if (conversationId === null) {
        conversationId = await createChat();
      }

      let attachmentId: number | undefined;

      // Upload the selected file first.
      if (selectedFile) {

        const formData = new FormData();

        formData.append(
          "file",
          selectedFile
        );

        const uploadResponse = await fetch(
          `${API}/conversations/${conversationId}/attachments`,
          {
            method: "POST",
            body: formData
          }
        );

        if (!uploadResponse.ok) {

          const errorData = await uploadResponse
            .json()
            .catch(() => null);

          throw new Error(
            typeof errorData?.detail === "string"
              ? errorData.detail
              : "Unable to upload attachment."
          );
        }

        const uploadedAttachment: {
          id: number;
          filename: string;
        } = await uploadResponse.json();

        attachmentId = uploadedAttachment.id;
      }

      // Show the user's message in the interface.
      const userMessage: Message = {
        role: "user",
        content: text,
        attachments: selectedFile
          ? [selectedFile.name]
          : []
      };

      setMessages((previous) => [
        ...previous,
        userMessage,
        {
          role: "assistant",
          content: ""
        }
      ]);

      placeholderAdded = true;

      setInput("");
      setAttachmentFile(null);

      // Send the message to Qwen.
      const response = await fetch(
        `${API}/conversations/${conversationId}/chat`,
        {
          method: "POST",

          headers: {
            "Content-Type": "application/json"
          },

          body: JSON.stringify({
            message: text,
            ...(attachmentId !== undefined
              ? { attachment_id: attachmentId }
              : {})
          })
        }
      );

      if (!response.ok || !response.body) {
        throw new Error(
          `Chat request failed (${response.status}).`
        );
      }

      // Read the streaming response.
      const reader = response.body.getReader();

      const decoder = new TextDecoder();

      let buffer = "";
      let finished = false;

      while (!finished) {

        const { value, done } = await reader.read();

        if (done) break;

        buffer += decoder.decode(
          value,
          { stream: true }
        );

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
                  (event.content || "")
              };

              return updated;
            });
          }

          if (event.type === "error") {
            throw new Error(
              event.content || "AI error."
            );
          }

          if (event.type === "done") {
            finished = true;
            break;
          }
        }
      }

      if (!finished) {
        throw new Error(
          "The AI response ended unexpectedly."
        );
      }

      // Refresh saved conversations.
      await loadConversations();

      // Keep our automatic memory suggestions.
      void requestMemorySuggestion(
        text,
        conversationId
      );

    } catch (error) {

      console.error(error);

      setChatError(
        error instanceof Error
          ? error.message
          : "An unexpected error occurred."
      );

      // Remove an empty assistant placeholder
      // if the request failed.
      if (placeholderAdded) {

        setMessages((previous) => {

          const last = previous[previous.length - 1];

          if (
            last?.role === "assistant" &&
            !last.content
          ) {
            return previous.slice(0, -1);
          }

          return previous;
        });
      }

    } finally {

      sendingRef.current = false;

      setLoading(false);
    }
  }

  async function loadMemories() {
    const response = await fetch(`${API}/memories`);

    if (!response.ok) {
      throw new Error("Failed to load memories");
    }

    const data: Memory[] = await response.json();

    setMemories(data);
  }

  async function loadMemorySettings() {
    const response = await fetch(`${API}/settings/memory`);

    if (!response.ok) {
      throw new Error("Failed to load memory settings");
    }

    const data: { enabled: boolean } = await response.json();

    setMemoryEnabled(data.enabled);
  }

  async function openMemory() {
    if (loading) return;

    setView("memory");
    setMemoryError("");

    try {
      await Promise.all([
        loadMemories(),
        loadMemorySettings()
      ]);
    } catch (error) {
      console.error(error);
      setMemoryError("Unable to load memory settings.");
    }
  }

  async function addMemory() {
    const content = memoryInput.trim();

    if (!content || memoryBusy) return;

    setMemoryBusy(true);
    setMemoryError("");

    try {
      const response = await fetch(`${API}/memories`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ content })
      });

      if (!response.ok) {
        throw new Error("Failed to save memory");
      }

      setMemoryInput("");

      await loadMemories();

    } catch (error) {
      console.error(error);
      setMemoryError("Failed to save memory.");
    } finally {
      setMemoryBusy(false);
    }
  }

  async function removeMemory(id: number) {
    if (memoryBusy) return;

    if (!window.confirm("Delete this memory permanently?")) {
      return;
    }

    setMemoryBusy(true);
    setMemoryError("");

    try {
      const response = await fetch(`${API}/memories/${id}`, {
        method: "DELETE"
      });

      if (!response.ok) {
        throw new Error("Failed to delete memory");
      }

      await loadMemories();

    } catch (error) {
      console.error(error);
      setMemoryError("Failed to delete memory.");
    } finally {
      setMemoryBusy(false);
    }
  }

  function startEditing(memory: Memory) {
    setEditingMemory(memory.id);
    setEditingContent(memory.content);
  }

  async function saveEditedMemory() {
    if (editingMemory === null || memoryBusy) return;

    const content = editingContent.trim();

    if (!content) return;

    setMemoryBusy(true);
    setMemoryError("");

    try {
      const response = await fetch(
        `${API}/memories/${editingMemory}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ content })
        }
      );

      if (!response.ok) {
        throw new Error("Failed to update memory");
      }

      setEditingMemory(null);
      setEditingContent("");

      await loadMemories();

    } catch (error) {
      console.error(error);
      setMemoryError("Failed to update memory.");
    } finally {
      setMemoryBusy(false);
    }
  }

  async function toggleMemory() {
    if (memoryBusy || loading) return;

    const newValue = !memoryEnabled;

    setMemoryBusy(true);
    setMemoryError("");

    try {
      const response = await fetch(`${API}/settings/memory`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          enabled: newValue
        })
      });

      if (!response.ok) {
        throw new Error("Failed to update memory setting");
      }

      setMemoryEnabled(newValue);

    } catch (error) {
      console.error(error);
      setMemoryError("Failed to update memory setting.");
    } finally {
      setMemoryBusy(false);
    }
  }

  async function saveSuggestedMemory() {
    if (!suggestedMemory || savingSuggestion) {
      return;
    }

    setSavingSuggestion(true);

    try {
      const response = await fetch(
        `${API}/memories`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            content: suggestedMemory.content
          })
        }
      );

      if (!response.ok) {
        throw new Error(
          "Failed to save suggested memory"
        );
      }

      setSuggestedMemory(null);

    } catch (error) {
      console.error(error);

      alert("Unable to save memory.");

    } finally {
      setSavingSuggestion(false);
    }
  }

  function dismissSuggestedMemory() {
    setSuggestedMemory(null);
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <h2>AI Assistant</h2>

        <button
          className="new-chat"
          disabled={loading}
          onClick={() => {
            setView("chat");
            setActiveChat(null);
            setMessages([]);
            setSuggestedMemory(null);
            setAttachmentFile(null);
            setChatError("");
          }}
        >
          + New Chat
        </button>

        <button
          className="memory-nav"
          disabled={loading}
          onClick={openMemory}
        >
          🧠 Memory
        </button>

        <div className="conversation-list">
          {conversations.map((conversation) => (
            <div
              key={conversation.id}
              className={`conversation ${activeChat === conversation.id ? "active" : ""
                }`}
            >
              <button
                className="conversation-title"
                disabled={loading}

                onClick={async () => {
                  try {

                    await loadMessages(conversation.id);

                    setView("chat");

                    setAttachmentFile(null);
                    setChatError("");
                    setSuggestedMemory(null);

                  } catch (error) {

                    console.error(error);

                    alert("Failed to load conversation.");
                  }
                }}
              >
                {conversation.title}
              </button>

              <button
                className="delete-chat"
                disabled={loading}
                onClick={() => deleteChat(conversation.id)}
                title="Delete conversation"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </aside>

      <div className="main-area">
        {view === "memory" ? (
          <div className="memory-page">

            <div className="memory-header">
              <h1>Long-Term Memory</h1>

              <p>
                Manage information your AI assistant remembers
                across conversations.
              </p>
            </div>

            <div className="memory-settings">
              <div>
                <h3>Enable Memory</h3>

                <p>
                  Allow the assistant to use saved memories
                  when answering questions.
                </p>
              </div>

              <button
                className={`memory-toggle ${memoryEnabled ? "enabled" : "disabled"
                  }`}
                disabled={memoryBusy || loading}
                onClick={toggleMemory}
              >
                {memoryEnabled ? "ON" : "OFF"}
              </button>
            </div>

            <div className="memory-add">
              <h3>Add Memory</h3>

              <textarea
                value={memoryInput}
                onChange={(event) =>
                  setMemoryInput(event.target.value)
                }
                placeholder="Enter something you want the AI to remember..."
              />

              <button
                disabled={!memoryInput.trim() || memoryBusy}
                onClick={addMemory}
              >
                Save Memory
              </button>
            </div>

            {memoryError && (
              <p className="memory-error">{memoryError}</p>
            )}

            <div className="memory-list">
              <h3>Saved Memories ({memories.length})</h3>

              {memories.length === 0 && (
                <p className="memory-empty">
                  No memories saved yet.
                </p>
              )}

              {memories.map((memory) => (
                <div className="memory-card" key={memory.id}>

                  {editingMemory === memory.id ? (
                    <>
                      <textarea
                        value={editingContent}
                        onChange={(event) =>
                          setEditingContent(event.target.value)
                        }
                      />

                      <div className="memory-actions">
                        <button
                          disabled={!editingContent.trim() || memoryBusy}
                          onClick={saveEditedMemory}
                        >
                          Save
                        </button>

                        <button
                          disabled={memoryBusy}
                          onClick={() => setEditingMemory(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <p>{memory.content}</p>

                      <div className="memory-actions">
                        <button
                          disabled={memoryBusy}
                          onClick={() => startEditing(memory)}
                        >
                          Edit
                        </button>

                        <button
                          className="danger"
                          disabled={memoryBusy}
                          onClick={() => removeMemory(memory.id)}
                        >
                          Delete
                        </button>
                      </div>
                    </>
                  )}

                </div>
              ))}
            </div>

          </div>
        ) : (

          <>
            <header className="header">
              <h1>AI Assistant</h1>
              <span>{loading ? "Generating..." : "Ready"}</span>
            </header><main className="chat">
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

                    <div>
                      {message.content ||
                        (loading && index === messages.length - 1
                          ? "Thinking..."
                          : "")}
                    </div>

                    {message.attachments?.map(
                      (filename, attachmentIndex) => (

                        <div
                          key={attachmentIndex}
                          className="chat-attachment"
                        >
                          📎 {filename}
                        </div>

                      )
                    )}

                  </div>

                </div>
              ))}

              <div ref={chatEndRef} />
            </main>

            {suggestedMemory &&
              suggestedMemory.conversationId === activeChat && (
                <div className="memory-suggestion">

                  <div className="suggestion-heading">
                    🧠 Suggested Memory
                  </div>

                  <p>
                    {suggestedMemory.content}
                  </p>

                  <div className="suggestion-actions">

                    <button
                      className="suggestion-save"
                      disabled={savingSuggestion}
                      onClick={saveSuggestedMemory}
                    >
                      {savingSuggestion
                        ? "Saving..."
                        : "Save Memory"}
                    </button>

                    <button
                      className="suggestion-dismiss"
                      disabled={savingSuggestion}
                      onClick={dismissSuggestedMemory}
                    >
                      Dismiss
                    </button>

                  </div>

                </div>
              )}

            <footer className="input-area">

              <div className="composer">

                {/* Display the selected attachment */}

                {attachmentFile && (

                  <div className="selected-attachment">

                    <span>
                      📎 {attachmentFile.name}
                    </span>

                    <button
                      type="button"
                      disabled={loading}
                      onClick={() => setAttachmentFile(null)}
                      title="Remove attachment"
                    >
                      ✕
                    </button>

                  </div>

                )}

                {/* Display upload or chat errors */}

                {chatError && (

                  <div className="chat-error">
                    {chatError}
                  </div>

                )}

                <div className="composer-row">

                  {/* Hidden file input */}

                  <input
                    ref={fileInputRef}
                    type="file"
                    style={{ display: "none" }}
                    accept=".py,.gd,.java,.js,.jsx,.ts,.tsx,.json,.html,.css,.md,.txt,.log,.xml,.yaml,.yml,.toml,.sql,.sh,.csv,.pdf"
                    onChange={selectAttachment}
                  />

                  {/* Attachment button */}

                  <button
                    type="button"
                    className="attach-button"
                    disabled={loading}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    📎 Attach
                  </button>

                  {/* Message input */}

                  <input
                    type="text"
                    value={input}
                    placeholder="Message AI Assistant..."
                    onChange={(event) =>
                      setInput(event.target.value)
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        sendMessage();
                      }
                    }}
                  />

                  {/* Send button */}

                  <button
                    type="button"
                    disabled={
                      loading ||
                      (!input.trim() && !attachmentFile)
                    }
                    onClick={sendMessage}
                  >
                    {loading ? "Working..." : "Send"}
                  </button>

                </div>

              </div>

            </footer>
          </>
        )}
      </div>
    </div>
  );
}

export default App;


