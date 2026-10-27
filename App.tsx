import { useEffect, useRef, useState } from "react";
import "./App.css";

type Message = {
  role: "user" | "assistant";
  content: string;

  attachments?: string[];

  image?: {
    id: number;
    filename: string;
  } | null;

  sources?: WebSource[];
};

type Conversation = {
  id: number;
  title: string;
};

type StreamEvent = {
  type:
  | "token"
  | "done"
  | "error"
  | "sources"
  | "search_status";

  content?: string;
  sources?: WebSource[];

  mode?: WebSearchMode;
  used?: boolean;
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

type WebSource = {
  title: string;
  url: string;
  description: string;
};

type WebSearchMode = "off" | "auto" | "on";

type InstalledModel = {
  name: string;
  supports_vision: boolean;
  parameter_size: string | null;
  quantization: string | null;
};

type AISettings = {

  temperature: number;

  context_length: number;

  max_output_tokens: number;

  default_model: string;

  default_search_mode: WebSearchMode;

};

const API = import.meta.env.DEV
  ? "http://127.0.0.1:8000"
  : "";


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

  const [webSearchMode, setWebSearchMode] =
    useState<WebSearchMode>("off");

  const [searchingWeb, setSearchingWeb] =
    useState(false);

  const [searchDecision, setSearchDecision] =
    useState<string>("");

  const [availableModels, setAvailableModels] =
    useState<InstalledModel[]>([]);

  const [selectedModel, setSelectedModel] =
    useState<string>(
      () =>
        localStorage.getItem(
          "ai-assistant-selected-model"
        ) || ""
    );

  const [modelsLoading, setModelsLoading] =
    useState(true);

  const [modelsError, setModelsError] =
    useState("");

  const [aiSettings, setAiSettings] =
    useState<AISettings | null>(null);

  const [settingsOpen, setSettingsOpen] =
    useState(false);

  const [settingsSaving, setSettingsSaving] =
    useState(false);

  const [settingsError, setSettingsError] =
    useState("");

  const [settingsNotice, setSettingsNotice] =
    useState("");

  const [savedDefaultModel, setSavedDefaultModel] =
    useState<string | null>(null);


  useEffect(() => {

    let cancelled = false;

    async function loadModels() {

      try {

        setModelsLoading(true);
        setModelsError("");

        const response = await fetch(`${API}/models`);

        if (!response.ok) {
          throw new Error(
            "Unable to retrieve installed models."
          );
        }

        const data: {
          models: InstalledModel[];
          default_model: string;
          vision_model: string;
        } = await response.json();
        console.log("MODELS RECEIVED FROM BACKEND:", data);

        console.log(
          "MODEL NAMES:",
          data.models.map((model) => model.name)
        );

        if (cancelled) {
          return;
        }

        setAvailableModels(data.models);

        // Keep the previously selected model
        // if it is still installed.
        setSelectedModel((current) => {

          const stillInstalled = data.models.some(
            (model) => model.name === current
          );

          if (stillInstalled) {
            return current;
          }

          // Otherwise use the backend default.
          const defaultInstalled = data.models.some(
            (model) =>
              model.name === data.default_model
          );

          if (defaultInstalled) {
            return data.default_model;
          }

          // Final fallback: first available model.
          return data.models[0]?.name || "";
        });

      } catch (error) {

        console.error(
          "Unable to load models:",
          error
        );

        if (!cancelled) {
          setModelsError(
            "Could not load Ollama models."
          );
        }

      } finally {

        if (!cancelled) {
          setModelsLoading(false);
        }
      }
    }

    void loadModels();

    return () => {
      cancelled = true;
    };

  }, []);

  useEffect(() => {

    if (!selectedModel) {
      return;
    }

    localStorage.setItem(
      "ai-assistant-selected-model",
      selectedModel
    );

  }, [selectedModel]);

  useEffect(() => {

    let cancelled = false;

    async function loadAISettings() {

      try {

        const response = await fetch(
          `${API}/settings/ai`
        );

        if (!response.ok) {
          throw new Error(
            "Unable to load AI settings."
          );
        }

        const data: AISettings =
          await response.json();

        if (cancelled) {
          return;
        }

        setAiSettings(data);

        // Restore the default Web Search mode.
        setWebSearchMode(
          data.default_search_mode
        );

        // Remember which default model should
        // be selected once models are loaded.
        setSavedDefaultModel(
          data.default_model
        );

      } catch (error) {

        console.error(
          "Settings loading failed:",
          error
        );

        if (!cancelled) {
          setSettingsError(
            "Unable to load saved AI settings."
          );
        }

      }
    }

    void loadAISettings();

    return () => {
      cancelled = true;
    };

  }, []);


  useEffect(() => {

    if (
      !savedDefaultModel ||
      modelsLoading ||
      availableModels.length === 0
    ) {
      return;
    }

    const installed = availableModels.some(
      (model) =>
        model.name === savedDefaultModel
    );

    if (installed) {

      setSelectedModel(
        savedDefaultModel
      );

    }

  }, [
    savedDefaultModel,
    modelsLoading,
    availableModels
  ]);

  async function loadConversations() {
    const response = await fetch(`${API}/conversations`);

    if (!response.ok) {
      throw new Error("Failed to load conversations");
    }

    const data: Conversation[] = await response.json();
    setConversations(data);
  }

  const [imagePreview, setImagePreview] =
    useState<string | null>(null);

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


  function isImageFile(file: File): boolean {

    const name = file.name.toLowerCase();

    return (
      name.endsWith(".png") ||
      name.endsWith(".jpg") ||
      name.endsWith(".jpeg") ||
      name.endsWith(".webp")
    );
  }

  function selectAttachment(
    event: React.ChangeEvent<HTMLInputElement>
  ) {

    const file = event.target.files?.[0];

    if (!file) return;

    const maxSize = isImageFile(file)
      ? 5 * 1024 * 1024
      : 2 * 1024 * 1024;

    if (file.size > maxSize) {

      setChatError(
        isImageFile(file)
          ? "Images must be smaller than 5 MB."
          : "Documents must be smaller than 2 MB."
      );

      event.target.value = "";
      return;
    }

    setAttachmentFile(file);
    setChatError("");

    event.target.value = "";
  }

  function cycleWebSearchMode() {

    setWebSearchMode((current) => {

      if (current === "off") {
        return "auto";
      }

      if (current === "auto") {
        return "on";
      }

      return "off";
    });
  }


  async function saveAISettings() {

    if (
      !aiSettings ||
      !selectedModel ||
      settingsSaving ||
      loading
    ) {
      return;
    }

    setSettingsSaving(true);

    setSettingsError("");

    setSettingsNotice("");

    try {

      // Save the current generation settings,
      // selected model and Web Search mode.
      const updatedSettings: AISettings = {

        ...aiSettings,

        default_model: selectedModel,

        default_search_mode: webSearchMode

      };

      if (
        updatedSettings.max_output_tokens >
        updatedSettings.context_length
      ) {

        throw new Error(
          "Maximum output tokens cannot exceed " +
          "the context length."
        );

      }

      const response = await fetch(
        `${API}/settings/ai`,
        {

          method: "PUT",

          headers: {
            "Content-Type": "application/json"
          },

          body: JSON.stringify(
            updatedSettings
          )

        }
      );

      if (!response.ok) {

        throw new Error(
          `Unable to save settings (${response.status}).`
        );

      }

      const saved: AISettings =
        await response.json();

      setAiSettings(saved);

      setSavedDefaultModel(
        saved.default_model
      );

      setSettingsNotice(
        "Settings saved successfully."
      );

    } catch (error) {

      console.error(
        "Settings save failed:",
        error
      );

      setSettingsError(
        error instanceof Error
          ? error.message
          : "Unable to save settings."
      );

    } finally {

      setSettingsSaving(false);

    }
  }


  async function sendMessage() {

    const selectedFile = attachmentFile;
    const selectedSearchMode = webSearchMode;

    const text =
      input.trim() ||
      (selectedFile
        ? isImageFile(selectedFile)
          ? "Please describe and analyse this image."
          : "Please analyse and explain the attached file."
        : "");

    if (!text || sendingRef.current) {
      return;
    }

    sendingRef.current = true;

    setLoading(true);
    setChatError("");
    setSearchDecision("");

    setSearchingWeb(
      selectedSearchMode !== "off"
    );

    let placeholderAdded = false;

    try {

      // Create a conversation if necessary.
      let conversationId = activeChat;

      if (conversationId === null) {
        conversationId = await createChat();
      }

      let attachmentId: number | undefined;
      let imageId: number | undefined;

      // Upload the selected file first.
      if (selectedFile) {

        const formData = new FormData();

        formData.append("file", selectedFile);

        const imageSelected = isImageFile(selectedFile);

        const uploadUrl = imageSelected
          ? `${API}/conversations/${conversationId}/images`
          : `${API}/conversations/${conversationId}/attachments`;

        const uploadResponse = await fetch(
          uploadUrl,
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

        const uploaded = await uploadResponse.json();

        if (imageSelected) {
          imageId = uploaded.id;
        } else {
          attachmentId = uploaded.id;
        }
      }

      // Show the user's message in the interface.
      const userMessage: Message = {
        role: "user",
        content: text,

        attachments:
          selectedFile && !isImageFile(selectedFile)
            ? [selectedFile.name]
            : [],

        image:
          selectedFile &&
            isImageFile(selectedFile) &&
            imageId !== undefined
            ? {
              id: imageId,
              filename: selectedFile.name
            }
            : null
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

            web_search_mode: selectedSearchMode,

            // Send the selected Ollama model.
            ...(selectedModel
              ? { model: selectedModel }
              : {}),

            ...(attachmentId !== undefined
              ? { attachment_id: attachmentId }
              : {}),

            ...(imageId !== undefined
              ? { image_id: imageId }
              : {})
          })
        }
      );

      setSearchingWeb(false);

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

          if (event.type === "search_status") {

            console.log(
              "Web search mode:",
              event.mode
            );

            console.log(
              "Web search used:",
              event.used
            );

            if (event.mode === "auto") {

              setSearchDecision(
                event.used
                  ? "🌐 AUTO searched the internet"
                  : "🧠 AUTO answered locally"
              );

            } else {

              setSearchDecision("");
            }
          }


          if (event.type === "sources") {
            console.log(
              "Sources received from backend:",
              event.sources
            );
          }

          if (event.type === "sources") {

            setMessages((previous) => {

              const updated = [...previous];

              const lastIndex = updated.length - 1;

              if (updated[lastIndex]?.role === "assistant") {

                updated[lastIndex] = {
                  ...updated[lastIndex],
                  sources: event.sources || []
                };

              }

              return updated;
            });

          }

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
      if (!selectedFile) {
        void requestMemorySuggestion(
          text,
          conversationId
        );
      }

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
      setSearchingWeb(false);
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

  useEffect(() => {

    if (!attachmentFile || !isImageFile(attachmentFile)) {
      setImagePreview(null);
      return;
    }

    const objectUrl = URL.createObjectURL(
      attachmentFile
    );

    setImagePreview(objectUrl);

    return () => {
      URL.revokeObjectURL(objectUrl);
    };

  }, [attachmentFile]);

  return (
    <div className="app">
      <aside className="sidebar">
        <h2>ECO AI</h2>

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

              <span>
                {searchingWeb
                  ? webSearchMode === "auto"
                    ? "🧠 Evaluating web search..."
                    : "🌐 Searching the web..."
                  : loading
                    ? "Generating..."
                    : searchDecision || "Ready"}
              </span>

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

                    {message.image && activeChat !== null && (

                      <div className="chat-image-container">

                        <img
                          src={
                            `${API}/conversations/${activeChat}` +
                            `/images/${message.image.id}`
                          }
                          alt={message.image.filename}
                          className="chat-image"
                        />

                        <div className="chat-image-name">
                          📎 {message.image.filename}
                        </div>

                      </div>

                    )}

                    {message.role === "assistant" &&
                      message.sources &&
                      message.sources.length > 0 && (

                        <div className="web-sources">

                          <div className="web-sources-heading">
                            🌐 Web Sources
                          </div>

                          <div className="web-sources-list">

                            {message.sources.map((source, index) => (

                              <a
                                key={index}
                                href={source.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="web-source"
                              >

                                <span className="web-source-number">
                                  {index + 1}
                                </span>

                                <div className="web-source-info">

                                  <div className="web-source-title">
                                    {source.title || source.url}
                                  </div>

                                  <div className="web-source-url">
                                    {source.url}
                                  </div>

                                </div>

                              </a>

                            ))}

                          </div>

                        </div>

                      )}

                  </div>

                </div>
              ))}

              <div ref={chatEndRef} />
            </main>

            <div className="model-selector">

              <label htmlFor="ollama-model-select">
                AI Model
              </label>

              <select
                id="ollama-model-select"
                value={selectedModel}
                disabled={
                  loading ||
                  modelsLoading ||
                  availableModels.length === 0
                }
                onChange={(event) => {
                  setSelectedModel(event.target.value);
                }}
              >

                {availableModels.length === 0 && (
                  <option value="">
                    {modelsLoading
                      ? "Loading models..."
                      : "No models available"}
                  </option>
                )}

                {availableModels.map((model) => (

                  <option
                    key={model.name}
                    value={model.name}
                  >

                    {model.name}

                    {model.supports_vision
                      ? " (Vision)"
                      : ""}

                  </option>

                ))}

              </select>

              {modelsError && (
                <span className="model-error">
                  {modelsError}
                </span>
              )}

              <button

                type="button"

                className="settings-button"

                disabled={loading || settingsSaving}

                onClick={() => {
                  setSettingsOpen(
                    (current) => !current
                  );
                }}

              >
                ⚙ Settings
              </button>

            </div>

            {settingsOpen && (

              <section className="ai-settings-panel">

                <h3>⚙ AI Settings</h3>

                {aiSettings ? (

                  <>

                    {/* TEMPERATURE */}

                    <div className="ai-setting-field">

                      <label htmlFor="ai-temperature">
                        Temperature
                      </label>

                      <p>
                        Lower values produce more predictable
                        responses. Higher values allow more
                        variation.
                      </p>

                      <input
                        id="ai-temperature"
                        type="number"
                        min="0"
                        max="1.5"
                        step="0.1"
                        value={aiSettings.temperature}
                        disabled={loading || settingsSaving}

                        onChange={(event) => {

                          setAiSettings((current) =>

                            current
                              ? {
                                ...current,
                                temperature: Number(
                                  event.target.value
                                )
                              }
                              : current

                          );

                        }}
                      />

                    </div>


                    {/* CONTEXT LENGTH */}

                    <div className="ai-setting-field">

                      <label htmlFor="ai-context-length">
                        Context Length
                      </label>

                      <p>
                        Larger values allow more conversation
                        history, documents and search results,
                        but require more memory.
                      </p>

                      <select
                        id="ai-context-length"
                        value={aiSettings.context_length}
                        disabled={loading || settingsSaving}

                        onChange={(event) => {

                          setAiSettings((current) =>

                            current
                              ? {
                                ...current,
                                context_length: Number(
                                  event.target.value
                                )
                              }
                              : current

                          );

                        }}
                      >

                        <option value={2048}>
                          2048 tokens
                        </option>

                        <option value={4096}>
                          4096 tokens
                        </option>

                        <option value={8192}>
                          8192 tokens
                        </option>

                        <option value={16384}>
                          16384 tokens
                        </option>

                      </select>

                    </div>


                    {/* MAXIMUM OUTPUT TOKENS */}

                    <div className="ai-setting-field">

                      <label htmlFor="ai-max-output">
                        Maximum Output Tokens
                      </label>

                      <p>
                        Limits the maximum length of
                        each AI response.
                      </p>

                      <select
                        id="ai-max-output"
                        value={aiSettings.max_output_tokens}
                        disabled={loading || settingsSaving}

                        onChange={(event) => {

                          setAiSettings((current) =>

                            current
                              ? {
                                ...current,
                                max_output_tokens: Number(
                                  event.target.value
                                )
                              }
                              : current

                          );

                        }}
                      >

                        <option value={512}>
                          512 tokens
                        </option>

                        <option value={1024}>
                          1024 tokens
                        </option>

                        <option value={2048}>
                          2048 tokens
                        </option>

                        <option value={4096}>
                          4096 tokens
                        </option>

                      </select>

                    </div>


                    {/* DEFAULT MODEL */}

                    <div className="ai-setting-field">

                      <label>
                        Default Model
                      </label>

                      <p>
                        The model currently selected in
                        the AI Model dropdown will become
                        your saved default:
                      </p>

                      <strong>
                        {selectedModel || "None selected"}
                      </strong>

                    </div>


                    {/* DEFAULT WEB SEARCH MODE */}

                    <div className="ai-setting-field">

                      <label>
                        Default Web Search Mode
                      </label>

                      <p>
                        The currently selected Web Search
                        mode will become your saved default.
                      </p>

                      <strong>
                        {webSearchMode.toUpperCase()}
                      </strong>

                    </div>


                    {/* STATUS MESSAGES */}

                    {settingsError && (

                      <div className="ai-settings-error">
                        {settingsError}
                      </div>

                    )}

                    {settingsNotice && (

                      <div className="ai-settings-success">
                        {settingsNotice}
                      </div>

                    )}


                    {/* SAVE BUTTON */}

                    <button
                      type="button"
                      className="ai-settings-save"

                      disabled={
                        loading ||
                        settingsSaving ||
                        !selectedModel
                      }

                      onClick={saveAISettings}
                    >

                      {settingsSaving
                        ? "Saving..."
                        : "Save Settings"}

                    </button>

                  </>

                ) : (

                  <p>
                    {settingsError || "Loading settings..."}
                  </p>

                )}

              </section>

            )}

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
                  <div className="selected-file-container">

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

                    {imagePreview && (
                      <img
                        src={imagePreview}
                        alt="Selected attachment preview"
                        className="image-preview"
                      />
                    )}

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
                    accept=".py,.gd,.java,.js,.jsx,.ts,.tsx,.json,.html,.css,.md,.txt,.log,.xml,.yaml,.yml,.toml,.sql,.sh,.csv,.pdf,.png,.jpg,.jpeg,.webp"
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
                  <button
                    type="button"
                    className={`web-search-button ${webSearchMode
                      }`}
                    disabled={loading}
                    onClick={cycleWebSearchMode}
                    title={`Web Search: ${webSearchMode.toUpperCase()}`}
                  >
                    🌐 Web Search

                    <span>
                      {webSearchMode.toUpperCase()}
                    </span>
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


